import { describe, expect, it } from 'vitest';
import { apply } from '$lib/sync/mutators';
import { drill, game, play, player, PROGRAM, run, SEASON, setValue, structure } from '$lib/sync/testing/fixtures';
import { emptyState, type MutationInput, type State } from '$lib/sync/types';
import { gameLog, linkedStats, perGame, practiceVsGames, seasonTotals, shotsOf } from './season';

const build = (...changes: MutationInput[]) => [...structure(), ...changes].reduce(apply, emptyState());
const gamesIn = (state: State) => [...state.games.values()].sort((a, b) => b.date.localeCompare(a.date));

describe('seasonTotals', () => {
	it("adds up each player's games and counts the games they played", () => {
		const ana = player({ name: 'Ana' });
		const bo = player({ name: 'Bo' });
		const g1 = game({ date: '2026-11-20' });
		const g2 = game({ date: '2026-11-24' });
		const empty = game({ date: '2026-11-28' });
		const state = build(
			ana,
			bo,
			g1,
			g2,
			empty,
			play(g1.args.id, { player_id: ana.args.id, stat: 'fg3_made', assist_player_id: bo.args.id }),
			play(g1.args.id, { player_id: ana.args.id, stat: 'ft_missed' }),
			play(g2.args.id, { player_id: ana.args.id, stat: 'fg2_made' }),
			play(g2.args.id, { side: 'them', stat: 'foul', foul_type: 'personal', drawn_by_player_id: bo.args.id }),
			play(g2.args.id, { side: 'them', stat: 'fg2_made' })
		);
		const t = seasonTotals(state, gamesIn(state));

		const a = t.players.get(ana.args.id)!;
		expect(a.gp).toBe(2);
		expect(a.line).toMatchObject({ pts: 5, fgm: 2, fga: 2, tpm: 1, tpa: 1, ftm: 0, fta: 1 });
		// Bo only has an assist in one game and a foul drawn in the other: both count.
		expect(t.players.get(bo.args.id)).toMatchObject({ gp: 2, line: { ast: 1, fd: 1, pts: 0 } });
		// The game with no plays counts for no one.
		expect(t.team.gp).toBe(2);
		expect(t.team.line).toMatchObject({ pts: 5, ast: 1, fd: 1 });
		expect(t.opponent.line).toMatchObject({ pts: 2, pf: 1 });
	});
});

describe('gameLog', () => {
	it("lists a player's line in each game they have one", () => {
		const ana = player();
		const g1 = game({ date: '2026-11-20', opponent: 'Lincoln' });
		const g2 = game({ date: '2026-11-24', opponent: 'Adams' });
		const state = build(ana, g1, g2, play(g2.args.id, { player_id: ana.args.id, stat: 'fg2_made' }), play(g1.args.id));
		const log = gameLog(state, gamesIn(state), ana.args.id);
		expect(log.map((x) => [x.game.opponent, x.line.pts])).toEqual([['Adams', 2]]);
	});
});

describe('perGame', () => {
	it('averages to one decimal', () => {
		expect(perGame(7, 3)).toBe('2.3');
		expect(perGame(6, 3)).toBe('2.0');
		expect(perGame(0, 0)).toBe('–');
	});
});

describe('shotsOf', () => {
	it('splits field goals into 2s and 3s', () => {
		const line = { ...seasonTotals(emptyState(), []).team.line, fgm: 5, fga: 12, tpm: 2, tpa: 5, ftm: 3, fta: 4 };
		expect(shotsOf(line, 'fg2')).toEqual({ made: 3, att: 7 });
		expect(shotsOf(line, 'fg3')).toEqual({ made: 2, att: 5 });
		expect(shotsOf(line, 'ft')).toEqual({ made: 3, att: 4 });
	});
});

describe('practiceVsGames', () => {
	const season = { id: SEASON, program_id: PROGRAM, name: '2026–27', starts_on: '2026-08-01', ends_on: '2027-07-31' };

	it('compares linked drills in the season with game shots', () => {
		const ana = player({ name: 'Ana' });
		const bo = player({ name: 'Bo' });
		const ft = drill({ game_stat: 'ft' });
		const unlinked = drill({ name: 'Form shooting' });
		const r1 = run(ft.args.id, { date: '2026-11-06', setup: 50 });
		const r2 = run(ft.args.id, { date: '2026-11-07', setup: 25 });
		const r3 = run(unlinked.args.id, { date: '2026-11-06', setup: 10 });
		const g = game();
		const state = build(
			ana,
			bo,
			ft,
			unlinked,
			r1,
			r2,
			r3,
			setValue(r1.args.id, ana.args.id, 40),
			setValue(r2.args.id, ana.args.id, 20),
			setValue(r3.args.id, ana.args.id, 9),
			g,
			play(g.args.id, { player_id: ana.args.id, stat: 'ft_made' }),
			play(g.args.id, { player_id: ana.args.id, stat: 'ft_missed' }),
			play(g.args.id, { player_id: bo.args.id, stat: 'ft_made' }),
			play(g.args.id, { player_id: bo.args.id, stat: 'fg2_made' })
		);
		const rows = practiceVsGames(state, PROGRAM, season, gamesIn(state), 'ft', [bo.args.id]);
		// Bo first, from the order; then Ana.
		expect(rows).toEqual([
			{ playerId: bo.args.id, practice: { made: 0, att: 0 }, games: { made: 1, att: 1 } },
			{ playerId: ana.args.id, practice: { made: 60, att: 75 }, games: { made: 1, att: 2 } }
		]);
		expect(practiceVsGames(state, PROGRAM, season, gamesIn(state), 'ft', [], new Set([ana.args.id]))).toHaveLength(1);
	});

	it('leaves out runs from other seasons', () => {
		const ana = player();
		const ft = drill({ game_stat: 'ft' });
		const old = run(ft.args.id, { date: '2026-11-06' });
		const state = build(ana, ft, old, setValue(old.args.id, ana.args.id, 40));
		const later = { ...season, starts_on: '2027-08-01', ends_on: '2028-07-31' };
		expect(practiceVsGames(state, PROGRAM, later, [], 'ft', [])).toEqual([]);
	});
});

describe('linkedStats', () => {
	it('lists the game stats some makes drill practices', () => {
		const state = build(drill({ game_stat: 'fg3' }), drill({ game_stat: 'ft' }), drill());
		expect(linkedStats(state, PROGRAM)).toEqual(['ft', 'fg3']);
	});
});
