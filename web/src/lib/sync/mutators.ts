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
	SPORTS,
	resultKey,
	type Drill,
	type Kind,
	type MutationArgs,
	type MutationInput,
	type MutationName,
	type Player,
	type Program,
	type Result,
	type RosterEntry,
	type Run,
	type Season,
	type State,
	type Team
} from './types';

/** A mutation that doesn't apply. `message` is shown to the coach. */
export class MutationError extends Error {}

const fail = (message: string): never => {
	throw new MutationError(message);
};

type Mutator<N extends MutationName> = (state: State, args: MutationArgs[N]) => State;

// The order of checks matches the server's, so a case with one problem gets
// the same message on both sides (see spec/mutations/).
const mutators: { [N in MutationName]: Mutator<N> } = {
	'program.put': (state, args) => {
		const id = uuid(args.id);
		const m = merged(state.programs.get(id), args);
		const name = checkName(m.name);
		if (m.sport === undefined || m.sport === null) fail("Sport can't be blank");
		if (!SPORTS.includes(m.sport!)) fail('Sport must be basketball');

		const program: Program = { id, name, sport: m.sport! };
		return { ...state, programs: put(state.programs, id, program) };
	},

	'season.put': (state, args) => {
		const id = uuid(args.id);
		const m = merged(state.seasons.get(id), args);
		const name = checkName(m.name);
		const starts = checkDate(m.starts_on, 'Starts on');
		const ends = checkDate(m.ends_on, 'Ends on');
		if (ends < starts) fail('Ends on must be on or after the start date');

		for (const other of state.seasons.values()) {
			if (other.id !== id && other.starts_on <= ends && other.ends_on >= starts) {
				fail(`Overlaps the ${other.name} season.`);
			}
		}

		const season: Season = { id, name, starts_on: starts, ends_on: ends };
		return { ...state, seasons: put(state.seasons, id, season) };
	},

	'team.put': (state, args) => {
		const id = uuid(args.id);
		const existing = state.teams.get(id);
		const m = merged(existing, args);
		const program = liveProgram(state, m.program_id);
		const name = checkName(m.name);
		unchangedProgram(existing, program, 'team');

		const team: Team = { id, program_id: program.id, name };
		return { ...state, teams: put(state.teams, id, team) };
	},

	'player.put': (state, args) => {
		const id = uuid(args.id);
		const existing = state.players.get(id);
		const m = merged(existing, args);
		const program = liveProgram(state, m.program_id);
		const name = checkName(m.name);
		unchangedProgram(existing, program, 'player');

		const player: Player = { id, program_id: program.id, name };
		return { ...state, players: put(state.players, id, player) };
	},

	'roster.put': (state, args) => {
		const id = uuid(args.id);
		const existing = state.roster_entries.get(id);
		const m = merged(existing, args);
		if (
			existing &&
			(existing.team_id !== m.team_id || existing.season_id !== m.season_id || existing.player_id !== m.player_id)
		) {
			fail("A roster entry can't move. Remove it and add a new one.");
		}

		const team = state.teams.get(m.team_id!) ?? fail('That team no longer exists.');
		const season = state.seasons.get(m.season_id!) ?? fail('That season no longer exists.');
		const player = state.players.get(m.player_id!) ?? fail('That player no longer exists.');
		if (player.program_id !== team.program_id) fail('That player is in a different program.');

		for (const other of state.roster_entries.values()) {
			if (other.id !== id && other.team_id === team.id && other.season_id === season.id && other.player_id === player.id) {
				fail('Already on that team this season.');
			}
		}

		const jersey = m.jersey ?? '';
		if (jersey.length > 10) fail('Jersey should be at most 10 character(s)');

		const entry: RosterEntry = { id, team_id: team.id, season_id: season.id, player_id: player.id, jersey };
		return { ...state, roster_entries: put(state.roster_entries, id, entry) };
	},

	'roster.remove': (state, args) => {
		if (!state.roster_entries.has(args.id)) return state;

		const roster_entries = new Map(state.roster_entries);
		roster_entries.delete(args.id);
		return { ...state, roster_entries };
	},

	'drill.put': (state, args) => {
		const id = uuid(args.id);
		const existing = state.drills.get(id);
		const m = merged(existing, args);
		const program = liveProgram(state, m.program_id);
		const name = checkName(m.name);
		if (m.kind === undefined || m.kind === null) fail("Kind can't be blank");
		if (!KINDS.includes(m.kind!)) fail('Kind must be makes, count or time');
		if (existing && existing.kind !== m.kind) fail("Kind can't change after the drill is created");
		unchangedProgram(existing, program, 'drill');
		positiveOrNull(m.default_setup, 'Default setup');

		const drill: Drill = {
			id,
			program_id: program.id,
			name,
			kind: m.kind!,
			default_setup: m.default_setup ?? null,
			archived: m.archived ?? false
		};
		return { ...state, drills: put(state.drills, id, drill) };
	},

	'run.create': (state, args) => {
		const program = liveProgram(state, args.program_id);
		const drill = state.drills.get(args.drill_id) ?? fail('That drill no longer exists.');
		if (drill.program_id !== program.id) fail('That drill is in a different program.');
		if (state.runs.has(args.id)) fail('Id already exists');
		if (!isDate(args.date)) fail('Date is invalid');
		checkRunSetup(drill.kind, args.setup);
		if (!seasonOf(state, args.date)) fail('No season includes that date.');

		const run: Run = {
			id: uuid(args.id),
			program_id: program.id,
			date: args.date,
			drill_id: drill.id,
			setup: args.setup ?? null
		};
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
		samePlayerProgram(livePlayer(state, args.player_id), run);

		const existing = getResult(state, run.id, args.player_id);
		const value = parseValue(drill.kind, args.value, existing.setup ?? run.setup);
		return putResult(state, { ...existing, value });
	},

	'result.set_setup': (state, args) => {
		const run = liveRun(state, args.drill_run_id);
		const drill = drillFor(state, run);
		samePlayerProgram(livePlayer(state, args.player_id), run);
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
	'program.put': ['id', 'name', 'sport'],
	'season.put': ['id', 'name', 'starts_on', 'ends_on'],
	'team.put': ['id', 'program_id', 'name'],
	'player.put': ['id', 'program_id', 'name'],
	'roster.put': ['id', 'team_id', 'season_id', 'player_id', 'jersey'],
	'roster.remove': ['id'],
	'drill.put': ['id', 'program_id', 'name', 'kind', 'default_setup', 'archived'],
	'run.create': ['id', 'program_id', 'date', 'drill_id', 'setup'],
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

/**
 * A row as a put leaves it: the stored row (if any) with the sent fields
 * written over it. A field sent as null becomes null; a field left out keeps
 * its stored value. Matches sent_or_stored and cast on the server.
 */
type Loose<T> = { [K in keyof T]?: T[K] | null };

function merged<T extends object>(existing: T | undefined, args: Loose<T>): Loose<T> {
	const out: Loose<T> = { ...existing };
	for (const [k, v] of Object.entries(args)) if (v !== undefined) out[k as keyof T] = v as T[keyof T] | null;
	return out;
}

function checkName(raw: string | null | undefined): string {
	const name = (raw ?? '').trim();
	if (!name) fail("Name can't be blank");
	if (name.length > 100) fail('Name should be at most 100 character(s)');
	return name;
}

/** A real calendar date as YYYY-MM-DD, like Ecto's :date cast. */
export function isDate(s: unknown): s is string {
	if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function checkDate(s: unknown, label: string): string {
	if (s === null || s === undefined || s === '') fail(`${label} can't be blank`);
	if (!isDate(s)) fail(`${label} is invalid`);
	return s as string;
}

/** The live season whose dates include `date`, if any. Seasons never overlap. */
export function seasonOf(state: State, date: string): Season | undefined {
	for (const s of state.seasons.values()) if (s.starts_on <= date && s.ends_on >= date) return s;
	return undefined;
}

function liveProgram(state: State, id: string | null | undefined): Program {
	return (id && state.programs.get(id)) || fail('That program no longer exists.');
}

function unchangedProgram(existing: { program_id: string } | undefined, program: Program, what: string) {
	if (existing && existing.program_id !== program.id) fail(`Program can't change after the ${what} is created`);
}

function samePlayerProgram(player: Player, run: Run) {
	if (player.program_id !== run.program_id) fail('That player is in a different program.');
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
