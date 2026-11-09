<script lang="ts">
	import { server } from '$lib/sync/index.svelte';
	import { getApp } from './context.svelte';
	import StatusPill from './StatusPill.svelte';
	import Tabs from './Tabs.svelte';

	const app = getApp();
	const s = $derived(app.sync.snapshot);
	const engine = $derived(app.sync.engine);

	let confirmReset = $state(false);
	let pulling = $state(false);

	async function pullNow() {
		pulling = true;
		await engine.sync();
		pulling = false;
	}

	async function reset() {
		confirmReset = false;
		await engine.reset();
		app.runId = null;
		app.showToast('Local data erased. Everything synced comes back from the server.');
	}

	const fmt = (args: unknown) => JSON.stringify(args);

	// Spike diagnostics (VITE_SPIKE_DIAG): what the Tauri web view supports.
	const diag = import.meta.env.VITE_SPIKE_DIAG ? spikeDiag() : null;
	let wake = $state('not tried');
	if (diag) {
		const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } };
		nav.wakeLock
			? nav.wakeLock.request('screen').then(
					() => (wake = 'granted'),
					(e: Error) => (wake = `refused: ${e.name}: ${e.message}`)
				)
			: (wake = 'no navigator.wakeLock');
	}
	function spikeDiag() {
		return {
			origin: location.origin,
			secure: String(isSecureContext),
			randomUUID: typeof crypto.randomUUID,
			indexedDB: typeof indexedDB,
			serviceWorker: 'serviceWorker' in navigator ? 'yes' : 'no',
			userAgent: navigator.userAgent
		};
	}

	/** "Jordan Reyes · Free throws", when the change names a player or run this device knows. */
	function about(args: unknown) {
		const a = args as Record<string, unknown>;
		const player = s.view.players.get(String(a.player_id ?? ''));
		const run = s.view.runs.get(String(a.drill_run_id ?? a.id ?? ''));
		const drill = run && s.view.drills.get(run.drill_id);
		return [player?.name ?? (typeof a.name === 'string' ? a.name : null), drill && `${drill.name}, ${run.date}`]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<header class="top"><div class="row"><h1>Sync</h1><StatusPill /></div></header>

<main class="inspector">
	{#if diag}
		<dl class="kv" id="spike-diag">
			{#each Object.entries(diag) as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
			<dt>wake lock</dt><dd>{wake}</dd>
		</dl>
	{/if}
	<label class="switch">
		Simulate offline
		<input type="checkbox" checked={s.offline} onchange={(e) => engine.setOffline(e.currentTarget.checked)} />
	</label>

	<dl class="kv">
		<dt>Organization</dt><dd>{server.organizationId}</dd>
		<dt>Client id</dt><dd>{s.clientId}</dd>
		<dt>Cursor</dt><dd>{s.cursor}</dd>
		<dt>Data id</dt><dd>{s.dataId ?? 'not pulled yet'}</dd>
		<dt>Last mutation id</dt><dd>{s.lastMutationId}</dd>
		<dt>State</dt><dd>{s.phase}</dd>
		<dt>Last synced</dt><dd>{s.lastSyncedAt?.toLocaleTimeString() ?? 'never'}</dd>
		{#if s.lastError}<dt>Last error</dt><dd class="err">{s.lastError}</dd>{/if}
		<dt>Rows</dt>
		<dd>
			{s.view.programs.size} programs · {s.view.seasons.size} seasons · {s.view.teams.size} teams ·
			{s.view.players.size} players · {s.view.roster_entries.size} roster entries · {s.view.drills.size} drills ·
			{s.view.runs.size} runs · {s.view.results.size} results
		</dd>
		<dt>Storage</dt>
		<dd class:err={app.sync.persisted === false}>
			{app.sync.persisted === true
				? 'Kept even when the device is low on space'
				: app.sync.persisted === false
					? 'May be cleared when the device is low on space. Add Courtside to the home screen.'
					: 'Unknown'}
		</dd>
	</dl>


	<div class="toolbar">
		<button class="secondary" disabled={s.offline || pulling} onclick={pullNow}>{pulling ? 'Syncing…' : 'Pull now'}</button>
		<button class="secondary" onclick={() => (confirmReset = true)}>Reset local data</button>
	</div>
	{#if confirmReset}
		<div class="note">
			<p style="margin:0 0 10px">
				This erases everything on this device and starts over as a new client.
				{#if s.pending.length}<b>{s.pending.length} unsynced change{s.pending.length === 1 ? '' : 's'} will be lost.</b>{/if}
			</p>
			<div class="toolbar">
				<button class="danger" onclick={reset}>Erase</button>
				<button class="secondary" onclick={() => (confirmReset = false)}>Keep</button>
			</div>
		</div>
	{/if}

	<h3>Rejected by the server ({s.rejections.length})</h3>
	{#if s.rejections.length}
		<ul class="mlist">
			{#each s.rejections as r (r.mutation_id)}
				<li>
					<div class="row"><b>#{r.mutation_id} {r.name}</b><button class="link" onclick={() => engine.dismissRejection(r.mutation_id)}>Dismiss</button></div>
					{#if about(r.args)}<span>{about(r.args)}</span>{/if}
					<span class="why">{r.reason}</span>
					<code>{fmt(r.args)}</code>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">None.</p>
	{/if}

	<h3>Pending ({s.pending.length})</h3>
	{#if s.pending.length}
		<ul class="mlist">
			{#each s.pending as m (m.id)}
				<li>
					<b>#{m.id} {m.name}</b>
					{#if about(m.args)}<span>{about(m.args)}</span>{/if}
					{#if s.skipped.get(m.id)}<span class="why">Won't apply: {s.skipped.get(m.id)}</span>{/if}
					<code>{fmt(m.args)}</code>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">Nothing waiting.</p>
	{/if}
</main>
<Tabs />
