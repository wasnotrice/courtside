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

/** Returns a new base with the pull's rows written in and tombstoned rows removed. */
export function applyPull(base: State, changes: PullResponse['changes']): State {
	const merge = <W extends { deleted: boolean; version: number }, T>(
		table: ReadonlyMap<string, T>,
		rows: W[],
		key: (row: W) => string,
		strip: (row: W) => T
	) => {
		if (rows.length === 0) return table;
		const next = new Map(table);
		for (const row of rows) {
			if (row.deleted) next.delete(key(row));
			else next.set(key(row), strip(row));
		}
		return next;
	};

	return {
		players: merge(base.players, changes.players, (r) => r.id, ({ deleted: _d, version: _v, ...p }) => p),
		drills: merge(base.drills, changes.drills, (r) => r.id, ({ deleted: _d, version: _v, ...d }) => d),
		runs: merge(base.runs, changes.runs, (r) => r.id, ({ deleted: _d, version: _v, ...r }) => r),
		results: merge(
			base.results,
			changes.results,
			(r) => resultKey(r.drill_run_id, r.player_id),
			({ deleted: _d, version: _v, ...r }) => r
		)
	};
}
