import 'fake-indexeddb/auto';
import { TABLES } from './replay';
import { describe, expect, it } from 'vitest';
import { DexieStore } from './dexie-store';
import { MemoryStore, type LocalStore } from './store';
import { player } from './testing/fixtures';
import type { PullResponse } from './types';

const pull = (over: Partial<PullResponse> = {}, changes: Partial<PullResponse['changes']> = {}): PullResponse => ({
	cursor: 1,
	data_id: 'data-1',
	last_mutation_id: 0,
	rejections: [],
	...over,
	changes: { ...(Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as PullResponse['changes']), ...changes }
});

const ana = { id: crypto.randomUUID(), program_id: crypto.randomUUID(), name: 'Ana' };
const rejection = (id: number) => ({ mutation_id: id, name: 'player.put', args: {}, reason: 'No' });

let n = 0;
const stores: [string, () => LocalStore][] = [
	['MemoryStore', () => new MemoryStore()],
	['DexieStore', () => new DexieStore(`test-${n++}`)]
];

describe.each(stores)('%s', (_name, make) => {
	it('creates a client id once and keeps it', async () => {
		const store = make();
		const first = await store.load();
		expect(first.clientId).toMatch(/^[0-9a-f-]{36}$/);
		expect((await store.load()).clientId).toBe(first.clientId);
		expect(first).toMatchObject({ cursor: 0, lastMutationId: 0, pending: [], rejections: [] });
	});

	it('numbers mutations in order', async () => {
		const store = make();
		const a = await store.enqueue(player());
		const b = await store.enqueue(player());
		expect([a.id, b.id]).toEqual([1, 2]);
		expect((await store.load()).pending.map((m) => m.id)).toEqual([1, 2]);
	});

	it('applies a pull: rows, tombstones, cursor, confirmed mutations and rejections', async () => {
		const store = make();
		await store.enqueue(player());
		await store.enqueue(player());
		await store.applyPull(
			pull(
				{ cursor: 7, last_mutation_id: 1, rejections: [rejection(1)] },
				{
					players: [{ ...ana, deleted: false, version: 7 }],
					results: [{ drill_run_id: 'r', player_id: ana.id, value: 3, setup: null, deleted: false, version: 7 }]
				}
			)
		);

		let snap = await store.load();
		expect(snap.cursor).toBe(7);
		expect(snap.lastMutationId).toBe(1);
		expect(snap.pending.map((m) => m.id)).toEqual([2]);
		expect(snap.base.players.get(ana.id)).toEqual(ana);
		expect(snap.base.results.size).toBe(1);
		expect(snap.rejections).toEqual([rejection(1)]);

		await store.applyPull(
			pull({ cursor: 8, last_mutation_id: 1 }, { players: [{ ...ana, deleted: true, version: 8 }] })
		);
		snap = await store.load();
		expect(snap.base.players.size).toBe(0);
	});

	it('keeps one copy of each rejection and dismisses them', async () => {
		const store = make();
		await store.applyPull(pull({ rejections: [rejection(2), rejection(1)] }));
		await store.applyPull(pull({ rejections: [rejection(1)] }));
		expect((await store.load()).rejections.map((r) => r.mutation_id)).toEqual([1, 2]);

		await store.dismissRejection(1);
		expect((await store.load()).rejections.map((r) => r.mutation_id)).toEqual([2]);
	});

	it('reset starts over as a new client', async () => {
		const store = make();
		const { clientId } = await store.load();
		await store.enqueue(player());
		await store.reset();

		const snap = await store.load();
		expect(snap.clientId).not.toBe(clientId);
		expect(snap.pending).toEqual([]);
		expect((await store.enqueue(player())).id).toBe(1);
	});
});
