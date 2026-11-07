<script lang="ts">
	import type { Kind } from '$lib/sync/types';
	import { fmtTime, KINDS } from './domain';

	let { kind, label, value = $bindable() }: { kind: Kind; label: string; value: string } = $props();
	const K = $derived(KINDS[kind]);
</script>

<label class="field">
	<span>{label}</span>
	<!-- svelte-ignore a11y_autofocus -->
	<input inputmode="decimal" autocomplete="off" bind:value placeholder={K.needSetup ? '50' : 'Leave blank if fixed'} autofocus />
</label>
<div class="presets">
	{#each K.presets as n (n)}
		<button class:on={value === String(n)} onclick={() => (value = String(n))}>
			{kind === 'count' && n >= 60 ? fmtTime(n) : n}
		</button>
	{/each}
</div>
