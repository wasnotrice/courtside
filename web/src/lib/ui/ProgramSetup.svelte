<!-- Shown when the organization has no program yet: creates one, with a varsity team. -->
<script lang="ts">
	import { DEFAULT_RULES } from '$lib/sync/basketball';
	import { getApp } from './context.svelte';
	import { draftOf, readRules, sameRules } from './games';
	import RulesEditor from './RulesEditor.svelte';

	const app = getApp();
	let name = $state("Girls' basketball");
	let rules = $state(draftOf(DEFAULT_RULES));
	let err = $state('');

	async function create() {
		const read = readRules(rules);
		if ('err' in read) return (err = read.err);
		const id = crypto.randomUUID();
		const ok = await app.mutate(
			{ name: 'program.put', args: { id, name: name.trim(), sport: 'basketball' } },
			{
				name: 'team.put',
				args: {
					id: crypto.randomUUID(),
					program_id: id,
					name: 'Varsity',
					...(sameRules(read.rules, DEFAULT_RULES) ? {} : { default_rules: read.rules })
				}
			}
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
	<RulesEditor bind:draft={rules} />
	<p class="hint">The rules varsity games start with. Each team can have its own.</p>
	{#if err}<p class="err" role="alert">{err}</p>{/if}
	<button class="primary wide" onclick={create}>Create program</button>
</main>
