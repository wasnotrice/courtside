import { describe, expect, it } from 'vitest';
import { apply } from './mutators';
import { drill, game, play, player, run, setValue, structure } from './testing/fixtures';
import { emptyState, type MutationInput, type State } from './types';
import { renamed, renamesOf, reverseOf } from './undo';

const build = (...changes: MutationInput[]) => [...structure(), ...changes].reduce(apply, emptyState());

/** Makes the change, then its reverse, and returns the state before and after. */
function roundTrip(state: State, input: MutationInput) {
	const reverse = reverseOf(state, input);
	expect(reverse).not.toBeNull();
	const after = reverse!.reduce(apply, apply(state, input));
	return { before: state, after };
}

describe('reverseOf: plays', () => {
	const g = game();
	const p = play(g.args.id, { stat: 'fg2_made' });
	const base = () => build(g, p);

	it('deletes a new play', () => {
		const q = play(g.args.id);
		const { before, after } = roundTrip(base(), q);
		expect(after.plays).toEqual(before.plays);
	});

	it('puts back the fields an edit changed, and only those', () => {
		const state = base();
		const edit: MutationInput = { name: 'play.put', args: { id: p.args.id, period: 2, assist_player_id: null } };
		expect(reverseOf(state, edit)).toEqual([{ name: 'play.put', args: { id: p.args.id, period: 1, assist_player_id: null } }]);
		const { before, after } = roundTrip(state, edit);
		expect(after.plays).toEqual(before.plays);
	});

	it('records a deleted play again, in the same place, under a new id', () => {
		const { before, after } = roundTrip(base(), { name: 'play.delete', args: { id: p.args.id } });
		const strip = (s: State) => [...s.plays.values()].map(({ id: _id, ...rest }) => rest);
		expect(strip(after)).toEqual(strip(before));
		expect(after.plays.has(p.args.id)).toBe(false);
	});
});

describe('reverseOf: results', () => {
	const ana = player();
	const d = drill();
	const r = run(d.args.id);
	const key = { drill_run_id: r.args.id, player_id: ana.args.id };

	it.each<[string, MutationInput[], MutationInput]>([
		['a first value', [], setValue(r.args.id, ana.args.id, 38)],
		['a changed value', [setValue(r.args.id, ana.args.id, 30)], setValue(r.args.id, ana.args.id, 38)],
		['a first value over a setup', [{ name: 'result.set_setup', args: { ...key, setup: 25 } }], setValue(r.args.id, ana.args.id, 20)],
		['a setup', [setValue(r.args.id, ana.args.id, 30)], { name: 'result.set_setup', args: { ...key, setup: 40 } }],
		[
			'a clear',
			[setValue(r.args.id, ana.args.id, 20), { name: 'result.set_setup', args: { ...key, setup: 25 } }],
			{ name: 'result.clear', args: key }
		]
	])('undoes %s', (_name, given, input) => {
		const { before, after } = roundTrip(build(ana, d, r, ...given), input);
		const live = (s: State) => [...s.results.values()].filter((x) => x.value !== null || x.setup !== null);
		expect(live(after)).toEqual(live(before));
	});

	it('has nothing to undo when clearing an empty row', () => {
		expect(reverseOf(build(ana, d, r), { name: 'result.clear', args: key })).toBeNull();
	});
});

describe('reverseOf: runs, games and the roster', () => {
	it('deletes a new run, and puts back a setup', () => {
		const d = drill();
		const r = run(d.args.id);
		expect(reverseOf(build(d), r)).toEqual([{ name: 'run.delete', args: { id: r.args.id } }]);
		const { before, after } = roundTrip(build(d, r), { name: 'run.set_setup', args: { id: r.args.id, setup: 25 } });
		expect(after.runs).toEqual(before.runs);
	});

	it('puts back a game edit', () => {
		const g = game();
		const { before, after } = roundTrip(build(g), { name: 'game.put', args: { id: g.args.id, status: 'final', official_us: 50, official_them: 40 } });
		expect(after.games).toEqual(before.games);
	});

	it('renames a player back', () => {
		const ana = player();
		const { before, after } = roundTrip(build(ana), { name: 'player.put', args: { id: ana.args.id, name: 'Anna' } });
		expect(after.players).toEqual(before.players);
	});

	it('has no undo for a new game or a delete it can’t reverse', () => {
		expect(reverseOf(build(), game())).toBeNull();
		expect(reverseOf(build(), { name: 'play.delete', args: { id: crypto.randomUUID() } })).toBeNull();
	});
});

describe('renamed', () => {
	it('points older steps at the id a deleted play came back under', () => {
		const g = game();
		const p = play(g.args.id);
		const state = build(g, p);
		const del: MutationInput = { name: 'play.delete', args: { id: p.args.id } };
		const back = reverseOf(state, del)!;
		const renames = renamesOf(del, back);
		const older: MutationInput[] = [{ name: 'play.delete', args: { id: p.args.id } }];
		expect(renamed(older, renames)).toEqual([{ name: 'play.delete', args: { id: (back[0].args as { id: string }).id } }]);
	});
});
