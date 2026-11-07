import type { Drill, MutationInput, MutationName, Player, Run } from '../types';

type Of<N extends MutationName> = Extract<MutationInput, { name: N }>;

export const id = () => crypto.randomUUID();

export const player = (over: Partial<Player> = {}): Of<'player.put'> => ({
	name: 'player.put',
	args: { id: id(), name: 'Ana', jersey: '4', active: true, ...over }
});

export const drill = (over: Partial<Drill> = {}): Of<'drill.put'> => ({
	name: 'drill.put',
	args: { id: id(), name: 'Free throws', kind: 'makes', default_setup: 50, archived: false, ...over }
});

export const run = (drillId: string, over: Partial<Run> = {}): Of<'run.create'> => ({
	name: 'run.create',
	args: { id: id(), date: '2026-11-06', drill_id: drillId, setup: 50, ...over }
});

export const setValue = (runId: string, playerId: string, value: number): Of<'result.set_value'> => ({
	name: 'result.set_value',
	args: { drill_run_id: runId, player_id: playerId, value }
});
