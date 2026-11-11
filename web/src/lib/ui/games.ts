// Games as the Games tab lists them, and game rules as the rules editor edits them.
// Pure functions over the sync view.

import { DEFAULT_RULES, rulesProblem, type Rules } from '$lib/sync/basketball';
import type { Game, Play, Season, State, Team } from '$lib/sync/types';
import { rosterOf, seasonOf, type RosterRow } from './domain';
import { ordinal, POINTS, PRESETS, presetOf } from './basketball';

/** The program's games in a season (all seasons if none), newest first. */
export function gamesOf(state: State, programId: string | undefined, season?: Season): Game[] {
	return [...state.games.values()]
		.filter(
			(g) =>
				state.teams.get(g.team_id)?.program_id === programId &&
				(!season || (g.date >= season.starts_on && g.date <= season.ends_on))
		)
		.sort((a, b) => b.date.localeCompare(a.date) || a.opponent.localeCompare(b.opponent));
}

/** "vs Lincoln", "at Lincoln", or "vs Lincoln (neutral)". */
export function matchup(game: Pick<Game, 'opponent' | 'home_away'>): string {
	if (game.home_away === 'away') return `at ${game.opponent}`;
	return game.home_away === 'neutral' ? `vs ${game.opponent} (neutral)` : `vs ${game.opponent}`;
}

/** The rules a new game for `team` starts with. */
export const teamRules = (team: Team | undefined): Rules => team?.default_rules ?? DEFAULT_RULES;

export const sameRules = (a: Rules, b: Rules) => (Object.keys(DEFAULT_RULES) as (keyof Rules)[]).every((k) => a[k] === b[k]);

/** The preset's name, or "Custom". */
export const rulesName = (rules: Rules) => presetOf(rules)?.name ?? 'Custom';

/** "4 × 8-min quarters · two shots from the 5th team foul · out on 5 fouls". */
export function rulesSummary(r: Rules): string {
	const periods = `${r.periods} × ${r.period_minutes}-min ${r.periods === 2 ? 'halves' : 'quarters'}`;
	const per = r.team_fouls_reset === 'period' && r.periods !== 2 ? 'quarter' : 'half';
	const bonus =
		r.bonus === 'two_shots'
			? `two shots from the ${ordinal(r.bonus_at)} foul a ${per}`
			: `one-and-one from the ${ordinal(r.bonus_at)} foul a ${per}` +
				(r.double_bonus_at !== null ? `, two shots from the ${ordinal(r.double_bonus_at)}` : '');
	return `${periods} · ${bonus} · out on ${r.foul_out_at} fouls`;
}


// --- the rules editor's draft ------------------------------------------------------------

/** What the rules editor holds: a preset, or custom values as typed. */
export interface RulesDraft {
	preset: string; // a preset key, or 'custom'
	periods: '4' | '2';
	period_minutes: string;
	overtime_minutes: string;
	team_fouls_reset: Rules['team_fouls_reset'];
	bonus_at: string;
	bonus: Rules['bonus'];
	double_bonus_at: string; // blank for none
	foul_out_at: string;
	technicals_to_eject: string;
}

/** A draft showing `rules`, or `preset`'s rules with that preset chosen. */
export function draftOf(rules: Rules, preset = presetOf(rules)?.key ?? 'custom'): RulesDraft {
	return {
		preset,
		periods: rules.periods === 2 ? '2' : '4',
		period_minutes: String(rules.period_minutes),
		overtime_minutes: String(rules.overtime_minutes),
		team_fouls_reset: rules.team_fouls_reset,
		bonus_at: String(rules.bonus_at),
		bonus: rules.bonus,
		double_bonus_at: rules.double_bonus_at === null ? '' : String(rules.double_bonus_at),
		foul_out_at: String(rules.foul_out_at),
		technicals_to_eject: String(rules.technicals_to_eject)
	};
}

/** The draft switched to another preset, its values filled from that preset (custom keeps them). */
export function choosePreset(draft: RulesDraft, key: string): RulesDraft {
	const preset = PRESETS.find((p) => p.key === key);
	return preset ? draftOf(preset.rules, key) : { ...draft, preset: 'custom' };
}

/** The rules a draft describes, or why it can't be saved. */
export function readRules(draft: RulesDraft): { rules: Rules } | { err: string } {
	const preset = PRESETS.find((p) => p.key === draft.preset);
	if (preset) return { rules: preset.rules };

	const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
	const minutes = (s: string, label: string) => {
		const n = num(s);
		return n > 0 ? n : `${label} must be a number of minutes above 0.`;
	};
	const count = (s: string, label: string) => {
		const n = num(s);
		return Number.isInteger(n) && n > 0 ? n : `${label} must be a whole number above 0.`;
	};

	const values = {
		period_minutes: minutes(draft.period_minutes, 'Period length'),
		overtime_minutes: minutes(draft.overtime_minutes, 'Overtime length'),
		bonus_at: count(draft.bonus_at, 'The bonus foul'),
		double_bonus_at: draft.double_bonus_at.trim() === '' ? null : count(draft.double_bonus_at, 'The double bonus foul'),
		foul_out_at: count(draft.foul_out_at, 'Fouls to foul out'),
		technicals_to_eject: count(draft.technicals_to_eject, 'Technicals to eject')
	};
	for (const v of Object.values(values)) if (typeof v === 'string') return { err: v };
	const v = values as { [K in keyof typeof values]: Exclude<(typeof values)[K], string> };

	const rules: Rules = {
		periods: Number(draft.periods),
		period_minutes: v.period_minutes,
		overtime_minutes: v.overtime_minutes,
		// With halves, fouls reset each half either way; 'half' matches the NCAA men's preset.
		team_fouls_reset: draft.periods === '2' ? 'half' : draft.team_fouls_reset,
		bonus_at: v.bonus_at,
		bonus: draft.bonus,
		double_bonus_at: draft.bonus === 'one_and_one' ? v.double_bonus_at : null,
		foul_out_at: v.foul_out_at,
		technicals_to_eject: v.technicals_to_eject
	};
	if (rules.double_bonus_at !== null && rules.double_bonus_at <= rules.bonus_at)
		return { err: 'The double bonus must start after the bonus.' };
	const problem = rulesProblem(rules);
	return problem ? { err: problem } : { rules };
}

// --- the game list's scores ---------------------------------------------------------------

/** Each game's score from its plays, and how many plays it has, in one pass over the plays. */
export function scoresByGame(state: State): Map<string, { us: number; them: number; plays: number }> {
	const out = new Map<string, { us: number; them: number; plays: number }>();
	for (const p of state.plays.values()) {
		const s = out.get(p.game_id) ?? out.set(p.game_id, { us: 0, them: 0, plays: 0 }).get(p.game_id)!;
		s.plays++;
		s[p.side] += POINTS[p.stat] ?? 0;
	}
	return out;
}

/** "2 points missing for us", from scoreMismatch's official minus plays. */
export function mismatchText(m: { us: number; them: number }): string {
	const part = (n: number, side: string) =>
		n === 0 ? null : `${Math.abs(n)} point${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'missing' : 'extra'} for ${side}`;
	return [part(m.us, 'us'), part(m.them, 'them')].filter(Boolean).join(', ');
}

// --- who can appear in a game -------------------------------------------------------------

/**
 * The players a game's screens offer: the team's roster for the game's season, by
 * jersey, then anyone else credited in its plays or in `extra` (call-ups from the
 * program), with no jersey.
 */
export function playersForGame(state: State, game: Game, plays: readonly Play[], extra: readonly string[] = []): RosterRow[] {
	const programId = state.teams.get(game.team_id)?.program_id;
	const out = rosterOf(state, programId, seasonOf(state, game.date)?.id, game.team_id);
	const have = new Set(out.map((r) => r.player.id));
	const add = (id: string | null) => {
		const player = id && !have.has(id) ? state.players.get(id) : undefined;
		if (player) {
			out.push({ player, jersey: '', teamIds: [] });
			have.add(player.id);
		}
	};
	for (const p of plays) [p.player_id, p.assist_player_id, p.drawn_by_player_id].forEach(add);
	extra.forEach(add);
	return out;
}
