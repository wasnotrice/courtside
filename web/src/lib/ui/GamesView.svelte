<script lang="ts">
	import type { Game, MutationInput } from '$lib/sync/types';
	import { scoreMismatch } from './basketball';
	import { getApp } from './context.svelte';
	import { changedFields, ensureSeason, fmtDate, seasonOf, teamsOf, todayISO } from './domain';
	import {
		draftOf,
		gamesOf,
		matchup,
		mismatchText,
		readRules,
		rulesName,
		sameRules,
		scoresByGame,
		teamRules,
		type RulesDraft
	} from './games';
	import RulesEditor from './RulesEditor.svelte';
	import ScopeBar from './ScopeBar.svelte';
	import Sheet from './Sheet.svelte';
	import StatusPill from './StatusPill.svelte';
	import Tabs from './Tabs.svelte';

	const app = getApp();
	const view = $derived(app.view);
	const program = $derived(app.program!);
	const teams = $derived(teamsOf(view, program.id));
	const games = $derived(gamesOf(view, program.id, app.season));
	const scores = $derived(scoresByGame(view));
	const GAME_CHANGES = ['game.put', 'game.delete', 'play.put', 'play.delete'];
	const rejections = $derived(app.sync.snapshot.rejections.filter((r) => GAME_CHANGES.includes(r.name)));

	const STATUS: Record<Game['status'], string> = { live: 'Live', final: 'Final', reviewed: 'Reviewed' };

	/** Which game a refused change was about, for its note. */
	function aboutGame(args: Record<string, unknown>): string {
		const id = (args.game_id ?? args.id) as string | undefined;
		const g = id ? view.games.get(id) : undefined;
		if (g) return matchup(g);
		return typeof args.opponent === 'string' ? `vs ${args.opponent}` : 'game';
	}

	// --- the game sheet: a new game, or a game's details -----------------------------

	interface Draft {
		game: Game | null; // null for a new game
		team_id: string;
		opponent: string;
		date: string;
		home_away: Game['home_away'];
		changeRules: boolean;
		rules: RulesDraft;
	}
	let draft = $state<Draft | null>(null);
	let confirmDelete = $state(false);
	let err = $state('');

	function newGame() {
		const team = teams[0];
		draft = {
			game: null,
			team_id: team?.id ?? '',
			opponent: '',
			date: todayISO(),
			home_away: 'home',
			changeRules: false,
			rules: draftOf(teamRules(team))
		};
		confirmDelete = false;
		err = '';
	}

	function open(game: Game) {
		draft = {
			game,
			team_id: game.team_id,
			opponent: game.opponent,
			date: game.date,
			home_away: game.home_away,
			changeRules: false,
			rules: draftOf(game.rules)
		};
		confirmDelete = false;
		err = '';
	}

	function chooseTeam(teamId: string) {
		if (!draft) return;
		draft.team_id = teamId;
		// Until the coach changes them, a new game's rules follow its team.
		if (!draft.changeRules) draft.rules = draftOf(teamRules(view.teams.get(teamId)));
	}

	const draftRules = $derived(draft ? readRules(draft.rules) : null);

	async function save() {
		if (!draft || !draftRules) return;
		if (!draft.team_id) return (err = 'Add a team on the Roster tab first.');
		if (!draft.opponent.trim()) return (err = 'Who are you playing?');
		if ('err' in draftRules) return (err = draftRules.err);

		const id = draft.game?.id ?? crypto.randomUUID();
		const next: Game = {
			id,
			team_id: draft.team_id,
			date: draft.date,
			opponent: draft.opponent.trim(),
			home_away: draft.home_away,
			status: draft.game?.status ?? 'live',
			rules: draftRules.rules,
			official_us: draft.game?.official_us ?? null,
			official_them: draft.game?.official_them ?? null
		};
		// Only what changed goes out, and the rules only if they differ.
		const { rules, ...rest } = next;
		const fields = changedFields(draft.game ?? undefined, rest);
		const rulesChanged = !draft.game || !sameRules(draft.game.rules, rules);
		if (!fields && !rulesChanged) return (draft = null);

		// The first game of a school year starts its season, even offline.
		const seasonChanges = ensureSeason(view, next.date);
		const changes: MutationInput[] = [
			...seasonChanges,
			{ name: 'game.put', args: { ...(fields ?? { id }), ...(rulesChanged ? { rules } : {}) } }
		];
		for (const change of changes) {
			const outcome = await app.sync.engine.mutate(change);
			if (!outcome.ok) return (err = outcome.reason);
		}

		// Show the season the game is in, so it's in the list.
		const season = seasonOf(app.view, next.date);
		if (season && season.id !== app.season?.id) app.chooseSeason(season.id);
		draft = null;
	}

	async function remove() {
		if (!draft?.game) return;
		if (await app.mutate({ name: 'game.delete', args: { id: draft.game.id } })) draft = null;
	}
</script>

<header class="top">
	<div class="row"><h1>Games</h1><StatusPill /></div>
	<ScopeBar season />
</header>

<main>
	{#each rejections as r (r.mutation_id)}
		<div class="reject standalone" role="alert">
			<span>Not saved ({aboutGame(r.args as Record<string, unknown>)}): {r.reason}</span>
			<button onclick={() => app.sync.engine.dismissRejection(r.mutation_id)}>Dismiss</button>
		</div>
	{/each}

	{#if !teams.length}
		<div class="note">
			Games belong to a team. <button class="link" onclick={() => app.go('roster')}>Add one on Roster</button>
		</div>
	{/if}

	{#if games.length}
		<ul class="runs">
			{#each games as g (g.id)}
				{@const s = scores.get(g.id)}
				{@const mismatch = s ? scoreMismatch(g, s) : null}
				<li>
					<button class="card" onclick={() => open(g)}>
						<span class="cname">{matchup(g)}</span><span class="tag status-{g.status}">{STATUS[g.status]}</span>
						<span class="cmeta">
							{fmtDate(g.date)}{teams.length > 1 ? ` · ${view.teams.get(g.team_id)?.name ?? ''}` : ''} · {rulesName(g.rules)}
						</span>
						<span class="csum">
							{#if g.official_us !== null && g.official_them !== null}
								{g.official_us}–{g.official_them}
							{:else if s}
								{s.us}–{s.them}
							{:else}
								<span class="muted">No plays yet</span>
							{/if}
						</span>
						{#if mismatch && s}
							<span class="cflag">Plays total {s.us}–{s.them}: {mismatchText(mismatch)}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="empty">
			<p class="big">No games{app.season ? ` in ${app.season.name}` : ''} yet</p>
			<p>Add a game, then record plays as they happen.</p>
		</div>
	{/if}

	<button class="primary wide" onclick={newGame}>+ New game</button>
</main>
<Tabs />

{#if draft}
	<Sheet onclose={() => (draft = null)}>
		<h2>{draft.game ? 'Game details' : 'New game'}</h2>
		{#if teams.length > 1 && !draft.game}
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
			<input autocomplete="off" bind:value={draft.opponent} placeholder="Lincoln" autofocus={!draft.game} />
		</label>
		<div class="field">
			<span>Where</span>
			<div class="seg">
				{#each [['home', 'Home'], ['away', 'Away'], ['neutral', 'Neutral']] as const as [k, label] (k)}
					<button class:on={draft.home_away === k} onclick={() => draft && (draft.home_away = k)}>{label}</button>
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
					{draftRules && 'rules' in draftRules ? rulesName(draftRules.rules) : 'Custom'}
					{#if !draft.game}<span class="muted">from {view.teams.get(draft.team_id)?.name ?? 'the team'}</span>{/if}
				</span>
				<button class="link" onclick={() => draft && (draft.changeRules = true)}>Change for this game</button>
			</div>
		{/if}

		{#if err}<p class="err" role="alert">{err}</p>{/if}
		<button class="primary wide" onclick={save}>{draft.game ? 'Save' : 'Create game'}</button>

		{#if draft.game}
			{@const n = scores.get(draft.game.id)?.plays ?? 0}
			{#if confirmDelete}
				<div class="note">
					Delete {matchup(draft.game)}{n ? ` and its ${n} play${n === 1 ? '' : 's'}` : ''}? Every phone loses it once this syncs.
				</div>
				<button class="danger wide" onclick={remove}>Delete game</button>
			{:else}
				<button class="danger-link" onclick={() => (confirmDelete = true)}>Delete game</button>
			{/if}
		{/if}
	</Sheet>
{/if}

<style>
	.cflag {
		grid-column: 1 / -1;
		color: var(--warn);
		font-size: 14px;
		font-weight: 600;
	}
	.status-live {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.status-reviewed {
		background: var(--good-soft);
		color: var(--good);
	}
	.rulesline {
		font-weight: 500;
	}
</style>
