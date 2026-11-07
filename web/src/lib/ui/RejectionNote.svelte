<script lang="ts">
	import type { Rejection } from '$lib/sync/types';
	import { getApp } from './context.svelte';

	let { rejection, standalone = false }: { rejection: Rejection; standalone?: boolean } = $props();
	const app = getApp();
</script>

<div class="reject" class:standalone role="alert">
	<span>Not saved: {rejection.reason}</span>
	<button onclick={() => app.sync.engine.dismissRejection(rejection.mutation_id)}>Dismiss</button>
</div>
