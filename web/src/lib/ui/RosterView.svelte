<script lang="ts">
	import type { Player, RosterEntry, Team } from '$lib/sync/types';
	import { getApp } from './context.svelte';
	import { changedFields, ensureSeason, parseRoster, rosterOf, teamsOf, todayISO } from './domain';
	import { draftOf, readRules, rulesName, sameRules, teamRules, type RulesDraft } from './games';
	import RulesEditor from './RulesEditor.svelte';
	import ScopeBar from './ScopeBar.svelte';
	import Sheet from './Sheet.svelte';
	import StatusPill from './StatusPill.svelte';
	import Tabs from './Tabs.svelte';

	const app = getApp();
	const view = $derived(app.view);
	const program = $derived(app.program!);
	const season = $derived(app.season);
	const teams = $derived(teamsOf(view, program.id));
	const programPlayers = $derived([...view.players.values()].filter((p) => p.program_id === program.id));
	// Players in the program but on no team this season, so they can be added back.
	const offRoster = $derived.by(() => {
		const on = new Set(rosterOf(view, program.id, season?.id).map((r) => r.player.id));
		return programPlayers.filter((p) => !on.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
	});
	const rejections = $derived(
		app.sync.snapshot.rejections.filter((r) => ['player.put', 'roster.put', 'roster.remove', 'team.put'].includes(r.name))
	);

	// --- adding players -------------------------------------------------------

	let paste = $state('');
	let addTo = $state<string | null>(null);
	const addTeam = $derived((addTo && view.teams.get(addTo)) || teams[0]);

	async function addPlayers() {
		if (!addTeam) return app.showToast('Add a team first.');
		const list = parseRoster(paste);
		if (!list.length) return app.showToast('Paste at least one player.');

		// No season yet: start this school year's, so the roster has one to belong to.
		const seasonChanges = season ? [] : ensureSeason(view, todayISO());
		const seasonId = season?.id ?? (seasonChanges[0].args as { id: string }).id;
		const onTeam = new Set(rosterOf(view, program.id, seasonId, addTeam.id).map((r) => r.player.id));
		const byName = new Map(programPlayers.map((p) => [p.name.toLowerCase(), p]));

		const changes = [...seasonChanges];
		let added = 0;
		for (const { name, jersey } of list) {
			// Someone already in the program (from another team or season) keeps their history.
			let player = byName.get(name.toLowerCase());
			if (!player) {
				player = { id: crypto.randomUUID(), program_id: program.id, name };
				byName.set(name.toLowerCase(), player);
				changes.push({ name: 'player.put', args: player });
			}
			if (onTeam.has(player.id)) continue;
			onTeam.add(player.id);
			changes.push({
				name: 'roster.put',
				args: { id: crypto.randomUUID(), team_id: addTeam.id, season_id: seasonId, player_id: player.id, jersey }
			});
			added++;
		}

		if (!added) return app.showToast(`Those players are already on ${addTeam.name}.`);
		if (await app.mutate(...changes)) {
			paste = '';
			app.showToast(`Added ${added} player${added === 1 ? '' : 's'} to ${addTeam.name}.`);
		}
	}

	// --- teams ----------------------------------------------------------------

	// The team sheet: a team's name, and the rules its new games start with. A new
	// team starts from the program's first team's rules, since a school's teams
	// usually play the same format.
	let teamDraft = $state<{ team: Team | null; name: string; rules: RulesDraft } | null>(null);
	let teamErr = $state('');

	function editTeam(team: Team | null) {
		teamDraft = { team, name: team?.name ?? '', rules: draftOf(teamRules(team ?? teams[0])) };
		teamErr = '';
	}

	async function saveTeam() {
		if (!teamDraft) return;
		const name = teamDraft.name.trim();
		if (!name) return (teamErr = 'Give the team a name.');
		const read = readRules(teamDraft.rules);
		if ('err' in read) return (teamErr = read.err);
		const { team } = teamDraft;
		const args: Partial<Team> & { id: string } = team
			? (changedFields(team, { id: team.id, name }) ?? { id: team.id })
			: { id: crypto.randomUUID(), program_id: program.id, name };
		// A team on the default rules keeps null until it picks something else.
		if (!sameRules(teamRules(team ?? undefined), read.rules)) args.default_rules = read.rules;
		if (!team || Object.keys(args).length > 1) {
			const outcome = await app.sync.engine.mutate({ name: 'team.put', args });
			if (!outcome.ok) return (teamErr = outcome.reason);
		}
		teamDraft = null;
	}

	// --- editing a player -----------------------------------------------------

	interface Draft {
		player: Player;
		name: string;
		jerseys: Record<string, string>;
		joinTeam: string;
		joinJersey: string;
	}
	let editing = $state<Draft | null>(null);
	let err = $state('');

	const entriesOf = (playerId: string): RosterEntry[] =>
		[...view.roster_entries.values()].filter((e) => e.player_id === playerId && e.season_id === season?.id);

	function edit(player: Player) {
		const entries = entriesOf(player.id);
		editing = {
			player,
			name: player.name,
			jerseys: Object.fromEntries(entries.map((e) => [e.id, e.jersey])),
			joinTeam: teams.find((t) => !entries.some((e) => e.team_id === t.id))?.id ?? '',
			joinJersey: entries[0]?.jersey ?? ''
		};
		err = '';
	}

	async function save() {
		if (!editing) return;
		// Only what changed goes out, so edits elsewhere to other fields survive.
		const changes = [];
		const player = changedFields(editing.player, { ...editing.player, name: editing.name.trim() });
		if (player) changes.push({ name: 'player.put' as const, args: player });
		for (const e of entriesOf(editing.player.id)) {
			const jersey = changedFields(e, { ...e, jersey: (editing.jerseys[e.id] ?? '').trim() });
			if (jersey) changes.push({ name: 'roster.put' as const, args: jersey });
		}
		for (const change of changes) {
			const outcome = await app.sync.engine.mutate(change);
			if (!outcome.ok) return (err = outcome.reason);
		}
		editing = null;
	}

	async function join() {
		if (!editing || !editing.joinTeam || !season) return;
		const outcome = await app.sync.engine.mutate({
			name: 'roster.put',
			args: {
				id: crypto.randomUUID(),
				team_id: editing.joinTeam,
				season_id: season.id,
				player_id: editing.player.id,
				jersey: editing.joinJersey.trim()
			}
		});
		if (!outcome.ok) return (err = outcome.reason);
		edit(editing.player);
	}

	async function leave(entry: RosterEntry) {
		await app.mutate({ name: 'roster.remove', args: { id: entry.id } });
		if (editing) edit(editing.player);
	}
</script>

<header class="top">
	<div class="row"><h1>Roster</h1><StatusPill /></div>
	<ScopeBar season />
</header>

<main>
	{#each rejections as r (r.mutation_id)}
		<div class="reject standalone" role="alert">
			<span>Not saved ({String((r.args as Record<string, unknown>).name ?? 'roster')}): {r.reason}</span>
			<button onclick={() => app.sync.engine.dismissRejection(r.mutation_id)}>Dismiss</button>
		</div>
	{/each}

	{#each teams as team (team.id)}
		{@const rows = rosterOf(view, program.id, season?.id, team.id)}
		<h3>{team.name}{season ? ` · ${season.name}` : ''}</h3>
		{#if rows.length}
			<ul class="rlist">
				{#each rows as r (r.player.id)}
					<li>
						<button class="prow-r" onclick={() => edit(r.player)}>
							<span class="jn">{r.jersey || '–'}</span><span><b>{r.player.name}</b></span>
							{#if r.teamIds.length > 1}<span class="tag">{r.teamIds.length} teams</span>{:else}<span class="muted">Edit</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">No players on {team.name}{season ? ` for ${season.name}` : ''} yet.</p>
		{/if}
	{/each}

	{#if offRoster.length}
		<h3>Not on a team this season</h3>
		<ul class="rlist">
			{#each offRoster as p (p.id)}
				<li>
					<button class="prow-r" onclick={() => edit(p)}>
						<span class="jn">–</span><span><b>{p.name}</b></span><span class="muted">Add</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<h3>Add players</h3>
	{#if teams.length > 1}
		<label class="field">
			<span>Team</span>
			<select value={addTeam?.id} onchange={(e) => (addTo = e.currentTarget.value)}>
				{#each teams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
			</select>
		</label>
	{/if}
	<label class="field">
		<span>One per line: jersey number, then name</span>
		<textarea bind:value={paste} placeholder={'23 Jordan Reyes\n5 Sam Okafor\n11 Alex Chen'}></textarea>
	</label>
	<button class="primary wide" onclick={addPlayers}>Add players{addTeam ? ` to ${addTeam.name}` : ''}</button>

	<h3>Teams</h3>
	<ul class="rlist">
		{#each teams as t (t.id)}
			<li>
				<button class="rrow" onclick={() => editTeam(t)}>
					<b>{t.name}</b><span class="muted">{rulesName(teamRules(t))}</span><span class="muted">Edit</span>
				</button>
			</li>
		{/each}
	</ul>
	<button class="secondary wide" onclick={() => editTeam(null)}>+ Add team</button>
</main>
<Tabs />

{#if editing}
	{@const entries = entriesOf(editing.player.id)}
	<Sheet onclose={() => (editing = null)}>
		<h2>Edit player</h2>
		<label class="field"><span>Name</span><input autocomplete="off" bind:value={editing.name} /></label>
		{#each entries as e (e.id)}
			<div class="row">
				<label class="field grow">
					<span>{view.teams.get(e.team_id)?.name ?? 'Team'} jersey</span>
					<input inputmode="numeric" autocomplete="off" bind:value={editing.jerseys[e.id]} />
				</label>
				<button class="danger-link" onclick={() => leave(e)}>Remove from team</button>
			</div>
		{/each}
		{#if err}<p class="err" role="alert">{err}</p>{/if}
		<button class="primary wide" onclick={save}>Save</button>

		{#if season && teams.some((t) => !entries.some((e) => e.team_id === t.id))}
			<h3>Add to a team for {season.name}</h3>
			<div class="row">
				<select bind:value={editing.joinTeam}>
					{#each teams.filter((t) => !entries.some((e) => e.team_id === t.id)) as t (t.id)}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
				<label class="field grow"><span class="sr">Jersey</span><input inputmode="numeric" placeholder="Jersey" bind:value={editing.joinJersey} /></label>
				<button class="secondary" onclick={join}>Add</button>
			</div>
		{/if}
	</Sheet>
{/if}

{#if teamDraft}
	<Sheet onclose={() => (teamDraft = null)}>
		<h2>{teamDraft.team ? 'Edit team' : 'New team'}</h2>
		<label class="field">
			<span>Name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input autocomplete="off" bind:value={teamDraft.name} placeholder="JV" autofocus={!teamDraft.team} />
		</label>
		<RulesEditor bind:draft={teamDraft.rules} />
		<p class="hint">New games start with these rules. Games already created keep their own.</p>
		{#if teamErr}<p class="err" role="alert">{teamErr}</p>{/if}
		<button class="primary wide" onclick={saveTeam}>{teamDraft.team ? 'Save' : 'Add team'}</button>
	</Sheet>
{/if}
