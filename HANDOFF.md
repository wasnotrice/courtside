# Handoff: Courtside

You're picking up a half-built project. Read this whole file before changing anything.

> **Superseded where they disagree.** A design review with the coach on 2026-11-07
> replaced parts of this file, including its "don't reopen" decisions and the ban on
> sync libraries. Where this file disagrees with these, they win:
> [`docs/games-plan.md`](docs/games-plan.md), [`GLOSSARY.md`](GLOSSARY.md) and
> [`docs/adr/`](docs/adr/). Keeping the sync hand-rolled is now a choice made on its
> merits (server authority, offline writes, Phoenix), not a rule.

## What this is

A practice stat tracker for a high school basketball team. During practice, players
finish a drill and report a number to the coach, who enters it on a phone. Today that's
free throws (makes out of N shots). Soon it will be any drill.

The coach is a software developer. This project is **deliberately an experiment in
offline-first design with hand-rolled sync**. Don't swap in PowerSync, ElectricSQL,
Replicache or a CRDT library: building the sync is the point. Keep the sync code behind
a clear boundary so one of those could be swapped in later for comparison.

Stack: **SvelteKit** client (`web/`), **Phoenix/Elixir** API (`server/`), **Postgres**.

## Decisions already made (don't reopen these)

- **Drills are data, not code.** A drill has a `kind`. Each kind has one quantity fixed
  in advance (`setup`) and one measured (`value`):

  | kind  | setup                     | value      | better | compare by               |
  |-------|---------------------------|------------|--------|--------------------------|
  | makes | shots (50, 30)            | makes      | higher | % (any setup)            |
  | count | length in seconds (60)    | reps/score | higher | same setup only          |
  | time  | reps (3 suicides)         | seconds    | lower  | same setup only          |

  `setup` is nullable for count and time (the drill's name may already define it) and
  required for makes. A drill has `default_setup`. A run (one drill at one practice)
  has its own `setup`, e.g. 30 shots today. A result can override `setup` for one
  player, for example someone who only shot 40.
- **There's no sessions table.** A run has a `date`. Add sessions later only if
  practice notes or attendance need them.
- **Offline-first from the start.** All ids are generated on the device (UUIDs), every
  write goes to the device first, and a queue of pending mutations syncs when there's
  signal.
- **Server-authoritative validation in Elixir code**, which the coach prefers over
  pushing logic into the database. Postgres keeps simple constraints as a backstop:
  foreign keys, checks, and a unique key on (run, player).
- **Conflict policy:** the most recent write wins, per field. Values like "38 vs 41
  makes" can't be merged, so a CRDT isn't appropriate.
- **No auth in v1.** It's local dev, single team.

## Sync protocol (see docs/sync-protocol.md for the full write-up)

This is Replicache-style push/pull using the **global version strategy**:

- `server_meta` holds one row with `version`. Every push transaction first runs
  `UPDATE server_meta SET version = version + 1 RETURNING version`, which takes the
  row lock. That **serializes pushes**, so version order equals commit order. This
  avoids the classic bug where a sequence number is assigned out of commit order and
  a pull skips a row. Every row the push writes is stamped with that version.
- Synced tables (`players`, `drills`, `drill_runs`, `results`) have `version bigint`
  and `deleted boolean`. A delete is a tombstone, so pulls can report it.
- **Push** `POST /api/push {client_id, mutations: [{id, name, args}]}`
  - `id` is a per-client integer that increases with each mutation. The `clients`
    table stores `last_mutation_id`. Mutations with `id <= last` are skipped, so
    retries are safe.
  - Each mutation runs inside a `SAVEPOINT`. A validation error, or an exception
    (which is rescued and logged), rolls back to the savepoint, writes a row to
    `mutation_rejections`, and **still advances** `last_mutation_id`, so one bad
    mutation can't block the queue.
  - Response: `{last_mutation_id, rejections: [{mutation_id, name, args, reason}]}`
    for the mutations in that batch.
  - After commit, the server broadcasts a **poke** on PubSub topic `"sync"`.
- **Pull** `GET /api/pull?client_id=…&cursor=N`
  - Runs in a `REPEATABLE READ READ ONLY` transaction, so it reads one consistent
    snapshot.
  - Returns `{cursor, last_mutation_id, rejections, changes: {players, drills, runs, results}}`,
    with rows where `version > cursor` (tombstones included) and rejections recorded
    after `cursor`.
  - Results are keyed on the wire by `(drill_run_id, player_id)`. The server's
    `results.id` isn't sent.
- **Poke channel:** Phoenix socket at `/socket`, channel `"sync"`, event `"poke"`
  with an empty payload. When a client gets a poke, it pulls. A missed poke only
  delays a client until its next periodic pull.

Mutation names and args (see `server/lib/courtside/sync/mutators.ex`):

| name               | args                                         | notes |
|--------------------|----------------------------------------------|-------|
| `player.put`       | `id, name, jersey, active`                   | upsert |
| `drill.put`        | `id, name, kind, default_setup, archived`    | upsert; `kind` can't change after the drill is created |
| `run.create`       | `id, date (YYYY-MM-DD), drill_id, setup`     | setup required for makes |
| `run.set_setup`    | `id, setup`                                  | rejected if any player without an override has makes > setup |
| `run.delete`       | `id`                                         | tombstones the run and its results |
| `result.set_value` | `drill_run_id, player_id, value`             | per-kind validation; makes ≤ effective setup |
| `result.set_setup` | `drill_run_id, player_id, setup` (null resets) | per-player override |
| `result.clear`     | `drill_run_id, player_id`                    | tombstone |

A result row can exist with `value: null` and a `setup` override. That means "no result
yet, but this player's setup is different."

## Current state

Steps 1 to 4 of the original plan are done, and step 5 is mostly done. See `README.md`
for how to run it and `docs/sync-protocol.md` for the protocol.

- **Server tests** (`server/test/courtside/sync_test.exs`, `sync_concurrency_test.exs`,
  `courtside_web/controllers/sync_controller_test.exs`). They found and fixed these bugs:
  `results` and `mutation_rejections` had integer ids (every write crashed); a blank
  jersey crashed `player.put`; `result.set_setup` didn't revive a cleared result; a NUL
  byte in args made the rejection unstorable, which wedged the client's queue.
- **Client sync layer** (`web/src/lib/sync/`): mutators, replay, Dexie and memory stores,
  HTTP and Phoenix poke transport, and the engine. The UI talks only to `engine.ts` (via
  `index.svelte.ts`).
- **UI** (`web/src/lib/ui/`): a port of the prototype, plus the Sync inspector tab.
  Driven end to end with Playwright against the real server: two devices, pokes, the
  offline switch, and a run deleted under another device's offline result.
- **Edge cases**: all three are Vitest tests with two simulated clients against
  `testing/fake-server.ts`, which follows the same protocol but uses the TypeScript rules.

Decisions made along the way:
- Rejections reach the client only through pull, not push responses. Once the cursor
  passes a rejection it never comes back, so a dismissed one stays dismissed.
- A failed push still pulls.
- Pull's `SET TRANSACTION` is behind `config :courtside, :snapshot_pulls` (off in
  test.exs, because the SQL sandbox already wraps each test in a transaction).
- Runs have no creation time, so the Practice list sorts by drill name.
- Clearing a value with a per-player setup sends `result.clear` and then
  `result.set_setup`, because there's no "clear value only" mutation.

## Next steps

The plan is [`docs/games-plan.md`](docs/games-plan.md). **Phase 1 is done**
(organizations, programs, teams, seasons and rosters; edits that send only their
changed fields; offline safety; sync hardening; shared mutation cases). Next are
the two spikes (Tauri on iOS, LiveStore for games), then phase 2 (games).

Phase 1 changed the step boundaries a little: the client mutators moved with the
server's in step 1, so the shared cases in `spec/mutations/` pass on both sides at
every commit.

Known follow-ups, not urgent:
- Several tabs open on one device: share state through a `BroadcastChannel` or a lock.
- Cleaning up old tombstones.
- Showing a "last edited by" when two coaches disagree on a value.
- The season picker is an unstyled native `<select>`.
- On the entry screen with a team filter, the summary line still covers the whole
  drill run.

## How to run

See `README.md`. In this sandbox, Postgres is the shared one on port **5432**, so use
`PGPORT=5432`, and Elixir needs `MISE_ELIXIR_VERSION=1.20.2-otp-29 MISE_ERLANG_VERSION=29.0.2`
(no mise version is set globally).

## Working agreements with this user

- **American spellings** in all writing.
- **Commit as you go** on a work branch, after each coherent step. You don't need to
  ask before a local commit. **Never commit on `main`.**
- **Ask before pushing** or opening a PR: show the change and a plain-English summary,
  then wait for a yes. **Squash** into clean commits before any push.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use they/them for anyone whose pronouns you don't know.
- The user prefers being given a recommendation over a survey of options.
