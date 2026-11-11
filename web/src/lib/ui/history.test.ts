import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '$lib/sync/types';
import { ago, changedSince, kindOf, revertOf, shownChanges } from './history';

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
	version: 1,
	client_id: 'a',
	mutation_id: 1,
	name: 'play.put',
	accepted: true,
	reason: null,
	changes: {},
	at: '2026-11-11T12:00:00Z',
	...over
});

const created = entry({ changes: { stat: [null, 'ft_made'], period: [null, 1], game_id: [null, 'g'] } });
const edited = entry({ changes: { period: [1, 2], assist_player_id: ['ana', null], recorded_at: [1, 2] } });

describe('kindOf', () => {
	it('tells creates, edits, deletes, restores and refusals apart', () => {
		expect(kindOf(created, true)).toBe('created');
		// A field set for the first time on a later edit also starts from null.
		expect(kindOf(entry({ changes: { clock: [null, 300] } }), false)).toBe('edited');
		expect(kindOf(edited, false)).toBe('edited');
		expect(kindOf(entry({ name: 'game.delete', changes: { deleted: [false, true] } }), false)).toBe('deleted');
		expect(kindOf(entry({ name: 'game.restore', changes: { deleted: [true, false] } }), false)).toBe('restored');
		expect(kindOf(entry({ accepted: false, reason: 'No', changes: null }), false)).toBe('refused');
	});
});

describe('shownChanges', () => {
	it('leaves out bookkeeping fields', () => {
		expect(shownChanges(edited)).toEqual([
			['period', 1, 2],
			['assist_player_id', 'ana', null]
		]);
	});
});

describe('revertOf', () => {
	it('sends back the before values of the fields an edit changed', () => {
		expect(revertOf('plays', 'p1', edited, false)).toEqual({
			name: 'play.put',
			args: { id: 'p1', period: 1, assist_player_id: 'ana' }
		});
		expect(revertOf('games', 'g1', entry({ changes: { status: ['live', 'final'] } }), false)).toEqual({
			name: 'game.put',
			args: { id: 'g1', status: 'live' }
		});
	});

	it('has nothing to revert for a create, a delete or a refusal', () => {
		expect(revertOf('plays', 'p1', created, true)).toBeNull();
		expect(revertOf('plays', 'p1', entry({ changes: { deleted: [false, true] } }), false)).toBeNull();
		expect(revertOf('plays', 'p1', entry({ accepted: false }), false)).toBeNull();
	});
});

describe('changedSince', () => {
	it('lists the fields that changed again after the edit', () => {
		expect(changedSince({ period: 2, assist_player_id: 'bo' }, edited)).toEqual([['assist_player_id', 'bo']]);
		expect(changedSince({ period: 2, assist_player_id: null }, edited)).toEqual([]);
	});

	it('compares rules by value', () => {
		const e = entry({ changes: { rules: [{ periods: 4 }, { periods: 2 }] } });
		expect(changedSince({ rules: { periods: 2 } }, e)).toEqual([]);
	});
});

describe('ago', () => {
	const now = new Date('2026-11-11T12:00:00Z').getTime();
	it('says how long ago', () => {
		expect(ago('2026-11-11T11:59:50Z', now)).toBe('Just now');
		expect(ago('2026-11-11T11:55:00Z', now)).toBe('5 min ago');
		expect(ago('2026-11-11T09:00:00Z', now)).toBe('3 h ago');
	});
});
