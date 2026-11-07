<script lang="ts">
	import type { Snippet } from 'svelte';

	let { onclose, children }: { onclose: () => void; children: Snippet } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="sheetwrap">
	<button class="backdrop" style="border:0" aria-label="Close" onclick={onclose}></button>
	<div class="sheet" role="dialog" aria-modal="true">
		<div class="stack">
			{@render children()}
		</div>
		<button class="ghost wide" onclick={onclose}>Cancel</button>
	</div>
</div>
