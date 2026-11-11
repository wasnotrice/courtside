import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, rulesProblem } from '$lib/sync/basketball';
import type { Play } from '$lib/sync/types';
import {
	bonusFor,
	boxScore,
	foulPeriodOf,
	foulTrouble,
	periodLabel,
	positionAtEnd,
	positionBetween,
	PRESETS,
	presetOf,
	scoreMismatch,
	teamFouls
} from './basketball';

let n = 0;
const p = (over: Partial<Play>): Play => ({
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
	position: 'a',
	recorded_at: 0,
	...over
});
const foul = (side: Play['side'], period: number, over: Partial<Play> = {}) =>
	p({ side, period, stat: 'foul', foul_type: 'personal', player_id: side === 'us' ? 'ana' : null, ...over });

const nfhs = PRESETS.find((x) => x.key === 'nfhs')!.rules;
const men = PRESETS.find((x) => x.key === 'ncaa_men')!.rules;
const old = PRESETS.find((x) => x.key === 'nfhs_pre_2023')!.rules;

describe('presets', () => {
	it('are all valid rules, and recognized again', () => {
		for (const preset of PRESETS) {
			expect(rulesProblem(preset.rules)).toBeNull();
			expect(presetOf({ ...preset.rules })?.key).toBe(preset.key);
		}
		expect(presetOf({ ...DEFAULT_RULES, period_minutes: 7 })).toBeNull();
	});

	it('label periods as quarters, halves and overtimes', () => {
		expect(periodLabel(nfhs, 2)).toBe('Q2');
		expect(periodLabel(men, 2)).toBe('H2');
		expect(periodLabel(nfhs, 5)).toBe('OT');
		expect(periodLabel(men, 4)).toBe('2OT');
	});
});

describe('positionBetween', () => {
	it('keeps 1,000 random insertions in order with no duplicates', () => {
		const keys: string[] = [];
		let seed = 7;
		const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
		for (let i = 0; i < 1000; i++) {
			const at = Math.floor(rand() * (keys.length + 1));
			const key = positionBetween(keys[at - 1] ?? null, keys[at] ?? null);
			keys.splice(at, 0, key);
		}
		expect([...keys].sort()).toEqual(keys);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys.every((k) => !k.endsWith('0'))).toBe(true);
	});

	it('live plays are keyed by time: short, in order, and safe when the clock goes back', () => {
		const plays: Play[] = [];
		const start = Date.UTC(2026, 10, 20, 19);
		for (let i = 0; i < 500; i++) plays.push(p({ position: positionAtEnd(plays, start + i * 6000) }));
		// A phone whose clock is a minute behind still adds after the last play.
		plays.push(p({ position: positionAtEnd(plays, start) }));

		const keys = plays.map((x) => x.position);
		expect([...keys].sort()).toEqual(keys);
		expect(new Set(keys).size).toBe(keys.length);
		expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(11);
		// And a film correction still fits between two of them.
		const between = positionBetween(keys[10], keys[11]);
		expect(between > keys[10] && between < keys[11]).toBe(true);
	});

	it('refuses bounds in the wrong order', () => {
		expect(() => positionBetween('b', 'a')).toThrow();
	});
});

describe('boxScore', () => {
	it('adds up points, shooting, rebounds, assists and the score', () => {
		const box = boxScore([
			p({ stat: 'fg3_made', assist_player_id: 'bea' }),
			p({ stat: 'fg2_missed' }),
			p({ stat: 'ft_made' }),
			p({ stat: 'ft_missed' }),
			p({ stat: 'oreb' }),
			p({ player_id: null, stat: 'dreb' }),
			p({ side: 'them', player_id: null, stat: 'fg2_made' })
		]);
		expect(box.players.get('ana')).toMatchObject({ pts: 4, fgm: 1, fga: 2, tpm: 1, tpa: 1, ftm: 1, fta: 2, oreb: 1, reb: 1 });
		expect(box.players.get('bea')).toMatchObject({ ast: 1, pts: 0 });
		expect(box.team).toMatchObject({ pts: 4, reb: 2, ast: 1 });
		expect(box.score).toEqual({ us: 4, them: 2 });
	});

	it('counts an offensive foul as a foul and a turnover, and credits fouls drawn', () => {
		const box = boxScore([
			foul('us', 1, { foul_type: 'offensive' }),
			foul('them', 1, { drawn_by_player_id: 'bea' })
		]);
		expect(box.players.get('ana')).toMatchObject({ pf: 1, tov: 1 });
		expect(box.players.get('bea')).toMatchObject({ fd: 1 });
		expect(box.opponent.pf).toBe(1);
	});

	it('flags a mismatch with the official score', () => {
		const game = { official_us: 54, official_them: 48 } as never;
		expect(scoreMismatch(game, { us: 52, them: 48 })).toEqual({ us: 2, them: 0 });
		expect(scoreMismatch(game, { us: 54, them: 48 })).toBeNull();
		expect(scoreMismatch({ official_us: null, official_them: null } as never, { us: 0, them: 0 })).toBeNull();
	});
});

describe('team fouls and the bonus', () => {
	it('reset each quarter (NFHS), but carry from the fourth quarter into overtime', () => {
		expect([1, 2, 3, 4, 5, 6].map((q) => foulPeriodOf(nfhs, q))).toEqual([1, 2, 3, 4, 4, 4]);
		expect([1, 2, 3, 4, 5].map((q) => foulPeriodOf(old, q))).toEqual([1, 1, 2, 2, 2]);
		expect([1, 2, 3].map((h) => foulPeriodOf(men, h))).toEqual([1, 2, 2]);
	});

	it('NFHS: two shots from the fifth foul in a quarter', () => {
		const plays = [1, 2, 3, 4].map(() => foul('them', 2));
		expect(teamFouls(plays, nfhs, 'them', 2)).toBe(4);
		expect(teamFouls(plays, nfhs, 'them', 3)).toBe(0);
		// The next foul is the fifth: we shoot two.
		expect(bonusFor(plays, nfhs, 'us', 2)).toBe('two_shots');
		expect(bonusFor(plays.slice(1), nfhs, 'us', 2)).toBe('none');
		expect(bonusFor(plays, nfhs, 'us', 3)).toBe('none');
	});

	it('NCAA men: one-and-one from the seventh foul in a half, two shots from the tenth', () => {
		const six = Array.from({ length: 6 }, () => foul('us', 2));
		expect(bonusFor(six, men, 'them', 2)).toBe('one_and_one');
		const nine = Array.from({ length: 9 }, () => foul('us', 2));
		expect(bonusFor(nine, men, 'them', 3)).toBe('two_shots'); // overtime continues the second half
	});

	it('technicals and bench fouls count toward team fouls', () => {
		const plays = [foul('us', 1, { foul_type: 'technical' }), foul('us', 1, { player_id: null, foul_type: 'technical' })];
		expect(teamFouls(plays, nfhs, 'us', 1)).toBe(2);
	});
});

describe('foulTrouble', () => {
	it('fouls out on the fifth foul of any type', () => {
		const plays = [foul('us', 1), foul('us', 2), foul('us', 3, { foul_type: 'offensive' }), foul('us', 3, { foul_type: 'technical' })];
		expect(foulTrouble(plays, nfhs, 'ana')).toMatchObject({ fouls: 4, fouledOut: false });
		expect(foulTrouble([...plays, foul('us', 4)], nfhs, 'ana')).toMatchObject({ fouls: 5, fouledOut: true });
	});

	it('is ejected after two technicals or one flagrant', () => {
		const two = [foul('us', 1, { foul_type: 'technical' }), foul('us', 2, { foul_type: 'technical' })];
		expect(foulTrouble(two, nfhs, 'ana')).toMatchObject({ technicals: 2, ejected: true });
		expect(foulTrouble([foul('us', 1, { foul_type: 'flagrant' })], nfhs, 'ana').ejected).toBe(true);
		expect(foulTrouble([foul('us', 1, { foul_type: 'technical' })], nfhs, 'ana').ejected).toBe(false);
	});
});
