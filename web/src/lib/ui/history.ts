// A row's history from the server's change log: what each change did, in words, and
// the change that reverts it (docs/games-plan.md, "Undo and history"). Pure functions.

import type { HistoryEntry, MutationInput } from '$lib/sync/types';

/** The rows the history sheet covers, as pull names their tables. */
export type HistoryTable = 'plays' | 'games' | 'players';

const PUT: Record<HistoryTable, 'play.put' | 'game.put' | 'player.put'> = {
	plays: 'play.put',
	games: 'game.put',
	players: 'player.put'
};

/** Fields that bookkeeping changes, not people; never shown or reverted on their own. */
const HIDDEN = new Set(['recorded_at', 'program_id', 'team_id', 'game_id']);

export type Kind = 'created' | 'deleted' | 'restored' | 'edited' | 'refused';

export function kindOf(e: HistoryEntry, oldest: boolean): Kind {
	if (!e.accepted) return 'refused';
	const deleted = e.changes?.deleted;
	if (deleted) return deleted[1] ? 'deleted' : 'restored';
	// A new row's fields all start from null; the oldest entry is the one that made it.
	return oldest && Object.values(e.changes ?? {}).every(([before]) => before === null) ? 'created' : 'edited';
}

/** The fields an edit changed, as they're shown. */
export function shownChanges(e: HistoryEntry): [string, unknown, unknown][] {
	return Object.entries(e.changes ?? {})
		.filter(([field]) => !HIDDEN.has(field) && field !== 'deleted')
		.map(([field, [before, after]]) => [field, before, after]);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The change that puts back an edit's before values, or null for anything else. Only the
 * fields the edit changed are sent, so later edits to other fields stay.
 */
export function revertOf(table: HistoryTable, key: string, e: HistoryEntry, oldest: boolean): MutationInput | null {
	if (kindOf(e, oldest) !== 'edited') return null;
	const fields = shownChanges(e);
	if (!fields.length) return null;
	const args: Record<string, unknown> = { id: key };
	for (const [field, before] of fields) args[field] = before;
	return { name: PUT[table], args } as MutationInput;
}

/** Fields the edit changed that have changed again since, with their value now. */
export function changedSince(row: object, e: HistoryEntry): [string, unknown][] {
	const now = row as Record<string, unknown>;
	return shownChanges(e)
		.filter(([field, , after]) => !same(now[field], after))
		.map(([field]) => [field, now[field]]);
}

/** "Just now", "5 min ago", "3 h ago", or the date. */
export function ago(at: string, now = Date.now()): string {
	const ms = now - new Date(at).getTime();
	const min = Math.round(ms / 60_000);
	if (min < 1) return 'Just now';
	if (min < 60) return `${min} min ago`;
	const h = Math.round(min / 60);
	if (h < 24) return `${h} h ago`;
	return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
