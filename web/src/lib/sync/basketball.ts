// Basketball's stats and game rules, matching server/lib/courtside/basketball.ex. The
// shared cases in spec/mutations/ keep the two in step.

export const STATS = [
	'ft_made',
	'ft_missed',
	'fg2_made',
	'fg2_missed',
	'fg3_made',
	'fg3_missed',
	'oreb',
	'dreb',
	'stl',
	'blk',
	'tov',
	'foul'
] as const;
export type Stat = (typeof STATS)[number];

export const MADE_FIELD_GOALS: readonly Stat[] = ['fg2_made', 'fg3_made'];

export const FOUL_TYPES = ['personal', 'offensive', 'technical', 'flagrant'] as const;
export type FoulType = (typeof FOUL_TYPES)[number];

export interface Rules {
	periods: number;
	period_minutes: number;
	overtime_minutes: number;
	team_fouls_reset: 'period' | 'half';
	bonus_at: number;
	bonus: 'one_and_one' | 'two_shots';
	double_bonus_at: number | null;
	foul_out_at: number;
	technicals_to_eject: number;
}

/**
 * The rules a game uses when neither it nor its team says otherwise.
 *
 * PROVISIONAL: believed to be the current NFHS high school rules. Check them against
 * the rule book before games ship (plan, phase 2 step 4).
 */
export const DEFAULT_RULES: Rules = {
	periods: 4,
	period_minutes: 8,
	overtime_minutes: 4,
	team_fouls_reset: 'period',
	bonus_at: 5,
	bonus: 'two_shots',
	double_bonus_at: null,
	foul_out_at: 5,
	technicals_to_eject: 2
};

const positiveInteger = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
const positiveNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const oneOf = (list: unknown[]) => (v: unknown) => list.includes(v);

// In the server's order: the first problem found is the one reported.
const RULE_CHECKS: [keyof Rules, (v: unknown) => boolean][] = [
	['periods', positiveInteger],
	['period_minutes', positiveNumber],
	['overtime_minutes', positiveNumber],
	['team_fouls_reset', oneOf(['period', 'half'])],
	['bonus_at', positiveInteger],
	['bonus', oneOf(['one_and_one', 'two_shots'])],
	['double_bonus_at', (v) => v === null || positiveInteger(v)],
	['foul_out_at', positiveInteger],
	['technicals_to_eject', positiveInteger]
];

/** Null if `rules` is a valid rules object, otherwise the reason. */
export function rulesProblem(rules: unknown): string | null {
	if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) return 'Rules are invalid.';
	const known = RULE_CHECKS.map(([k]) => k as string);
	const extra = Object.keys(rules)
		.filter((k) => !known.includes(k))
		.sort();
	if (extra.length) return `Rules are invalid: ${extra[0]}`;
	for (const [key, ok] of RULE_CHECKS) {
		if (!(key in rules) || !ok((rules as Record<string, unknown>)[key])) return `Rules are invalid: ${key}`;
	}
	return null;
}

/** A period's length in seconds: regulation, or overtime after it. */
export const periodSeconds = (rules: Rules, period: number) =>
	Math.round((period <= rules.periods ? rules.period_minutes : rules.overtime_minutes) * 60);
