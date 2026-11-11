// Season totals across a team's games, and practice compared with games for the shots a
// drill practices. Pure functions over the sync view.

import type { Game, GameStat, Season, State } from '$lib/sync/types';
import { boxScore, emptyLine, playsOf, type Line } from './basketball';
import { effSetup } from './domain';

function addLine(to: Line, from: Line) {
	for (const k of Object.keys(to) as (keyof Line)[]) to[k] += from[k];
}

/** A player's (or the team's) totals over the games they have a line in. */
export interface SeasonLine {
	/** Games with at least one play, assist or foul drawn credited. */
	gp: number;
	line: Line;
}

export interface SeasonTotals {
	players: Map<string, SeasonLine>;
	/** Our totals, over the games that have plays. */
	team: SeasonLine;
	opponent: SeasonLine;
}

/** Adds up the box scores of `games`. A game with no plays counts for no one. */
export function seasonTotals(state: State, games: readonly Game[]): SeasonTotals {
	const players = new Map<string, SeasonLine>();
	const team: SeasonLine = { gp: 0, line: emptyLine() };
	const opponent: SeasonLine = { gp: 0, line: emptyLine() };
	for (const game of games) {
		const plays = playsOf(state, game.id);
		if (!plays.length) continue;
		const box = boxScore(plays);
		team.gp++;
		opponent.gp++;
		addLine(team.line, box.team);
		addLine(opponent.line, box.opponent);
		for (const [id, line] of box.players) {
			const s = players.get(id) ?? players.set(id, { gp: 0, line: emptyLine() }).get(id)!;
			s.gp++;
			addLine(s.line, line);
		}
	}
	// Fouls drawn are credited to players only, so the team's are theirs added up.
	team.line.fd = [...players.values()].reduce((n, s) => n + s.line.fd, 0);
	return { players, team, opponent };
}

/** A player's line in each game they have one, in the order of `games`. */
export function gameLog(state: State, games: readonly Game[], playerId: string): { game: Game; line: Line }[] {
	return games.flatMap((game) => {
		const line = boxScore(playsOf(state, game.id)).players.get(playerId);
		return line ? [{ game, line }] : [];
	});
}

/** A per-game average, to one decimal. */
export const perGame = (total: number, gp: number) => (gp ? (Math.round((total / gp) * 10) / 10).toFixed(1) : '–');

export const GAME_STAT_LABEL: Record<GameStat, string> = {
	ft: 'Free throws',
	fg2: '2-point shots',
	fg3: '3-point shots'
};

/** Makes and attempts of one kind of shot in a box score line. */
export function shotsOf(line: Line, stat: GameStat): Shots {
	switch (stat) {
		case 'ft':
			return { made: line.ftm, att: line.fta };
		case 'fg3':
			return { made: line.tpm, att: line.tpa };
		case 'fg2':
			return { made: line.fgm - line.tpm, att: line.fga - line.tpa };
	}
}

export interface Shots {
	made: number;
	att: number;
}

export interface Comparison {
	playerId: string;
	practice: Shots;
	games: Shots;
}

/**
 * Practice against games for one kind of shot: each player's makes and attempts in the
 * season's runs of drills that practice it, and in `games`. Practice counts only
 * results with a known number of shots. Players come in `order`, then anyone else
 * with shots in either, and only players with some.
 */
export function practiceVsGames(
	state: State,
	programId: string,
	season: Season | undefined,
	games: readonly Game[],
	stat: GameStat,
	order: readonly string[],
	only?: ReadonlySet<string>
): Comparison[] {
	const rows = new Map<string, Comparison>();
	const rowOf = (id: string) =>
		rows.get(id) ?? rows.set(id, { playerId: id, practice: { made: 0, att: 0 }, games: { made: 0, att: 0 } }).get(id)!;

	const drills = new Set(
		[...state.drills.values()].filter((d) => d.program_id === programId && d.kind === 'makes' && d.game_stat === stat).map((d) => d.id)
	);
	for (const run of state.runs.values()) {
		if (!drills.has(run.drill_id)) continue;
		if (season && (run.date < season.starts_on || run.date > season.ends_on)) continue;
		for (const r of state.results.values()) {
			if (r.drill_run_id !== run.id || r.value === null) continue;
			const att = effSetup(run, r);
			if (!att) continue;
			const row = rowOf(r.player_id);
			row.practice.made += r.value;
			row.practice.att += att;
		}
	}
	for (const [id, s] of seasonTotals(state, games).players) {
		const shots = shotsOf(s.line, stat);
		if (!shots.att) continue;
		const row = rowOf(id);
		row.games.made += shots.made;
		row.games.att += shots.att;
	}

	const rank = new Map(order.map((id, i) => [id, i]));
	const name = (id: string) => state.players.get(id)?.name ?? '';
	return [...rows.values()]
		.filter((r) => (!only || only.has(r.playerId)) && state.players.has(r.playerId))
		.sort(
			(a, b) =>
				(rank.get(a.playerId) ?? Infinity) - (rank.get(b.playerId) ?? Infinity) || name(a.playerId).localeCompare(name(b.playerId))
		);
}

/** The game stats with at least one drill in the program that practices them. */
export function linkedStats(state: State, programId: string): GameStat[] {
	const have = new Set(
		[...state.drills.values()].filter((d) => d.program_id === programId && d.kind === 'makes' && d.game_stat).map((d) => d.game_stat!)
	);
	return (['ft', 'fg2', 'fg3'] as const).filter((s) => have.has(s));
}
