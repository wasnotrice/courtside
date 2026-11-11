<!-- Shown when the organization has no program yet: creates one, with a varsity team. -->
<script lang="ts">
	import { getApp } from './context.svelte';

	const app = getApp();
	let name = $state("Girls' basketball");

	async function create() {
		const id = crypto.randomUUID();
		const ok = await app.mutate(
			{ name: 'program.put', args: { id, name: name.trim(), sport: 'basketball' } },
			{ name: 'team.put', args: { id: crypto.randomUUID(), program_id: id, name: 'Varsity' } }
		);
		if (ok) app.chooseProgram(id);
	}
</script>

<header class="top"><div class="row"><h1>Courtside</h1></div></header>
<main>
	<div class="empty">
		<p class="big">Set up your program</p>
		<p>A program is one sport for one gender, such as girls' basketball. It starts with a varsity team; add JV from the roster.</p>
	</div>
	<label class="field"><span>Program name</span><input autocomplete="off" bind:value={name} /></label>
	<button class="primary wide" onclick={create}>Create program</button>
</main>
