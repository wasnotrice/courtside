// Shapes shared by the sync layer. Rows mirror what the server sends on pull
// (see server/lib/courtside/sync.ex, to_wire/1), minus `version` and `deleted`,
// which only matter while applying a pull.

import type { FoulType, Rules, Stat } from './basketball';

export type { FoulType, Rules, Stat } from './basketball';

export type Kind = 'makes' | 'count' | 'time';
export const KINDS: readonly Kind[] = ['makes', 'count', 'time'];

/** The game stat a makes drill practices: free throws, 2-point or 3-point shots. */
export type GameStat = 'ft' | 'fg2' | 'fg3';
export const GAME_STATS: readonly GameStat[] = ['ft', 'fg2', 'fg3'];

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
	/** Copied into each new game; null means the default rules. */
	default_rules: Rules | null;
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
	/** For a makes drill, the game stat it matches, to compare practice with games. */
	game_stat: GameStat | null;
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

/** One game played by a team against an opponent on a date. Keeps its own rules. */
export interface Game {
	id: string;
	team_id: string;
	/** YYYY-MM-DD; must fall in a season. */
	date: string;
	opponent: string;
	home_away: 'home' | 'away' | 'neutral';
	status: 'live' | 'final' | 'reviewed';
	rules: Rules;
	/** The scorebook's final score, entered when the game is final. */
	official_us: number | null;
	official_them: number | null;
}

/**
 * One stat credited during a game: to a player, to the team (no player) or to the
 * opponent (side 'them', never a player).
 */
export interface Play {
	id: string;
	game_id: string;
	side: 'us' | 'them';
	player_id: string | null;
	stat: Stat;
	/** On fouls only; a foul is 'personal' unless it says otherwise. */
	foul_type: FoulType | null;
	/** On our made field goals only. */
	assist_player_id: string | null;
	/** Our player who was fouled, on the other team's fouls only. */
	drawn_by_player_id: string | null;
	period: number;
	/** Seconds left in the period. */
	clock: number | null;
	/** Seconds into the film. */
	video_at: number | null;
	/** Sorts the play-by-play: a key between its neighbors' keys. */
	position: string;
	/** When the device recorded it, in milliseconds since 1970. Breaks ties. */
	recorded_at: number;
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
	games: ReadonlyMap<string, Game>;
	plays: ReadonlyMap<string, Play>;
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
	results: new Map(),
	games: new Map(),
	plays: new Map()
});

// --- mutations ---------------------------------------------------------------

/**
 * A put creates the row when the id is new (and then needs the required fields)
 * and otherwise changes only the fields sent. Send just the fields that changed.
 */
type Put<T extends { id: string }> = Pick<T, 'id'> & { [K in Exclude<keyof T, 'id'>]?: T[K] | null };

export interface MutationArgs {
	'program.put': Put<Program>;
	'season.put': Put<Season>;
	'team.put': Put<Team>;
	'player.put': Put<Player>;
	'roster.put': Put<RosterEntry>;
	'roster.remove': { id: string };
	'drill.put': Put<Drill>;
	'run.create': Run;
	'run.set_setup': { id: string; setup: number | null };
	'run.delete': { id: string };
	'result.set_value': { drill_run_id: string; player_id: string; value: number };
	'result.set_setup': { drill_run_id: string; player_id: string; setup: number | null };
	'result.clear': { drill_run_id: string; player_id: string };
	'game.put': Put<Game>;
	'game.delete': { id: string };
	'play.put': Put<Play>;
	'play.delete': { id: string };
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

/** The transport adds the organization; the engine doesn't need to know it. */
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
		games: Synced<Game>[];
		plays: Synced<Play>[];
	};
}
