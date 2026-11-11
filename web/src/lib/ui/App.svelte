<script lang="ts">
	import type { Sync } from '$lib/sync/index.svelte';
	import { AppState, setApp } from './context.svelte';
	import EntryView from './EntryView.svelte';
	import GamesView from './GamesView.svelte';
	import LiveView from './LiveView.svelte';
	import HistoryView from './HistoryView.svelte';
	import PracticeView from './PracticeView.svelte';
	import ProgramSetup from './ProgramSetup.svelte';
	import RosterView from './RosterView.svelte';
	import SyncInspector from './SyncInspector.svelte';

	let { sync }: { sync: Sync } = $props();

	// svelte-ignore state_referenced_locally
	const app = setApp(new AppState(sync));

	// A run deleted elsewhere (or rejected) closes its entry screen.
	$effect(() => {
		if (app.runId && !app.view.runs.has(app.runId)) app.runId = null;
	});
	// Likewise a deleted game closes its live screen.
	$effect(() => {
		if (app.gameId && !app.view.games.has(app.gameId)) app.gameId = null;
	});
</script>

<div class="wrap-app">
	{#if !app.program && app.tab !== 'sync'}
		<ProgramSetup />
	{:else if app.tab === 'today' && app.runId && app.view.runs.has(app.runId)}
		{#key app.runId}
			<EntryView runId={app.runId} />
		{/key}
	{:else if app.tab === 'games' && app.gameId && app.view.games.has(app.gameId)}
		{#key app.gameId}
			<LiveView gameId={app.gameId} />
		{/key}
	{:else if app.tab === 'games'}
		<GamesView />
	{:else if app.tab === 'roster'}
		<RosterView />
	{:else if app.tab === 'history'}
		<HistoryView />
	{:else if app.tab === 'sync'}
		<SyncInspector />
	{:else}
		<PracticeView />
	{/if}
</div>

{#if app.toast}
	<div class="toast" class:low={!(app.tab === 'today' && app.runId) && !(app.tab === 'games' && app.gameId)} role="status">{app.toast}</div>
{/if}
