// Display rules for drills and results, ported from docs/prototype.html. Pure
// functions over the sync view; nothing here writes.

import { resultKey, type Drill, type Kind, type Player, type Result, type Run, type State } from '$lib/sync/types';

export const KINDS: Record<
	Kind,
	{
		name: string;
		hint: string;
		setupKey: string;
		setupWord: string;
		setupField: string;
		valueWord: string;
		needSetup: boolean;
		presets: number[];
	}
> = {
	makes: {
		name: 'Makes',
		hint: 'Made X of N shots. Higher % is better.',
		setupKey: 'Shots',
		setupWord: 'shots',
		setupField: 'Shots per player',
		valueWord: 'makes',
		needSetup: true,
		presets: [25, 30, 50, 100]
	},
	count: {
		name: 'Count',
		hint: 'Reps or score in a set length of time. Higher is better.',
		setupKey: 'Length',
		setupWord: 'seconds',
		setupField: 'Length in seconds (optional)',
		valueWord: 'reps or score',
		needSetup: false,
		presets: [30, 60, 90, 120]
	},
	time: {
		name: 'Time',
		hint: 'Seconds to finish a set number of reps. Lower is better.',
		setupKey: 'Reps',
		setupWord: 'reps',
		setupField: 'Reps (optional)',
		valueWord: 'seconds, e.g. 95.5 = 1:35.5',
		needSetup: false,
		presets: [1, 3, 5, 10]
	}
};

// --- formatting ----------------------------------------------------------------

export function todayISO() {
	const d = new Date();
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const r1 = (n: number) => String(Math.round(n * 10) / 10);
export const pct = (x: number) => Math.round(x * 100) + '%';

export function fmtTime(sec: number) {
	sec = Math.round(sec * 10) / 10;
	if (sec < 60) return r1(sec);
	const m = Math.floor(sec / 60);
	const s = Math.round((sec - m * 60) * 10) / 10;
	return m + ':' + (s < 10 ? '0' : '') + r1(s);
}

export function fmtDate(iso: string) {
	try {
		return new Date(iso + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
	} catch {
		return iso;
	}
}

export function setupText(kind: Kind, setup: number | null) {
	if (setup == null) return kind === 'count' ? 'No set length' : 'No set reps';
	if (kind === 'makes') return `Out of ${setup}`;
	if (kind === 'count') return setup < 60 ? `${r1(setup)}s long` : `${fmtTime(setup)} long`;
	return `${r1(setup)} reps`;
}

export const fmtValue = (kind: Kind, v: number) => (kind === 'time' ? fmtTime(v) : r1(v));

/** "95.5" or "1:35.5" → seconds. Null for blank, NaN for nonsense. */
export function parseNum(str: string): number | null {
	const s = String(str ?? '').trim();
	if (!s) return null;
	if (s.includes(':')) {
		const [m, sec] = s.split(':').map(Number);
		return Number.isFinite(m) && Number.isFinite(sec) && sec < 60 ? m * 60 + sec : NaN;
	}
	const n = Number(s);
	return Number.isFinite(n) ? n : NaN;
}

export function readSetup(kind: Kind, str: string): { v: number | null } | { err: string } {
	const s = String(str ?? '').trim();
	if (!s) return KINDS[kind].needSetup ? { err: `Enter the number of ${KINDS[kind].setupWord}.` } : { v: null };
	const n = parseNum(s);
	if (n === null || !(n > 0)) return { err: 'Enter a number above zero.' };
	if (kind === 'makes' && !Number.isInteger(n)) return { err: 'Shots must be a whole number.' };
	return { v: n };
}

/** "23 Jordan Reyes", "#5, Sam Okafor", "Alex Chen 11" or just a name, one per line. */
export function parseRoster(text: string) {
	return text
		.split(/\n+/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => {
			let m = l.match(/^#?(\d{1,3})[\s,.\-–]+(.+)$/);
			if (m) return { jersey: m[1], name: m[2].trim() };
			m = l.match(/^(.+?)[\s,]+#?(\d{1,3})$/);
			if (m) return { jersey: m[2], name: m[1].trim() };
			return { jersey: '', name: l };
		});
}

// --- queries -------------------------------------------------------------------

const jnum = (j: string) => (j === '' || j == null ? 999 : Number.isFinite(+j) ? +j : 998);
export const byJersey = (a: Player, b: Player) => jnum(a.jersey) - jnum(b.jersey) || a.name.localeCompare(b.name);

/** Active players, plus inactive ones in `keep` (so their old results still show). */
export function roster(state: State, keep?: Set<string>) {
	return [...state.players.values()].filter((p) => p.active || keep?.has(p.id)).sort(byJersey);
}

/** A player's row in a run, value or not (it may only carry a setup override). */
export const entry = (state: State, runId: string, playerId: string): Result | undefined =>
	state.results.get(resultKey(runId, playerId));

/** Results with a value, by player id. */
export function results(state: State, runId: string) {
	const out = new Map<string, Result & { value: number }>();
	for (const r of state.results.values()) {
		if (r.drill_run_id === runId && r.value !== null) out.set(r.player_id, r as Result & { value: number });
	}
	return out;
}

export const effSetup = (run: Run, r?: Result) => r?.setup ?? run.setup ?? null;

export function score(drill: Drill, run: Run, r: Result & { value: number }) {
	const s = effSetup(run, r);
	return drill.kind === 'makes' ? (s ? r.value / s : null) : r.value;
}

export const beats = (drill: Drill, a: number, b: number) => (drill.kind === 'time' ? a < b : a > b);

/**
 * A player's best. Makes compare across any number of shots (as %). Count and
 * time compare only at the same setup.
 */
export function bestFor(
	state: State,
	drill: Drill,
	playerId: string,
	opts: { excludeRun?: string; setup?: number | null } = {}
) {
	let best: number | null = null;
	for (const run of state.runs.values()) {
		if (run.drill_id !== drill.id || run.id === opts.excludeRun) continue;
		const r = entry(state, run.id, playerId);
		if (!r || r.value === null) continue;
		if (drill.kind !== 'makes' && opts.setup !== undefined && effSetup(run, r) !== opts.setup) continue;
		const sc = score(drill, run, r as Result & { value: number });
		if (sc !== null && (best === null || beats(drill, sc, best))) best = sc;
	}
	return best;
}

export function fmtScore(drill: Drill, s: number) {
	if (drill.kind === 'makes') return pct(s);
	return drill.kind === 'time' ? fmtTime(s) + 's' : r1(s);
}

const median = (a: number[]) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);

export function summary(state: State, drill: Drill, run: Run) {
	const rs = [...results(state, run.id).values()];
	if (!rs.length) return 'No results yet';
	if (drill.kind === 'makes') {
		let m = 0;
		let a = 0;
		for (const r of rs) {
			const s = effSetup(run, r);
			if (s) {
				m += r.value;
				a += s;
			}
		}
		return a ? `${pct(m / a)} team (${m}/${a})` : 'No results yet';
	}
	const vals = rs.map((r) => r.value).sort((x, y) => x - y);
	if (drill.kind === 'time') return `Fastest ${fmtTime(vals[0])} · median ${fmtTime(median(vals))}`;
	return `Top ${r1(vals[vals.length - 1])} · median ${r1(median(vals))}`;
}

/** Runs on a date, in a stable order (the schema has no creation time). */
export function runsOn(state: State, date: string) {
	return [...state.runs.values()]
		.filter((r) => r.date === date)
		.sort((a, b) => (state.drills.get(a.drill_id)?.name ?? '').localeCompare(state.drills.get(b.drill_id)?.name ?? ''));
}

/** Drills by most recent practice, then name. */
export function drillsByUse(state: State) {
	const last = new Map<string, string>();
	for (const r of state.runs.values()) if ((last.get(r.drill_id) ?? '') < r.date) last.set(r.drill_id, r.date);
	return [...state.drills.values()].sort(
		(a, b) => (last.get(b.id) ?? '').localeCompare(last.get(a.id) ?? '') || a.name.localeCompare(b.name)
	);
}
