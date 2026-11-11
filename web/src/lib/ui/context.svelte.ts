// UI-only state shared across views: which program and season are shown, which
// screen is open, the practice date, and the toast. Data comes from the sync
// engine, never from here.

import { getContext, setContext } from 'svelte';
import type { Sync } from '$lib/sync/index.svelte';
import type { MutationInput, Program, Season } from '$lib/sync/types';
import { renamed, renamesOf, reverseOf } from '$lib/sync/undo';
import { seasonOf, todayISO } from './domain';

/** One step that can be undone: what it was, and the changes that put it back. */
export interface Undo {
	/** The screen it was made on, such as "game:<id>" or "run:<id>". */
	scope: string;
	label: string;
	reverse: MutationInput[];
	/** Old id to new id, for plays this step's undo records again under a new id. */
	renames: Map<string, string>;
}

// The chosen program and season are remembered on this device. Storage can be
// unavailable (private browsing), so failures just mean "not remembered".
const remembered = (key: string) => {
	try {
		return localStorage.getItem(`courtside.${key}`);
	} catch {
		return null;
	}
};
const remember = (key: string, value: string) => {
	try {
		localStorage.setItem(`courtside.${key}`, value);
	} catch {
		// Not remembered; that's fine.
	}
};

export type GameMode = 'live' | 'plays' | 'box';

export type Tab = 'today' | 'games' | 'roster' | 'history' | 'sync';

export class AppState {
	tab = $state<Tab>('today');
	date = $state(todayISO());
	runId = $state<string | null>(null);
	/** The game whose live screen is open, on the Games tab. */
	gameId = $state<string | null>(null);
	/** Which of the game's screens is open: recording, the play-by-play, or the box score. */
	gameMode = $state<GameMode>('live');
	/** The Games tab's list of games, or the season's totals. */
	gamesPane = $state<'games' | 'season'>('games');
	historyDrill = $state<string | null>(null);
	toast = $state('');
	/** Undo steps, oldest first. In memory only: reloading the app clears them. */
	private undos = $state.raw<Undo[]>([]);
	private programId = $state(remembered('program'));
	private seasonId = $state(remembered('season'));
	private toastTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(readonly sync: Sync) {}

	get view() {
		return this.sync.snapshot.view;
	}

	get programs(): Program[] {
		return [...this.view.programs.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	/** The program every screen shows: the one chosen on this device, or the first. */
	get program(): Program | undefined {
		return (this.programId && this.view.programs.get(this.programId)) || this.programs[0];
	}

	/** Newest first. */
	get seasons(): Season[] {
		return [...this.view.seasons.values()].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
	}

	/** The season Roster and History show: the one chosen, else today's, else the newest. */
	get season(): Season | undefined {
		return (this.seasonId && this.view.seasons.get(this.seasonId)) || seasonOf(this.view, todayISO()) || this.seasons[0];
	}

	chooseProgram(id: string) {
		this.programId = id;
		remember('program', id);
		this.runId = null;
		this.gameId = null;
	}

	chooseSeason(id: string) {
		this.seasonId = id;
		remember('season', id);
	}

	/** Queues a change, or shows why it was refused. Returns whether it was queued. */
	async mutate(...inputs: MutationInput[]): Promise<boolean> {
		for (const input of inputs) {
			const result = await this.sync.engine.mutate(input);
			if (!result.ok) {
				this.showToast(result.reason);
				return false;
			}
		}
		return true;
	}

	/**
	 * Queues changes as one step that `undo(scope)` can take back. Each change's reverse
	 * comes from the view just before it, the only time the phone knows the old values.
	 */
	async mutateUndoable(scope: string, label: string, ...inputs: MutationInput[]): Promise<boolean> {
		let reverse: MutationInput[] = [];
		const renames = new Map<string, string>();
		let ok = true;
		for (const input of inputs) {
			const back = reverseOf(this.view, input);
			if (!(await this.mutate(input))) {
				ok = false;
				break;
			}
			reverse = [...(back ?? []), ...reverse];
			for (const [from, to] of renamesOf(input, back ?? [])) renames.set(from, to);
		}
		if (reverse.length) this.undos = [...this.undos.slice(-49), { scope, label, reverse, renames }];
		return ok;
	}

	/** The step `undo(scope)` would take back. */
	lastUndo(scope: string): Undo | undefined {
		return this.undos.findLast((u) => u.scope === scope);
	}

	/**
	 * Takes back the newest step made on `scope`'s screen by sending its reverse, checked
	 * like any other change. If someone changed the same fields since, this overwrites them.
	 */
	async undo(scope: string): Promise<boolean> {
		const step = this.lastUndo(scope);
		if (!step) return false;
		const ok = await this.mutate(...step.reverse);
		// Older steps that named a play this brought back under a new id now name the new one.
		this.undos = this.undos
			.filter((u) => u !== step)
			.map((u) => (step.renames.size ? { ...u, reverse: renamed(u.reverse, step.renames) } : u));
		if (ok) this.showToast(`Undone: ${step.label}`);
		return ok;
	}

	showToast(message: string) {
		this.toast = message;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => (this.toast = ''), 3200);
	}

	go(tab: Tab) {
		this.tab = tab;
		this.runId = null;
		this.gameId = null;
		window.scrollTo(0, 0);
	}

	/** Opens a game: live while it's being played, otherwise its play-by-play. */
	openGame(gameId: string, mode?: GameMode) {
		const game = this.view.games.get(gameId);
		if (!game) return;
		this.tab = 'games';
		this.gameId = gameId;
		this.gameMode = mode ?? (game.status === 'live' ? 'live' : 'plays');
		window.scrollTo(0, 0);
	}

	openRun(runId: string) {
		const run = this.view.runs.get(runId);
		if (!run) return;
		this.date = run.date;
		this.tab = 'today';
		this.runId = runId;
		window.scrollTo(0, 0);
	}
}

const KEY = Symbol('app');
export const setApp = (app: AppState) => setContext(KEY, app);
export const getApp = () => getContext<AppState>(KEY);
