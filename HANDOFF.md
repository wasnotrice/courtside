# Handoff: Courtside

You're picking up a half-built project. Read this whole file before changing anything.

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

## Sync protocol (implemented on the server; the client isn't built)

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

Branch: **`scaffold`**. `main` has no commits. Never commit on `main`.

Done:
- Phoenix 1.8 API-only app (`--no-html --no-assets --binary-id`), app `:courtside`.
- `compose.yaml` runs Postgres 17 on **host port 5433**. 5432 was taken on the original
  machine by another project's container. `config/dev.exs` and `config/test.exs` set
  `port: 5433`. Adjust if the sandbox differs.
- Migration `priv/repo/migrations/20261106000000_create_sync_tables.exs`.
- `lib/courtside/practice.ex` (schemas), `lib/courtside/sync.ex` (push/pull),
  `lib/courtside/sync/mutators.ex` (validation), `lib/courtside_web/controllers/sync_controller.ex`,
  `lib/courtside_web/channels/sync_socket.ex` (socket and channel), routes in `router.ex`,
  socket in `endpoint.ex`.
- `mix compile --warnings-as-errors` passes, and the migration runs. **Nothing has been
  exercised at runtime yet**: no requests have been sent and no tests have been written.
- SvelteKit app generated with `sv create --template minimal --types ts`. It's untouched.
- `docs/prototype.html` is the earlier single-file prototype, built as a hosted Claude
  artifact. **Use it as the UI and UX reference**: the courtside flow, the custom number
  pad (phone number keypads have no Return or Next key), labels per kind, personal-best
  badges, and the team summary. Its sync layer is a simpler version of the same idea and
  should not be reused as is.

## Next steps, in order

1. **Server tests** (`server/test/courtside/sync_test.exs`, plus a controller test):
   - Replaying the same push is a no-op (idempotency).
   - A rejected mutation is recorded, returned, and still advances `last_mutation_id`.
     Later mutations in the same batch still apply.
   - A crashing mutation (e.g. a malformed UUID) is rejected and doesn't fail the push.
   - Pull with `cursor=0` returns everything. Pull with the returned cursor returns nothing.
   - `run.delete` tombstones the run and its results, and pull returns the tombstones.
   - Makes > setup is rejected for `result.set_value`, `run.set_setup` and
     `result.set_setup`.
   - Two concurrent pushes get distinct versions in commit order. This is optional but
     instructive: use two tasks with sandbox `shared` mode.
2. **Client sync layer** (`web/src/lib/sync/`). The UI must only talk to this layer:
   - `adapter-static` with `fallback: 'index.html'` and `ssr = false`, plus
     `src/service-worker.ts` (the SvelteKit docs example) so the app shell loads offline.
   - Vite dev proxy: `/api` to `http://localhost:4000`, `/socket` to the same with
     `ws: true`. This avoids CORS.
   - IndexedDB, Dexie was the plan, with these tables: the base tables mirroring the
     server; `pending` (mutations with explicit ids, using a `next_mutation_id` counter
     in `meta`, assigned in the same transaction); `meta` (`client_id`, `cursor`,
     `next_mutation_id`); and `rejections`.
   - `mutators.ts`: pure TypeScript `apply(state, mutation) → state` functions with the
     same names and rules as the Elixir ones. Use them in two places: to validate before
     enqueueing (refuse invalid input right away), and to compute the view.
   - **View = base + pending mutations replayed.** Hold the base in memory and recompute
     the view after every mutation or pull. A pending mutation that no longer applies
     during that replay is skipped in the view; the server will reject it.
   - Sync loop: on each mutation, push the whole pending batch, then pull. On pull,
     apply the changes to the base (remove tombstoned rows), save the cursor, drop
     pending entries with `id <= last_mutation_id`, store rejections, and recompute.
     Retry with backoff, and also pull on the `online` event, on a poke (npm
     `phoenix` client), and periodically while the page is visible. Serialize push
     and pull.
   - **A "simulate offline" switch** in the sync client, so experiments don't need
     DevTools.
   - Vitest tests for the mutators and the replay logic.
3. **UI** (Svelte 5 runes; the user has `svelte5` and `sveltekit` skills, so use
   them). Start functional: roster paste, add a drill or start a run, an entry list,
   and a **sync inspector** panel showing client id, cursor, last mutation id, pending
   mutations, rejections (each with a dismiss button), the offline switch, "Pull now"
   and "Reset local data". Rejections must stay visible next to the affected player
   until dismissed. Never drop them silently. Then port the prototype's number pad and
   phone layout.
4. **`README.md`** with how to run it, and **`docs/sync-protocol.md`**: a cleaned-up
   version of the protocol section above, written for the coach.
5. **Edge cases to test on purpose** (the experiment's real goal), ideally as tests that
   run two simulated clients against one server:
   - Two clients enter results for the same player while offline.
   - Deleting a run on one client while another adds results to it.
   - Changing a run's setup after makes have been entered.

Known follow-ups, not urgent:
- Several tabs open on one device: share state through a `BroadcastChannel` or a lock.
- Partial sync (a `team_id` and per-team pulls).
- Cleaning up old tombstones.
- Auth.
- Showing a "last edited by" when two coaches disagree on a value.

## How to run

```sh
docker compose up -d                 # Postgres on :5433
cd server && mix setup && mix phx.server   # API on :4000
cd web && npm install && npm run dev       # app on :5173 (proxy not configured yet)
```

On the original machine, `erl --version` hangs because it starts an interactive shell.
Use `elixir -v` instead.

## Working agreements with this user

- **American spellings** in all writing.
- **Commit as you go** on a work branch, after each coherent step. You don't need to
  ask before a local commit. **Never commit on `main`.**
- **Ask before pushing** or opening a PR: show the change and a plain-English summary,
  then wait for a yes. **Squash** into clean commits before any push.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use they/them for anyone whose pronouns you don't know.
- The user prefers being given a recommendation over a survey of options.
