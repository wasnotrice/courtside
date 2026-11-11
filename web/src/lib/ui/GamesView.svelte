<script lang="ts">
	import type { Game } from '$lib/sync/types';
	import { scoreMismatch } from './basketball';
	import { getApp } from './context.svelte';
	import { fmtDate, teamsOf } from './domain';
	import GameSheet from './GameSheet.svelte';
	import { lostChanges } from '$lib/sync/restore';
	import { gamesOf, matchup, mismatchText, rulesName, scoresByGame } from './games';
	import LostNotes from './LostNotes.svelte';
	import ScopeBar from './ScopeBar.svelte';
	import SeasonView from './SeasonView.svelte';
	import StatusPill from './StatusPill.svelte';
	import Tabs from './Tabs.svelte';

	const app = getApp();
	const view = $derived(app.view);
	const program = $derived(app.program!);
	const teams = $derived(teamsOf(view, program.id));
	const games = $derived(gamesOf(view, program.id, app.season));
	const scores = $derived(scoresByGame(view));
	const GAME_CHANGES = ['game.put', 'game.delete', 'play.put', 'play.delete'];
	// Changes into a deleted game get a note of their own, to restore it.
	const grouped = $derived(
		new Set(lostChanges(app.sync.snapshot.rejections, view).flatMap((l) => l.rejections.map((r) => r.mutation_id)))
	);
	const rejections = $derived(
		app.sync.snapshot.rejections.filter((r) => GAME_CHANGES.includes(r.name) && !grouped.has(r.mutation_id))
	);

	const STATUS: Record<Game['status'], string> = { live: 'Live', final: 'Final', reviewed: 'Reviewed' };

	/** Which game a refused change was about, for its note. */
	function aboutGame(args: Record<string, unknown>): string {
		const id = (args.game_id ?? args.id) as string | undefined;
		const g = id ? view.games.get(id) : undefined;
		if (g) return matchup(g);
		return typeof args.opponent === 'string' ? `vs ${args.opponent}` : 'game';
	}

	// The game sheet: a new game (null), or nothing open (undefined).
	let creating = $state(false);
</script>

<header class="top">
	<div class="row"><h1>Games</h1><StatusPill /></div>
	<ScopeBar season />
	<div class="seg two" role="tablist" aria-label="Games or season">
		<button role="tab" aria-selected={app.gamesPane === 'games'} class:on={app.gamesPane === 'games'} onclick={() => (app.gamesPane = 'games')}>
			Games
		</button>
		<button role="tab" aria-selected={app.gamesPane === 'season'} class:on={app.gamesPane === 'season'} onclick={() => (app.gamesPane = 'season')}>
			Season
		</button>
	</div>
</header>

<main>
	{#if app.gamesPane === 'season'}
		<SeasonView />
	{:else}
	<LostNotes kind="game" />
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
					<button class="card" onclick={() => app.openGame(g.id)}>
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

	<button class="primary wide" onclick={() => (creating = true)}>+ New game</button>
	{/if}
</main>
<Tabs />

{#if creating}
	<GameSheet game={null} onclose={() => (creating = false)} oncreated={(id) => app.openGame(id)} />
{/if}

<style>
	.seg.two {
		grid-template-columns: 1fr 1fr;
	}
	.seg.two button {
		padding: 6px 4px;
	}
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
</style>
