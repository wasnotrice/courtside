import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '$lib/sync/basketball';
import { apply } from '$lib/sync/mutators';
import { game, play, PROGRAM, structure } from '$lib/sync/testing/fixtures';
import { emptyState, type MutationInput } from '$lib/sync/types';
import { PRESETS } from './basketball';
import { choosePreset, draftOf, gamesOf, matchup, mismatchText, readRules, rulesName, rulesSummary, scoresByGame } from './games';

const build = (...changes: MutationInput[]) => [...structure(), ...changes].reduce(apply, emptyState());

describe('gamesOf', () => {
	it("lists the program's games in the season, newest first", () => {
		const otherProgram = crypto.randomUUID();
		const otherTeam = crypto.randomUUID();
		const state = build(
			game({ date: '2026-11-20', opponent: 'Lincoln' }),
			game({ date: '2027-01-08', opponent: 'Adams' }),
			game({ date: '2027-01-08', opponent: 'Central' }),
			{ name: 'season.put', args: { id: crypto.randomUUID(), name: '2027–28', starts_on: '2027-08-01', ends_on: '2028-07-31' } },
			game({ date: '2027-11-19', opponent: 'Next year' }),
			{ name: 'program.put', args: { id: otherProgram, name: "Boys' basketball", sport: 'basketball' } },
			{ name: 'team.put', args: { id: otherTeam, program_id: otherProgram, name: 'Varsity' } },
			game({ team_id: otherTeam, opponent: 'Not ours' })
		);
		const season = [...state.seasons.values()].find((s) => s.name === '2026–27')!;

		expect(gamesOf(state, PROGRAM, season).map((g) => g.opponent)).toEqual(['Adams', 'Central', 'Lincoln']);
		expect(gamesOf(state, PROGRAM).map((g) => g.opponent)).toEqual(['Next year', 'Adams', 'Central', 'Lincoln']);
	});
});

describe('matchup', () => {
	it('says vs, at or neutral', () => {
		expect(matchup({ opponent: 'Lincoln', home_away: 'home' })).toBe('vs Lincoln');
		expect(matchup({ opponent: 'Lincoln', home_away: 'away' })).toBe('at Lincoln');
		expect(matchup({ opponent: 'Lincoln', home_away: 'neutral' })).toBe('vs Lincoln (neutral)');
	});
});

describe('rules', () => {
	it('names and summarizes presets', () => {
		expect(rulesName(DEFAULT_RULES)).toBe('High school (NFHS)');
		expect(rulesSummary(DEFAULT_RULES)).toBe('4 × 8-min quarters · two shots from the 5th foul a quarter · out on 5 fouls');
		const men = PRESETS.find((p) => p.key === 'ncaa_men')!.rules;
		expect(rulesSummary(men)).toBe(
			'2 × 20-min halves · one-and-one from the 7th foul a half, two shots from the 10th · out on 5 fouls'
		);
		expect(rulesName({ ...DEFAULT_RULES, period_minutes: 6 })).toBe('Custom');
		const mn = PRESETS.find((p) => p.key === 'mshsl_varsity')!.rules;
		expect(rulesSummary(mn)).toBe(
			'2 × 18-min halves · one-and-one from the 7th foul a half, two shots from the 10th · out on 5 fouls'
		);
	});

	it('reads a preset draft as that preset', () => {
		for (const p of PRESETS) expect(readRules(draftOf(p.rules))).toEqual({ rules: p.rules });
	});

	it('starts custom from the preset it switched from', () => {
		const draft = choosePreset(draftOf(DEFAULT_RULES), 'custom');
		expect(draft.preset).toBe('custom');
		expect(readRules(draft)).toEqual({ rules: DEFAULT_RULES });
		expect(choosePreset(draft, 'ncaa_men').period_minutes).toBe('20');
	});

	it('reads custom rules, such as JV with 6-minute quarters', () => {
		const draft = { ...choosePreset(draftOf(DEFAULT_RULES), 'custom'), period_minutes: '6', overtime_minutes: '2' };
		expect(readRules(draft)).toEqual({ rules: { ...DEFAULT_RULES, period_minutes: 6, overtime_minutes: 2 } });
	});

	it('resets fouls by half with two halves', () => {
		const draft = { ...draftOf({ ...DEFAULT_RULES, period_minutes: 6 }), periods: '2' as const };
		expect(readRules(draft)).toEqual({ rules: { ...DEFAULT_RULES, period_minutes: 6, periods: 2, team_fouls_reset: 'half' } });
	});

	it('drops the double bonus when the bonus is two shots', () => {
		const draft = { ...draftOf({ ...DEFAULT_RULES, period_minutes: 6 }), double_bonus_at: '10' };
		expect(readRules(draft)).toEqual({ rules: { ...DEFAULT_RULES, period_minutes: 6 } });
	});

	it('says what is wrong with a custom draft', () => {
		const custom = draftOf({ ...DEFAULT_RULES, period_minutes: 6 });
		expect(readRules({ ...custom, period_minutes: '' })).toEqual({ err: 'Period length must be a number of minutes above 0.' });
		expect(readRules({ ...custom, foul_out_at: '4.5' })).toEqual({ err: 'Fouls to foul out must be a whole number above 0.' });
		expect(readRules({ ...custom, bonus: 'one_and_one', bonus_at: '7', double_bonus_at: '7' })).toEqual({
			err: 'The double bonus must start after the bonus.'
		});
	});
});

describe('the game list', () => {
	it("totals each game's points from its plays", () => {
		const g = game();
		const h = game({ opponent: 'Adams' });
		const state = build(
			g,
			h,
			play(g.args.id, { stat: 'fg3_made' }),
			play(g.args.id, { stat: 'ft_made' }),
			play(g.args.id, { side: 'them', stat: 'fg2_made' }),
			play(g.args.id, { side: 'them', stat: 'fg2_missed' }),
			play(h.args.id, { stat: 'foul' })
		);
		const scores = scoresByGame(state);
		expect(scores.get(g.args.id)).toEqual({ us: 4, them: 2, plays: 4 });
		expect(scores.get(h.args.id)).toEqual({ us: 0, them: 0, plays: 1 });
	});

	it('says what the plays are missing', () => {
		expect(mismatchText({ us: 2, them: 0 })).toBe('2 points missing for us');
		expect(mismatchText({ us: -1, them: 3 })).toBe('1 point extra for us, 3 points missing for them');
	});
});
