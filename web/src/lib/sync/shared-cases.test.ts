// Runs the shared mutation cases in spec/mutations/ through the client mutators.
// The server runs the same files (server/test/courtside/shared_mutation_cases_test.exs),
// so a rule, argument or message that differs between the two fails one suite.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { apply, MutationError } from './mutators';
import { keyOf as rowKey, TABLES } from './replay';
import type { MutationInput, State } from './types';

type Table = keyof State;
type Row = Record<string, unknown> & { deleted?: boolean };
type Rows = Partial<Record<Table, Row[]>>;

interface Case {
	name: string;
	with?: Rows;
	mutation: MutationInput;
	expect: { rows: Rows } | { rejected: string };
	known_difference?: string;
}

const dir = fileURLToPath(new URL('../../../../spec/mutations/', import.meta.url));
const keyOf = (table: Table, row: Row) => rowKey(table, row as Parameters<typeof rowKey>[1]);

/** The client's base after a pull: tombstones never reach it. */
function stateFrom(given: Rows, extra: Rows = {}): State {
	const tables = Object.fromEntries(
		TABLES.map((t) => {
			const live = [...(given[t] ?? []), ...(extra[t] ?? [])].filter((r) => !r.deleted);
			return [t, new Map(live.map((r) => [keyOf(t, r), r]))];
		})
	);
	return tables as unknown as State;
}

const sorted = (table: Table, rows: Row[]) =>
	[...rows].sort((a, b) => keyOf(table, a).localeCompare(keyOf(table, b)));

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
	const spec = JSON.parse(readFileSync(dir + file, 'utf8')) as { given?: Rows; cases: Case[] };

	describe(file, () => {
		for (const c of spec.cases) {
			if (c.known_difference) {
				it.skip(`${c.name} (known difference: ${c.known_difference})`, () => {});
				continue;
			}

			it(c.name, () => {
				const before = stateFrom(spec.given ?? {}, c.with);

				if ('rejected' in c.expect) {
					expect(() => apply(before, c.mutation)).toThrow(MutationError);
					expect(() => apply(before, c.mutation)).toThrow(new RegExp(`^${escape(c.expect.rejected)}$`));
					return;
				}

				const after = apply(before, c.mutation);
				for (const [table, rows] of Object.entries(c.expect.rows) as [Table, Row[]][]) {
					const actual = [...after[table].values()] as unknown as Row[];
					expect(sorted(table, actual), table).toEqual(sorted(table, rows));
				}
			});
		}
	});
}

function escape(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
