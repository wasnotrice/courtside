// Shapes shared by the sync layer. Rows mirror what the server sends on pull
// (see server/lib/courtside/sync.ex, to_wire/1), minus `version` and `deleted`,
// which only matter while applying a pull.

export type Kind = 'makes' | 'count' | 'time';
export const KINDS: readonly Kind[] = ['makes', 'count', 'time'];

export type Sport = 'basketball';
export const SPORTS: readonly Sport[] = ['basketball'];

/** One sport for one gender at the organization, such as girls' basketball. */
export interface Program {
	id: string;
	name: string;
	sport: Sport;
}

/** One school year, shared by the organization's programs. Dates are YYYY-MM-DD. */
export interface Season {
	id: string;
	name: string;
	starts_on: string;
	ends_on: string;
}

/** One level within a program, such as varsity or JV. */
export interface Team {
	id: string;
	program_id: string;
	name: string;
}

export interface Player {
	id: string;
	program_id: string;
	name: string;
}

/** A player's place on one team for one season, with the jersey worn there. */
export interface RosterEntry {
	id: string;
	team_id: string;
	season_id: string;
	player_id: string;
	jersey: string;
}

export interface Drill {
	id: string;
	program_id: string;
	name: string;
	kind: Kind;
	default_setup: number | null;
	archived: boolean;
}

export interface Run {
	id: string;
	program_id: string;
	/** YYYY-MM-DD, the practice day. */
	date: string;
	drill_id: string;
	setup: number | null;
}

/** One player's result in one run. `value` is null when only `setup` is overridden. */
export interface Result {
	drill_run_id: string;
	player_id: string;
	value: number | null;
	setup: number | null;
}

/** The data a client holds: either the server's (the base) or base + pending (the view). */
export interface State {
	programs: ReadonlyMap<string, Program>;
	seasons: ReadonlyMap<string, Season>;
	teams: ReadonlyMap<string, Team>;
	players: ReadonlyMap<string, Player>;
	roster_entries: ReadonlyMap<string, RosterEntry>;
	drills: ReadonlyMap<string, Drill>;
	runs: ReadonlyMap<string, Run>;
	/** Keyed by resultKey(run, player). */
	results: ReadonlyMap<string, Result>;
}

export const resultKey = (drillRunId: string, playerId: string) => `${drillRunId}/${playerId}`;

export const emptyState = (): State => ({
	programs: new Map(),
	seasons: new Map(),
	teams: new Map(),
	players: new Map(),
	roster_entries: new Map(),
	drills: new Map(),
	runs: new Map(),
	results: new Map()
});

// --- mutations ---------------------------------------------------------------

export interface MutationArgs {
	'program.put': Program;
	'season.put': Season;
	'team.put': Team;
	'player.put': Player;
	'roster.put': RosterEntry;
	'roster.remove': { id: string };
	'drill.put': Drill;
	'run.create': Run;
	'run.set_setup': { id: string; setup: number | null };
	'run.delete': { id: string };
	'result.set_value': { drill_run_id: string; player_id: string; value: number };
	'result.set_setup': { drill_run_id: string; player_id: string; setup: number | null };
	'result.clear': { drill_run_id: string; player_id: string };
}

export type MutationName = keyof MutationArgs;

/** A mutation as the UI asks for it, before it has an id. */
export type MutationInput = {
	[N in MutationName]: { name: N; args: MutationArgs[N] };
}[MutationName];

/** A mutation waiting to be confirmed by the server. `id` increases per client. */
export type PendingMutation = MutationInput & { id: number };

// --- wire --------------------------------------------------------------------

export interface Rejection {
	mutation_id: number;
	name: string;
	args: Record<string, unknown>;
	reason: string;
}

export interface PushRequest {
	organization_id: string;
	client_id: string;
	mutations: PendingMutation[];
}

export interface PushResponse {
	last_mutation_id: number;
	rejections: Rejection[];
}

type Synced<T> = T & { deleted: boolean; version: number };

export interface PullResponse {
	cursor: number;
	/** Changes when the server's data is recreated or restored: pull from scratch. */
	data_id: string;
	last_mutation_id: number;
	rejections: Rejection[];
	changes: {
		programs: Synced<Program>[];
		seasons: Synced<Season>[];
		teams: Synced<Team>[];
		players: Synced<Player>[];
		roster_entries: Synced<RosterEntry>[];
		drills: Synced<Drill>[];
		runs: Synced<Run>[];
		results: Synced<Result>[];
	};
}
