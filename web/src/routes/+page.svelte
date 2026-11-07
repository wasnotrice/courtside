<script lang="ts">
	import { openSync } from '$lib/sync/index.svelte';
	import App from '$lib/ui/App.svelte';

	const ready = openSync();
</script>

{#await ready}
	<p class="muted" style="padding-top: 24px">Loading…</p>
{:then sync}
	<App {sync} />
{:catch error}
	<div class="note" style="margin-top: 24px">
		Courtside couldn't start: {error.message}
	</div>
{/await}
