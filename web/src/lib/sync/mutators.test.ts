// The rules, arguments and messages of every mutation are covered by the
// shared cases in spec/mutations/ (see shared-cases.test.ts), which the server
// runs too. This file covers what those cases can't.

import { describe, expect, it } from 'vitest';
import { apply } from './mutators';
import { player, structure } from './testing/fixtures';
import { emptyState } from './types';

describe('apply', () => {
	it('does not change the state it was given', () => {
		const before = structure().reduce(apply, emptyState());
		const players = before.players;
		const after = apply(before, player());

		expect(before.players).toBe(players);
		expect(before.players.size).toBe(0);
		expect(after.players.size).toBe(1);
	});
});
