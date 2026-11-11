import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncEngine } from './engine';
import { lostChanges, restoreLost } from './restore';
import { MemoryStore } from './store';
import { FakeServer } from './testing/fake-server';
import { drill, game, play, player, run, setValue } from './testing/fixtures';
import { resultKey } from './types';

const engines: SyncEngine[] = [];
afterEach(() => engines.splice(0).forEach((e) => e.stop()));

async function device(server: FakeServer) {
	const transport = server.transport();
	const engine = await SyncEngine.open({ store: new MemoryStore(), transport });
	engines.push(engine);
	await engine.sync();
	return { engine, transport };
}

async function ok(engine: SyncEngine, ...inputs: Parameters<SyncEngine['mutate']>[0][]) {
	for (const m of inputs) expect(await engine.mutate(m)).toEqual({ ok: true });
}

/** A game with one synced play on phone A, which phone B has also pulled. */
async function gameOnTwoPhones() {
	const server = new FakeServer();
	const a = await device(server);
	const b = await device(server);
	const g = game();
	const first = play(g.args.id, { stat: 'fg2_made' });
	await ok(a.engine, g, first);
	await a.engine.sync();
	await b.engine.sync();
	return { server, a, b, g, first };
}

describe('restoring a deleted game', () => {
	it('brings back the game, its plays, and the changes recorded offline', async () => {
		const { server, a, b, g, first } = await gameOnTwoPhones();

		// A loses signal and keeps recording; B deletes the game.
		a.transport.online = false;
		const second = play(g.args.id, { stat: 'fg3_made' });
		await ok(a.engine, second, { name: 'play.put', args: { id: first.args.id, period: 2 } });
		await ok(b.engine, { name: 'game.delete', args: { id: g.args.id } });
		await b.engine.sync();

		a.transport.online = true;
		await a.engine.sync();
		expect(a.engine.snapshot.view.games.has(g.args.id)).toBe(false);
		expect(a.engine.snapshot.rejections.map((r) => r.reason)).toEqual(['That game was deleted.', 'That play was deleted.']);

		const lost = lostChanges(a.engine.snapshot.rejections, a.engine.snapshot.view);
		expect(lost).toMatchObject([{ kind: 'game', id: g.args.id, gone: true }]);
		expect(lost[0].rejections).toHaveLength(1);

		expect(await restoreLost(a.engine, lost[0])).toEqual({ ok: true });
		await a.engine.sync();

		expect(a.engine.snapshot.rejections).toEqual([]);
		const live = server.live();
		expect(live.games.has(g.args.id)).toBe(true);
		expect(live.plays.get(first.args.id)?.period).toBe(2);
		expect(live.plays.has(second.args.id)).toBe(true);
		expect(a.engine.snapshot.view.plays.size).toBe(2);
		// B gets it all back too.
		await b.engine.sync();
		expect(b.engine.snapshot.view.plays.size).toBe(2);
	});

	it('needs a connection to bring the game back', async () => {
		const { a, b, g } = await gameOnTwoPhones();
		a.transport.online = false;
		await ok(a.engine, play(g.args.id));
		await ok(b.engine, { name: 'game.delete', args: { id: g.args.id } });
		await b.engine.sync();
		a.transport.online = true;
		await a.engine.sync();
		const [lost] = lostChanges(a.engine.snapshot.rejections, a.engine.snapshot.view);

		a.engine.setOffline(true);
		expect(await restoreLost(a.engine, lost)).toEqual({ ok: false, reason: 'Restoring needs a connection.' });

		// Signal drops after the switch says online: the restore waits in the queue.
		a.engine.setOffline(false);
		a.transport.online = false;
		expect(await restoreLost(a.engine, lost)).toMatchObject({ ok: false });
		expect(a.engine.snapshot.rejections).toHaveLength(1);
	});

	it('only sends the changes again when the game is already back', async () => {
		const { server, a, b, g } = await gameOnTwoPhones();
		a.transport.online = false;
		const offline = play(g.args.id);
		await ok(a.engine, offline);
		await ok(b.engine, { name: 'game.delete', args: { id: g.args.id } });
		await b.engine.sync();
		a.transport.online = true;
		await a.engine.sync();
		// B changes its mind first.
		await ok(b.engine, { name: 'game.restore', args: { id: g.args.id } });
		await b.engine.sync();
		await a.engine.sync();

		const [lost] = lostChanges(a.engine.snapshot.rejections, a.engine.snapshot.view);
		expect(lost.gone).toBe(false);
		expect(await restoreLost(a.engine, lost)).toEqual({ ok: true });
		await a.engine.sync();
		expect(server.live().plays.has(offline.args.id)).toBe(true);
		expect(a.engine.snapshot.rejections).toEqual([]);
	});
});

describe('restoring a deleted drill run', () => {
	it('brings back the run, its results, and the results recorded offline', async () => {
		const server = new FakeServer();
		const a = await device(server);
		const b = await device(server);
		const ana = player({ name: 'Ana' });
		const bo = player({ name: 'Bo' });
		const d = drill();
		const r = run(d.args.id);
		await ok(a.engine, ana, bo, d, r, setValue(r.args.id, ana.args.id, 40));
		await a.engine.sync();
		await b.engine.sync();

		a.transport.online = false;
		await ok(a.engine, setValue(r.args.id, bo.args.id, 35));
		await ok(b.engine, { name: 'run.delete', args: { id: r.args.id } });
		await b.engine.sync();
		a.transport.online = true;
		await a.engine.sync();

		const lost = lostChanges(a.engine.snapshot.rejections, a.engine.snapshot.view);
		expect(lost).toMatchObject([{ kind: 'run', id: r.args.id, gone: true }]);
		expect(await restoreLost(a.engine, lost[0])).toEqual({ ok: true });
		await a.engine.sync();

		const results = server.live().results;
		expect(results.get(resultKey(r.args.id, ana.args.id))?.value).toBe(40);
		expect(results.get(resultKey(r.args.id, bo.args.id))?.value).toBe(35);
		expect(a.engine.snapshot.rejections).toEqual([]);
	});
});
