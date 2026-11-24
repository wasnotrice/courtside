<!-- The box score: each player, our plays with no player, our totals and theirs. Tap a
cell to see the plays behind it, edit or delete them, or add one. -->
<script lang="ts">
	import type { Stat } from '$lib/sync/basketball';
	import type { Play } from '$lib/sync/types';
	import { boxScore, pct, periodLabel, playsOf, type Line } from './basketball';
	import { getApp } from './context.svelte';
	import GameHeader from './GameHeader.svelte';
	import GameStatus from './GameStatus.svelte';
	import { playersForGame } from './games';
	import { describePlay, shortNames } from './live';
	import PlaySheet from './PlaySheet.svelte';
	import { COLUMN_LABEL, COLUMNS, playsBehind, type Column, type Row } from './review';
	import Sheet from './Sheet.svelte';

	let { gameId }: { gameId: string } = $props();

	const app = getApp();
	const view = $derived(app.view);
	const game = $derived(view.games.get(gameId)!);
	const plays = $derived(playsOf(view, gameId));
	const box = $derived(boxScore(plays));
	const rows = $derived(playersForGame(view, game, plays));
	const names = $derived(shortNames(rows));
	const nameOf = (id: string) => names.get(id) ?? view.players.get(id)?.name ?? 'Player';
	const noPlayer = $derived(boxScore(plays.filter((p) => p.side === 'us' && !p.player_id)).team);
	const hasNoPlayer = $derived(plays.some((p) => p.side === 'us' && !p.player_id));
	// Fouls drawn are credited to players only, so the team's total is theirs added up.
	const teamFd = $derived([...box.players.values()].reduce((n, l) => n + l.fd, 0));

	/** The table's rows: players with a line (in roster order), then the totals. */
	const tableRows = $derived.by(() => {
		const out: { row: Row; label: string; jersey: string; line: Line; total?: boolean }[] = [];
		for (const r of rows) {
			const line = box.players.get(r.player.id);
			if (line) out.push({ row: { player: r.player.id }, label: nameOf(r.player.id), jersey: r.jersey, line });
		}
		if (hasNoPlayer) out.push({ row: 'no_player', label: 'No player', jersey: '', line: { ...noPlayer, ast: 0 } });
		out.push({ row: 'team', label: 'Total', jersey: '', line: { ...box.team, fd: teamFd }, total: true });
		out.push({ row: 'opponent', label: 'Opp', jersey: '', line: box.opponent, total: true });
		return out;
	});

	function cell(line: Line, col: Column): string {
		switch (col) {
			case 'fg':
				return `${line.fgm}-${line.fga}`;
			case 'tp':
				return `${line.tpm}-${line.tpa}`;
			case 'ft':
				return `${line.ftm}-${line.fta}`;
			default:
				return String(line[col]);
		}
	}

	// --- the plays behind a cell -----------------------------------------------------------

	let open = $state<{ row: Row; label: string; col: Column } | null>(null);
	let editing = $state<{ play: Play | null; preset: Partial<Play> } | null>(null);
	const behind = $derived(open ? playsBehind(plays, open.row, open.col) : []);

	/** What "Add a play" starts with for a cell: its row's side and player, and a matching stat. */
	function presetFor(row: Row, col: Column): Partial<Play> {
		const STAT: Record<Column, Stat> = {
			pts: 'fg2_made',
			fg: 'fg2_made',
			tp: 'fg3_made',
			ft: 'ft_made',
			oreb: 'oreb',
			dreb: 'dreb',
			reb: 'dreb',
			ast: 'fg2_made',
			stl: 'stl',
			blk: 'blk',
			tov: 'tov',
			pf: 'foul',
			fd: 'foul'
		};
		const player = typeof row === 'object' ? row.player : null;
		if (col === 'fd') return { side: 'them', stat: 'foul', drawn_by_player_id: player };
		if (col === 'ast') return { side: 'us', stat: 'fg2_made', assist_player_id: player };
		return { side: row === 'opponent' ? 'them' : 'us', player_id: player, stat: STAT[col] };
	}
</script>

<GameHeader {game} score={box.score} />

<main>
	<GameStatus {game} score={box.score} />

	<div class="tablewrap">
		<table class="box">
			<thead>
				<tr>
					<th class="who">Player</th>
					{#each COLUMNS as col (col)}<th class="n">{COLUMN_LABEL[col]}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each tableRows as r (typeof r.row === 'object' ? r.row.player : r.row)}
					<tr class:total={r.total}>
						<th class="who" class:opp={r.row === 'opponent'} scope="row">{#if r.jersey}<span class="jersey">{r.jersey}</span>{/if}{r.label}</th>
						{#each COLUMNS as col (col)}
							<td class="n">
								<button onclick={() => (open = { row: r.row, label: r.label, col })}>{cell(r.line, col)}</button>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="hint">
		FG {pct(box.team.fgm, box.team.fga) ?? '–'}% · 3PT {pct(box.team.tpm, box.team.tpa) ?? '–'}% · FT
		{pct(box.team.ftm, box.team.fta) ?? '–'}%. Tap any number to see the plays behind it.
	</p>
</main>

{#if editing}
	<PlaySheet {game} {plays} {rows} play={editing.play} preset={editing.preset} onclose={() => (editing = null)} />
{:else if open}
	<Sheet onclose={() => (open = null)}>
		<h2>{open.label} · {COLUMN_LABEL[open.col]}</h2>
		{#if behind.length}
			<ul class="dlist">
				{#each behind as p (p.id)}
					<li>
						<button class="drow" onclick={() => (editing = { play: p, preset: {} })}>
							<span>{describePlay(p, nameOf, game.opponent)}</span><span class="muted">{periodLabel(game.rules, p.period)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">No plays.</p>
		{/if}
		<button class="secondary wide" onclick={() => open && (editing = { play: null, preset: presetFor(open.row, open.col) })}>
			+ Add a play
		</button>
	</Sheet>
{/if}

<style>
	.box th.who {
		position: sticky;
		left: 0;
		background: var(--surface);
		z-index: 1;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.box tbody th.who {
		font-size: 15px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink);
		font-weight: 600;
	}
	.jersey {
		color: var(--muted);
		margin-right: 6px;
	}
	.box td,
	.box th {
		padding: 0 6px;
	}
	.box td button {
		width: 100%;
		min-width: 34px;
		background: none;
		border: 0;
		padding: 10px 2px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.box tr.total td,
	.box tr.total th {
		font-weight: 700;
		background: var(--bg);
	}
</style>
