<!-- A game's status (live, final, reviewed), its official score from the scorebook, and
the flag when the plays don't add up to it. Marking a game final asks for the score. -->
<script lang="ts">
	import type { Game } from '$lib/sync/types';
	import { scoreMismatch } from './basketball';
	import { getApp } from './context.svelte';
	import { mismatchText } from './games';
	import Sheet from './Sheet.svelte';

	let { game, score }: { game: Game; score: { us: number; them: number } } = $props();

	const app = getApp();
	const snap = $derived(app.sync.snapshot);
	const mismatch = $derived(scoreMismatch(game, score));
	const hasOfficial = $derived(game.official_us !== null && game.official_them !== null);
	const unsynced = $derived(snap.pending.filter((m) => m.name.startsWith('play.') || m.name.startsWith('game.')).length);

	const STATUSES: [Game['status'], string][] = [
		['live', 'Live'],
		['final', 'Final'],
		['reviewed', 'Reviewed']
	];

	// The official score sheet, opened by marking the game final or tapping the score.
	let editing = $state<{ us: string; them: string; status: Game['status'] } | null>(null);
	let err = $state('');

	function openScore(status: Game['status']) {
		editing = {
			us: String(game.official_us ?? score.us),
			them: String(game.official_them ?? score.them),
			status
		};
		err = '';
	}

	async function setStatus(status: Game['status']) {
		if (status === game.status) return;
		if (status === 'final' && !hasOfficial) return openScore('final');
		await app.mutate({ name: 'game.put', args: { id: game.id, status } });
	}

	async function saveScore() {
		if (!editing) return;
		const read = (s: string) => (s.trim() === '' ? null : Number(s));
		const us = read(editing.us);
		const them = read(editing.them);
		const bad = (n: number | null) => n !== null && !(Number.isInteger(n) && n >= 0);
		if (bad(us) || bad(them)) return (err = 'Scores are whole numbers, 0 or more.');
		if ((us === null) !== (them === null)) return (err = 'Enter both scores, or neither.');

		const outcome = await app.sync.engine.mutate({
			name: 'game.put',
			args: { id: game.id, status: editing.status, official_us: us, official_them: them }
		});
		if (!outcome.ok) return (err = outcome.reason);
		editing = null;
	}
</script>

<div class="status">
	<div class="statusrow">
		<span class="muted">Status</span>
		<div class="chips" role="group" aria-label="Game status">
			{#each STATUSES as [status, label] (status)}
				<button class:on={game.status === status} aria-pressed={game.status === status} onclick={() => setStatus(status)}>{label}</button>
			{/each}
		</div>
	</div>
	<button class="official" onclick={() => openScore(game.status)}>
		{#if hasOfficial}
			Official score <b>{game.official_us}–{game.official_them}</b> <span class="muted">Edit</span>
		{:else}
			<span class="muted">Add the official score from the scorebook</span>
		{/if}
	</button>
	{#if mismatch}
		<p class="flag" role="status">Plays total {score.us}–{score.them}, official {game.official_us}–{game.official_them}: {mismatchText(mismatch)}</p>
	{/if}
</div>

{#if editing}
	<Sheet onclose={() => (editing = null)}>
		<h2>{editing.status === 'final' && game.status !== 'final' ? 'Final score' : 'Official score'}</h2>
		<p class="hint">From the scorebook. Plays total {score.us}–{score.them}.</p>
		<div class="pair">
			<label class="field"><span>Us</span><input inputmode="numeric" bind:value={editing.us} /></label>
			<label class="field"><span class="opp">Opp</span><input inputmode="numeric" bind:value={editing.them} /></label>
		</div>
		{#if unsynced && (snap.offline || snap.phase === 'retrying')}
			<p class="note">
				{unsynced} change{unsynced === 1 ? '' : 's'} to this game {unsynced === 1 ? "hasn't" : "haven't"} reached the server
				yet. Get signal before you close the app or hand the phone back.
			</p>
		{/if}
		{#if err}<p class="err" role="alert">{err}</p>{/if}
		<button class="primary wide" onclick={saveScore}>
			{editing.status === 'final' && game.status !== 'final' ? 'Mark final' : 'Save'}
		</button>
	</Sheet>
{/if}

<style>
	.status {
		display: grid;
		gap: 8px;
	}
	.statusrow {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 600;
	}
	.statusrow .chips {
		padding-bottom: 0;
	}
	.official {
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
		font-weight: 500;
	}
	.official b {
		font-variant-numeric: tabular-nums;
		margin: 0 6px;
	}
	.flag {
		margin: 0;
		color: var(--warn);
		background: var(--warn-soft);
		border-radius: 8px;
		padding: 8px 10px;
		font-weight: 600;
		font-size: 14px;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
</style>
