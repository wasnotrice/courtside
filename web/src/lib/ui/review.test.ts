import { describe, expect, it } from 'vitest';
import type { Play } from '$lib/sync/types';
import { boxScore } from './basketball';
import { byPeriod, COLUMNS, fmtClock, hints, parseTime, playsBehind, type Column, type Row } from './review';

let n = 0;
const p = (over: Partial<Play> = {}): Play => ({
	id: `p${++n}`,
	game_id: 'g',
	side: 'us',
	player_id: 'ana',
	stat: 'dreb',
	foul_type: null,
	assist_player_id: null,
	drawn_by_player_id: null,
	period: 1,
	clock: null,
	video_at: null,
	position: String(n).padStart(4, '0'),
	recorded_at: 0,
	...over
});
const them = (over: Partial<Play> = {}) => p({ side: 'them', player_id: null, ...over });

describe('the play-by-play', () => {
	it('groups plays by period in order', () => {
		const a = p({ period: 1 });
		const b = p({ period: 2 });
		const c = p({ period: 1 });
		expect(byPeriod([a, b, c]).map((g) => [g.period, g.plays.map((x) => x.id)])).toEqual([
			[1, [a.id, c.id]],
			[2, [b.id]]
		]);
	});

	it('hints at shots with no player and clocks that run backward', () => {
		const shot = p({ player_id: null, stat: 'fg2_made' });
		const reb = p({ player_id: null, stat: 'dreb' });
		const early = p({ clock: 300 });
		const later = p({ clock: 420 });
		const next = p({ period: 2, clock: 470 });
		const h = hints([shot, reb, early, later, next]);
		expect(h.get(shot.id)).toBe('No player: fix from film');
		expect(h.has(reb.id)).toBe(false);
		expect(h.get(later.id)).toBe('Clock is out of order');
		expect(h.has(next.id)).toBe(false);
	});
});

describe('times', () => {
	it('reads and writes minutes and seconds', () => {
		expect(parseTime('5:07')).toBe(307);
		expect(parseTime('1:02:03')).toBe(3723);
		expect(parseTime('45')).toBe(45);
		expect(parseTime('')).toBeNull();
		expect(parseTime('5:75')).toBeNaN();
		expect(parseTime('abc')).toBeNaN();
		expect(fmtClock(307)).toBe('5:07');
		expect(fmtClock(3723)).toBe('1:02:03');
	});
});

describe('playsBehind', () => {
	const plays = [
		p({ stat: 'fg3_made', assist_player_id: 'bea' }),
		p({ stat: 'fg2_missed' }),
		p({ player_id: 'bea', stat: 'ft_made' }),
		p({ player_id: null, stat: 'fg2_made' }),
		p({ stat: 'foul', foul_type: 'offensive' }),
		p({ stat: 'tov' }),
		them({ stat: 'foul', drawn_by_player_id: 'bea' }),
		them({ stat: 'fg2_made' }),
		them({ stat: 'oreb' })
	];
	const ids = (row: Row, col: Column) => playsBehind(plays, row, col).map((x) => plays.indexOf(x));

	it('finds the plays behind a cell', () => {
		expect(ids({ player: 'ana' }, 'fg')).toEqual([0, 1]);
		expect(ids({ player: 'ana' }, 'tov')).toEqual([4, 5]);
		expect(ids({ player: 'bea' }, 'ast')).toEqual([0]);
		expect(ids({ player: 'bea' }, 'fd')).toEqual([6]);
		expect(ids('no_player', 'pts')).toEqual([3]);
		expect(ids('team', 'pts')).toEqual([0, 2, 3]);
		expect(ids('opponent', 'reb')).toEqual([8]);
	});

	it('agrees with the box score on every count', () => {
		const box = boxScore(plays);
		const count: Record<Column, (l: ReturnType<typeof boxScore>['team']) => number> = {
			pts: (l) => l.ftm + l.fgm,
			fg: (l) => l.fga,
			tp: (l) => l.tpa,
			ft: (l) => l.fta,
			oreb: (l) => l.oreb,
			dreb: (l) => l.dreb,
			reb: (l) => l.reb,
			ast: (l) => l.ast,
			stl: (l) => l.stl,
			blk: (l) => l.blk,
			tov: (l) => l.tov,
			pf: (l) => l.pf,
			fd: (l) => l.fd
		};
		for (const col of COLUMNS) {
			expect(playsBehind(plays, { player: 'ana' }, col).length, col).toBe(count[col](box.players.get('ana')!));
			expect(playsBehind(plays, { player: 'bea' }, col).length, col).toBe(count[col](box.players.get('bea')!));
			if (col !== 'fd') expect(playsBehind(plays, 'team', col).length, col).toBe(count[col](box.team));
			expect(playsBehind(plays, 'opponent', col).length, col).toBe(col === 'ast' || col === 'fd' ? 0 : count[col](box.opponent));
		}
	});
});
