// The sync engine: the only thing the UI talks to. It owns the base (server
// state as last pulled), the queue of pending mutations and the view (base +
// pending replayed), and runs the push/pull loop.
//
// Everything below this boundary (store, transport, replay) could be swapped
// for PowerSync, Replicache and the like, as long as the engine keeps the same
// surface: `snapshot`, `subscribe`, `mutate`, `sync`, `setOffline`,
// `dismissRejection` and `reset`.

import { apply, MutationError } from './mutators';
import { applyPull, computeView, type View } from './replay';
import { addUnique, type LocalStore } from './store';
import { emptyState } from './types';
import type { PokeSource, Transport } from './transport';
import type { MutationInput, PendingMutation, Rejection, State } from './types';

export type Phase = 'idle' | 'syncing' | 'retrying' | 'offline';

export interface SyncSnapshot {
	/** What the UI shows: the server's data plus this device's pending changes. */
	view: State;
	clientId: string;
	cursor: number;
	lastMutationId: number;
	pending: readonly PendingMutation[];
	/** Pending mutations that no longer apply locally, by id, with the reason. */
	skipped: ReadonlyMap<number, string>;
	/** Server rejections the coach hasn't dismissed. */
	rejections: readonly Rejection[];
	/** True when the "simulate offline" switch is on. */
	offline: boolean;
	phase: Phase;
	lastError: string | null;
	lastSyncedAt: Date | null;
}

export type MutateResult = { ok: true } | { ok: false; reason: string };

/**
 * The most mutations sent in one push. The server refuses more than 500
 * (Courtside.Sync.max_mutations/0); a longer queue goes in several rounds.
 */
export const PUSH_BATCH = 200;

export interface EngineOptions {
	store: LocalStore;
	transport: Transport;
	pokes?: PokeSource;
	/** How often to pull while the page is visible. */
	pollMs?: number;
	maxBackoffMs?: number;
}

export class SyncEngine {
	private base!: State;
	private viewCache!: View;
	private clientId!: string;
	private cursor = 0;
	private dataId: string | null = null;
	private lastMutationId = 0;
	private pending: PendingMutation[] = [];
	private rejections: Rejection[] = [];
	private offline = false;
	private phase: Phase = 'idle';
	private lastError: string | null = null;
	private lastSyncedAt: Date | null = null;

	private current!: SyncSnapshot;
	private listeners = new Set<(s: SyncSnapshot) => void>();

	private looping = false;
	private running: Promise<void> = Promise.resolve();
	private again = false;
	private failures = 0;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private mutations: Promise<unknown> = Promise.resolve();
	private teardown: (() => void)[] = [];

	private constructor(private readonly opts: EngineOptions) {}

	/** Loads local state. Call `start()` to begin syncing in the background. */
	static async open(opts: EngineOptions): Promise<SyncEngine> {
		const engine = new SyncEngine(opts);
		await engine.load();
		return engine;
	}

	get snapshot(): SyncSnapshot {
		return this.current;
	}

	subscribe(listener: (s: SyncSnapshot) => void): () => void {
		this.listeners.add(listener);
		listener(this.current);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Validates against the current view and queues the mutation. Returns the
	 * reason if it doesn't apply, in which case nothing is queued.
	 */
	mutate(input: MutationInput): Promise<MutateResult> {
		// Serialized, so each mutation is validated against the one before it.
		const result = this.mutations.then(async (): Promise<MutateResult> => {
			try {
				apply(this.viewCache.state, input);
			} catch (e) {
				if (e instanceof MutationError) return { ok: false, reason: e.message };
				throw e;
			}

			const queued = await this.opts.store.enqueue(input);
			this.pending = [...this.pending, queued];
			this.recompute();
			void this.sync();
			return { ok: true };
		});
		this.mutations = result.catch(() => {});
		return result;
	}

	/**
	 * Pushes pending mutations, then pulls. Calls made while a round is running
	 * queue one more round, so push and pull never overlap.
	 */
	sync(): Promise<void> {
		this.clearRetry();
		this.again = true;
		if (!this.looping) {
			this.looping = true;
			this.running = this.loop();
		}
		return this.running;
	}

	/** The "simulate offline" switch: no requests go out and pokes are ignored. */
	setOffline(offline: boolean) {
		this.offline = offline;
		this.clearRetry();
		this.phase = offline ? 'offline' : 'idle';
		this.emit();
		if (!offline) void this.sync();
	}

	async dismissRejection(mutationId: number) {
		await this.opts.store.dismissRejection(mutationId);
		this.rejections = this.rejections.filter((r) => r.mutation_id !== mutationId);
		this.emit();
	}

	/** Erases this device's data, pending changes included, and starts over as a new client. */
	async reset() {
		await this.running;
		await this.opts.store.reset();
		await this.load();
		void this.sync();
	}

	/** Syncs now and on pokes, on reconnect and periodically while the page is visible. */
	start() {
		const sync = () => void this.sync();
		if (this.opts.pokes) this.teardown.push(this.opts.pokes.subscribe(sync));

		if (typeof window !== 'undefined') {
			const onOnline = () => {
				this.failures = 0;
				sync();
			};
			const onVisible = () => document.visibilityState === 'visible' && sync();
			const timer = setInterval(onVisible, this.opts.pollMs ?? 30_000);
			window.addEventListener('online', onOnline);
			document.addEventListener('visibilitychange', onVisible);
			this.teardown.push(() => {
				clearInterval(timer);
				window.removeEventListener('online', onOnline);
				document.removeEventListener('visibilitychange', onVisible);
			});
		}

		sync();
	}

	stop() {
		this.clearRetry();
		for (const fn of this.teardown.splice(0)) fn();
	}

	// --- internals -------------------------------------------------------------

	private async load() {
		const snap = await this.opts.store.load();
		this.clientId = snap.clientId;
		this.cursor = snap.cursor;
		this.dataId = snap.dataId;
		this.lastMutationId = snap.lastMutationId;
		this.base = snap.base;
		this.pending = snap.pending;
		this.rejections = snap.rejections;
		this.failures = 0;
		this.lastError = null;
		this.lastSyncedAt = null;
		this.recompute();
	}

	private async loop() {
		try {
			// A request made during a round (a new mutation, a poke, coming back
			// online) gets another round right away, even if this one failed.
			while (this.again && !this.offline) {
				this.again = false;
				await this.round();
			}
		} finally {
			// Cleared with no await after the last check, so a sync() call can
			// never join a loop that has already decided to stop.
			this.looping = false;
		}
	}

	private async round() {
		this.clearRetry();
		this.phase = 'syncing';
		this.emit();

		try {
			// The server reports rejections only through pull (see LocalStore.applyPull).
			// A failed push doesn't stop the pull: one-way signal, or a push the
			// server keeps refusing, shouldn't also cut this device off from updates.
			let pushError: unknown = null;
			const batch = this.pending.slice(0, PUSH_BATCH);
			if (batch.length > 0) {
				await this.opts.transport
					.push({ client_id: this.clientId, mutations: batch })
					.catch((e) => (pushError = e));
			}

			let pull = await this.opts.transport.pull(this.clientId, this.cursor);

			// The server's data was recreated or restored: its versions no longer
			// line up with this cursor. Start the base over, keeping the queue.
			if ((this.dataId !== null && pull.data_id !== this.dataId) || pull.cursor < this.cursor) {
				await this.opts.store.restartBase();
				this.base = emptyState();
				this.cursor = 0;
				pull = await this.opts.transport.pull(this.clientId, 0);
			}

			await this.opts.store.applyPull(pull);

			this.base = applyPull(this.base, pull.changes);
			this.cursor = pull.cursor;
			this.dataId = pull.data_id;
			this.lastMutationId = pull.last_mutation_id;
			this.pending = this.pending.filter((m) => m.id > pull.last_mutation_id);
			const rejections = [...this.rejections];
			addUnique(rejections, pull.rejections);
			this.rejections = rejections;
			this.lastSyncedAt = new Date();
			if (pushError) throw pushError;
			// A full batch went out and more are queued: go again for the rest.
			if (batch.length === PUSH_BATCH && this.pending.length > 0) this.again = true;

			this.failures = 0;
			this.lastError = null;
			this.phase = 'idle';
		} catch (e) {
			this.failures++;
			this.lastError = e instanceof Error ? e.message : String(e);
			this.phase = this.offline ? 'offline' : 'retrying';
			if (!this.offline) this.scheduleRetry();
		}

		this.recompute();
	}

	private scheduleRetry() {
		const delay = Math.min(this.opts.maxBackoffMs ?? 30_000, 1000 * 2 ** (this.failures - 1));
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.sync();
		}, delay);
	}

	private clearRetry() {
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}

	private recompute() {
		this.viewCache = computeView(this.base, this.pending);
		this.emit();
	}

	private emit() {
		this.current = {
			view: this.viewCache.state,
			clientId: this.clientId,
			cursor: this.cursor,
			lastMutationId: this.lastMutationId,
			pending: this.pending,
			skipped: this.viewCache.skipped,
			rejections: this.rejections,
			offline: this.offline,
			phase: this.phase,
			lastError: this.lastError,
			lastSyncedAt: this.lastSyncedAt
		};
		for (const listener of this.listeners) listener(this.current);
	}
}
