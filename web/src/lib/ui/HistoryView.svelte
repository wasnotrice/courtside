<script lang="ts">
	import { GAME_STATS, type Drill, type GameStat } from '$lib/sync/types';
	import { getApp } from './context.svelte';
	import {
		bestFor,
		changedFields,
		effSetup,
		entry,
		fmtDate,
		fmtScore,
		fmtValue,
		KINDS,
		pct,
		readSetup,
		results,
		rosterOf,
		seasonOf,
		setupText,
		summary,
		teamsOf,
		todayISO,
		type RosterRow
	} from './domain';
	import ScopeBar from './ScopeBar.svelte';
	import { GAME_STAT_LABEL } from './season';
	import Sheet from './Sheet.svelte';
	import SetupField from './SetupField.svelte';
	import StatusPill from './StatusPill.svelte';
	import Tabs from './Tabs.svelte';

	const app = getApp();
	const view = $derived(app.view);
	const program = $derived(app.program!);
	const season = $derived(app.season);
	const teams = $derived(teamsOf(view, program.id));
	let team = $state<string | null>(null);
	const drills = $derived(
		[...view.drills.values()].filter((d) => d.program_id === program.id).sort((a, b) => a.name.localeCompare(b.name))
	);
	const drill = $derived(
		(app.historyDrill && view.drills.get(app.historyDrill)) || drills.find((d) => !d.archived) || drills[0]
	);
	// This drill's runs in the chosen season.
	const runs = $derived(
		drill
			? [...view.runs.values()]
					.filter((r) => r.drill_id === drill.id && (!season || (r.date >= season.starts_on && r.date <= season.ends_on)))
					.sort((a, b) => b.date.localeCompare(a.date))
			: []
	);
	// The season's roster (or one team's), plus, for everyone, anyone with a result.
	const people = $derived.by((): RosterRow[] => {
		const list = rosterOf(view, program.id, season?.id, team);
		if (team) return list;
		const have = new Set(list.map((r) => r.player.id));
		for (const run of runs) {
			for (const pid of results(view, run.id).keys()) {
				const player = have.has(pid) ? undefined : view.players.get(pid);
				if (player) list.push({ player, jersey: '', teamIds: [] });
				have.add(pid);
			}
		}
		return list;
	});
	// Count and time compare at the latest run's setup, so numbers are comparable.
	const refSetup = $derived(runs[0]?.setup ?? null);

	const rows = $derived.by(() => {
		if (!drill) return [];
		return people.flatMap(({ player: p }) => {
			const mine = runs.flatMap((run) => {
				const r = entry(view, run.id, p.id);
				return r && r.value !== null ? [{ run, r: r as typeof r & { value: number } }] : [];
			});
			if (!mine.length) return [];
			const last = mine[0];
			const lastSetup = effSetup(last.run, last.r);

			if (drill.kind === 'makes') {
				let m = 0;
				let a = 0;
				for (const x of mine) {
					const s = effSetup(x.run, x.r);
					if (s) {
						m += x.r.value;
						a += s;
					}
				}
				const best = bestFor(view, drill, p.id);
				return [{ p, cells: [`${last.r.value}/${lastSetup ?? '?'}`, best !== null ? pct(best) : '–', a ? pct(m / a) : '–', String(a)] }];
			}
			const best = bestFor(view, drill, p.id, { setup: refSetup });
			const star = lastSetup !== refSetup ? '*' : '';
			return [{ p, cells: [fmtValue(drill.kind, last.r.value) + star, best !== null ? fmtScore(drill, best) : '–', String(mine.length)] }];
		});
	});

	function exportCSV() {
		const cell = (v: unknown) => {
			const s = v == null ? '' : String(v);
			return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
		};
		const lines = [['date', 'drill', 'kind', 'player', 'jersey', 'setup', 'value', 'pct'].join(',')];
		// Every run in the program, with each player's jersey from that run's season.
		const jerseys = new Map<string | undefined, Map<string, string>>();
		const jerseyIn = (seasonId: string | undefined, playerId: string) => {
			if (!jerseys.has(seasonId)) {
				jerseys.set(seasonId, new Map(rosterOf(view, program.id, seasonId).map((r) => [r.player.id, r.jersey])));
			}
			return jerseys.get(seasonId)!.get(playerId) ?? '';
		};
		const programRuns = [...view.runs.values()].filter((r) => r.program_id === program.id);
		for (const run of programRuns.sort((a, b) => a.date.localeCompare(b.date))) {
			const d = view.drills.get(run.drill_id);
			if (!d) continue;
			const seasonId = seasonOf(view, run.date)?.id;
			for (const [pid, r] of results(view, run.id)) {
				const name = view.players.get(pid)?.name ?? '(removed)';
				const s = effSetup(run, r);
				const share = d.kind === 'makes' && s ? (r.value / s).toFixed(3) : '';
				lines.push([run.date, d.name, d.kind, name, jerseyIn(seasonId, pid), s, r.value, share].map(cell).join(','));
			}
		}
		const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
		const a = Object.assign(document.createElement('a'), { href: url, download: `courtside-${todayISO()}.csv` });
		a.click();
		URL.revokeObjectURL(url);
	}

	let editing = $state<{ drill: Drill; name: string; setup: string; archived: boolean; gameStat: GameStat | '' } | null>(null);
	let err = $state('');

	async function saveDrill() {
		if (!editing) return;
		const name = editing.name.trim();
		if (!name) return (err = 'Give the drill a name.');
		const res = readSetup(editing.drill.kind, editing.setup);
		if ('err' in res) return (err = res.err);
		// Only what changed goes out, so edits elsewhere to other fields survive.
		const game_stat = editing.drill.kind === 'makes' ? editing.gameStat || null : null;
		const args = changedFields(editing.drill, { ...editing.drill, name, default_setup: res.v, archived: editing.archived, game_stat });
		const outcome = args ? await app.sync.engine.mutate({ name: 'drill.put', args }) : { ok: true as const };
		if (!outcome.ok) return (err = outcome.reason);
		editing = null;
	}
</script>

<header class="top">
	<div class="row"><h1>History</h1><StatusPill /></div>
	<ScopeBar season />
</header>

<main>
	{#if !drill}
		<div class="empty"><p class="big">No drills yet</p></div>
	{:else}
		<div class="chips" role="tablist">
			{#each drills as d (d.id)}
				<button class:on={d.id === drill.id} onclick={() => (app.historyDrill = d.id)}>
					{d.name}{d.archived ? ' (hidden)' : ''}
				</button>
			{/each}
		</div>
		{#if teams.length > 1}
			<div class="chips" role="tablist" aria-label="Team">
				<button class:on={team === null} onclick={() => (team = null)}>Everyone</button>
				{#each teams as t (t.id)}
					<button class:on={team === t.id} onclick={() => (team = t.id)}>{t.name}</button>
				{/each}
			</div>
		{/if}
		<div class="toolbar">
			<button class="secondary" onclick={exportCSV}>Export CSV</button>
			<button
				class="secondary"
				onclick={() => {
					err = '';
					editing = {
						drill,
						name: drill.name,
						setup: String(drill.default_setup ?? ''),
						archived: drill.archived,
						gameStat: drill.game_stat ?? ''
					};
				}}>Edit drill</button
			>
		</div>

		<h3>Players</h3>
		{#if rows.length}
			<div class="tablewrap">
				<table>
					<thead>
						{#if drill.kind === 'makes'}
							<tr><th>Player</th><th class="n">Last</th><th class="n">Best</th><th class="n">Season</th><th class="n">Shots</th></tr>
						{:else}
							<tr><th>Player</th><th class="n">Last</th><th class="n">Best ({setupText(drill.kind, refSetup)})</th><th class="n">Runs</th></tr>
						{/if}
					</thead>
					<tbody>
						{#each rows as row (row.p.id)}
							<tr>
								<td>{row.p.name}</td>
								{#each row.cells as c, i (i)}<td class="n">{c}</td>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if drill.kind !== 'makes'}
				<p class="hint">
					Best compares only runs at the same {drill.kind === 'count' ? 'length' : 'number of reps'} as the latest one.
					* means the last result used a different setup.
				</p>
			{/if}
		{:else}
			<p class="muted">No results for {drill.name} yet.</p>
		{/if}

		<h3>Practices</h3>
		{#if runs.length}
			<ul class="rlist">
				{#each runs as run (run.id)}
					<li>
						<button class="rrow" onclick={() => app.openRun(run.id)}>
							<b>{fmtDate(run.date)}</b>
							<span class="muted">{setupText(drill.kind, run.setup)} · {results(view, run.id).size} players</span>
							<span class="num">{summary(view, drill, run)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Not run{season ? ` in ${season.name}` : ''} yet.</p>
		{/if}
	{/if}
</main>
<Tabs />

{#if editing}
	<Sheet onclose={() => (editing = null)}>
		<h2>Edit drill</h2>
		<label class="field"><span>Name</span><input autocomplete="off" bind:value={editing.name} /></label>
		<p class="hint">Records: {KINDS[editing.drill.kind].name}. {KINDS[editing.drill.kind].hint}</p>
		<SetupField
			kind={editing.drill.kind}
			label={'Default ' + KINDS[editing.drill.kind].setupField.toLowerCase()}
			bind:value={editing.setup}
		/>
		{#if editing.drill.kind === 'makes'}
			<label class="field">
				<span>Matches in games</span>
				<select bind:value={editing.gameStat}>
					<option value="">Nothing</option>
					{#each GAME_STATS as s (s)}<option value={s}>{GAME_STAT_LABEL[s]}</option>{/each}
				</select>
			</label>
			<p class="hint">Compares this drill with the same shots in games, on Games, then Season.</p>
		{/if}
		<label class="check"><input type="checkbox" bind:checked={editing.archived} /> Hide from Add a drill</label>
		{#if err}<p class="err" role="alert">{err}</p>{/if}
		<button class="primary wide" onclick={saveDrill}>Save</button>
	</Sheet>
{/if}
