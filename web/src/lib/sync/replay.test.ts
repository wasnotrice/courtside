import { describe, expect, it } from 'vitest';
import { apply } from './mutators';
import { applyPull, computeView, TABLES } from './replay';
import { drill, player, run, setValue, structure } from './testing/fixtures';
import { emptyState, resultKey, type PendingMutation, type PullResponse } from './types';

/** A base holding the fixtures' program and season, as after a first pull. */
const base = () => structure().reduce(apply, emptyState());

const pending = (...ms: Omit<PendingMutation, 'id'>[]): PendingMutation[] =>
	ms.map((m, i) => ({ ...m, id: i + 1 }) as PendingMutation);

const noChanges = () => Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as PullResponse['changes'];

describe('computeView', () => {
	it('replays pending mutations on top of the base', () => {
		const p = player();
		const view = computeView(base(), pending(p));
		expect(view.state.players.get(p.args.id)?.name).toBe('Ana');
		expect(view.skipped.size).toBe(0);
	});

	it('skips a pending mutation that no longer applies and keeps going', () => {
		const p = player();
		const d = drill();
		const r = run(d.args.id);
		const runId = r.args.id;
		const playerId = p.args.id;

		const queue = pending(p, d, r, setValue(runId, playerId, 60), setValue(runId, playerId, 30));
		const view = computeView(base(), queue);

		expect(view.skipped).toEqual(new Map([[4, '60 makes is more than 50 shots.']]));
		expect(view.state.results.get(resultKey(runId, playerId))?.value).toBe(30);
	});

	it('copies each table once, and the view never changes after the replay', () => {
		const queue = pending(player({ name: 'A' }), player({ name: 'B' }));
		const view = computeView(base(), queue);
		const players = view.state.players;

		// Checking the next tap against the view (as mutate() does) must not write into it.
		apply(view.state, player({ name: 'C' }));
		expect(view.state.players).toBe(players);
		expect(players.size).toBe(2);
	});

	it('leaves the base untouched', () => {
		const before = base();
		computeView(before, pending(player()));
		expect(before.players.size).toBe(0);
	});
});

describe('applyPull', () => {
	it('writes rows and removes tombstones', () => {
		const id = crypto.randomUUID();
		const row = { id, program_id: crypto.randomUUID(), name: 'Ana' };
		const withPlayer = applyPull(emptyState(), {
			...noChanges(),
			players: [{ ...row, deleted: false, version: 1 }]
		});
		expect(withPlayer.players.get(id)).toEqual(row);

		const gone = applyPull(withPlayer, { ...noChanges(), players: [{ ...row, deleted: true, version: 2 }] });
		expect(gone.players.size).toBe(0);
	});

	it('keys results by run and player', () => {
		const result = { drill_run_id: 'r', player_id: 'p', value: 3, setup: null };
		const base = applyPull(emptyState(), { ...noChanges(), results: [{ ...result, deleted: false, version: 1 }] });
		expect(base.results.get(resultKey('r', 'p'))).toEqual(result);
	});
});
