// Client mutators: pure `apply(state, mutation) → state` functions with the same
// names, rules and messages as server/lib/courtside/sync/mutators.ex. They run
// in two places:
//
// - before enqueueing, so invalid input is refused right away, and
// - when computing the view (base + pending replayed).
//
// The server is authoritative. When the two disagree, the server's rejection
// wins and shows up in the sync inspector.

import { DEFAULT_RULES, FOUL_TYPES, MADE_FIELD_GOALS, periodSeconds, rulesProblem, STATS } from './basketball';
import {
	KINDS,
	SPORTS,
	resultKey,
	type Drill,
	type Game,
	type Kind,
	type MutationArgs,
	type MutationInput,
	type MutationName,
	type Play,
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
		if (args.default_rules !== undefined && args.default_rules !== null) checkRules(args.default_rules);

		const team: Team = { id, program_id: program.id, name, default_rules: m.default_rules ?? null };
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
	},

	'game.put': (state, args) => {
		const id = uuid(args.id);
		const existing = state.games.get(id);
		const m = merged(existing, args);
		const team = (m.team_id && state.teams.get(m.team_id)) || fail('That team no longer exists.');
		if (existing && existing.team_id !== team.id) fail("Team can't change after the game is created");

		// A new game copies its team's rules, or the default, unless it brings its own.
		const rules = existing ? m.rules : (m.rules ?? team.default_rules ?? DEFAULT_RULES);
		const opponent = typeof m.opponent === 'string' ? m.opponent.trim() : '';
		if (m.date === undefined || m.date === null) fail("Date can't be blank");
		if (!isDate(m.date)) fail('Date is invalid');
		if (!opponent) fail("Opponent can't be blank");
		if (opponent.length > 100) fail('Opponent should be at most 100 character(s)');
		if (!rules) fail("Rules can't be blank");
		const home_away = m.home_away ?? 'home';
		if (!['home', 'away', 'neutral'].includes(home_away)) fail('Home away must be home, away or neutral');
		const status = m.status ?? 'live';
		if (!['live', 'final', 'reviewed'].includes(status)) fail('Status must be live, final or reviewed');
		checkScore(m.official_us, 'Official us');
		checkScore(m.official_them, 'Official them');
		if (!existing || args.rules !== undefined) checkRules(rules);
		if (!seasonOf(state, m.date!)) fail('No season includes that date.');

		const game: Game = {
			id,
			team_id: team.id,
			date: m.date!,
			opponent,
			home_away,
			status,
			rules: rules!,
			official_us: m.official_us ?? null,
			official_them: m.official_them ?? null
		};
		return { ...state, games: put(state.games, id, game) };
	},

	'game.delete': (state, args) => {
		if (!state.games.has(args.id)) return state;

		const games = new Map(state.games);
		games.delete(args.id);
		const plays = new Map(state.plays);
		for (const p of state.plays.values()) if (p.game_id === args.id) plays.delete(p.id);
		return { ...state, games, plays };
	},

	// The checks run in the server's order (mutators.ex, put_play), so a play with one
	// problem gets the same message on both sides.
	'play.put': (state, args) => {
		const id = uuid(args.id);
		const existing = state.plays.get(id);
		// An edit to a play this phone no longer has: another phone deleted it.
		if (!existing && !('game_id' in args)) fail('That play was deleted.');
		const m = merged(existing, args);
		const game = (m.game_id && state.games.get(m.game_id)) || fail('That game was deleted.');
		if (existing && existing.game_id !== game.id) fail("Game can't change after the play is recorded");

		const foul_type = m.stat === 'foul' && m.foul_type == null ? 'personal' : (m.foul_type ?? null);
		if (m.side == null) fail("Side can't be blank");
		if (m.stat == null) fail("Stat can't be blank");
		if (m.period == null) fail("Period can't be blank");
		if (typeof m.position !== 'string' || !m.position.trim()) fail("Position can't be blank");
		if (m.recorded_at == null) fail("Recorded at can't be blank");
		if (!['us', 'them'].includes(m.side!)) fail('Side must be us or them');
		if (!STATS.includes(m.stat!)) fail('Stat is invalid');
		if (!Number.isInteger(m.period)) fail('Period is invalid');
		if (m.period! <= 0) fail('Period must be greater than 0');
		if (m.clock != null && !Number.isInteger(m.clock)) fail('Clock is invalid');
		if (m.clock != null && m.clock < 0) fail('Clock must be greater than or equal to 0');
		if (m.video_at != null && !(typeof m.video_at === 'number' && Number.isFinite(m.video_at))) fail('Video at is invalid');
		if (m.video_at != null && m.video_at < 0) fail('Video at must be greater than or equal to 0');
		if (!Number.isInteger(m.recorded_at)) fail('Recorded at is invalid');

		const play: Play = {
			id,
			game_id: game.id,
			side: m.side!,
			player_id: m.player_id ?? null,
			stat: m.stat!,
			foul_type,
			assist_player_id: m.assist_player_id ?? null,
			drawn_by_player_id: m.drawn_by_player_id ?? null,
			period: m.period!,
			clock: m.clock ?? null,
			video_at: m.video_at ?? null,
			position: m.position!,
			recorded_at: m.recorded_at!
		};

		if (play.side === 'them' && play.player_id !== null) fail("The other team's plays can't have a player.");
		if (play.assist_player_id !== null && !(play.side === 'us' && MADE_FIELD_GOALS.includes(play.stat))) {
			fail('Only made shots can have an assist.');
		}
		if (play.assist_player_id !== null && play.assist_player_id === play.player_id) {
			fail("A player can't assist their own shot.");
		}
		if (play.foul_type !== null && play.stat !== 'foul') fail('Only fouls have a foul type.');
		if (play.foul_type !== null && !FOUL_TYPES.includes(play.foul_type)) fail('Foul type is invalid');
		if (play.drawn_by_player_id !== null && !(play.side === 'them' && play.stat === 'foul')) {
			fail("Only the other team's fouls can be drawn.");
		}

		const team = state.teams.get(game.team_id);
		for (const pid of [play.player_id, play.assist_player_id, play.drawn_by_player_id]) {
			if (pid === null) continue;
			const player = livePlayer(state, pid);
			if (player.program_id !== team?.program_id) fail('That player is in a different program.');
		}
		if (play.clock !== null && play.clock > periodSeconds(game.rules, play.period)) {
			fail("Clock is more than the period's length.");
		}

		return { ...state, plays: put(state.plays, id, play) };
	},

	'play.delete': (state, args) => {
		if (!state.plays.has(args.id)) return state;

		const plays = new Map(state.plays);
		plays.delete(args.id);
		return { ...state, plays };
	}
};

function checkRules(rules: unknown) {
	const problem = rulesProblem(rules);
	if (problem) fail(problem);
}

function checkScore(n: unknown, label: string) {
	if (n === null || n === undefined) return;
	if (!Number.isInteger(n)) fail(`${label} is invalid`);
	if ((n as number) < 0) fail(`${label} must be greater than or equal to 0`);
}

/**
 * The arguments each mutation accepts. Anything else is refused rather than
 * ignored, on both sides, so a field name the two disagree on fails loudly
 * instead of being dropped by the server. Matches @fields in mutators.ex.
 */
const FIELDS: { [N in MutationName]: readonly (keyof MutationArgs[N])[] } = {
	'program.put': ['id', 'name', 'sport'],
	'season.put': ['id', 'name', 'starts_on', 'ends_on'],
	'team.put': ['id', 'program_id', 'name', 'default_rules'],
	'player.put': ['id', 'program_id', 'name'],
	'roster.put': ['id', 'team_id', 'season_id', 'player_id', 'jersey'],
	'roster.remove': ['id'],
	'drill.put': ['id', 'program_id', 'name', 'kind', 'default_setup', 'archived'],
	'run.create': ['id', 'program_id', 'date', 'drill_id', 'setup'],
	'run.set_setup': ['id', 'setup'],
	'run.delete': ['id'],
	'result.set_value': ['drill_run_id', 'player_id', 'value'],
	'result.set_setup': ['drill_run_id', 'player_id', 'setup'],
	'result.clear': ['drill_run_id', 'player_id'],
	'game.put': ['id', 'team_id', 'date', 'opponent', 'home_away', 'status', 'rules', 'official_us', 'official_them'],
	'game.delete': ['id'],
	'play.put': [
		'id',
		'game_id',
		'side',
		'player_id',
		'stat',
		'foul_type',
		'assist_player_id',
		'drawn_by_player_id',
		'period',
		'clock',
		'video_at',
		'position',
		'recorded_at'
	],
	'play.delete': ['id']
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
