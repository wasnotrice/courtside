// Phase 2, step 3: how long the view takes to rebuild with a full game queued
// offline. Every tap replays every pending change on top of the base.

import { expect, it } from 'vitest';
import { apply } from './mutators';
import { computeView } from './replay';
import { game, play, player, structure } from './testing/fixtures';
import { emptyState, type PendingMutation, type State } from './types';

it('replays a season-sized base with 400 pending plays', () => {
	// The base: a season already synced, ~25 games of 400 plays and a 15-player roster.
	let base: State = structure().reduce(apply, emptyState());
	const players = Array.from({ length: 15 }, (_, i) => player({ name: `P${i}` }));
	for (const p of players) base = apply(base, p);
	for (let g = 0; g < 24; g++) {
		const gm = game({ opponent: `Opp ${g}` });
		base = apply(base, gm);
		// Built straight into the map: applying 9,600 plays one by one is itself the slow path.
		const plays = new Map(base.plays);
		for (let i = 0; i < 400; i++) {
			const p = play(gm.args.id, { player_id: players[i % 15].args.id, stat: 'fg2_made' });
			plays.set(p.args.id, { foul_type: null, assist_player_id: null, drawn_by_player_id: null, clock: null, video_at: null, ...p.args } as never);
		}
		base = { ...base, plays };
	}

	// Tonight's game, all of it still pending.
	const tonight = game({ opponent: 'Tonight' });
	const pending = [tonight, ...Array.from({ length: 400 }, (_, i) => play(tonight.args.id, { player_id: players[i % 15].args.id, stat: 'fg2_made' }))].map(
		(m, i) => ({ ...m, id: i + 1 }) as PendingMutation
	);

	computeView(base, pending); // warm up
	const runs = 5;
	const t0 = performance.now();
	for (let i = 0; i < runs; i++) computeView(base, pending);
	const ms = (performance.now() - t0) / runs;

	const view = computeView(base, pending);
	expect(view.skipped.size).toBe(0);
	expect(view.state.plays.size).toBe(24 * 400 + 400);
	console.log(`computeView: base ${base.plays.size} plays + ${pending.length} pending: ${ms.toFixed(1)} ms per replay (this Mac, Node)`);
});
