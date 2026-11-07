import { describe, expect, it } from 'vitest';
import { applyPull, computeView } from './replay';
import { drill, player, run, setValue } from './testing/fixtures';
import { emptyState, resultKey, type PendingMutation, type PullResponse } from './types';

const pending = (...ms: Omit<PendingMutation, 'id'>[]): PendingMutation[] =>
	ms.map((m, i) => ({ ...m, id: i + 1 }) as PendingMutation);

const noChanges = (): PullResponse['changes'] => ({ players: [], drills: [], runs: [], results: [] });

describe('computeView', () => {
	it('replays pending mutations on top of the base', () => {
		const p = player();
		const view = computeView(emptyState(), pending(p));
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
		const view = computeView(emptyState(), queue);

		expect(view.skipped).toEqual(new Map([[4, '60 makes is more than 50 shots.']]));
		expect(view.state.results.get(resultKey(runId, playerId))?.value).toBe(30);
	});

	it('leaves the base untouched', () => {
		const base = emptyState();
		computeView(base, pending(player()));
		expect(base.players.size).toBe(0);
	});
});

describe('applyPull', () => {
	it('writes rows and removes tombstones', () => {
		const id = crypto.randomUUID();
		const row = { id, name: 'Ana', jersey: '4', active: true };
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
