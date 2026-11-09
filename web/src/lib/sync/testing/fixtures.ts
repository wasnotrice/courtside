import type { Drill, MutationInput, MutationName, Player, Run } from '../types';

type Of<N extends MutationName> = Extract<MutationInput, { name: N }>;

export const id = () => crypto.randomUUID();

/** The program and season every fixture belongs to. FakeServer starts with both. */
export const PROGRAM = 'b0000000-0000-4000-8000-000000000001';
export const SEASON = 'f0000000-0000-4000-8000-000000000001';

export const structure = (): MutationInput[] => [
	{ name: 'program.put', args: { id: PROGRAM, name: "Girls' basketball", sport: 'basketball' } },
	{ name: 'season.put', args: { id: SEASON, name: '2026–27', starts_on: '2026-08-01', ends_on: '2027-07-31' } }
];

export const player = (over: Partial<Player> = {}): Of<'player.put'> => ({
	name: 'player.put',
	args: { id: id(), program_id: PROGRAM, name: 'Ana', ...over }
});

export const drill = (over: Partial<Drill> = {}): Of<'drill.put'> => ({
	name: 'drill.put',
	args: { id: id(), program_id: PROGRAM, name: 'Free throws', kind: 'makes', default_setup: 50, archived: false, ...over }
});

export const run = (drillId: string, over: Partial<Run> = {}): Of<'run.create'> => ({
	name: 'run.create',
	args: { id: id(), program_id: PROGRAM, date: '2026-11-06', drill_id: drillId, setup: 50, ...over }
});

export const setValue = (runId: string, playerId: string, value: number): Of<'result.set_value'> => ({
	name: 'result.set_value',
	args: { drill_run_id: runId, player_id: playerId, value }
});
