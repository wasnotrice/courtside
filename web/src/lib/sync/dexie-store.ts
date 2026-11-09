// LocalStore on IndexedDB via Dexie. Tables mirror the server's synced tables,
// plus the queue (`pending`), sync bookkeeping (`meta`) and `rejections`.
//
// One database per organization (`courtside-<organization id>`), so a device
// can hold more than one, and signing out can delete exactly one.
//
// Schema upgrades may throw away the base (the server still has it; the next
// pull brings it back) but must never throw away `pending`, which exists only
// on this device.

import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { keyOf, TABLES } from './replay';
import { addUnique, newClientId, type LocalStore, type Snapshot } from './store';
import {
	emptyState,
	type MutationInput,
	type PendingMutation,
	type PullResponse,
	type Rejection,
	type State
} from './types';

interface Meta {
	key: 'client_id' | 'cursor' | 'data_id' | 'last_mutation_id' | 'next_mutation_id';
	value: string | number;
}

type BaseTable = keyof State;

/** Base tables, keyed by `key` (keyOf: the id, or run/player for results). */
type Keyed = Record<string, unknown> & { key: string };

/** Clears the base and the cursor for a fresh pull, keeping the queue. */
async function dropBase(tx: Transaction) {
	for (const t of tx.storeNames) {
		if (!['pending', 'rejections', 'meta'].includes(t)) await tx.table(t).clear();
	}
	await tx.table('meta').bulkDelete(['cursor', 'data_id']);
}

class CourtsideDB extends Dexie {
	pending!: EntityTable<PendingMutation, 'id'>;
	rejections!: EntityTable<Rejection, 'mutation_id'>;
	meta!: EntityTable<Meta, 'key'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores({
			players: 'id',
			drills: 'id',
			runs: 'id',
			results: 'key, drill_run_id',
			pending: 'id',
			rejections: 'mutation_id',
			meta: 'key'
		});
		// Organizations, programs, seasons, teams and roster entries. Every base
		// table is keyed by `key`, so the old base is dropped and pulled again.
		this.version(2)
			.stores({
				players: null,
				drills: null,
				runs: null,
				results: null,
				...Object.fromEntries(TABLES.map((t) => [`base_${t}`, 'key'])),
				pending: 'id',
				rejections: 'mutation_id',
				meta: 'key'
			})
			.upgrade(dropBase);
	}

	base(table: BaseTable): EntityTable<Keyed, 'key'> {
		return this.table(`base_${table}`);
	}
}

export class DexieStore implements LocalStore {
	private db: CourtsideDB;

	constructor(organizationId: string) {
		this.db = new CourtsideDB(`courtside-${organizationId}`);
	}

	async load(): Promise<Snapshot> {
		const db = this.db;
		return db.transaction('rw', db.tables, async () => {
			let clientId = await this.meta<string>('client_id');
			if (!clientId) {
				clientId = newClientId();
				await db.meta.put({ key: 'client_id', value: clientId });
			}

			const base = emptyState() as unknown as Record<BaseTable, Map<string, unknown>>;
			for (const t of TABLES) {
				for (const { key, ...row } of await db.base(t).toArray()) base[t].set(key, row);
			}

			return {
				clientId,
				cursor: (await this.meta<number>('cursor')) ?? 0,
				dataId: (await this.meta<string>('data_id')) ?? null,
				lastMutationId: (await this.meta<number>('last_mutation_id')) ?? 0,
				base: base as unknown as State,
				pending: await db.pending.orderBy('id').toArray(),
				rejections: await db.rejections.orderBy('mutation_id').toArray()
			};
		});
	}

	async enqueue(mutation: MutationInput): Promise<PendingMutation> {
		const db = this.db;
		return db.transaction('rw', db.pending, db.meta, async () => {
			const id = (await this.meta<number>('next_mutation_id')) ?? 1;
			const pending = { ...mutation, id } as PendingMutation;
			await db.pending.add(pending);
			await db.meta.put({ key: 'next_mutation_id', value: id + 1 });
			return pending;
		});
	}

	async applyPull(pull: PullResponse): Promise<void> {
		const db = this.db;

		await db.transaction('rw', db.tables, async () => {
			for (const t of TABLES) {
				const rows = pull.changes[t] as unknown as ({ deleted: boolean; version: number } & Record<string, unknown>)[];
				for (const { deleted, version: _v, ...row } of rows ?? []) {
					const key = keyOf(t, row);
					await (deleted ? db.base(t).delete(key) : db.base(t).put({ ...row, key }));
				}
			}

			await db.meta.bulkPut([
				{ key: 'cursor', value: pull.cursor },
				{ key: 'data_id', value: pull.data_id },
				{ key: 'last_mutation_id', value: pull.last_mutation_id }
			]);
			await db.pending.where('id').belowOrEqual(pull.last_mutation_id).delete();
			await this.putRejections(pull.rejections);
		});
	}

	async restartBase(): Promise<void> {
		const db = this.db;
		await db.transaction('rw', db.tables, () => dropBase(Dexie.currentTransaction!));
	}

	async dismissRejection(mutationId: number): Promise<void> {
		await this.db.rejections.delete(mutationId);
	}

	async reset(): Promise<void> {
		const db = this.db;
		await db.transaction('rw', db.tables, () => Promise.all(db.tables.map((t) => t.clear())));
	}

	private async putRejections(rejections: Rejection[]) {
		// Keeps the first copy of each, matching MemoryStore.
		const fresh: Rejection[] = [];
		addUnique(fresh, rejections);
		for (const r of fresh) {
			if (!(await this.db.rejections.get(r.mutation_id))) await this.db.rejections.add(r);
		}
	}

	private async meta<T extends string | number>(key: Meta['key']): Promise<T | undefined> {
		return (await this.db.meta.get(key))?.value as T | undefined;
	}
}
