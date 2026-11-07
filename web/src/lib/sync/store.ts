// Where the sync engine keeps its state on the device. The engine holds
// everything in memory and writes through to a LocalStore, so the store only
// has to be durable and atomic, not fast to query.

import { applyPull } from './replay';
import {
	emptyState,
	type MutationInput,
	type PendingMutation,
	type PullResponse,
	type Rejection,
	type State
} from './types';

export interface Snapshot {
	clientId: string;
	/** The server version this client's base reflects. */
	cursor: number;
	/** The last of this client's mutations the server has processed. */
	lastMutationId: number;
	base: State;
	pending: PendingMutation[];
	rejections: Rejection[];
}

export interface LocalStore {
	/** Reads everything, creating a client id on first run. */
	load(): Promise<Snapshot>;
	/** Assigns the next mutation id and saves the mutation, atomically. */
	enqueue(mutation: MutationInput): Promise<PendingMutation>;
	/**
	 * In one transaction: writes the pull into the base, saves the cursor and
	 * last mutation id, drops confirmed pending mutations and adds rejections.
	 *
	 * Rejections arrive only through pulls (not push responses): once the
	 * cursor passes a rejection it never comes back, so a dismissed one stays
	 * dismissed.
	 */
	applyPull(pull: PullResponse): Promise<void>;
	dismissRejection(mutationId: number): Promise<void>;
	/** Erases everything. The next load starts as a brand-new client. */
	reset(): Promise<void>;
}

export const newClientId = () => crypto.randomUUID();

/** Keeps everything in memory. For tests and for simulating extra devices. */
export class MemoryStore implements LocalStore {
	private snap: Snapshot | null = null;
	private nextMutationId = 1;

	async load(): Promise<Snapshot> {
		this.snap ??= {
			clientId: newClientId(),
			cursor: 0,
			lastMutationId: 0,
			base: emptyState(),
			pending: [],
			rejections: []
		};
		return structuredClone(this.snap);
	}

	async enqueue(mutation: MutationInput): Promise<PendingMutation> {
		const snap = await this.ensure();
		const pending = { ...mutation, id: this.nextMutationId++ } as PendingMutation;
		snap.pending.push(structuredClone(pending));
		return pending;
	}

	async applyPull(pull: PullResponse): Promise<void> {
		const snap = await this.ensure();
		snap.base = applyPull(snap.base, pull.changes);
		snap.cursor = pull.cursor;
		snap.lastMutationId = pull.last_mutation_id;
		snap.pending = snap.pending.filter((m) => m.id > pull.last_mutation_id);
		addUnique(snap.rejections, pull.rejections);
	}

	async dismissRejection(mutationId: number): Promise<void> {
		const snap = await this.ensure();
		snap.rejections = snap.rejections.filter((r) => r.mutation_id !== mutationId);
	}

	async reset(): Promise<void> {
		this.snap = null;
		this.nextMutationId = 1;
	}

	private async ensure(): Promise<Snapshot> {
		if (!this.snap) await this.load();
		return this.snap!;
	}
}

/** Adds rejections not already present. Mutation ids are unique per client. */
export function addUnique(into: Rejection[], rejections: Rejection[]) {
	for (const r of rejections) {
		if (!into.some((x) => x.mutation_id === r.mutation_id)) into.push(r);
	}
	into.sort((a, b) => a.mutation_id - b.mutation_id);
}
