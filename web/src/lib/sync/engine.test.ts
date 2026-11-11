import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUSH_BATCH, SyncEngine } from './engine';
import { HttpError } from './transport';
import { MemoryStore } from './store';
import { FakeServer } from './testing/fake-server';
import { drill, game, play, PROGRAM, player, run, setValue } from './testing/fixtures';
import { DexieStore } from './dexie-store';
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
	// Pull the program and season the fixtures belong to.
	await engine.sync();
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
		const before = server.version;
		engine.setOffline(true);

		await engine.mutate(player());
		await engine.sync();
		expect(server.version).toBe(before);
		expect(engine.snapshot.phase).toBe('offline');

		engine.setOffline(false);
		await settle();
		expect(server.version).toBeGreaterThan(before);
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

	it('sends a long queue in batches', async () => {
		const server = new FakeServer();
		const { engine, transport } = await device(server);
		transport.online = false;
		for (let i = 0; i < PUSH_BATCH * 2 + 10; i++) await engine.mutate(player({ name: `P${i}` }));

		const sizes: number[] = [];
		const push = transport.push;
		transport.push = function (req) {
			sizes.push(req.mutations.length);
			return push.call(this, req);
		};
		transport.online = true;
		await engine.sync();

		expect(sizes).toEqual([PUSH_BATCH, PUSH_BATCH, 10]);
		expect(engine.snapshot.pending).toHaveLength(0);
		expect(server.live().players.size).toBe(PUSH_BATCH * 2 + 10);
	});

	it('a 401 keeps every pending change queued, with none rejected, and sends them later', async () => {
		vi.useFakeTimers();
		const server = new FakeServer();
		const { engine, transport } = await device(server);
		const push = transport.push;
		transport.push = async () => {
			throw new HttpError(401, 'Sign in again.');
		};

		await engine.mutate(player());
		await engine.mutate(player({ name: 'Bea' }));
		await engine.sync();
		expect(engine.snapshot.pending).toHaveLength(2);
		expect(engine.snapshot.rejections).toEqual([]);
		expect(engine.snapshot.phase).toBe('retrying');
		expect(engine.snapshot.lastError).toBe('Sign in again.');

		transport.push = push;
		await vi.advanceTimersByTimeAsync(5_000);
		expect(engine.snapshot.pending).toHaveLength(0);
		expect(server.live().players.size).toBe(2);
	});

	it('pulls from scratch when the server data is restored, keeping its queue', async () => {
		const server = new FakeServer();
		const { engine, transport } = await device(server);
		const backup = server.backup();

		const gone = player({ name: 'Gone' });
		await engine.mutate(gone);
		await engine.sync();
		expect(engine.snapshot.view.players.has(gone.args.id)).toBe(true);

		// Restoring the backup loses Gone. This phone queues another change offline.
		server.restore(backup);
		transport.online = false;
		const kept = player({ name: 'Kept' });
		await engine.mutate(kept);

		transport.online = true;
		await engine.sync();
		await engine.sync();
		expect(engine.snapshot.view.players.has(gone.args.id)).toBe(false);
		expect(engine.snapshot.view.players.get(kept.args.id)?.name).toBe('Kept');
		expect(server.live().players.has(kept.args.id)).toBe(true);
		expect(engine.snapshot.pending).toHaveLength(0);
	});

	it('can add the next season offline and record a practice in it', async () => {
		const server = new FakeServer();
		const { engine, transport } = await device(server);
		transport.online = false;

		const season = crypto.randomUUID();
		const d = drill();
		for (const m of [
			{ name: 'season.put' as const, args: { id: season, name: '2027–28', starts_on: '2027-08-01', ends_on: '2028-07-31' } },
			d,
			run(d.args.id, { date: '2027-09-01' })
		]) {
			expect(await engine.mutate(m)).toEqual({ ok: true });
		}

		transport.online = true;
		await engine.sync();
		expect(engine.snapshot.rejections).toEqual([]);
		expect(server.live().seasons.has(season)).toBe(true);
		expect(server.live().runs.size).toBe(1);
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
	it('edits to different fields of the same row both survive', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const d = drill();
		await a.engine.mutate(d);
		await a.engine.sync();
		await b.engine.sync();

		a.transport.online = false;
		b.transport.online = false;
		await a.engine.mutate({ name: 'drill.put', args: { id: d.args.id, name: 'FTs' } });
		await b.engine.mutate({ name: 'drill.put', args: { id: d.args.id, default_setup: 30 } });

		a.transport.online = true;
		b.transport.online = true;
		await a.engine.sync();
		await b.engine.sync();
		await a.engine.sync();

		const expected = { ...d.args, name: 'FTs', default_setup: 30 };
		expect(server.live().drills.get(d.args.id)).toEqual(expected);
		expect(a.engine.snapshot.view.drills.get(d.args.id)).toEqual(expected);
		expect(b.engine.snapshot.view.drills.get(d.args.id)).toEqual(expected);
	});

	it('known limit: a phone that syncs late overwrites a newer edit to the same field', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const p = player();
		await a.engine.mutate(p);
		await a.engine.sync();
		await b.engine.sync();

		// A renames first but is offline; B renames later and syncs at once.
		a.transport.online = false;
		await a.engine.mutate({ name: 'player.put', args: { id: p.args.id, name: 'Older edit' } });
		await b.engine.mutate({ name: 'player.put', args: { id: p.args.id, name: 'Newer edit' } });
		await b.engine.sync();

		// The last change to reach the server wins, not the last one made.
		a.transport.online = true;
		await a.engine.sync();
		expect(server.live().players.get(p.args.id)).toEqual({ id: p.args.id, program_id: PROGRAM, name: 'Older edit' });
	});

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

describe('games', () => {
	it('a film correction on one phone reaches another that was offline, and both keep their changes', async () => {
		const server = new FakeServer();
		const film = await device(server);
		const bench = await device(server);
		const g = game();
		const p = player();
		const shot = play(g.args.id, { player_id: p.args.id, stat: 'fg2_made' });
		for (const m of [g, p, shot]) await bench.engine.mutate(m);
		await bench.engine.sync();
		await film.engine.sync();

		// The bench phone goes offline and records more; film review fixes the shot's clock.
		bench.transport.online = false;
		const rebound = play(g.args.id, { side: 'them', stat: 'oreb' });
		await bench.engine.mutate(rebound);
		await film.engine.mutate({ name: 'play.put', args: { id: shot.args.id, clock: 412, video_at: 1830.5 } });
		await film.engine.sync();

		bench.transport.online = true;
		await bench.engine.sync();
		await film.engine.sync();

		for (const d of [film, bench]) {
			expect(d.engine.snapshot.view.plays.get(shot.args.id)).toMatchObject({ clock: 412, video_at: 1830.5 });
			expect(d.engine.snapshot.view.plays.has(rebound.args.id)).toBe(true);
		}
	});

	it('an edit to a play another phone deleted is rejected, and the play stays gone', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const g = game();
		const p = play(g.args.id);
		for (const m of [g, p]) await a.engine.mutate(m);
		await a.engine.sync();
		await b.engine.sync();

		b.transport.online = false;
		await b.engine.mutate({ name: 'play.put', args: { id: p.args.id, period: 2 } });
		await a.engine.mutate({ name: 'play.delete', args: { id: p.args.id } });
		await a.engine.sync();

		b.transport.online = true;
		await b.engine.sync();
		expect(b.engine.snapshot.rejections.map((r) => r.reason)).toEqual(['That play was deleted.']);
		expect(b.engine.snapshot.view.plays.has(p.args.id)).toBe(false);
		expect(server.live().plays.has(p.args.id)).toBe(false);
	});

	it('plays recorded into a game another phone deleted show as "won\'t sync", then rejected', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const g = game();
		await a.engine.mutate(g);
		await a.engine.sync();
		await b.engine.sync();

		b.transport.online = false;
		const late = play(g.args.id);
		await b.engine.mutate(late);
		await a.engine.mutate({ name: 'game.delete', args: { id: g.args.id } });
		await a.engine.sync();

		// B pulls the delete before its push lands: its queued play no longer applies.
		const push = b.transport.push;
		b.transport.push = async () => {
			throw new TypeError('Failed to fetch');
		};
		b.transport.online = true;
		await b.engine.sync();
		expect([...b.engine.snapshot.skipped.values()]).toEqual(['That game was deleted.']);

		b.transport.push = push;
		await b.engine.sync();
		expect(b.engine.snapshot.rejections.map((r) => r.reason)).toEqual(['That game was deleted.']);
		expect(b.engine.snapshot.pending).toHaveLength(0);
	});

	it('closing the app mid-game loses no play', async () => {
		const server = new FakeServer();
		const name = `game-${crypto.randomUUID()}`;
		const transport = server.transport();
		let engine = await SyncEngine.open({ store: new DexieStore(name), transport });
		await engine.sync();
		transport.online = false;

		const g = game();
		await engine.mutate(g);
		const plays = Array.from({ length: 40 }, () => play(g.args.id));
		for (const p of plays) expect(await engine.mutate(p)).toEqual({ ok: true });
		engine.stop();

		// "Reopen the app": a new engine on the same IndexedDB database.
		engine = await SyncEngine.open({ store: new DexieStore(name), transport });
		engine.stop();
		expect(engine.snapshot.pending).toHaveLength(41);
		expect(engine.snapshot.view.plays.size).toBe(40);

		transport.online = true;
		await engine.sync();
		expect(server.live().plays.size).toBe(40);
	});
});
