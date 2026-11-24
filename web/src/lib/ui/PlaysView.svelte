<!-- The play-by-play, by period, for review and corrections from film: tap a play to
edit it, delete it or add one after it. -->
<script lang="ts">
	import type { Play } from '$lib/sync/types';
	import { boxScore, periodLabel, playsOf } from './basketball';
	import { getApp } from './context.svelte';
	import GameHeader from './GameHeader.svelte';
	import GameStatus from './GameStatus.svelte';
	import { playersForGame } from './games';
	import { describePlay, shortNames } from './live';
	import PlaySheet from './PlaySheet.svelte';
	import RejectionNote from './RejectionNote.svelte';
	import { byPeriod, fmtClock, hints } from './review';

	let { gameId }: { gameId: string } = $props();

	const app = getApp();
	const view = $derived(app.view);
	const game = $derived(view.games.get(gameId)!);
	const plays = $derived(playsOf(view, gameId));
	const score = $derived(boxScore(plays).score);
	const rows = $derived(playersForGame(view, game, plays));
	const names = $derived(shortNames(rows));
	const nameOf = (id: string) => names.get(id) ?? view.players.get(id)?.name ?? 'Player';
	const groups = $derived(byPeriod(plays));
	const hinted = $derived(hints(plays));
	const rejections = $derived(
		app.sync.snapshot.rejections.filter((r) => {
			const args = r.args as Record<string, unknown>;
			return args.game_id === gameId || (r.name === 'game.put' && args.id === gameId);
		})
	);

	/** The edit sheet: a play to edit, or a new play (after one, or at the end). */
	let sheet = $state<{ play: Play | null; after: Play | null } | null>(null);
</script>

<GameHeader {game} {score} />

<main>
	{#each rejections as r (r.mutation_id)}<RejectionNote rejection={r} standalone />{/each}
	<GameStatus {game} {score} />

	{#if hinted.size}
		<p class="hint">{hinted.size} play{hinted.size === 1 ? '' : 's'} flagged below.</p>
	{/if}

	{#each groups as g (g.period)}
		<h3>{periodLabel(game.rules, g.period)}</h3>
		<ul class="pbp">
			{#each g.plays as p (p.id)}
				<li>
					<button class="prow-p" class:them={p.side === 'them'} onclick={() => (sheet = { play: p, after: null })}>
						<span class="clk">{p.clock !== null ? fmtClock(p.clock) : ''}</span>
						<span class="what">
							{describePlay(p, nameOf, game.opponent)}
							{#if hinted.has(p.id)}<small class="hintline">{hinted.get(p.id)}</small>{/if}
						</span>
						<span class="film">{p.video_at !== null ? `▶ ${fmtClock(p.video_at)}` : ''}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="empty">
			<p class="big">No plays yet</p>
			<p>Record them on the Live screen, or add them here from film.</p>
		</div>
	{/each}

	<button class="secondary wide" onclick={() => (sheet = { play: null, after: null })}>+ Add a play at the end</button>
</main>

{#if sheet}
	{#key sheet}
		<PlaySheet
			{game}
			{plays}
			{rows}
			play={sheet.play}
			after={sheet.after}
			onclose={() => (sheet = null)}
			onaddafter={(p) => (sheet = { play: null, after: p })}
		/>
	{/key}
{/if}

<style>
	main h3 {
		margin: 10px 0 0;
	}
	.pbp {
		display: grid;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
	}
	.pbp li + li {
		border-top: 1px solid var(--line);
	}
	.prow-p {
		width: 100%;
		display: grid;
		grid-template-columns: 44px 1fr auto;
		gap: 8px;
		align-items: center;
		background: none;
		border: 0;
		padding: 10px 12px;
		text-align: left;
	}
	.prow-p.them .what {
		color: var(--opp);
	}
	.clk,
	.film {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		font-size: 14px;
	}
	.what {
		display: grid;
		font-weight: 500;
	}
	.hintline {
		color: var(--warn);
		font-weight: 600;
	}
</style>
