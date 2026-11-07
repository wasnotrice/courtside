// The UI's entry point to sync. Components read `sync.snapshot` (reactive) and
// call the engine's methods; they never touch the store or transport.

import { DexieStore } from './dexie-store';
import { SyncEngine, type SyncSnapshot } from './engine';
import { HttpTransport, PhoenixPokes } from './transport';

export type { MutateResult, Phase, SyncSnapshot } from './engine';
export type * from './types';
export { resultKey } from './types';

export interface Sync {
	readonly engine: SyncEngine;
	readonly snapshot: SyncSnapshot;
}

/** Opens local data and starts syncing. Call once, from the root layout. */
export async function openSync(): Promise<Sync> {
	const engine = await SyncEngine.open({
		store: new DexieStore(),
		transport: new HttpTransport(),
		pokes: new PhoenixPokes()
	});

	let snapshot = $state.raw(engine.snapshot);
	engine.subscribe((s) => (snapshot = s));
	engine.start();

	return {
		engine,
		get snapshot() {
			return snapshot;
		}
	};
}
