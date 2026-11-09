<!-- Which program, and optionally which season, a screen shows. The program
picker appears only when there's more than one. -->
<script lang="ts">
	import { getApp } from './context.svelte';

	let { season = false }: { season?: boolean } = $props();
	const app = getApp();
</script>

{#if app.programs.length > 1 || (season && app.seasons.length)}
	<div class="row wrap scope">
		{#if app.programs.length > 1}
			<label>
				<span class="sr">Program</span>
				<select value={app.program?.id} onchange={(e) => app.chooseProgram(e.currentTarget.value)}>
					{#each app.programs as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</label>
		{/if}
		{#if season && app.seasons.length}
			<label>
				<span class="sr">Season</span>
				<select value={app.season?.id} onchange={(e) => app.chooseSeason(e.currentTarget.value)}>
					{#each app.seasons as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
				</select>
			</label>
		{/if}
	</div>
{/if}
