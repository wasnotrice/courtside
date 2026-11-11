<!-- The top of every game screen: back, the matchup (tap for the game's details), the
score from the plays, and the switch between Live, Plays and Box. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Game } from '$lib/sync/types';
	import { getApp, type GameMode } from './context.svelte';
	import GameSheet from './GameSheet.svelte';
	import { matchup } from './games';
	import Sheet from './Sheet.svelte';
	import StatusPill from './StatusPill.svelte';

	let { game, score, children }: { game: Game; score: { us: number; them: number }; children?: Snippet } = $props();

	const app = getApp();
	const snap = $derived(app.sync.snapshot);
	let sheet = $state<'details' | 'leave' | null>(null);

	/** Changes to games and plays still on this phone only. */
	const unsynced = $derived(snap.pending.filter((m) => m.name.startsWith('play.') || m.name.startsWith('game.')).length);

	// Leaving while offline with unsynced plays: ask the scorer to get signal first.
	function back() {
		if (unsynced > 0 && (snap.offline || snap.phase === 'retrying')) sheet = 'leave';
		else app.gameId = null;
	}
	const MODES: [GameMode, string][] = [
		['live', 'Live'],
		['plays', 'Plays'],
		['box', 'Box']
	];
</script>

<header class="top game">
	<div class="row">
		<button class="back" onclick={back}>‹ Games</button>
		<StatusPill />
	</div>
	<div class="row">
		<button class="title" onclick={() => (sheet = 'details')}><h1>{matchup(game)}</h1></button>
		<span class="score" aria-label="Score">{score.us}–{score.them}</span>
	</div>
	<div class="seg modes" role="tablist" aria-label="Game screen">
		{#each MODES as [mode, label] (mode)}
			<button role="tab" aria-selected={app.gameMode === mode} class:on={app.gameMode === mode} onclick={() => (app.gameMode = mode)}>
				{label}
			</button>
		{/each}
	</div>
	{@render children?.()}
</header>

{#if sheet === 'details'}
	<GameSheet {game} onclose={() => (sheet = null)} />
{:else if sheet === 'leave'}
	<Sheet onclose={() => (sheet = null)}>
		<h2>Not synced yet</h2>
		<p>
			{unsynced === 1 ? '1 change is' : `${unsynced} changes are`} saved on this phone but {unsynced === 1 ? "hasn't" : "haven't"}
			reached the server yet. Get signal before you close the app or hand the phone back.
		</p>
		<button class="secondary wide" onclick={() => (app.gameId = null)}>Leave the game screen</button>
	</Sheet>
{/if}

<style>
	header.game {
		gap: 6px;
	}
	.title {
		background: none;
		border: 0;
		padding: 0;
		text-align: left;
		min-width: 0;
	}
	.title h1 {
		font-size: 28px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.score {
		font-family: var(--display);
		font-weight: 700;
		font-size: 34px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.modes button {
		padding: 6px 4px;
	}
</style>
