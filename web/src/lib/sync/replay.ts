// The two pure halves of the sync model:
//
// - applyPull folds a pull's changes into the base (the server's state as this
//   client last saw it).
// - computeView replays pending mutations on top of the base. That's what the
//   UI shows.

import { apply, MutationError } from './mutators';
import { resultKey, type PendingMutation, type PullResponse, type State } from './types';

export interface View {
	state: State;
	/**
	 * Pending mutations that no longer apply on top of the latest base, keyed by
	 * mutation id, with the reason. They stay queued: the server will reject
	 * them, and its rejection is what the coach acts on.
	 */
	skipped: ReadonlyMap<number, string>;
}

export function computeView(base: State, pending: readonly PendingMutation[]): View {
	let state = base;
	const skipped = new Map<number, string>();

	for (const m of pending) {
		try {
			state = apply(state, m);
		} catch (e) {
			skipped.set(m.id, e instanceof MutationError ? e.message : String(e));
		}
	}

	return { state, skipped };
}

/** The tables a client holds, in the order they're applied. */
export const TABLES = [
	'programs',
	'seasons',
	'teams',
	'players',
	'roster_entries',
	'drills',
	'runs',
	'results',
	'games',
	'plays'
] as const satisfies readonly (keyof State)[];

/** A row's key in its table. Results are addressed by (run, player); everything else by id. */
export function keyOf(table: keyof State, row: { id?: string; drill_run_id?: string; player_id?: string }): string {
	return table === 'results' ? resultKey(row.drill_run_id!, row.player_id!) : row.id!;
}

/** Returns a new base with the pull's rows written in and tombstoned rows removed. */
export function applyPull(base: State, changes: PullResponse['changes']): State {
	const next = { ...base } as Record<keyof State, ReadonlyMap<string, unknown>>;

	for (const table of TABLES) {
		const rows = changes[table] as unknown as ({ deleted: boolean; version: number } & Record<string, unknown>)[];
		if (!rows?.length) continue;

		const map = new Map(base[table] as ReadonlyMap<string, unknown>);
		for (const { deleted, version: _v, ...row } of rows) {
			const key = keyOf(table, row);
			if (deleted) map.delete(key);
			else map.set(key, row);
		}
		next[table] = map;
	}

	return next as unknown as State;
}
