<script lang="ts">
	import type { Sync } from '$lib/sync/index.svelte';
	import { AppState, setApp } from './context.svelte';
	import EntryView from './EntryView.svelte';
	import HistoryView from './HistoryView.svelte';
	import PracticeView from './PracticeView.svelte';
	import RosterView from './RosterView.svelte';
	import SyncInspector from './SyncInspector.svelte';

	let { sync }: { sync: Sync } = $props();

	// svelte-ignore state_referenced_locally
	const app = setApp(new AppState(sync));

	// A run deleted elsewhere (or rejected) closes its entry screen.
	$effect(() => {
		if (app.runId && !app.view.runs.has(app.runId)) app.runId = null;
	});
</script>

<div class="wrap-app">
	{#if app.tab === 'today' && app.runId && app.view.runs.has(app.runId)}
		{#key app.runId}
			<EntryView runId={app.runId} />
		{/key}
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
	<div class="toast" class:low={!(app.tab === 'today' && app.runId)} role="status">{app.toast}</div>
{/if}
