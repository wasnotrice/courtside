<script lang="ts">
	import { getApp } from './context.svelte';
	import { drillsByUse, fmtDate, KINDS, readSetup, results, roster, runsOn, setupText, summary, todayISO } from './domain';
	import Sheet from './Sheet.svelte';
	import SetupField from './SetupField.svelte';
	import StatusPill from './StatusPill.svelte';
	import Tabs from './Tabs.svelte';
	import type { Kind } from '$lib/sync/types';

	const app = getApp();
	const view = $derived(app.view);
	const runs = $derived(runsOn(view, app.date));
	const total = $derived(roster(view).length);
	const rejected = $derived(app.sync.snapshot.rejections.length);

	// The "Add a drill" sheet.
	let adding = $state(false);
	let pick = $state<string | null>(null);
	let creating = $state(false);
	let name = $state('');
	let kind = $state<Kind>('makes');
	let setup = $state('');
	let err = $state('');

	function openAdd() {
		adding = true;
		pick = null;
		creating = false;
		err = '';
	}

	function choose(drillId: string) {
		pick = drillId;
		setup = String(view.drills.get(drillId)?.default_setup ?? '');
		err = '';
	}

	function newDrill() {
		creating = true;
		name = '';
		kind = 'makes';
		setup = '50';
		err = '';
	}

	function setKind(k: Kind) {
		kind = k;
		setup = k === 'makes' ? '50' : k === 'count' ? '60' : '';
	}

	async function start(drillId: string, k: Kind, draftSetup: string, create?: { name: string }) {
		const res = readSetup(k, draftSetup);
		if ('err' in res) return (err = res.err);

		const runId = crypto.randomUUID();
		const ok = await app.mutate(
			...(create
				? [{ name: 'drill.put' as const, args: { id: drillId, name: create.name, kind: k, default_setup: res.v, archived: false } }]
				: []),
			{ name: 'run.create', args: { id: runId, date: app.date, drill_id: drillId, setup: res.v } }
		);
		if (!ok) return;
		adding = false;
		app.openRun(runId);
	}

	function createAndStart() {
		if (!name.trim()) return (err = 'Give the drill a name.');
		void start(crypto.randomUUID(), kind, setup, { name: name.trim() });
	}
</script>

<header class="top">
	<div class="row"><h1>Practice</h1><StatusPill /></div>
	<div class="row wrap">
		<label class="date"><span class="sr">Practice date</span><input type="date" bind:value={app.date} /></label>
		<span class="muted">{app.date === todayISO() ? 'Today' : fmtDate(app.date)}</span>
	</div>
</header>

<main>
	{#if rejected}
		<button class="note banner" onclick={() => app.go('sync')}>
			{rejected} change{rejected === 1 ? ' was' : 's were'} not saved. Review in Sync.
		</button>
	{/if}
	{#if !total}
		<div class="note">Add your players first. <button class="link" onclick={() => app.go('roster')}>Go to Roster</button></div>
	{/if}

	{#if runs.length}
		<ul class="runs">
			{#each runs as run (run.id)}
				{@const d = view.drills.get(run.drill_id)}
				{#if d}
					<li>
						<button class="card" onclick={() => app.openRun(run.id)}>
							<span class="cname">{d.name}</span><span class="tag k-{d.kind}">{KINDS[d.kind].name}</span>
							<span class="cmeta">{setupText(d.kind, run.setup)} · {results(view, run.id).size} of {total} entered</span>
							<span class="csum">{summary(view, d, run)}</span>
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	{:else}
		<div class="empty">
			<p class="big">No drills logged for this practice</p>
			<p>Add a drill, then enter each player's number as they report it.</p>
		</div>
	{/if}

	<button class="primary wide" onclick={openAdd}>+ Add a drill</button>
</main>
<Tabs />

{#if adding}
	<Sheet onclose={() => (adding = false)}>
		{#if creating}
			<h2>New drill</h2>
			<label class="field"><span>Name</span><input autocomplete="off" bind:value={name} placeholder="Mikan drill" /></label>
			<div class="field">
				<span>What you record</span>
				<div class="seg">
					{#each Object.entries(KINDS) as [k, K] (k)}
						<button class:on={kind === k} onclick={() => setKind(k as Kind)}>{K.name}</button>
					{/each}
				</div>
				<p class="hint">{KINDS[kind].hint}</p>
			</div>
			{#key kind}
				<SetupField {kind} label={'Default ' + KINDS[kind].setupField.toLowerCase()} bind:value={setup} />
			{/key}
			{#if err}<p class="err" role="alert">{err}</p>{/if}
			<button class="primary wide" onclick={createAndStart}>Create and start</button>
		{:else}
			<h2>Add a drill</h2>
			<ul class="dlist">
				{#each drillsByUse(view).filter((d) => !d.archived) as d (d.id)}
					{#if pick === d.id}
						<li class="pick">
							<div class="row"><b>{d.name}</b><span class="tag k-{d.kind}">{KINDS[d.kind].name}</span></div>
							<SetupField kind={d.kind} label={'For today: ' + KINDS[d.kind].setupField.toLowerCase()} bind:value={setup} />
							{#if err}<p class="err" role="alert">{err}</p>{/if}
							<button class="primary wide" onclick={() => start(d.id, d.kind, setup)}>Start</button>
						</li>
					{:else}
						<li>
							<button class="drow" onclick={() => choose(d.id)}>
								<span>{d.name}</span><span class="tag k-{d.kind}">{KINDS[d.kind].name}</span>
								<span class="muted">{setupText(d.kind, d.default_setup)}</span>
							</button>
						</li>
					{/if}
				{/each}
			</ul>
			<button class="secondary wide" onclick={newDrill}>+ New drill</button>
		{/if}
	</Sheet>
{/if}
