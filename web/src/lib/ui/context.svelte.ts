// UI-only state shared across views: which program and season are shown, which
// screen is open, the practice date, and the toast. Data comes from the sync
// engine, never from here.

import { getContext, setContext } from 'svelte';
import type { Sync } from '$lib/sync/index.svelte';
import type { MutationInput, Program, Season } from '$lib/sync/types';
import { seasonOf, todayISO } from './domain';

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
	historyDrill = $state<string | null>(null);
	toast = $state('');
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
