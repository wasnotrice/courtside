// The live screen's logic: what each button records, which follow-up question a play
// asks, and how plays read in the recent list. Pure functions; LiveView does the taps.

import type { Rules, Stat } from '$lib/sync/basketball';
import { bonusFor } from './basketball';
import type { Play } from '$lib/sync/types';
import type { RosterRow } from './domain';

/** Short labels for the stat buttons and the play list. */
export const STAT_LABEL: Record<Stat, string> = {
	ft_made: 'FT ✓',
	ft_missed: 'FT ✗',
	fg2_made: '2 ✓',
	fg2_missed: '2 ✗',
	fg3_made: '3 ✓',
	fg3_missed: '3 ✗',
	oreb: 'OREB',
	dreb: 'DREB',
	stl: 'STL',
	blk: 'BLK',
	tov: 'TO',
	foul: 'F'
};

/**
 * The stat pad, in two rows. Both teams get the same one, every button in the same
 * place, so the scorer's hands learn one layout.
 */
export const STAT_PAD: Stat[] = [
	...['ft_made', 'ft_missed', 'fg2_made', 'fg2_missed', 'fg3_made', 'fg3_missed'],
	...['oreb', 'dreb', 'stl', 'blk', 'tov', 'foul']
] as Stat[];

/**
 * The live screen's pad: shots in make/miss pairs, then everything else. One rebound
 * key (offensive or defensive comes from the last miss) and a free-throw key that opens
 * the trip, since free throws come at a slower pace.
 */
export const SHOT_KEYS = [
	['fg2_made', 'fg2_missed'],
	['fg3_made', 'fg3_missed']
] as const satisfies readonly (readonly Stat[])[];
export type OtherKey = 'reb' | 'stl' | 'blk' | 'tov' | 'foul' | 'ft';
export const OTHER_KEYS: OtherKey[] = ['reb', 'stl', 'blk', 'tov', 'foul', 'ft'];
export const OTHER_LABEL: Record<OtherKey, string> = { reb: 'REB', stl: 'STL', blk: 'BLK', tov: 'TO', foul: 'F', ft: 'FT' };

/**
 * A rebound for `side` with no miss to hang it on: offensive if the last miss was
 * `side`'s own, defensive otherwise (and when nothing has been missed yet).
 */
export function reboundStat(plays: readonly Pick<Play, 'side' | 'stat'>[], side: Play['side']): 'oreb' | 'dreb' {
	const miss = plays.findLast((p) => MISSES.includes(p.stat));
	return miss?.side === side ? 'oreb' : 'dreb';
}

/** A free-throw trip: how many shots, and whether a miss on the first ends it. */
export interface Trip {
	shots: number;
	oneAndOne: boolean;
}

/**
 * The trip `side` is most likely shooting, from the play just before it: one shot after
 * its own make (an and-one), the bonus after a common foul by the other team, and two
 * otherwise. The scorer can add a shot or stop early.
 */
export function tripFor(plays: readonly Play[], rules: Rules, side: Play['side'], period: number): Trip {
	const last = plays.at(-1);
	if (last?.side === side && (last.stat === 'fg2_made' || last.stat === 'fg3_made')) return { shots: 1, oneAndOne: false };
	if (last && last.side !== side && last.stat === 'foul' && (last.foul_type ?? 'personal') === 'personal') {
		if (bonusFor(plays.slice(0, -1), rules, side, period) === 'one_and_one') return { shots: 2, oneAndOne: true };
	}
	return { shots: 2, oneAndOne: false };
}

const MISSES: Stat[] = ['ft_missed', 'fg2_missed', 'fg3_missed'];

/** A missed field goal can have been blocked; a missed free throw can't. */
export const blockable = (play: Pick<Play, 'stat'>) => play.stat === 'fg2_missed' || play.stat === 'fg3_missed';

/**
 * The skippable question asked after a play, if any. Steals and turnovers, and blocks
 * and missed shots, come in pairs: whichever half is recorded, the question offers the
 * other.
 */
export type FollowUp =
	| 'assist' // our make: who passed
	| 'rebound' // any miss: who rebounded (and, for a field goal, "Blocked")
	| 'foul_type' // our foul: offensive, technical or flagrant
	| 'drawn' // their foul: who was fouled
	| 'steal' // our turnover: did they steal it
	| 'turnover_by' // their steal: who lost it
	| 'blocked_shot'; // a block: the other side's missed shot

export function followUpFor(play: Pick<Play, 'side' | 'stat' | 'player_id'>): FollowUp | null {
	if (MISSES.includes(play.stat)) return 'rebound';
	if (play.stat === 'blk') return 'blocked_shot';
	if (play.side === 'them') {
		if (play.stat === 'foul') return 'drawn';
		if (play.stat === 'stl') return 'turnover_by';
		return null;
	}
	if (play.stat === 'foul') return 'foul_type';
	if (play.stat === 'tov') return 'steal';
	// An assist needs a shooter to differ from; a team make gets no prompt.
	if ((play.stat === 'fg2_made' || play.stat === 'fg3_made') && play.player_id) return 'assist';
	return null;
}

const other = (side: Play['side']): Play['side'] => (side === 'us' ? 'them' : 'us');

type PlayFields = Pick<Play, 'side' | 'player_id' | 'stat'>;

/**
 * The other half of a pair: the steal for a turnover, the turnover for a steal, the
 * block for a missed shot, or the missed shot for a block. `player` is our player when
 * the new play is ours (null for Team); `shot` is which miss, for a block's shot.
 */
export function pairedPlay(
	play: PlayFields,
	player: string | null = null,
	shot: 'fg2_missed' | 'fg3_missed' = 'fg2_missed'
): PlayFields {
	const side = other(play.side);
	const stat: Stat = play.stat === 'tov' ? 'stl' : play.stat === 'stl' ? 'tov' : play.stat === 'blk' ? shot : 'blk';
	return { side, player_id: side === 'us' ? player : null, stat };
}

/** Who got the rebound of a miss: one of our players, our team, or theirs. */
export type Rebounder = { player: string } | 'team' | 'them';

/** The rebound play for a miss by `missedBy`: offensive if the shooting side kept it. */
export function reboundPlay(missedBy: Play['side'], by: Rebounder): Pick<Play, 'side' | 'player_id' | 'stat'> {
	const side = by === 'them' ? 'them' : 'us';
	return {
		side,
		player_id: typeof by === 'object' ? by.player : null,
		stat: side === missedBy ? 'oreb' : 'dreb'
	};
}

/** The period to record in when the screen opens: the latest one with a play. */
export const currentPeriod = (plays: readonly Play[]) => plays.reduce((n, p) => Math.max(n, p.period), 1);

/**
 * Button names for the players: first names, with a last initial where two share one
 * ("Sam O.", "Sam P.").
 */
export function shortNames(rows: readonly Pick<RosterRow, 'player'>[]): Map<string, string> {
	const parts = rows.map((r) => r.player.name.trim().split(/\s+/));
	const firstCount = new Map<string, number>();
	for (const [first] of parts) firstCount.set(first.toLowerCase(), (firstCount.get(first.toLowerCase()) ?? 0) + 1);
	return new Map(
		rows.map((r, i) => {
			const [first, ...rest] = parts[i];
			const last = rest.at(-1);
			return [r.player.id, (firstCount.get(first.toLowerCase()) ?? 0) > 1 && last ? `${first} ${last[0]}.` : first];
		})
	);
}

const FOUL_LABEL = { personal: '', offensive: ' (offensive)', technical: ' (technical)', flagrant: ' (flagrant)' } as const;

/**
 * "Ava 2 ✓ (ast Riley)", "Lincoln F (on Sam)", "Team DREB". The other team's plays use
 * its name; the buttons say Opp.
 */
export function describePlay(play: Play, nameOf: (id: string) => string, opponent = 'Opp'): string {
	const who = play.side === 'them' ? opponent.trim() || 'Opp' : play.player_id ? nameOf(play.player_id) : 'Team';
	let what = STAT_LABEL[play.stat];
	if (play.stat === 'foul' && play.foul_type) what += FOUL_LABEL[play.foul_type];
	if (play.assist_player_id) what += ` (ast ${nameOf(play.assist_player_id)})`;
	if (play.drawn_by_player_id) what += ` (on ${nameOf(play.drawn_by_player_id)})`;
	return `${who} ${what}`;
}
