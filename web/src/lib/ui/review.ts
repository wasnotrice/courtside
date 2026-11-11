// The review screens' logic: the play-by-play by period, hints worth fixing from film,
// clock and film times as typed, and which plays sit behind a box score cell.

import type { Stat } from '$lib/sync/basketball';
import type { Play } from '$lib/sync/types';

/** The play-by-play split into periods, in order. */
export function byPeriod(plays: readonly Play[]): { period: number; plays: Play[] }[] {
	const out = new Map<number, Play[]>();
	for (const p of plays) out.set(p.period, [...(out.get(p.period) ?? []), p]);
	return [...out.entries()].sort(([a], [b]) => a - b).map(([period, plays]) => ({ period, plays }));
}

/** Stats a player makes, so one of ours with no player is worth fixing from film. */
const NEEDS_PLAYER: Stat[] = ['ft_made', 'ft_missed', 'fg2_made', 'fg2_missed', 'fg3_made', 'fg3_missed', 'stl', 'blk'];

/**
 * Hints, not rules: our shots, steals and blocks with no player, and clock times that
 * run backward (later in a period with more time left). Keyed by play id.
 */
export function hints(plays: readonly Play[]): Map<string, string> {
	const out = new Map<string, string>();
	const lastClock = new Map<number, number>();
	for (const p of plays) {
		if (p.side === 'us' && !p.player_id && NEEDS_PLAYER.includes(p.stat)) out.set(p.id, 'No player: fix from film');
		if (p.clock !== null) {
			const before = lastClock.get(p.period);
			if (before !== undefined && p.clock > before) out.set(p.id, 'Clock is out of order');
			lastClock.set(p.period, p.clock);
		}
	}
	return out;
}

// --- times ------------------------------------------------------------------------------

/** "5:07" for 307 seconds; "1:02:03" past an hour. */
export function fmtClock(seconds: number): string {
	const s = Math.floor(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Seconds from "m:ss", "h:mm:ss", or plain seconds. Blank is null; anything else
 * unreadable is NaN.
 */
export function parseTime(text: string): number | null {
	const t = text.trim();
	if (!t) return null;
	if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return NaN;
	const parts = t.split(':').map(Number);
	if (parts.slice(1).some((n) => n >= 60)) return NaN;
	return parts.reduce((total, n) => total * 60 + n, 0);
}

// --- box score cells ------------------------------------------------------------------------

/** Box score columns, in table order. */
export const COLUMNS = ['pts', 'fg', 'tp', 'ft', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fd'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABEL: Record<Column, string> = {
	pts: 'PTS',
	fg: 'FG',
	tp: '3PT',
	ft: 'FT',
	oreb: 'OREB',
	dreb: 'DREB',
	reb: 'REB',
	ast: 'AST',
	stl: 'STL',
	blk: 'BLK',
	tov: 'TO',
	pf: 'PF',
	fd: 'FD'
};

const STATS_OF: Record<Exclude<Column, 'ast' | 'fd' | 'tov'>, Stat[]> = {
	pts: ['ft_made', 'fg2_made', 'fg3_made'],
	fg: ['fg2_made', 'fg2_missed', 'fg3_made', 'fg3_missed'],
	tp: ['fg3_made', 'fg3_missed'],
	ft: ['ft_made', 'ft_missed'],
	oreb: ['oreb'],
	dreb: ['dreb'],
	reb: ['oreb', 'dreb'],
	stl: ['stl'],
	blk: ['blk'],
	pf: ['foul']
};

/** A box score row: one of our players, our plays with no player, all of ours, or theirs. */
export type Row = { player: string } | 'no_player' | 'team' | 'opponent';

/** The plays behind one cell, in play-by-play order. */
export function playsBehind(plays: readonly Play[], row: Row, column: Column): Play[] {
	// Whether a play credited to `id` (a player, or null for none) belongs to this row.
	const credited = (id: string | null) =>
		row === 'team' || row === 'opponent' || (row === 'no_player' ? id === null : id === row.player);

	return plays.filter((p) => {
		// Assists and fouls drawn count for the player credited, not the shooter or fouler,
		// and only on our side.
		if (column === 'ast' || column === 'fd') {
			if (row === 'opponent' || row === 'no_player') return false;
			if (column === 'ast') return p.assist_player_id !== null && credited(p.assist_player_id);
			return p.side === 'them' && p.stat === 'foul' && p.drawn_by_player_id !== null && credited(p.drawn_by_player_id);
		}
		if (p.side !== (row === 'opponent' ? 'them' : 'us') || !credited(p.player_id)) return false;
		if (column === 'tov') return p.stat === 'tov' || (p.stat === 'foul' && p.foul_type === 'offensive');
		return STATS_OF[column].includes(p.stat);
	});
}
