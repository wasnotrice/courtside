import { describe, expect, it } from 'vitest';
import { apply, MutationError } from './mutators';
import { drill, player, run, setValue } from './testing/fixtures';
import { emptyState, resultKey, type MutationInput, type State } from './types';

const applyAll = (state: State, ...ms: MutationInput[]) => ms.reduce(apply, state);

/** A player, a makes drill and a 50-shot run. */
function seeded(kind: 'makes' | 'count' | 'time' = 'makes', setup: number | null = 50) {
	const p = player();
	const d = drill({ kind });
	const r = run(d.args.id, { setup });
	const state = applyAll(emptyState(), p, d, r);
	return { state, playerId: p.args.id, runId: r.args.id, drillId: d.args.id };
}

const rejects = (fn: () => unknown, message: string) => {
	expect(fn).toThrow(MutationError);
	expect(fn).toThrow(message);
};

describe('player.put', () => {
	it('trims names and refuses blanks', () => {
		const state = apply(emptyState(), player({ name: '  Ana  ' }));
		expect([...state.players.values()][0].name).toBe('Ana');
		rejects(() => apply(emptyState(), player({ name: '   ' })), "Name can't be blank");
	});

	it('does not mutate the state it was given', () => {
		const before = emptyState();
		apply(before, player());
		expect(before.players.size).toBe(0);
	});
});

describe('drill.put', () => {
	it("can't change a drill's kind", () => {
		const d = drill();
		const state = apply(emptyState(), d);
		rejects(
			() => apply(state, { name: 'drill.put', args: { ...d.args, kind: "count" } }),
			"Kind can't change"
		);
	});

	it('refuses a non-positive default setup', () => {
		rejects(() => apply(emptyState(), drill({ default_setup: 0 })), 'Default setup must be greater than 0');
	});
});

describe('run.create', () => {
	it('requires shots for makes drills only', () => {
		const makes = drill();
		const count = drill({ kind: 'count', default_setup: null });
		const state = applyAll(emptyState(), makes, count);
		rejects(() => apply(state, run(makes.args.id, { setup: null })), 'Setup shots are required');
		expect(apply(state, run(count.args.id, { setup: null })).runs.size).toBe(1);
	});

	it('refuses an unknown drill', () => {
		rejects(() => apply(emptyState(), run(crypto.randomUUID())), 'That drill no longer exists.');
	});
});

describe('result.set_value', () => {
	it('records a value', () => {
		const { state, runId, playerId } = seeded();
		const next = apply(state, setValue(runId, playerId, 38));
		expect(next.results.get(resultKey(runId, playerId))).toEqual({
			drill_run_id: runId,
			player_id: playerId,
			value: 38,
			setup: null
		});
	});

	it('refuses makes above the shots', () => {
		const { state, runId, playerId } = seeded();
		rejects(() => apply(state, setValue(runId, playerId, 51)), '51 makes is more than 50 shots.');
	});

	it("uses the player's own setup when overridden", () => {
		const { state, runId, playerId } = seeded();
		const next = applyAll(
			state,
			{ name: 'result.set_setup', args: { drill_run_id: runId, player_id: playerId, setup: 60 } },
			setValue(runId, playerId, 55)
		);
		expect(next.results.get(resultKey(runId, playerId))).toMatchObject({ value: 55, setup: 60 });
	});

	it('applies per-kind rules', () => {
		const makes = seeded();
		rejects(() => apply(makes.state, setValue(makes.runId, makes.playerId, 3.5)), 'Makes must be a whole number.');

		const time = seeded('time', 3);
		rejects(() => apply(time.state, setValue(time.runId, time.playerId, 0)), 'Time must be above zero.');
		expect(() => apply(time.state, setValue(time.runId, time.playerId, 31.4))).not.toThrow();

		const count = seeded('count', null);
		rejects(() => apply(count.state, setValue(count.runId, count.playerId, -1)), "Results can't be negative.");
	});

	it('refuses results for a deleted run or an unknown player', () => {
		const { state, runId, playerId } = seeded();
		const deleted = apply(state, { name: 'run.delete', args: { id: runId } });
		rejects(() => apply(deleted, setValue(runId, playerId, 10)), 'That drill was removed from the practice.');
		rejects(() => apply(state, setValue(runId, crypto.randomUUID(), 10)), 'That player is no longer on the roster.');
	});
});

describe('changing setup after makes are entered', () => {
	it('run.set_setup refuses a setup below anyone using it', () => {
		const { state, runId, playerId } = seeded();
		const withMakes = apply(state, setValue(runId, playerId, 40));
		rejects(
			() => apply(withMakes, { name: 'run.set_setup', args: { id: runId, setup: 30 } }),
			'Ana has 40 makes, more than 30 shots.'
		);
	});

	it('run.set_setup ignores players with their own setup', () => {
		const { state, runId, playerId } = seeded();
		const next = applyAll(
			state,
			setValue(runId, playerId, 40),
			{ name: 'result.set_setup', args: { drill_run_id: runId, player_id: playerId, setup: 45 } },
			{ name: 'run.set_setup', args: { id: runId, setup: 30 } }
		);
		expect(next.runs.get(runId)?.setup).toBe(30);
	});

	it('result.set_setup refuses a setup below the makes', () => {
		const { state, runId, playerId } = seeded();
		const withMakes = apply(state, setValue(runId, playerId, 40));
		rejects(
			() =>
				apply(withMakes, { name: 'result.set_setup', args: { drill_run_id: runId, player_id: playerId, setup: 30 } }),
			'40 makes is more than 30 shots.'
		);
	});
});

describe('deletes', () => {
	it('run.delete removes the run and its results', () => {
		const { state, runId, playerId } = seeded();
		const next = applyAll(state, setValue(runId, playerId, 38), { name: 'run.delete', args: { id: runId } });
		expect(next.runs.size).toBe(0);
		expect(next.results.size).toBe(0);
		expect(next.players.size).toBe(1);
	});

	it('result.clear removes one result', () => {
		const { state, runId, playerId } = seeded();
		const next = applyAll(state, setValue(runId, playerId, 38), {
			name: 'result.clear',
			args: { drill_run_id: runId, player_id: playerId }
		});
		expect(next.results.size).toBe(0);
	});
});

it('refuses unknown mutations and malformed ids', () => {
	rejects(() => apply(emptyState(), { name: 'player.explode', args: {} } as never), 'Unknown change type');
	rejects(() => apply(emptyState(), player({ id: 'not-a-uuid' })), 'could not apply');
});
