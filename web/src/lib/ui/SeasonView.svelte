<!-- Season totals for one team's games, totals or per game, with each player's game log,
and practice compared with games for the shots a drill practices. -->
<script lang="ts">
	import type { GameStat } from '$lib/sync/types';
	import { pct, type Line } from './basketball';
	import { getApp } from './context.svelte';
	import { fmtDate, rosterOf, teamsOf } from './domain';
	import { gamesOf, matchup } from './games';
	import { GAME_STAT_LABEL, gameLog, linkedStats, perGame, practiceVsGames, seasonTotals, type Shots } from './season';
	import Sheet from './Sheet.svelte';

	const app = getApp();
	const view = $derived(app.view);
	const program = $derived(app.program!);
	const season = $derived(app.season);
	const teams = $derived(teamsOf(view, program.id));
	let teamId = $state<string | null>(null);
	const team = $derived(teams.find((t) => t.id === teamId) ?? teams[0]);
	let perGameMode = $state(false);

	const games = $derived(team ? gamesOf(view, program.id, season).filter((g) => g.team_id === team.id) : []);
	const totals = $derived(seasonTotals(view, games));
	const roster = $derived(team ? rosterOf(view, program.id, season?.id, team.id) : []);
	const jerseys = $derived(new Map(roster.map((r) => [r.player.id, r.jersey])));
	const nameOf = (id: string) => view.players.get(id)?.name ?? 'Player';

	/** Players with a line: the roster by jersey, then call-ups by name. */
	const playerIds = $derived.by(() => {
		const ids = roster.map((r) => r.player.id).filter((id) => totals.players.has(id));
		const rest = [...totals.players.keys()].filter((id) => !jerseys.has(id) && view.players.has(id));
		return [...ids, ...rest.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))];
	});

	const COLS = ['pts', 'fg', 'tp', 'ft', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf'] as const;
	type Col = (typeof COLS)[number];
	const LABEL: Record<Col, string> = {
		pts: 'PTS',
		fg: 'FG',
		tp: '3PT',
		ft: 'FT',
		reb: 'REB',
		ast: 'AST',
		stl: 'STL',
		blk: 'BLK',
		tov: 'TO',
		pf: 'PF'
	};
	const SHOTS: Partial<Record<Col, [keyof Line, keyof Line]>> = { fg: ['fgm', 'fga'], tp: ['tpm', 'tpa'], ft: ['ftm', 'fta'] };

	/** Totals show shots as made-attempted; per game shows their percentage. */
	function cell(line: Line, gp: number, col: Col, avg = perGameMode): string {
		const shots = SHOTS[col];
		if (shots) {
			const [m, a] = shots;
			if (!avg) return `${line[m]}-${line[a]}`;
			const p = pct(line[m], line[a]);
			return p === null ? '–' : `${p}%`;
		}
		const n = line[col as keyof Line];
		return avg ? perGame(n, gp) : String(n);
	}

	// --- a player's game log ---------------------------------------------------------------

	let logFor = $state<string | null>(null);
	const log = $derived(logFor ? gameLog(view, games, logFor) : []);

	// --- practice vs games ------------------------------------------------------------------

	const stats = $derived(linkedStats(view, program.id));
	const order = $derived(roster.map((r) => r.player.id));
	const onTeam = $derived(new Set([...order, ...totals.players.keys()]));
	const compare = $derived(
		stats.map((stat) => ({ stat, rows: practiceVsGames(view, program.id, season, games, stat, order, onTeam) }))
	);
	const share = (s: Shots) => (s.att ? s.made / s.att : null);
	function diff(a: Shots, b: Shots): string {
		const p = share(a);
		const g = share(b);
		if (p === null || g === null) return '';
		const d = Math.round(g * 100) - Math.round(p * 100);
		return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0';
	}
	const fmtShots = (s: Shots) => (s.att ? `${pct(s.made, s.att)}%` : '–');
	const statTitle = (stat: GameStat) => GAME_STAT_LABEL[stat];
</script>

{#if teams.length > 1}
	<div class="chips" role="tablist" aria-label="Team">
		{#each teams as t (t.id)}
			<button role="tab" aria-selected={team?.id === t.id} class:on={team?.id === t.id} onclick={() => (teamId = t.id)}>{t.name}</button>
		{/each}
	</div>
{/if}

{#if !totals.team.gp}
	<div class="empty">
		<p class="big">No game stats{season ? ` in ${season.name}` : ''} yet</p>
		<p>Totals appear here once {team?.name ?? 'a team'} has a game with plays.</p>
	</div>
{:else}
	<div class="seg two" role="group" aria-label="Show">
		<button class:on={!perGameMode} aria-pressed={!perGameMode} onclick={() => (perGameMode = false)}>Totals</button>
		<button class:on={perGameMode} aria-pressed={perGameMode} onclick={() => (perGameMode = true)}>Per game</button>
	</div>

	<div class="tablewrap">
		<table class="season">
			<thead>
				<tr>
					<th class="who">Player</th>
					<th class="n">GP</th>
					{#each COLS as col (col)}<th class="n">{perGameMode && SHOTS[col] ? `${LABEL[col]}%` : LABEL[col]}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each playerIds as id (id)}
					{@const s = totals.players.get(id)!}
					<tr>
						<th class="who" scope="row">
							<button onclick={() => (logFor = id)}>
								{#if jerseys.get(id)}<span class="jersey">{jerseys.get(id)}</span>{/if}{nameOf(id)}
							</button>
						</th>
						<td class="n">{s.gp}</td>
						{#each COLS as col (col)}<td class="n">{cell(s.line, s.gp, col)}</td>{/each}
					</tr>
				{/each}
				<tr class="total">
					<th class="who" scope="row">Total</th>
					<td class="n">{totals.team.gp}</td>
					{#each COLS as col (col)}<td class="n">{cell(totals.team.line, totals.team.gp, col)}</td>{/each}
				</tr>
				<tr class="total">
					<th class="who" scope="row">Them</th>
					<td class="n">{totals.opponent.gp}</td>
					{#each COLS as col (col)}<td class="n">{cell(totals.opponent.line, totals.opponent.gp, col)}</td>{/each}
				</tr>
			</tbody>
		</table>
	</div>
	<p class="hint">
		{totals.team.gp} game{totals.team.gp === 1 ? '' : 's'} with plays. GP counts the games a player has a stat in. Tap a name
		for their games.
	</p>
{/if}

<h3>Practice vs games</h3>
{#if !stats.length}
	<p class="hint">
		Link a shooting drill to the shot it practices to compare here: on History, choose the drill, then Edit drill, then
		"Matches in games".
	</p>
{:else}
	{#each compare as c (c.stat)}
		<h4>{statTitle(c.stat)}</h4>
		{#if c.rows.length}
			<div class="tablewrap">
				<table class="compare">
					<thead>
						<tr><th>Player</th><th class="n">Practice</th><th class="n">Games</th><th class="n">Diff</th></tr>
					</thead>
					<tbody>
						{#each c.rows as r (r.playerId)}
							<tr>
								<td>{nameOf(r.playerId)}</td>
								<td class="n">{fmtShots(r.practice)} <small class="muted">{r.practice.made}/{r.practice.att}</small></td>
								<td class="n">{fmtShots(r.games)} <small class="muted">{r.games.made}/{r.games.att}</small></td>
								<td class="n">{diff(r.practice, r.games)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="muted">No {statTitle(c.stat).toLowerCase()} in practice or games yet.</p>
		{/if}
	{/each}
	<p class="hint">Diff is the game percentage minus the practice one, in points.</p>
{/if}

{#if logFor}
	<Sheet onclose={() => (logFor = null)}>
		<h2>{nameOf(logFor)}</h2>
		<div class="tablewrap">
			<table class="season">
				<thead>
					<tr>
						<th class="who">Game</th>
						{#each COLS as col (col)}<th class="n">{LABEL[col]}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each log as x (x.game.id)}
						<tr>
							<th class="who" scope="row">
								<button class="game" onclick={() => app.openGame(x.game.id, 'box')}>
									{matchup(x.game)}<small>{fmtDate(x.game.date)}</small>
								</button>
							</th>
							{#each COLS as col (col)}<td class="n">{cell(x.line, 1, col, false)}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="hint">Tap a game for its box score.</p>
	</Sheet>
{/if}

<style>
	.seg.two {
		grid-template-columns: 1fr 1fr;
	}
	h3 {
		margin: 10px 0 0;
	}
	h4 {
		margin: 4px 0 0;
	}
	.season th.who {
		position: sticky;
		left: 0;
		background: var(--surface);
		z-index: 1;
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.season tbody th.who {
		font-size: 15px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink);
		font-weight: 600;
	}
	.season th.who button {
		background: none;
		border: 0;
		padding: 10px 0;
		font: inherit;
		color: inherit;
		text-align: left;
	}
	.season th.who button.game {
		display: grid;
		padding: 6px 0;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.game small {
		color: var(--muted);
		font-weight: 500;
		font-size: 13px;
	}
	.jersey {
		color: var(--muted);
		margin-right: 6px;
	}
	.season td,
	.season th {
		padding: 0 6px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.season tr.total td,
	.season tr.total th {
		font-weight: 700;
		background: var(--bg);
	}
	.season tr.total th.who {
		padding: 10px 6px;
	}
	.compare td {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
