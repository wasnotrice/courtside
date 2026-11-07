<script lang="ts">
	import { getApp, type Tab } from './context.svelte';

	const app = getApp();
	const tabs: [Tab, string][] = [
		['today', 'Practice'],
		['roster', 'Roster'],
		['history', 'History'],
		['sync', 'Sync']
	];
	const rejected = $derived(app.sync.snapshot.rejections.length);
</script>

<nav class="tabs" aria-label="Sections">
	<div>
		{#each tabs as [id, label] (id)}
			<button class="tab" aria-current={app.tab === id ? 'page' : undefined} onclick={() => app.go(id)}>
				{label}{#if id === 'sync' && rejected}&nbsp;({rejected}){/if}
			</button>
		{/each}
	</div>
</nav>
