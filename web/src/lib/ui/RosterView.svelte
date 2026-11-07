<script lang="ts">
	import type { Player } from '$lib/sync/types';
	import { getApp } from './context.svelte';
	import { byJersey, parseRoster } from './domain';
	import Sheet from './Sheet.svelte';
	import StatusPill from './StatusPill.svelte';
	import Tabs from './Tabs.svelte';

	const app = getApp();
	const players = $derived([...app.view.players.values()].sort(byJersey));
	const playerRejections = $derived(app.sync.snapshot.rejections.filter((r) => r.name === 'player.put'));

	let paste = $state('');

	async function addPlayers() {
		const have = new Set(players.map((p) => p.name.toLowerCase()));
		const list = parseRoster(paste).filter((p) => !have.has(p.name.toLowerCase()));
		if (!list.length) return app.showToast(paste ? 'Those players are already on the roster.' : 'Paste at least one player.');

		const ok = await app.mutate(
			...list.map((p) => ({
				name: 'player.put' as const,
				args: { id: crypto.randomUUID(), name: p.name, jersey: p.jersey, active: true }
			}))
		);
		if (ok) {
			paste = '';
			app.showToast(`Added ${list.length} player${list.length === 1 ? '' : 's'}.`);
		}
	}

	let editing = $state<Player | null>(null);
	let err = $state('');

	function edit(p: Player) {
		editing = { ...p };
		err = '';
	}

	async function save() {
		if (!editing) return;
		const outcome = await app.sync.engine.mutate({
			name: 'player.put',
			args: { ...editing, name: editing.name.trim(), jersey: editing.jersey.trim() }
		});
		if (!outcome.ok) return (err = outcome.reason);
		editing = null;
	}
</script>

<header class="top"><div class="row"><h1>Roster</h1><StatusPill /></div></header>

<main>
	{#each playerRejections as r (r.mutation_id)}
		<div class="reject standalone" role="alert">
			<span>Not saved ({String((r.args as Record<string, unknown>).name ?? 'player')}): {r.reason}</span>
			<button onclick={() => app.sync.engine.dismissRejection(r.mutation_id)}>Dismiss</button>
		</div>
	{/each}

	{#if players.length}
		<ul class="rlist">
			{#each players as p (p.id)}
				<li>
					<button class="prow-r" onclick={() => edit(p)}>
						<span class="jn">{p.jersey || '–'}</span><span><b>{p.name}</b></span>
						{#if p.active}<span class="muted">Edit</span>{:else}<span class="tag">Hidden</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="empty"><p class="big">No players yet</p><p>Paste your roster below, one player per line.</p></div>
	{/if}

	<h3>Add players</h3>
	<label class="field">
		<span>One per line: jersey number, then name</span>
		<textarea bind:value={paste} placeholder={'23 Jordan Reyes\n5 Sam Okafor\n11 Alex Chen'}></textarea>
	</label>
	<button class="primary wide" onclick={addPlayers}>Add players</button>
</main>
<Tabs />

{#if editing}
	<Sheet onclose={() => (editing = null)}>
		<h2>Edit player</h2>
		<label class="field"><span>Name</span><input autocomplete="off" bind:value={editing.name} /></label>
		<label class="field"><span>Jersey number</span><input inputmode="numeric" autocomplete="off" bind:value={editing.jersey} /></label>
		<label class="check">
			<input type="checkbox" bind:checked={editing.active} /> Show in drills (uncheck to hide without losing history)
		</label>
		{#if err}<p class="err" role="alert">{err}</p>{/if}
		<button class="primary wide" onclick={save}>Save</button>
	</Sheet>
{/if}
