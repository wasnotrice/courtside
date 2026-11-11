import { describe, expect, it } from 'vitest';
import type { Play } from '$lib/sync/types';
import { blockable, currentPeriod, describePlay, followUpFor, pairedPlay, reboundPlay, shortNames } from './live';

const p = (over: Partial<Play> = {}): Play => ({
	id: crypto.randomUUID(),
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
	position: 'a',
	recorded_at: 0,
	...over
});

describe('follow-up questions', () => {
	it('asks for an assist after our make, a rebound after any miss, and about fouls', () => {
		expect(followUpFor(p({ stat: 'fg3_made' }))).toBe('assist');
		expect(followUpFor(p({ stat: 'fg2_made', player_id: null }))).toBeNull();
		expect(followUpFor(p({ stat: 'ft_made' }))).toBeNull();
		expect(followUpFor(p({ stat: 'fg2_missed' }))).toBe('rebound');
		expect(followUpFor(p({ side: 'them', player_id: null, stat: 'ft_missed' }))).toBe('rebound');
		expect(followUpFor(p({ stat: 'foul' }))).toBe('foul_type');
		expect(followUpFor(p({ side: 'them', player_id: null, stat: 'foul' }))).toBe('drawn');
		expect(followUpFor(p({ side: 'them', player_id: null, stat: 'fg2_made' }))).toBeNull();
		expect(followUpFor(p({ stat: 'stl' }))).toBeNull();
		expect(followUpFor(p({ side: 'them', player_id: null, stat: 'tov' }))).toBeNull();
	});

	it('offer the other half of a steal and turnover, or a block and missed shot', () => {
		expect(followUpFor(p({ stat: 'tov' }))).toBe('steal');
		expect(followUpFor(p({ side: 'them', player_id: null, stat: 'stl' }))).toBe('turnover_by');
		expect(followUpFor(p({ stat: 'blk' }))).toBe('blocked_shot');
		expect(followUpFor(p({ side: 'them', player_id: null, stat: 'blk' }))).toBe('blocked_shot');
		expect(blockable(p({ stat: 'fg3_missed' }))).toBe(true);
		expect(blockable(p({ stat: 'ft_missed' }))).toBe(false);
	});
});

describe('pairs', () => {
	const them = (stat: Play['stat']) => p({ side: 'them', player_id: null, stat });
	it('turn our turnover into their steal, and their steal into our turnover', () => {
		expect(pairedPlay(p({ stat: 'tov' }))).toEqual({ side: 'them', player_id: null, stat: 'stl' });
		expect(pairedPlay(them('stl'), 'bea')).toEqual({ side: 'us', player_id: 'bea', stat: 'tov' });
		expect(pairedPlay(them('stl'), null)).toEqual({ side: 'us', player_id: null, stat: 'tov' });
	});

	it("turn a miss into the other side's block, and a block into the other side's miss", () => {
		expect(pairedPlay(p({ stat: 'fg3_missed' }))).toEqual({ side: 'them', player_id: null, stat: 'blk' });
		expect(pairedPlay(them('fg2_missed'), 'bea')).toEqual({ side: 'us', player_id: 'bea', stat: 'blk' });
		expect(pairedPlay(p({ stat: 'blk' }), 'bea', 'fg3_missed')).toEqual({ side: 'them', player_id: null, stat: 'fg3_missed' });
		expect(pairedPlay(them('blk'), 'bea', 'fg2_missed')).toEqual({ side: 'us', player_id: 'bea', stat: 'fg2_missed' });
	});
});

describe('rebounds', () => {
	it('are offensive when the shooting side keeps the ball', () => {
		expect(reboundPlay('us', { player: 'bea' })).toEqual({ side: 'us', player_id: 'bea', stat: 'oreb' });
		expect(reboundPlay('us', 'team')).toEqual({ side: 'us', player_id: null, stat: 'oreb' });
		expect(reboundPlay('us', 'them')).toEqual({ side: 'them', player_id: null, stat: 'dreb' });
		expect(reboundPlay('them', { player: 'bea' })).toEqual({ side: 'us', player_id: 'bea', stat: 'dreb' });
		expect(reboundPlay('them', 'them')).toEqual({ side: 'them', player_id: null, stat: 'oreb' });
	});
});

describe('the screen', () => {
	it('opens on the latest period with a play', () => {
		expect(currentPeriod([])).toBe(1);
		expect(currentPeriod([p({ period: 2 }), p({ period: 3 }), p({ period: 1 })])).toBe(3);
	});

	it('uses first names, adding a last initial where two match', () => {
		const row = (id: string, name: string) => ({ player: { id, program_id: 'x', name } });
		const names = shortNames([row('a', 'Sam Okafor'), row('b', 'sam Price'), row('c', 'Ava Lee'), row('d', 'Mia')]);
		expect([...names.values()]).toEqual(['Sam O.', 'sam P.', 'Ava', 'Mia']);
	});

	it('describes plays', () => {
		const nameOf = (id: string) => ({ ana: 'Ana', bea: 'Bea' })[id] ?? '?';
		expect(describePlay(p({ stat: 'fg2_made', assist_player_id: 'bea' }), nameOf)).toBe('Ana 2 ✓ (ast Bea)');
		expect(describePlay(p({ stat: 'foul', foul_type: 'offensive' }), nameOf)).toBe('Ana F (offensive)');
		expect(describePlay(p({ stat: 'foul', foul_type: 'personal' }), nameOf)).toBe('Ana F');
		expect(describePlay(p({ side: 'them', player_id: null, stat: 'foul', drawn_by_player_id: 'bea' }), nameOf)).toBe(
			'Them F (on Bea)'
		);
		expect(describePlay(p({ player_id: null }), nameOf)).toBe('Team DREB');
		expect(describePlay(p({ side: 'them', player_id: null, stat: 'fg3_missed' }), nameOf)).toBe('Them 3 ✗');
	});
});
