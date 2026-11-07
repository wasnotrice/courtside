import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './engine';
import { MemoryStore } from './store';
import { FakeServer } from './testing/fake-server';
import { drill, player, run, setValue } from './testing/fixtures';
import { resultKey } from './types';

const engines: SyncEngine[] = [];
afterEach(() => {
	engines.splice(0).forEach((e) => e.stop());
	vi.useRealTimers();
});

async function device(server: FakeServer, opts: { pokes?: boolean } = {}) {
	const transport = server.transport();
	const store = new MemoryStore();
	const engine = await SyncEngine.open({ store, transport, pokes: opts.pokes ? server.pokes() : undefined });
	engines.push(engine);
	return { engine, transport, store };
}

/** Lets pokes fire, then waits for every engine's sync loop to finish. */
async function settle() {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await Promise.all(engines.map((e) => e.sync()));
	}
}

/** Creates a player, a 50-shot free-throw drill and today's run, synced. */
async function practice(engine: SyncEngine) {
	const p = player();
	const d = drill();
	const r = run(d.args.id);
	for (const m of [p, d, r]) expect(await engine.mutate(m)).toEqual({ ok: true });
	await engine.sync();
	return { playerId: p.args.id, runId: r.args.id };
}

describe('a single device', () => {
	it('shows a mutation at once and clears it from the queue once the server has it', async () => {
		const server = new FakeServer();
		const { engine, transport } = await device(server);
		transport.online = false;

		const p = player();
		await engine.mutate(p);
		expect(engine.snapshot.view.players.get(p.args.id)?.name).toBe('Ana');
		expect(engine.snapshot.pending).toHaveLength(1);

		transport.online = true;
		await engine.sync();
		expect(engine.snapshot.pending).toHaveLength(0);
		expect(engine.snapshot.lastMutationId).toBe(1);
		expect(engine.snapshot.cursor).toBe(server.version);
		expect(engine.snapshot.view.players.get(p.args.id)?.name).toBe('Ana');
	});

	it('refuses invalid input without queueing it', async () => {
		const { engine } = await device(new FakeServer());
		const result = await engine.mutate(player({ name: ' ' }));
		expect(result).toEqual({ ok: false, reason: "Name can't be blank" });
		expect(engine.snapshot.pending).toHaveLength(0);
	});

	it('validates each mutation against the ones queued before it', async () => {
		const { engine } = await device(new FakeServer());
		const d = drill();
		const [a, b] = await Promise.all([engine.mutate(d), engine.mutate(run(d.args.id))]);
		expect(a.ok && b.ok).toBe(true);
	});

	it('sends nothing while the offline switch is on, and syncs when it goes off', async () => {
		const server = new FakeServer();
		const { engine } = await device(server);
		engine.setOffline(true);

		await engine.mutate(player());
		await engine.sync();
		expect(server.version).toBe(0);
		expect(engine.snapshot.phase).toBe('offline');

		engine.setOffline(false);
		await settle();
		expect(server.version).toBeGreaterThan(0);
		expect(engine.snapshot.pending).toHaveLength(0);
		expect(engine.snapshot.phase).toBe('idle');
	});

	it('retries with backoff after a network failure', async () => {
		vi.useFakeTimers();
		const server = new FakeServer();
		const { engine, transport } = await device(server);
		transport.online = false;

		await engine.mutate(player());
		await engine.sync();
		expect(engine.snapshot.phase).toBe('retrying');
		expect(engine.snapshot.lastError).toBe('Failed to fetch');

		transport.online = true;
		await vi.advanceTimersByTimeAsync(5_000);
		expect(engine.snapshot.phase).toBe('idle');
		expect(engine.snapshot.pending).toHaveLength(0);
	});

	it('replaying a push after a lost response does not apply it twice', async () => {
		const server = new FakeServer();
		const { engine, transport } = await device(server);
		const { runId, playerId } = await practice(engine);

		// The push reaches the server, then the signal drops before the response
		// (and the pull) get through.
		const push = transport.push;
		transport.push = async function (req) {
			await push.call(this, req);
			this.online = false;
			throw new TypeError('Failed to fetch');
		};
		await engine.mutate(setValue(runId, playerId, 38));
		await engine.sync();
		expect(engine.snapshot.pending).toHaveLength(1);

		transport.push = push;
		transport.online = true;
		await engine.sync();
		expect(engine.snapshot.pending).toHaveLength(0);
		expect(engine.snapshot.rejections).toEqual([]);
		expect(server.live().results.get(resultKey(runId, playerId))?.value).toBe(38);
	});

	it('reset starts over as a new client with no local data', async () => {
		const server = new FakeServer();
		const { engine } = await device(server);
		await practice(engine);
		const before = engine.snapshot.clientId;

		await engine.reset();
		await engine.sync();
		expect(engine.snapshot.clientId).not.toBe(before);
		// Everything comes back from the server.
		expect(engine.snapshot.view.players.size).toBe(1);
		expect(engine.snapshot.lastMutationId).toBe(0);
	});
});

describe('two devices', () => {
	it('a poke makes the other device pull', async () => {
		const server = new FakeServer();
		const a = await device(server, { pokes: true });
		const b = await device(server, { pokes: true });
		a.engine.start();
		b.engine.start();

		const p = player();
		await a.engine.mutate(p);
		await settle();
		expect(b.engine.snapshot.view.players.has(p.args.id)).toBe(true);
	});

	it('both enter a result for the same player offline: the later push wins on both', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const { runId, playerId } = await practice(a.engine);
		await b.engine.sync();

		a.engine.setOffline(true);
		b.engine.setOffline(true);
		await a.engine.mutate(setValue(runId, playerId, 38));
		await b.engine.mutate(setValue(runId, playerId, 41));

		// Each sees its own value while offline.
		const key = resultKey(runId, playerId);
		expect(a.engine.snapshot.view.results.get(key)?.value).toBe(38);
		expect(b.engine.snapshot.view.results.get(key)?.value).toBe(41);

		a.engine.setOffline(false);
		await settle();
		b.engine.setOffline(false);
		await settle();

		expect(a.engine.snapshot.view.results.get(key)?.value).toBe(41);
		expect(b.engine.snapshot.view.results.get(key)?.value).toBe(41);
		expect(a.engine.snapshot.rejections).toEqual([]);
		expect(b.engine.snapshot.rejections).toEqual([]);
	});

	it('one deletes a run while the other adds results to it: the results are rejected, visibly', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const { runId, playerId } = await practice(a.engine);
		await b.engine.sync();

		b.engine.setOffline(true);
		await b.engine.mutate(setValue(runId, playerId, 38));
		await a.engine.mutate({ name: 'run.delete', args: { id: runId } });
		await a.engine.sync();

		b.engine.setOffline(false);
		await settle();

		expect(b.engine.snapshot.view.runs.has(runId)).toBe(false);
		expect(b.engine.snapshot.view.results.size).toBe(0);
		expect(b.engine.snapshot.pending).toHaveLength(0);
		expect(b.engine.snapshot.rejections).toMatchObject([
			{ name: 'result.set_value', reason: 'That drill was removed from the practice.' }
		]);
	});

	it('a pending mutation that stops applying after a pull is shown as skipped until the server rejects it', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const { runId, playerId } = await practice(a.engine);
		await b.engine.sync();

		// b can pull but its pushes don't get through.
		const push = b.transport.push;
		b.transport.push = async () => {
			throw new TypeError('Failed to fetch');
		};
		await b.engine.mutate(setValue(runId, playerId, 38));
		await a.engine.mutate({ name: 'run.delete', args: { id: runId } });
		await a.engine.sync();
		await b.engine.sync();

		const [queued] = b.engine.snapshot.pending;
		expect(b.engine.snapshot.skipped.get(queued.id)).toBe('That drill was removed from the practice.');
		expect(b.engine.snapshot.view.runs.has(runId)).toBe(false);
		expect(b.engine.snapshot.phase).toBe('retrying');

		b.transport.push = push;
		await b.engine.sync();
		expect(b.engine.snapshot.pending).toHaveLength(0);
		expect(b.engine.snapshot.skipped.size).toBe(0);
		expect(b.engine.snapshot.rejections).toMatchObject([{ mutation_id: queued.id }]);
	});

	it('one lowers the shots after the other entered more makes: the later change is rejected', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const { runId, playerId } = await practice(a.engine);
		await b.engine.sync();

		a.engine.setOffline(true);
		b.engine.setOffline(true);
		await a.engine.mutate(setValue(runId, playerId, 40));
		await b.engine.mutate({ name: 'run.set_setup', args: { id: runId, setup: 30 } });

		a.engine.setOffline(false);
		await settle();
		b.engine.setOffline(false);
		await settle();

		expect(b.engine.snapshot.rejections).toMatchObject([
			{ name: 'run.set_setup', reason: 'Ana has 40 makes, more than 30 shots.' }
		]);
		for (const { engine } of [a, b]) {
			expect(engine.snapshot.view.runs.get(runId)?.setup).toBe(50);
			expect(engine.snapshot.view.results.get(resultKey(runId, playerId))?.value).toBe(40);
		}
	});

	it('a dismissed rejection stays dismissed', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const { runId, playerId } = await practice(a.engine);
		await b.engine.sync();

		b.engine.setOffline(true);
		await b.engine.mutate(setValue(runId, playerId, 38));
		await a.engine.mutate({ name: 'run.delete', args: { id: runId } });
		await a.engine.sync();
		b.engine.setOffline(false);
		await settle();

		const [rejection] = b.engine.snapshot.rejections;
		await b.engine.dismissRejection(rejection.mutation_id);
		await b.engine.sync();
		expect(b.engine.snapshot.rejections).toEqual([]);
	});
});
