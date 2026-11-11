// The UI's entry point to sync. Components read `sync.snapshot` (reactive) and
// call the engine's methods; they never touch the store or transport.

import { DexieStore } from './dexie-store';
import { SyncEngine, type SyncSnapshot } from './engine';
import { HttpTransport, PhoenixPokes, type ServerConfig } from './transport';

export type { MutateResult, Phase, SyncSnapshot } from './engine';
export type * from './types';
export { resultKey } from './types';

/**
 * Which server and organization to sync with. Until sign-in exists, these come
 * from the build: VITE_COURTSIDE_API (empty means this page's origin, which in
 * dev is Vite proxying to Phoenix) and VITE_COURTSIDE_ORG (defaults to the
 * organization in server/priv/repo/seeds.exs).
 */
export const server: ServerConfig = {
	baseUrl: import.meta.env.VITE_COURTSIDE_API ?? '',
	organizationId: import.meta.env.VITE_COURTSIDE_ORG ?? 'c0000000-0000-4000-8000-000000000001'
};

export interface Sync {
	readonly engine: SyncEngine;
	readonly snapshot: SyncSnapshot;
	/**
	 * Whether the browser agreed to keep local data even when the device runs
	 * low on space: true, false, or null if the browser can't say. Without it,
	 * unsynced changes can be evicted. Installing to the home screen makes a yes
	 * likely on iOS.
	 */
	readonly persisted: boolean | null;
}

/** Opens local data and starts syncing. Call once, from the root layout. */
export async function openSync(): Promise<Sync> {
	const engine = await SyncEngine.open({
		store: new DexieStore(server.organizationId),
		transport: new HttpTransport(server),
		pokes: new PhoenixPokes(server)
	});

	let snapshot = $state.raw(engine.snapshot);
	engine.subscribe((s) => (snapshot = s));
	engine.start();

	const persisted = await requestPersistence();

	return {
		engine,
		get snapshot() {
			return snapshot;
		},
		persisted
	};
}

async function requestPersistence(): Promise<boolean | null> {
	try {
		const storage = navigator.storage;
		if (!storage?.persist) return null;
		return (await storage.persisted()) || (await storage.persist());
	} catch {
		return null;
	}
}
