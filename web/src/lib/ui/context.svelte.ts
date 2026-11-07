// UI-only state shared across views: which screen is open, the practice date,
// and the toast. Data comes from the sync engine, never from here.

import { getContext, setContext } from 'svelte';
import type { Sync } from '$lib/sync/index.svelte';
import type { MutationInput } from '$lib/sync/types';
import { todayISO } from './domain';

export type Tab = 'today' | 'roster' | 'history' | 'sync';

export class AppState {
	tab = $state<Tab>('today');
	date = $state(todayISO());
	runId = $state<string | null>(null);
	historyDrill = $state<string | null>(null);
	toast = $state('');
	private toastTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(readonly sync: Sync) {}

	get view() {
		return this.sync.snapshot.view;
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
