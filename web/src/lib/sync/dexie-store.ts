// LocalStore on IndexedDB via Dexie. Tables mirror the server's synced tables,
// plus the queue (`pending`), sync bookkeeping (`meta`) and `rejections`.

import Dexie, { type EntityTable } from 'dexie';
import { addUnique, newClientId, type LocalStore, type Snapshot } from './store';
import {
	resultKey,
	type Drill,
	type MutationInput,
	type PendingMutation,
	type Player,
	type PullResponse,
	type Rejection,
	type Result,
	type Run
} from './types';

interface Meta {
	key: 'client_id' | 'cursor' | 'last_mutation_id' | 'next_mutation_id';
	value: string | number;
}

class CourtsideDB extends Dexie {
	players!: EntityTable<Player, 'id'>;
	drills!: EntityTable<Drill, 'id'>;
	runs!: EntityTable<Run, 'id'>;
	results!: EntityTable<Result & { key: string }, 'key'>;
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
	}
}

export class DexieStore implements LocalStore {
	private db: CourtsideDB;

	constructor(name = 'courtside') {
		this.db = new CourtsideDB(name);
	}

	async load(): Promise<Snapshot> {
		const db = this.db;
		return db.transaction('rw', db.tables, async () => {
			let clientId = await this.meta<string>('client_id');
			if (!clientId) {
				clientId = newClientId();
				await db.meta.put({ key: 'client_id', value: clientId });
			}

			const [players, drills, runs, results, pending, rejections] = await Promise.all([
				db.players.toArray(),
				db.drills.toArray(),
				db.runs.toArray(),
				db.results.toArray(),
				db.pending.orderBy('id').toArray(),
				db.rejections.orderBy('mutation_id').toArray()
			]);

			return {
				clientId,
				cursor: (await this.meta<number>('cursor')) ?? 0,
				lastMutationId: (await this.meta<number>('last_mutation_id')) ?? 0,
				base: {
					players: new Map(players.map((p) => [p.id, p])),
					drills: new Map(drills.map((d) => [d.id, d])),
					runs: new Map(runs.map((r) => [r.id, r])),
					results: new Map(results.map(({ key, ...r }) => [key, r]))
				},
				pending,
				rejections
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
		const { players, drills, runs, results } = pull.changes;

		await db.transaction('rw', db.tables, async () => {
			for (const { deleted, version: _v, ...p } of players) await (deleted ? db.players.delete(p.id) : db.players.put(p));
			for (const { deleted, version: _v, ...d } of drills) await (deleted ? db.drills.delete(d.id) : db.drills.put(d));
			for (const { deleted, version: _v, ...r } of runs) await (deleted ? db.runs.delete(r.id) : db.runs.put(r));
			for (const { deleted, version: _v, ...r } of results) {
				const key = resultKey(r.drill_run_id, r.player_id);
				await (deleted ? db.results.delete(key) : db.results.put({ ...r, key }));
			}

			await db.meta.bulkPut([
				{ key: 'cursor', value: pull.cursor },
				{ key: 'last_mutation_id', value: pull.last_mutation_id }
			]);
			await db.pending.where('id').belowOrEqual(pull.last_mutation_id).delete();
			await this.putRejections(pull.rejections);
		});
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
