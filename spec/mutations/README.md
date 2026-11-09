# Shared mutation cases

Every mutation has two implementations: TypeScript on the phone
(`web/src/lib/sync/mutators.ts`) and Elixir on the server
(`server/lib/courtside/sync/mutators.ex`). The cases in this folder are run by both test
suites, so the two can't drift apart without a test failing:

- `web/src/lib/sync/shared-cases.test.ts` applies each case with the client mutators.
- `server/test/courtside/shared_mutation_cases_test.exs` pushes each case through
  `Courtside.Sync.push/2` against the database.

When a rule, an argument or a message changes, change the case here first, then make
both sides pass.

## Format

Each `*.json` file holds:

```json
{
  "given": { "players": [], "drills": [], "runs": [], "results": [] },
  "cases": [
    {
      "name": "what the case shows",
      "with": { "results": [] },
      "mutation": { "name": "result.set_value", "args": {} },
      "expect": { "rows": { "results": [] } }
    }
  ]
}
```

- **`given`**: the rows that exist before each case in the file. Rows use the wire shape
  (see `web/src/lib/sync/types.ts`), and may add `"deleted": true` for a tombstone:
  the server stores it, while the client never sees it, as after a real pull.
- **`with`**: extra rows for this case only, added to `given`.
- **`expect`** is one of:
  - `{"rows": {...}}`: the mutation is accepted, and each table listed holds exactly
    these live rows afterward, in any order. Tables not listed aren't checked.
  - `{"rejected": "message"}`: the mutation is refused with exactly this message.
- **`known_difference`**: optional. The two sides are known to disagree, and the value
  says why. Both runners skip the case, so each difference stays written down until
  it's fixed or accepted.
