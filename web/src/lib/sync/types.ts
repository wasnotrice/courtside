// Shapes shared by the sync layer. Rows mirror what the server sends on pull
// (see server/lib/courtside/sync.ex, to_wire/1), minus `version` and `deleted`,
// which only matter while applying a pull.

export type Kind = 'makes' | 'count' | 'time';
export const KINDS: readonly Kind[] = ['makes', 'count', 'time'];

export interface Player {
	id: string;
	name: string;
	jersey: string;
	active: boolean;
}

export interface Drill {
	id: string;
	name: string;
	kind: Kind;
	default_setup: number | null;
	archived: boolean;
}

export interface Run {
	id: string;
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
	players: ReadonlyMap<string, Player>;
	drills: ReadonlyMap<string, Drill>;
	runs: ReadonlyMap<string, Run>;
	/** Keyed by resultKey(run, player). */
	results: ReadonlyMap<string, Result>;
}

export const resultKey = (drillRunId: string, playerId: string) => `${drillRunId}/${playerId}`;

export const emptyState = (): State => ({
	players: new Map(),
	drills: new Map(),
	runs: new Map(),
	results: new Map()
});

// --- mutations ---------------------------------------------------------------

export interface MutationArgs {
	'player.put': Player;
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
	last_mutation_id: number;
	rejections: Rejection[];
	changes: {
		players: Synced<Player>[];
		drills: Synced<Drill>[];
		runs: Synced<Run>[];
		results: Synced<Result>[];
	};
}
