<!-- Changes refused because another phone deleted the game or drill run they went
into, one note per game or run: restore it and save them again, or let them go. -->
<script lang="ts">
	import { lostChanges, restoreLost, type Lost } from '$lib/sync/restore';
	import { getApp } from './context.svelte';
	import { fmtDate } from './domain';
	import { matchup } from './games';

	let { kind }: { kind: Lost['kind'] } = $props();

	const app = getApp();
	const snap = $derived(app.sync.snapshot);
	const groups = $derived(lostChanges(snap.rejections, snap.view).filter((l) => l.kind === kind));

	let busy = $state<string | null>(null);
	let confirming = $state<string | null>(null);
	let errors = $state<Record<string, string>>({});

	const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

	/** The day the first refused play was recorded, to tell which game it was. */
	function recordedOn(l: Lost): string {
		const at = l.rejections.map((r) => r.args.recorded_at).find((v) => typeof v === 'number') as number | undefined;
		if (at === undefined) return '';
		const d = new Date(at);
		const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		return ` on ${fmtDate(iso)}`;
	}

	function text(l: Lost): string {
		const n = l.rejections.length;
		if (l.kind === 'game') {
			if (!l.gone) {
				const g = snap.view.games.get(l.id)!;
				return `${matchup(g)} is back, but ${plural(n, 'change')} made while it was deleted ${n === 1 ? "wasn't" : "weren't"} saved.`;
			}
			return `A game was deleted on another phone. ${plural(n, 'change')} recorded into it${recordedOn(l)} ${n === 1 ? "wasn't" : "weren't"} saved.`;
		}
		if (!l.gone) return `A drill is back in the practice, but ${plural(n, 'result')} entered while it was removed ${n === 1 ? "wasn't" : "weren't"} saved.`;
		return `A drill was removed from the practice on another phone. ${plural(n, 'result')} entered into it ${n === 1 ? "wasn't" : "weren't"} saved.`;
	}

	const key = (l: Lost) => `${l.kind}:${l.id}`;

	async function restore(l: Lost) {
		busy = key(l);
		const outcome = await restoreLost(app.sync.engine, l);
		busy = null;
		errors = { ...errors, [key(l)]: outcome.ok ? '' : outcome.reason };
		if (outcome.ok) app.showToast(l.kind === 'game' ? 'Game restored' : 'Drill restored');
	}

	async function dismiss(l: Lost) {
		for (const r of l.rejections) await app.sync.engine.dismissRejection(r.mutation_id);
		confirming = null;
	}
</script>

{#each groups as l (key(l))}
	<div class="reject standalone lost" role="alert">
		<p>{text(l)}</p>
		{#if errors[key(l)]}<p class="why">{errors[key(l)]}</p>{/if}
		{#if confirming === key(l)}
			<p>Dismissing loses {l.rejections.length === 1 ? 'it' : 'them'} for good.</p>
			<div class="acts">
				<button onclick={() => dismiss(l)}>Lose {l.rejections.length === 1 ? 'it' : 'them'}</button>
				<button onclick={() => (confirming = null)}>Keep</button>
			</div>
		{:else}
			<div class="acts">
				<button disabled={busy === key(l)} onclick={() => restore(l)}>
					{busy === key(l) ? 'Restoring…' : !l.gone ? 'Save them again' : l.kind === 'game' ? 'Restore the game' : 'Restore the drill'}
				</button>
				<button onclick={() => (confirming = key(l))}>Dismiss</button>
			</div>
		{/if}
	</div>
{/each}

<style>
	.lost {
		display: grid;
		gap: 6px;
	}
	.lost p {
		margin: 0;
	}
	.why {
		font-weight: 700;
	}
	.acts {
		display: flex;
		gap: 16px;
	}
</style>
