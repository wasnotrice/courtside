<!-- A new game, or an existing game's details: team, opponent, where, date, rules, and delete. -->
<script lang="ts">
	import type { Game, MutationInput } from '$lib/sync/types';
	import { getApp } from './context.svelte';
	import { changedFields, ensureSeason, seasonOf, teamsOf, todayISO } from './domain';
	import { draftOf, matchup, readRules, rulesName, sameRules, teamRules } from './games';
	import RulesEditor from './RulesEditor.svelte';
	import Sheet from './Sheet.svelte';

	let {
		game,
		onclose,
		oncreated
	}: { game: Game | null; onclose: () => void; oncreated?: (id: string) => void } = $props();

	const app = getApp();
	const view = $derived(app.view);
	const teams = $derived(teamsOf(view, app.program?.id));
	// svelte-ignore state_referenced_locally
	const start = game;
	const plays = $derived(start ? [...view.plays.values()].filter((p) => p.game_id === start.id).length : 0);

	// svelte-ignore state_referenced_locally
	let draft = $state({
		team_id: start?.team_id ?? teams[0]?.id ?? '',
		opponent: start?.opponent ?? '',
		date: start?.date ?? todayISO(),
		home_away: start?.home_away ?? ('home' as Game['home_away']),
		changeRules: false,
		rules: draftOf(start?.rules ?? teamRules(teams[0]))
	});
	let confirmDelete = $state(false);
	let err = $state('');
	const draftRules = $derived(readRules(draft.rules));

	function chooseTeam(teamId: string) {
		draft.team_id = teamId;
		// Until the coach changes them, a new game's rules follow its team.
		if (!draft.changeRules) draft.rules = draftOf(teamRules(view.teams.get(teamId)));
	}

	async function save() {
		if (!draft.team_id) return (err = 'Add a team on the Roster tab first.');
		if (!draft.opponent.trim()) return (err = 'Who are you playing?');
		if ('err' in draftRules) return (err = draftRules.err);

		const id = start?.id ?? crypto.randomUUID();
		const next: Game = {
			id,
			team_id: draft.team_id,
			date: draft.date,
			opponent: draft.opponent.trim(),
			home_away: draft.home_away,
			status: start?.status ?? 'live',
			rules: draftRules.rules,
			official_us: start?.official_us ?? null,
			official_them: start?.official_them ?? null
		};
		// Only what changed goes out, and the rules only if they differ.
		const { rules, ...rest } = next;
		const fields = changedFields(start ?? undefined, rest);
		const rulesChanged = !start || !sameRules(start.rules, rules);
		if (!fields && !rulesChanged) return onclose();

		// The first game of a school year starts its season, even offline.
		const changes: MutationInput[] = [
			...ensureSeason(view, next.date),
			{ name: 'game.put', args: { ...(fields ?? { id }), ...(rulesChanged ? { rules } : {}) } }
		];
		for (const change of changes) {
			const outcome = await app.sync.engine.mutate(change);
			if (!outcome.ok) return (err = outcome.reason);
		}

		// Show the season the game is in, so it's in the list.
		const season = seasonOf(app.view, next.date);
		if (season && season.id !== app.season?.id) app.chooseSeason(season.id);
		onclose();
		if (!start) oncreated?.(id);
	}

	async function remove() {
		if (start && (await app.mutate({ name: 'game.delete', args: { id: start.id } }))) onclose();
	}
</script>

<Sheet {onclose}>
	<h2>{start ? 'Game details' : 'New game'}</h2>
	{#if teams.length > 1 && !start}
		<label class="field">
			<span>Team</span>
			<select value={draft.team_id} onchange={(e) => chooseTeam(e.currentTarget.value)}>
				{#each teams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
			</select>
		</label>
	{/if}
	<label class="field">
		<span>Opponent</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input autocomplete="off" bind:value={draft.opponent} placeholder="Lincoln" autofocus={!start} />
	</label>
	<div class="field">
		<span>Where</span>
		<div class="seg">
			{#each [['home', 'Home'], ['away', 'Away'], ['neutral', 'Neutral']] as const as [k, label] (k)}
				<button class:on={draft.home_away === k} onclick={() => (draft.home_away = k)}>{label}</button>
			{/each}
		</div>
	</div>
	<label class="field date"><span>Date</span><input type="date" bind:value={draft.date} /></label>

	{#if draft.changeRules}
		<RulesEditor bind:draft={draft.rules} />
	{:else}
		<div class="row rulesline">
			<span>
				<span class="muted">Rules:</span>
				{'rules' in draftRules ? rulesName(draftRules.rules) : 'Custom'}
				{#if !start}<span class="muted">from {view.teams.get(draft.team_id)?.name ?? 'the team'}</span>{/if}
			</span>
			<button class="link" onclick={() => (draft.changeRules = true)}>Change for this game</button>
		</div>
	{/if}

	{#if err}<p class="err" role="alert">{err}</p>{/if}
	<button class="primary wide" onclick={save}>{start ? 'Save' : 'Create game'}</button>

	{#if start}
		{#if confirmDelete}
			<div class="note">
				Delete {matchup(start)}{plays ? ` and its ${plays} play${plays === 1 ? '' : 's'}` : ''}? Every phone loses it once
				this syncs.
			</div>
			<button class="danger wide" onclick={remove}>Delete game</button>
		{:else}
			<button class="danger-link" onclick={() => (confirmDelete = true)}>Delete game</button>
		{/if}
	{/if}
</Sheet>

<style>
	.rulesline {
		font-weight: 500;
	}
</style>
