// Basketball math for the game screens: rules presets, the play-by-play order and
// position keys, box scores, team fouls and the bonus, and foul trouble. Pure functions
// over the sync view. The stats, foul types and rules check live in
// $lib/sync/basketball.ts, shared with the mutators.
//
// Rules sources: docs/research/basketball-rules.md.

import { DEFAULT_RULES, MADE_FIELD_GOALS, type Rules, type Stat } from '$lib/sync/basketball';
import type { Game, Play, State } from '$lib/sync/types';

// --- rules presets -------------------------------------------------------------------

export interface Preset {
	key: string;
	name: string;
	rules: Rules;
}

export const PRESETS: readonly Preset[] = [
	{ key: 'nfhs', name: 'High school (NFHS)', rules: DEFAULT_RULES },
	{
		key: 'nfhs_pre_2023',
		name: 'High school before 2023–24',
		rules: { ...DEFAULT_RULES, team_fouls_reset: 'half', bonus_at: 7, bonus: 'one_and_one', double_bonus_at: 10 }
	},
	{
		key: 'ncaa_women',
		name: "NCAA women's",
		rules: { ...DEFAULT_RULES, period_minutes: 10, overtime_minutes: 5 }
	},
	{
		key: 'ncaa_men',
		name: "NCAA men's",
		rules: {
			periods: 2,
			period_minutes: 20,
			overtime_minutes: 5,
			team_fouls_reset: 'half',
			bonus_at: 7,
			bonus: 'one_and_one',
			double_bonus_at: 10,
			foul_out_at: 5,
			technicals_to_eject: 2
		}
	}
];

const same = (a: Rules, b: Rules) => (Object.keys(a) as (keyof Rules)[]).every((k) => a[k] === b[k]);

/** The preset these rules match, or null for custom rules. */
export const presetOf = (rules: Rules): Preset | null => PRESETS.find((p) => same(p.rules, rules)) ?? null;

/** "Q2", "H1", "OT", "2OT". */
export function periodLabel(rules: Rules, period: number): string {
	if (period > rules.periods) {
		const ot = period - rules.periods;
		return ot === 1 ? 'OT' : `${ot}OT`;
	}
	return rules.periods === 2 ? `H${period}` : `Q${period}`;
}

// --- order and position keys ----------------------------------------------------------

/** A game's live plays in play-by-play order: by position, then id for ties between phones. */
export function playsOf(state: State, gameId: string): Play[] {
	return [...state.plays.values()]
		.filter((p) => p.game_id === gameId)
		.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1));
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A position key that sorts strictly between `before` and `after` (null means the
 * start or the end). Keys are base-36 digit strings compared as plain strings, with no
 * trailing '0', so there's always room between two of them. This is the midpoint
 * step of fractional indexing (David Greenspan's algorithm).
 */
export function positionBetween(before: string | null, after: string | null): string {
	const a = before ?? '';
	if (after !== null && a >= after) throw new Error(`positionBetween: ${a} is not before ${after}`);
	return midpoint(a, after);
}

function midpoint(a: string, b: string | null): string {
	if (b !== null) {
		// Keep the shared prefix (a padded with '0's), then work on what follows it.
		let n = 0;
		while ((a[n] ?? '0') === b[n]) n++;
		if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
	}
	const lo = a ? DIGITS.indexOf(a[0]) : 0;
	const hi = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
	if (hi - lo > 1) return DIGITS[Math.round((lo + hi) / 2)];
	// Adjacent first digits. If `after` has more digits, its first digit alone fits.
	if (b !== null && b.length > 1) return b.slice(0, 1);
	// Otherwise keep `before`'s first digit and go past the rest of it.
	return DIGITS[lo] + midpoint(a.slice(1), null);
}

/**
 * The position for a play added at the end of the game, as the live screen does: the
 * time it was recorded, in base 36 and fixed width, so plays from two phones interleave
 * by time and keys stay 10 characters long. If this phone's clock is behind the last
 * play (clock drift, or two taps in one millisecond), it goes just after it instead.
 */
export function positionAtEnd(plays: readonly Play[], now = Date.now()): string {
	// The trailing 'i' keeps keys from ending in '0', which positionBetween needs.
	const key = `${now.toString(36).padStart(9, '0')}i`;
	const last = plays.at(-1)?.position ?? null;
	return last === null || key > last ? key : positionBetween(last, null);
}

// --- box score -------------------------------------------------------------------------

export interface Line {
	pts: number;
	fgm: number;
	fga: number;
	tpm: number;
	tpa: number;
	ftm: number;
	fta: number;
	oreb: number;
	dreb: number;
	reb: number;
	ast: number;
	stl: number;
	blk: number;
	/** Turnovers, including offensive fouls. */
	tov: number;
	/** Fouls committed, of every type. */
	pf: number;
	/** Fouls by the other team that this player drew. */
	fd: number;
}

const emptyLine = (): Line => ({
	pts: 0,
	fgm: 0,
	fga: 0,
	tpm: 0,
	tpa: 0,
	ftm: 0,
	fta: 0,
	oreb: 0,
	dreb: 0,
	reb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tov: 0,
	pf: 0,
	fd: 0
});

const POINTS: Partial<Record<Stat, number>> = { ft_made: 1, fg2_made: 2, fg3_made: 3 };

/** Adds one play's stat to a line (the player who made the play). */
function add(line: Line, play: Play) {
	line.pts += POINTS[play.stat] ?? 0;
	switch (play.stat) {
		case 'fg2_made':
			line.fgm++;
			line.fga++;
			break;
		case 'fg2_missed':
			line.fga++;
			break;
		case 'fg3_made':
			line.fgm++;
			line.fga++;
			line.tpm++;
			line.tpa++;
			break;
		case 'fg3_missed':
			line.fga++;
			line.tpa++;
			break;
		case 'ft_made':
			line.ftm++;
			line.fta++;
			break;
		case 'ft_missed':
			line.fta++;
			break;
		case 'oreb':
			line.oreb++;
			line.reb++;
			break;
		case 'dreb':
			line.dreb++;
			line.reb++;
			break;
		case 'stl':
			line.stl++;
			break;
		case 'blk':
			line.blk++;
			break;
		case 'tov':
			line.tov++;
			break;
		case 'foul':
			line.pf++;
			// An offensive foul is one play that counts as a foul and a turnover.
			if (play.foul_type === 'offensive') line.tov++;
			break;
	}
}

export interface BoxScore {
	/** Each of our players with any play, assist or foul drawn. */
	players: Map<string, Line>;
	/** All of our plays, with or without a player. */
	team: Line;
	/** The other team's totals. */
	opponent: Line;
	/** From the plays. Compare `official` on the game. */
	score: { us: number; them: number };
}

export function boxScore(plays: readonly Play[]): BoxScore {
	const players = new Map<string, Line>();
	const lineOf = (id: string) => players.get(id) ?? players.set(id, emptyLine()).get(id)!;
	const team = emptyLine();
	const opponent = emptyLine();

	for (const p of plays) {
		if (p.side === 'them') {
			add(opponent, p);
			if (p.drawn_by_player_id) lineOf(p.drawn_by_player_id).fd++;
			continue;
		}
		add(team, p);
		if (p.player_id) add(lineOf(p.player_id), p);
		if (p.assist_player_id) {
			lineOf(p.assist_player_id).ast++;
			team.ast++;
		}
	}

	return { players, team, opponent, score: { us: team.pts, them: opponent.pts } };
}

/** Points the plays are missing compared with the scorebook, or null if there's no official score. */
export function scoreMismatch(game: Game, score: { us: number; them: number }) {
	if (game.official_us === null || game.official_them === null) return null;
	const us = game.official_us - score.us;
	const them = game.official_them - score.them;
	return us === 0 && them === 0 ? null : { us, them };
}

export const pct = (made: number, attempted: number) => (attempted ? Math.round((made / attempted) * 100) : null);

// --- team fouls and the bonus ------------------------------------------------------------

/**
 * Which stretch of the game team fouls count over. Fouls reset each quarter or each
 * half, but never going into overtime: overtime continues the last regulation quarter
 * or half (NFHS, NCAA men and women alike).
 */
export function foulPeriodOf(rules: Rules, period: number): number {
	const p = Math.min(period, rules.periods);
	if (rules.team_fouls_reset === 'period') return p;
	return p <= rules.periods / 2 ? 1 : 2;
}

/** Fouls `side` has committed in the same foul stretch as `period`. Every foul type counts. */
export function teamFouls(plays: readonly Play[], rules: Rules, side: Play['side'], period: number): number {
	const stretch = foulPeriodOf(rules, period);
	return plays.filter((p) => p.side === side && p.stat === 'foul' && foulPeriodOf(rules, p.period) === stretch).length;
}

export type Bonus = 'none' | 'one_and_one' | 'two_shots';

/** The free throws `side` shoots on the other team's next common foul in `period`. */
export function bonusFor(plays: readonly Play[], rules: Rules, side: Play['side'], period: number): Bonus {
	const fouls = teamFouls(plays, rules, side === 'us' ? 'them' : 'us', period) + 1;
	if (rules.double_bonus_at !== null && fouls >= rules.double_bonus_at) return 'two_shots';
	if (fouls >= rules.bonus_at) return rules.bonus;
	return 'none';
}

// --- foul trouble --------------------------------------------------------------------------

export interface FoulTrouble {
	fouls: number;
	technicals: number;
	fouledOut: boolean;
	/** Two technicals, or one flagrant foul. */
	ejected: boolean;
}

/** A player's fouls in a game. Every foul type counts toward fouling out. */
export function foulTrouble(plays: readonly Play[], rules: Rules, playerId: string): FoulTrouble {
	const mine = plays.filter((p) => p.side === 'us' && p.stat === 'foul' && p.player_id === playerId);
	const technicals = mine.filter((p) => p.foul_type === 'technical').length;
	return {
		fouls: mine.length,
		technicals,
		fouledOut: mine.length >= rules.foul_out_at,
		ejected: technicals >= rules.technicals_to_eject || mine.some((p) => p.foul_type === 'flagrant')
	};
}

export { MADE_FIELD_GOALS };
