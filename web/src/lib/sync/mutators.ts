// Client mutators: pure `apply(state, mutation) → state` functions with the same
// names, rules and messages as server/lib/courtside/sync/mutators.ex. They run
// in two places:
//
// - before enqueueing, so invalid input is refused right away, and
// - when computing the view (base + pending replayed).
//
// The server is authoritative. When the two disagree, the server's rejection
// wins and shows up in the sync inspector.

import {
	KINDS,
	resultKey,
	type Drill,
	type Kind,
	type MutationArgs,
	type MutationInput,
	type MutationName,
	type Player,
	type Result,
	type Run,
	type State
} from './types';

/** A mutation that doesn't apply. `message` is shown to the coach. */
export class MutationError extends Error {}

const fail = (message: string): never => {
	throw new MutationError(message);
};

type Mutator<N extends MutationName> = (state: State, args: MutationArgs[N]) => State;

const mutators: { [N in MutationName]: Mutator<N> } = {
	'player.put': (state, args) => {
		const name = (args.name ?? '').trim();
		if (!name) fail("Name can't be blank");
		if (name.length > 100) fail('Name should be at most 100 character(s)');

		const player: Player = {
			id: uuid(args.id),
			name,
			jersey: args.jersey ?? '',
			active: args.active ?? true
		};
		return { ...state, players: put(state.players, player.id, player) };
	},

	'drill.put': (state, args) => {
		const name = (args.name ?? '').trim();
		if (!name) fail("Name can't be blank");
		if (!KINDS.includes(args.kind)) fail('Kind must be makes, count or time');

		const existing = state.drills.get(args.id);
		if (existing && existing.kind !== args.kind) fail("Kind can't change after the drill is created");
		positiveOrNull(args.default_setup, 'Default setup');

		const drill: Drill = {
			id: uuid(args.id),
			name,
			kind: args.kind,
			default_setup: args.default_setup ?? null,
			archived: args.archived ?? false
		};
		return { ...state, drills: put(state.drills, drill.id, drill) };
	},

	'run.create': (state, args) => {
		const drill = state.drills.get(args.drill_id) ?? fail('That drill no longer exists.');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date ?? '')) fail('Date is invalid');
		if (state.runs.has(args.id)) fail('Id already exists');
		checkRunSetup(drill.kind, args.setup);

		const run: Run = { id: uuid(args.id), date: args.date, drill_id: drill.id, setup: args.setup ?? null };
		return { ...state, runs: put(state.runs, run.id, run) };
	},

	'run.set_setup': (state, args) => {
		const run = liveRun(state, args.id);
		const drill = drillFor(state, run);
		checkRunSetup(drill.kind, args.setup);

		if (drill.kind === 'makes') {
			for (const r of resultsOf(state, run.id)) {
				if (r.setup === null && r.value !== null && r.value > args.setup!) {
					const name = state.players.get(r.player_id)?.name ?? 'A player';
					fail(`${name} has ${r.value} makes, more than ${args.setup} shots.`);
				}
			}
		}

		return { ...state, runs: put(state.runs, run.id, { ...run, setup: args.setup }) };
	},

	'run.delete': (state, args) => {
		if (!state.runs.has(args.id)) return state;

		const runs = new Map(state.runs);
		runs.delete(args.id);
		const results = new Map(state.results);
		for (const r of resultsOf(state, args.id)) results.delete(resultKey(r.drill_run_id, r.player_id));
		return { ...state, runs, results };
	},

	'result.set_value': (state, args) => {
		const run = liveRun(state, args.drill_run_id);
		const drill = drillFor(state, run);
		livePlayer(state, args.player_id);

		const existing = getResult(state, run.id, args.player_id);
		const value = parseValue(drill.kind, args.value, existing.setup ?? run.setup);
		return putResult(state, { ...existing, value });
	},

	'result.set_setup': (state, args) => {
		const run = liveRun(state, args.drill_run_id);
		const drill = drillFor(state, run);
		livePlayer(state, args.player_id);
		positiveOrNull(args.setup, 'Setup');

		const existing = getResult(state, run.id, args.player_id);
		const setup = args.setup ?? run.setup;
		if (drill.kind === 'makes' && existing.value !== null && setup !== null && existing.value > setup) {
			fail(`${existing.value} makes is more than ${setup} shots.`);
		}
		return putResult(state, { ...existing, setup: args.setup ?? null });
	},

	'result.clear': (state, args) => {
		const key = resultKey(args.drill_run_id, args.player_id);
		if (!state.results.has(key)) return state;

		const results = new Map(state.results);
		results.delete(key);
		return { ...state, results };
	}
};

/**
 * The arguments each mutation accepts. Anything else is refused rather than
 * ignored, on both sides, so a field name the two disagree on fails loudly
 * instead of being dropped by the server. Matches @fields in mutators.ex.
 */
const FIELDS: { [N in MutationName]: readonly (keyof MutationArgs[N])[] } = {
	'player.put': ['id', 'name', 'jersey', 'active'],
	'drill.put': ['id', 'name', 'kind', 'default_setup', 'archived'],
	'run.create': ['id', 'date', 'drill_id', 'setup'],
	'run.set_setup': ['id', 'setup'],
	'run.delete': ['id'],
	'result.set_value': ['drill_run_id', 'player_id', 'value'],
	'result.set_setup': ['drill_run_id', 'player_id', 'setup'],
	'result.clear': ['drill_run_id', 'player_id']
};

/** Applies one mutation, or throws MutationError with the reason it doesn't apply. */
export function apply(state: State, mutation: MutationInput): State {
	const mutator = mutators[mutation.name] as Mutator<MutationName> | undefined;
	if (!mutator) fail(`Unknown change type: ${mutation.name}`);

	const args: unknown = mutation.args;
	if (typeof args !== 'object' || args === null) fail('The server could not apply this change.');
	const allowed: readonly string[] = FIELDS[mutation.name];
	const unknown = Object.keys(args as object)
		.filter((k) => !allowed.includes(k))
		.sort();
	if (unknown.length > 0) fail(`Unknown field: ${unknown[0]}`);

	return mutator!(state, mutation.args);
}

// --- helpers -----------------------------------------------------------------

function put<T>(map: ReadonlyMap<string, T>, key: string, value: T): Map<string, T> {
	return new Map(map).set(key, value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(id: string): string {
	if (!UUID.test(id ?? '')) fail('The server could not apply this change.');
	return id;
}

function liveRun(state: State, id: string): Run {
	return state.runs.get(id) ?? fail('That drill was removed from the practice.');
}

function livePlayer(state: State, id: string): Player {
	return state.players.get(id) ?? fail('That player is no longer on the roster.');
}

function drillFor(state: State, run: Run): Drill {
	// The base never holds a run without its drill: the server checks the
	// foreign key, and drills can't be deleted.
	return state.drills.get(run.drill_id) ?? fail('That drill no longer exists.');
}

function resultsOf(state: State, runId: string): Result[] {
	return [...state.results.values()].filter((r) => r.drill_run_id === runId);
}

function getResult(state: State, runId: string, playerId: string): Result {
	return (
		state.results.get(resultKey(runId, playerId)) ?? {
			drill_run_id: runId,
			player_id: playerId,
			value: null,
			setup: null
		}
	);
}

function putResult(state: State, result: Result): State {
	const key = resultKey(result.drill_run_id, result.player_id);
	return { ...state, results: put(state.results, key, result) };
}

function positiveOrNull(n: number | null | undefined, label: string) {
	if (n === null || n === undefined) return;
	if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${label} is invalid`);
	if (n <= 0) fail(`${label} must be greater than 0`);
}

function checkRunSetup(kind: Kind, setup: number | null | undefined) {
	if (kind === 'makes' && (setup === null || setup === undefined)) fail('Setup shots are required');
	positiveOrNull(setup, 'Setup');
}

function parseValue(kind: Kind, value: unknown, setup: number | null): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Enter a number.');
	if (value < 0) fail("Results can't be negative.");
	if (kind === 'makes') {
		if (!Number.isInteger(value)) fail('Makes must be a whole number.');
		if (setup !== null && value > setup) fail(`${value} makes is more than ${setup} shots.`);
	}
	if (kind === 'time' && value === 0) fail('Time must be above zero.');
	return value;
}
