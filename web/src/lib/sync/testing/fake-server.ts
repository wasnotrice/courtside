// An in-memory stand-in for the Phoenix server, speaking the same protocol
// (global version, tombstones, last_mutation_id, rejections). It uses the
// client mutators as its rules, so it tests the protocol, not the validation:
// the Elixir rules are tested in server/test.

import { apply, MutationError } from '../mutators';
import { TABLES } from '../replay';
import { structure } from './fixtures';
import type { PokeSource, Transport } from '../transport';
import {
	emptyState,
	type PendingMutation,
	type PullResponse,
	type PushRequest,
	type PushResponse,
	type Rejection,
	type State
} from '../types';

type Row = { deleted: boolean; version: number };
type Tables = { [K in keyof State]: Map<string, (State[K] extends ReadonlyMap<string, infer T> ? T : never) & Row> };

export class FakeServer {
	version = 0;
	/** Changes when the fake server's data is "restored" (see restore()). */
	dataId = crypto.randomUUID();
	private tables = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as unknown as Tables;
	private clients = new Map<string, number>();
	private rejections: (Rejection & { client_id: string; version: number })[] = [];
	private pokeListeners = new Set<() => void>();

	/** Starts with the fixtures' program and season, pushed by a setup client. */
	constructor({ empty = false }: { empty?: boolean } = {}) {
		if (!empty) {
			this.push({
				client_id: 'setup',
				mutations: structure().map((m, i) => ({ ...m, id: i + 1 }) as PendingMutation)
			});
		}
	}

	push({ client_id, mutations }: PushRequest): PushResponse {
		const version = ++this.version;
		let last = this.clients.get(client_id) ?? 0;

		for (const m of [...mutations].sort((a, b) => a.id - b.id)) {
			if (m.id <= last) continue;
			const before = this.live();
			try {
				this.write(before, apply(before, m), version);
			} catch (e) {
				const reason = e instanceof MutationError ? e.message : 'The server could not apply this change.';
				this.rejections.push({ client_id, mutation_id: m.id, name: m.name, args: m.args as never, reason, version });
			}
			last = m.id;
		}

		this.clients.set(client_id, last);
		const ids = new Set(mutations.map((m) => m.id));
		queueMicrotask(() => this.pokeListeners.forEach((fn) => fn()));
		return {
			last_mutation_id: last,
			rejections: this.rejections.filter((r) => r.client_id === client_id && ids.has(r.mutation_id)).map(strip)
		};
	}

	pull(clientId: string, cursor: number): PullResponse {
		const since = <T extends Row>(table: Map<string, T>) =>
			[...table.values()].filter((r) => r.version > cursor).sort((a, b) => a.version - b.version);

		return structuredClone({
			cursor: this.version,
			data_id: this.dataId,
			last_mutation_id: this.clients.get(clientId) ?? 0,
			rejections: this.rejections.filter((r) => r.client_id === clientId && r.version > cursor).map(strip),
			changes: Object.fromEntries(
				TABLES.map((t) => [t, since(this.tables[t] as Map<string, Row>)])
			) as unknown as PullResponse['changes']
		});
	}

	/** A copy of everything, to restore() later, like a database backup. */
	backup() {
		return structuredClone({ version: this.version, tables: this.tables, clients: this.clients, rejections: this.rejections });
	}

	/** Puts a backup back, with a new data id, as restoring a database would. */
	restore(backup: ReturnType<FakeServer['backup']>) {
		const b = structuredClone(backup);
		this.version = b.version;
		this.tables = b.tables;
		this.clients = b.clients;
		this.rejections = b.rejections;
		this.dataId = crypto.randomUUID();
	}

	/** The live rows, as a client would hold them after a full pull. */
	live(): State {
		const live = <T extends Row>(table: Map<string, T>) => {
			const out = new Map<string, Omit<T, keyof Row>>();
			for (const [k, { deleted, version: _v, ...row }] of table) if (!deleted) out.set(k, row);
			return out;
		};
		return {
			...emptyState(),
			...Object.fromEntries(TABLES.map((t) => [t, live(this.tables[t] as Map<string, Row>)]))
		} as State;
	}

	/** A Transport for one client. `online` can be flipped to simulate lost signal. */
	transport(): Transport & { online: boolean } {
		const server = this;
		return {
			online: true,
			async push(req) {
				if (!this.online) throw new TypeError('Failed to fetch');
				return structuredClone(server.push(structuredClone(req)));
			},
			async pull(clientId, cursor) {
				if (!this.online) throw new TypeError('Failed to fetch');
				return server.pull(clientId, cursor);
			}
		};
	}

	pokes(): PokeSource {
		return {
			subscribe: (fn) => {
				this.pokeListeners.add(fn);
				return () => this.pokeListeners.delete(fn);
			}
		};
	}

	// Stamps every row the mutation added or changed, and tombstones removed ones.
	private write(before: State, after: State, version: number) {
		for (const name of Object.keys(this.tables) as (keyof State)[]) {
			const table = this.tables[name] as Map<string, Row>;
			const old = before[name] as ReadonlyMap<string, object>;
			const next = after[name] as ReadonlyMap<string, object>;
			for (const [key, row] of next) {
				if (old.get(key) !== row) table.set(key, { ...row, deleted: false, version });
			}
			for (const [key, row] of old) {
				if (!next.has(key)) table.set(key, { ...row, deleted: true, version });
			}
		}
	}
}

const strip = ({ client_id: _c, version: _v, ...r }: Rejection & { client_id: string; version: number }) => r;
