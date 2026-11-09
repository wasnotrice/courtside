import 'fake-indexeddb/auto';
import { TABLES } from './replay';
import Dexie from 'dexie';
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

	it('remembers the data id of the last pull', async () => {
		const store = make();
		expect((await store.load()).dataId).toBeNull();
		await store.applyPull(pull({ data_id: 'data-7' }));
		expect((await store.load()).dataId).toBe('data-7');
	});

	it('restartBase drops the base and cursor but keeps the client id, queue and rejections', async () => {
		const store = make();
		const { clientId } = await store.load();
		await store.enqueue(player());
		await store.enqueue(player());
		await store.applyPull(
			pull({ cursor: 7, rejections: [rejection(1)] }, { players: [{ ...ana, deleted: false, version: 7 }] })
		);

		await store.restartBase();

		const snap = await store.load();
		expect(snap).toMatchObject({ clientId, cursor: 0, dataId: null });
		expect(snap.base.players.size).toBe(0);
		expect(snap.pending.map((m) => m.id)).toEqual([1, 2]);
		expect(snap.rejections).toEqual([rejection(1)]);
		expect((await store.enqueue(player())).id).toBe(3);
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

describe('DexieStore schema upgrades', () => {
	it('keeps pending changes when upgrading from version 1, and drops the old base', async () => {
		// A database as version 1 of the app left it.
		const old = new Dexie('courtside-upgrade-test');
		old.version(1).stores({
			players: 'id',
			drills: 'id',
			runs: 'id',
			results: 'key, drill_run_id',
			pending: 'id',
			rejections: 'mutation_id',
			meta: 'key'
		});
		await old.table('players').put({ id: 'p1', name: 'Ana', jersey: '4', active: true });
		await old.table('pending').bulkPut([
			{ id: 1, name: 'player.put', args: { id: 'p1', name: 'Ana B' } },
			{ id: 2, name: 'player.put', args: { id: 'p2', name: 'Bea' } }
		]);
		await old.table('meta').bulkPut([
			{ key: 'client_id', value: 'old-client' },
			{ key: 'cursor', value: 41 },
			{ key: 'next_mutation_id', value: 3 }
		]);
		old.close();

		const store = new DexieStore('upgrade-test');
		const snap = await store.load();

		expect(snap.pending.map((m) => m.id)).toEqual([1, 2]);
		expect(snap).toMatchObject({ clientId: 'old-client', cursor: 0, dataId: null });
		expect(snap.base.players.size).toBe(0);
		expect((await store.enqueue(player())).id).toBe(3);
	});
});
