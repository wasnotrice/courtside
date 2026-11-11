// Getting back changes the server refused because another phone deleted the game or
// drill run they were recorded into (docs/games-plan.md, "Restoring from a refusal").
// Deletes are tombstones, so the server can bring the row back with game.restore or
// run.restore; then the refused changes are sent again.

import type { MutateResult, SyncEngine } from './engine';
import type { MutationInput, Rejection, State } from './types';

// The server's messages for a change into a deleted game or run (spec/mutations/).
const GAME_DELETED = 'That game was deleted.';
const PLAY_DELETED = 'That play was deleted.';
const RUN_DELETED = 'That drill was removed from the practice.';

/** Refused changes into one game or drill run that was deleted. */
export interface Lost {
	kind: 'game' | 'run';
	id: string;
	/** Oldest first. */
	rejections: Rejection[];
	/** False once the game or run is back on this phone (restored, maybe elsewhere). */
	gone: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Which deleted game or run a refusal was about, if it was refused for that. */
function lostTo(r: Rejection): { kind: Lost['kind']; id: string } | null {
	const a = r.args;
	if (r.reason === GAME_DELETED) {
		const id = r.name === 'game.put' ? str(a.id) : str(a.game_id);
		return id ? { kind: 'game', id } : null;
	}
	if (r.reason === RUN_DELETED) {
		const id = r.name === 'run.set_setup' ? str(a.id) : str(a.drill_run_id);
		return id ? { kind: 'run', id } : null;
	}
	return null;
}

/** The refusals that a restore could save, grouped by the game or run they went into. */
export function lostChanges(rejections: readonly Rejection[], view: State): Lost[] {
	const groups = new Map<string, Lost>();
	for (const r of [...rejections].sort((a, b) => a.mutation_id - b.mutation_id)) {
		const to = lostTo(r);
		if (!to) continue;
		const key = `${to.kind}:${to.id}`;
		const gone = to.kind === 'game' ? !view.games.has(to.id) : !view.runs.has(to.id);
		const group = groups.get(key) ?? groups.set(key, { ...to, rejections: [], gone }).get(key)!;
		group.rejections.push(r);
	}
	return [...groups.values()];
}

/**
 * Brings the game or run back if it's still gone (this needs a connection), then sends
 * each refused change again. A change that still doesn't apply stays listed, and the
 * first reason is returned.
 */
export async function restoreLost(engine: SyncEngine, lost: Lost): Promise<MutateResult> {
	const name = lost.kind === 'game' ? 'game.restore' : 'run.restore';
	const here = () => (lost.kind === 'game' ? engine.snapshot.view.games : engine.snapshot.view.runs).has(lost.id);

	if (!here()) {
		if (engine.snapshot.offline) return { ok: false, reason: 'Restoring needs a connection.' };
		const queued = await engine.mutate({ name, args: { id: lost.id } });
		if (!queued.ok) return queued;
		await engine.sync();
		if (!here()) {
			const refused = engine.snapshot.rejections.find((r) => r.name === name && r.args.id === lost.id);
			if (!refused) return { ok: false, reason: "Couldn't reach the server. Try again when you have signal." };
			await engine.dismissRejection(refused.mutation_id);
			return { ok: false, reason: refused.reason };
		}
	}

	// Edits to plays deleted along with the game were refused for the play, not the
	// game: now that those plays are back, they can go again too.
	const view = engine.snapshot.view;
	const edits =
		lost.kind === 'game'
			? engine.snapshot.rejections.filter(
					(r) => r.reason === PLAY_DELETED && view.plays.get(str(r.args.id) ?? '')?.game_id === lost.id
				)
			: [];

	let firstFailure: string | null = null;
	for (const r of [...lost.rejections, ...edits].sort((a, b) => a.mutation_id - b.mutation_id)) {
		const outcome = await engine.mutate({ name: r.name, args: r.args } as MutationInput);
		if (outcome.ok) await engine.dismissRejection(r.mutation_id);
		else firstFailure ??= outcome.reason;
	}
	return firstFailure ? { ok: false, reason: firstFailure } : { ok: true };
}
