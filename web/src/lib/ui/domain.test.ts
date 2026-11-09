import { describe, expect, it } from 'vitest';
import { apply } from '$lib/sync/mutators';
import { player, PROGRAM, SEASON, structure } from '$lib/sync/testing/fixtures';
import { emptyState } from '$lib/sync/types';
import {
	changedFields,
	ensureSeason,
	fmtTime,
	parseNum,
	parseRoster,
	readSetup,
	rosterOf,
	schoolYear,
	setupText
} from './domain';

describe('parseRoster', () => {
	it('reads jersey-first, jersey-last and name-only lines', () => {
		expect(parseRoster('23 Jordan Reyes\n#5, Sam Okafor\nAlex Chen 11\n\nMaya')).toEqual([
			{ jersey: '23', name: 'Jordan Reyes' },
			{ jersey: '5', name: 'Sam Okafor' },
			{ jersey: '11', name: 'Alex Chen' },
			{ jersey: '', name: 'Maya' }
		]);
	});
});

describe('numbers', () => {
	it('parses minutes:seconds', () => {
		expect(parseNum('1:35.5')).toBe(95.5);
		expect(parseNum('1:75')).toBeNaN();
		expect(parseNum('')).toBeNull();
	});

	it('formats times', () => {
		expect(fmtTime(95.5)).toBe('1:35.5');
		expect(fmtTime(9.25)).toBe('9.3');
	});

	it('reads setups per kind', () => {
		expect(readSetup('makes', '')).toEqual({ err: 'Enter the number of shots.' });
		expect(readSetup('makes', '2.5')).toEqual({ err: 'Shots must be a whole number.' });
		expect(readSetup('time', '')).toEqual({ v: null });
		expect(readSetup('count', '1:00')).toEqual({ v: 60 });
		expect(setupText('count', 90)).toBe('1:30 long');
	});
});

describe('seasons', () => {
	it('puts a date in its August-to-July school year', () => {
		expect(schoolYear('2026-11-06')).toEqual({ name: '2026–27', starts_on: '2026-08-01', ends_on: '2027-07-31' });
		expect(schoolYear('2027-07-31').name).toBe('2026–27');
		expect(schoolYear('2027-08-01').name).toBe('2027–28');
	});

	it('creates a season only when none includes the date', () => {
		const state = structure().reduce(apply, emptyState());
		expect(ensureSeason(state, '2026-11-06')).toEqual([]);
		expect(ensureSeason(state, '2027-09-01')).toEqual([
			{ name: 'season.put', args: { id: expect.any(String), name: '2027–28', starts_on: '2027-08-01', ends_on: '2028-07-31' } }
		]);
	});
});

describe('rosterOf', () => {
	it("lists a season's players by jersey, with the jersey from their highest team", () => {
		const jv = crypto.randomUUID();
		const varsity = crypto.randomUUID();
		const ana = player({ name: 'Ana' });
		const bea = player({ name: 'Bea' });
		const entry = (team: string, p: string, jersey: string) =>
			({ name: 'roster.put', args: { id: crypto.randomUUID(), team_id: team, season_id: SEASON, player_id: p, jersey } }) as const;

		const state = [
			...structure(),
			{ name: 'team.put', args: { id: jv, program_id: PROGRAM, name: 'JV' } } as const,
			{ name: 'team.put', args: { id: varsity, program_id: PROGRAM, name: 'Varsity' } } as const,
			ana,
			bea,
			entry(jv, ana.args.id, '30'),
			entry(varsity, ana.args.id, '3'),
			entry(jv, bea.args.id, '12')
		].reduce(apply, emptyState());

		const all = rosterOf(state, PROGRAM, SEASON);
		expect(all.map((r) => [r.player.name, r.jersey, r.teamIds.length])).toEqual([
			['Ana', '3', 2],
			['Bea', '12', 1]
		]);
		expect(rosterOf(state, PROGRAM, SEASON, jv).map((r) => [r.player.name, r.jersey])).toEqual([
			['Bea', '12'],
			['Ana', '30']
		]);
	});
});

describe('changedFields', () => {
	it('keeps only what changed, plus the id', () => {
		const before = { id: 'p', program_id: 'g', name: 'Ana' };
		expect(changedFields(before, { ...before, name: 'Ana B' })).toEqual({ id: 'p', name: 'Ana B' });
		expect(changedFields(before, { ...before })).toBeNull();
		expect(changedFields(undefined, before)).toEqual(before);
	});
});
