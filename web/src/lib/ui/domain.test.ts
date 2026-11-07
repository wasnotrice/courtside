import { describe, expect, it } from 'vitest';
import { fmtTime, parseNum, parseRoster, readSetup, setupText } from './domain';

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
