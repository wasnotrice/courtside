<!-- A row's history from the server, newest first: who changed what and when, with
Revert for each edit. Shown inside the sheet that edits the row. Needs a connection. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { FOUL_TYPES, type Rules } from '$lib/sync/basketball';
	import type { HistoryEntry } from '$lib/sync/types';
	import { periodLabel, presetOf } from './basketball';
	import { getApp } from './context.svelte';
	import { fmtDate } from './domain';
	import { ago, changedSince, kindOf, revertOf, shownChanges, type HistoryTable, type Kind } from './history';
	import { STAT_LABEL } from './live';
	import { fmtClock } from './review';

	let {
		table,
		key,
		row,
		rules,
		onback
	}: {
		table: HistoryTable;
		key: string;
		/** The row as it is now, to warn when a revert would undo a later change. */
		row: object;
		/** The game's rules, to name periods. */
		rules?: Rules;
		onback: () => void;
	} = $props();

	const app = getApp();
	const snap = $derived(app.sync.snapshot);

	let entries = $state<HistoryEntry[] | null>(null);
	let failed = $state('');
	let confirming = $state<number | null>(null);

	async function load() {
		failed = '';
		if (snap.offline) return (failed = 'History needs a connection.');
		try {
			entries = await app.sync.history(table, key);
		} catch {
			failed = 'History needs a connection.';
		}
	}
	onMount(load);

	const LABEL: Record<string, string> = {
		side: 'Side',
		player_id: 'Player',
		stat: 'Stat',
		foul_type: 'Foul type',
		assist_player_id: 'Assist',
		drawn_by_player_id: 'Fouled',
		period: 'Period',
		clock: 'Clock',
		video_at: 'Film time',
		position: 'Order',
		opponent: 'Opponent',
		date: 'Date',
		home_away: 'Where',
		status: 'Status',
		rules: 'Rules',
		official_us: 'Official score, us',
		official_them: 'Official score, them',
		name: 'Name'
	};
	const FOUL: Record<string, string> = Object.fromEntries(FOUL_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)]));
	const WORDS: Record<string, string> = {
		us: 'Us',
		them: 'Them',
		home: 'Home',
		away: 'Away',
		neutral: 'Neutral',
		live: 'Live',
		final: 'Final',
		reviewed: 'Reviewed'
	};

	function fmt(field: string, v: unknown): string {
		if (v === null || v === undefined) return 'none';
		if (field.endsWith('player_id')) return snap.view.players.get(String(v))?.name ?? 'a removed player';
		if (field === 'stat') return STAT_LABEL[v as keyof typeof STAT_LABEL] ?? String(v);
		if (field === 'foul_type') return FOUL[String(v)] ?? String(v);
		if (field === 'period') return rules ? periodLabel(rules, Number(v)) : String(v);
		if (field === 'clock' || field === 'video_at') return fmtClock(Number(v));
		if (field === 'date') return fmtDate(String(v));
		if (field === 'rules') return presetOf(v as Rules)?.name ?? 'Custom';
		return WORDS[String(v)] ?? String(v);
	}

	const VERB: Record<Kind, string> = {
		created: 'Created',
		edited: 'Changed',
		deleted: 'Deleted',
		restored: 'Restored',
		refused: 'Not saved'
	};
	const who = (e: HistoryEntry) => (e.client_id === snap.clientId ? 'This phone' : 'Another phone');

	async function revert(e: HistoryEntry, oldest: boolean) {
		const change = revertOf(table, key, e, oldest);
		if (!change) return;
		if (confirming !== e.version && changedSince(row, e).length) return (confirming = e.version);
		confirming = null;
		if (!(await app.mutate(change))) return;
		app.showToast('Reverted');
		await app.sync.engine.sync();
		await load();
	}
</script>

<div class="head">
	<button class="link" onclick={onback}>‹ Back</button>
	<h2>History</h2>
</div>

{#if failed}
	<p class="muted">{failed}</p>
	<button class="secondary wide" onclick={load}>Try again</button>
{:else if !entries}
	<p class="muted">Loading…</p>
{:else if !entries.length}
	<p class="muted">No changes recorded yet. Changes made before history was kept don't show here.</p>
{:else}
	<ul class="hist">
		{#each entries as e, i (`${e.version}:${e.client_id}:${e.mutation_id}`)}
			{@const oldest = i === entries.length - 1}
			{@const kind = kindOf(e, oldest)}
			{@const since = changedSince(row, e)}
			<li>
				<div class="meta"><b>{VERB[kind]}</b> <span class="muted">{who(e)} · {ago(e.at)}</span></div>
				{#if kind === 'refused'}
					<span class="why">{e.reason}</span>
				{:else if kind === 'edited'}
					{#each shownChanges(e) as [field, before, after] (field)}
						<span>
							{LABEL[field] ?? field}{field === 'position' ? ' changed' : `: ${fmt(field, before)} → ${fmt(field, after)}`}
						</span>
					{/each}
					{#if confirming === e.version}
						<p class="warn">
							Changed again since: {since.map(([f, v]) => `${LABEL[f] ?? f} is now ${fmt(f, v)}`).join(', ')}. Revert
							anyway?
						</p>
						<div class="acts">
							<button class="link" onclick={() => revert(e, oldest)}>Revert anyway</button>
							<button class="link" onclick={() => (confirming = null)}>Cancel</button>
						</div>
					{:else if revertOf(table, key, e, oldest)}
						<div class="acts"><button class="link" onclick={() => revert(e, oldest)}>Revert</button></div>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}
	.head h2 {
		margin: 0;
	}
	.hist {
		display: grid;
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
	}
	.hist li {
		display: grid;
		gap: 2px;
		padding: 10px 12px;
	}
	.hist li + li {
		border-top: 1px solid var(--line);
	}
	.meta {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.why,
	.warn {
		color: var(--warn);
		font-weight: 600;
		margin: 0;
	}
	.acts {
		display: flex;
		gap: 16px;
	}
</style>
