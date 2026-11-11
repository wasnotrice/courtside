// Undo (docs/games-plan.md, "Undo and history"). The phone keeps no history, so the
// only moment it knows a field's old value is just before the change: `reverseOf` works
// out, from the view at that moment, the changes that would put things back. Undo sends
// those as ordinary changes, checked like any other.

import { resultKey, type MutationInput, type State } from './types';

const pick = (row: object, keys: Iterable<string>) => {
	const out: Record<string, unknown> = {};
	for (const k of keys) out[k] = (row as Record<string, unknown>)[k] ?? null;
	return out;
};

/** The fields an edit sends, besides the id. */
const sentFields = (args: object) => Object.keys(args).filter((k) => k !== 'id');

/**
 * The changes that would undo `input`, worked out from `state` just before it's made.
 * Null for a change that has nothing to undo or can't be undone.
 */
export function reverseOf(state: State, input: MutationInput): MutationInput[] | null {
	switch (input.name) {
		case 'play.put': {
			const before = state.plays.get(input.args.id);
			if (!before) return [{ name: 'play.delete', args: { id: input.args.id } }];
			return [{ name: 'play.put', args: { id: before.id, ...pick(before, sentFields(input.args)) } }];
		}
		case 'play.delete': {
			// A deleted play can't come back under its id (the server keeps it deleted), so
			// undo records it again as a new play in the same place.
			const before = state.plays.get(input.args.id);
			if (!before) return null;
			return [{ name: 'play.put', args: { ...before, id: crypto.randomUUID() } }];
		}
		case 'result.set_value':
		case 'result.set_setup':
		case 'result.clear': {
			const { drill_run_id, player_id } = input.args;
			const key = { drill_run_id, player_id };
			const before = state.results.get(resultKey(drill_run_id, player_id));
			const restore: MutationInput[] = [];
			if (before?.value != null) restore.push({ name: 'result.set_value', args: { ...key, value: before.value } });
			if (before?.setup != null) restore.push({ name: 'result.set_setup', args: { ...key, setup: before.setup } });
			if (input.name === 'result.set_setup') {
				return [{ name: 'result.set_setup', args: { ...key, setup: before?.setup ?? null } }];
			}
			if (input.name === 'result.set_value' && before?.value == null) {
				// There was no value: clearing drops the whole row, so put a setup back.
				return [{ name: 'result.clear', args: key }, ...restore];
			}
			return restore.length ? restore : null;
		}
		case 'run.create':
			return [{ name: 'run.delete', args: { id: input.args.id } }];
		case 'run.set_setup': {
			const before = state.runs.get(input.args.id);
			return before ? [{ name: 'run.set_setup', args: { id: before.id, setup: before.setup } }] : null;
		}
		case 'roster.put': {
			const before = state.roster_entries.get(input.args.id);
			if (!before) return [{ name: 'roster.remove', args: { id: input.args.id } }];
			return [{ name: 'roster.put', args: { id: before.id, ...pick(before, sentFields(input.args)) } } as MutationInput];
		}
		case 'game.put': {
			const before = state.games.get(input.args.id);
			if (!before) return null;
			return [{ name: 'game.put', args: { id: before.id, ...pick(before, sentFields(input.args)) } } as MutationInput];
		}
		case 'player.put': {
			const before = state.players.get(input.args.id);
			if (!before) return null;
			return [{ name: 'player.put', args: { id: before.id, ...pick(before, sentFields(input.args)) } } as MutationInput];
		}
		default:
			return null;
	}
}

/**
 * Undoing a play.delete brings the play back under a new id. Older undo steps still
 * name the old id: this points them at the new one.
 */
export function renamed(inputs: readonly MutationInput[], renames: ReadonlyMap<string, string>): MutationInput[] {
	return inputs.map((m) => {
		const id = (m.args as { id?: string }).id;
		const to = id && renames.get(id);
		return to ? ({ ...m, args: { ...m.args, id: to } } as MutationInput) : m;
	});
}

/** The ids a reverse gives back under a new id: deleted plays it records again. */
export function renamesOf(input: MutationInput, reverse: readonly MutationInput[]): Map<string, string> {
	const out = new Map<string, string>();
	if (input.name === 'play.delete' && reverse[0]?.name === 'play.put') out.set(input.args.id, reverse[0].args.id);
	return out;
}
