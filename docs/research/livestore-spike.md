# Spike: LiveStore for games

Would LiveStore, an event-sourced local-first data layer, be a better model for
Courtside's game stats (and maybe everything) than our hand-rolled sync? Questions
from [`docs/games-plan.md`](../games-plan.md), "Spikes, between phases 1 and 2".

Spiked 2026-11-09 on branch `spike/livestore`, code in `spikes/livestore/`. Headless
Vitest tests on LiveStore's Node adapter, with an in-process stand-in for "Phoenix as
the sync backend" (`src/server.ts`). Every claim below marked *(test)* is a passing
test in `spikes/livestore/test/`; numbers are from the dev Mac, Node 22.

## Summary

- **Recommendation: stay hand-rolled, for games and for everything.** LiveStore does
  offline writes well, but it has no way for the server to refuse a change, and
  Courtside's rules, rejections and "N changes not saved" depend on exactly that.
- **Offline works.** 440 events recorded on two offline phones converged in 1.6 s,
  with everything arriving once and both phones agreeing row for row *(test)*.
- **Conflict policy is the same as ours:** the last edit to reach the server wins, per
  field, if edits are partial events *(test)*.
- **No server veto.** The sync protocol has no "refused" answer. A server that refuses
  an event wedges that phone for good: later good events never arrive *(test)*.
- **Rules live in every phone's code.** A phone on an older app version that lacks a
  rule shows plays the others hide, and keeps disagreeing *(test)*.
- **The phone can't tell it's unsynced.** `syncStatus()` covers the phone's own
  session and leader, not the server: the wedged phone reports `isSynced: true`
  *(test)*.
- **Rule checks that read state break dev mode.** livestorejs/livestore#503 (open since
  July 2025) stalls sync during rebases when a materializer uses `ctx.query`, which
  every Courtside rule needs *(test)*.
- **Schema changes have sharp edges.** A phone that skipped an unknown event never
  replays it after updating, unless the release also changes a state table *(test)*.
- **The log only grows.** A season is ~11,000 events, 2.8 MB on the phone; rebuilding
  state from it takes 2.4 s on a Mac. There's no compaction in 0.5.0.
- **Phoenix as the backend is feasible** (an ordered log per store, push only at the
  head, pull from a cursor), but it can't add the missing refusal.

## Gain, lose, neutral

| | What | Compared with Courtside today | Evidence |
|---|---|---|---|
| Gain | Offline writes and rebasing are built in | We wrote and test our own queue, replay and engine | Q1 |
| Gain | A real local SQLite with reactive queries | We hold Maps and recompute the view; a box score would be hand-written JS | `src/device.ts` |
| Gain | Full history of every play, by design | We keep current rows plus tombstones; history would be extra work | the event log |
| Gain | Fast: 0.66 ms per commit, 20 ms cold open for a season | Ours is similar for practice data; untested at 400 pending | Q4 |
| Neutral | Last arrival wins per field | Same, by design | Q1 |
| Neutral | Deterministic "refused" table built by materializers | Like our rejections, but computed on each phone, not by the server | Q2 |
| Neutral | Svelte 5 wrapper exists, thin | We have our own `$state.raw` binding | Q6 |
| Lose | The server can't refuse a change | Our server refuses, records why, and the phone shows it | Q2 |
| Lose | Rules depend on every phone's app version | Our server applies one version of the rules to everyone | Q2 |
| Lose | No signal for "not saved to the server" | Our pending count is exactly that | Q2 |
| Lose | Dev mode stalls with state-reading rules (#503) | No such issue | Q1, smoke test |
| Lose | Unknown events skipped on old phones are never replayed unless tables change | Our server data is one shape; old phones just get rejections | Q3 |
| Lose | Log grows forever, every phone holds all of it, no compaction | Phones hold current rows only | Q4 |
| Lose | No auth; examples are stubs and Cloudflare-centric | Our plan has device tokens and per-program checks in one place | Q7 |
| Lose | Maturity: 0.5.0, Effect 4 under the hood, version overrides needed to install | Our code is small and ours | setup |

## Answers

### 1. Offline, two devices *(test/offline.test.ts)*

A scripted game of 400 plays, with about 1 edit per 15 plays and 1 undo per 30, split
between phone A (our plays) and phone B (theirs), both offline: 440 events.

- A pushed 257 events in 213 ms. B pulled, rebased its 183 and pushed them in 1.26 s.
  Both phones converged 1.6 s after coming online.
- Every event reached the server exactly once, and both phones hold identical plays.
- The server log has all of A's events, then all of B's. The screen order comes from
  each play's `position`, so the play-by-play interleaves correctly by game time (193
  switches between phones).
- Two offline edits to the same play: the one that reaches the server last wins, field
  by field (A's player and assist, B's period). Same as Courtside.
- An offline edit to a play another phone deleted: the edit is in the log (nothing
  refuses it), but the materializer ignores it the same way on both phones and records
  "That play was deleted." in a `refused` table.

### 2. Rules without a server veto *(test/rules.test.ts)*

- **Old app versions disagree.** A phone without the rule "the other team's plays can't
  have a player" records such a play. It's in every log; the phones with the rule hide
  it and list it as refused; the old phone counts it. Box scores differ until the old
  phone updates, and see Q3 for why updating may not fix it.
- **The server can't refuse.** The `SyncBackend` contract's push can only succeed or
  fail (`ServerAheadError`, `IsOfflineError`, `UnknownError`…). Refusing a bad event
  means failing the push, which the client retries for ever: nothing after the bad
  event ever reaches the server, the phone shows everything as saved, and
  `syncStatus()` says `isSynced: true, pendingCount: 0`. The custom-provider docs do
  suggest "schema-aware validation" on push, but give the client no way to handle a
  refusal.
- **Throwing in a materializer** (LiveStore's documented way to reject an event) on a
  pulled event: the error is only logged, the phone's head moves past the batch, the
  batch's state changes are rolled back (losing the good play that came with the bad
  one), and that phone stops syncing.
- **What works:** materializers that deterministically *skip* a bad event and record
  why. Every phone running the same rules converges, and the coach can be shown
  "won't count" like our rejections. It's only as strong as the oldest app in use.

### 3. Schema changes *(test/schema.test.ts)*

Events are immutable; a new shape is a new event (`v2.PlayRecorded` with `foul_type`).

- With the default `unknownEventHandling: 'warn'`, a v1 phone keeps the v2 event in its
  log but shows nothing for it.
- Updating that phone to an app with the v2 materializer **doesn't show the play**, not
  even after reconnecting. The state database is named after a hash of the *tables*
  (`state${schema.state.sqlite.hash}` in `@livestore/common`), so a new materializer
  doesn't trigger a rebuild, and the skipped event is never replayed.
- Changing any state table in the same release forces a rebuild from the stored log
  (63 ms for this small log), and the play appears. So every release that adds an event
  must also change a table, or old phones silently miss data.
- With `'fail'`, a v1 phone stops syncing at the first v2 event.
- The docs ([app evolution](https://docs.livestore.dev/patterns/app-evolution/)) don't
  say when state is rebuilt.

### 4. Size *(test/size.test.ts)*

A season: 25 scripted games, 11,046 events, 9,675 live plays, file storage.

| Measure | Result |
|---|---|
| Commit, one per tap | 0.66 ms each |
| On disk | 3.6 MB: event log 2.8 MB, state 760 KB |
| Server log as JSON | 2.7 MB, about 256 bytes per event |
| Cold open | 20 ms |
| Rebuild state from the log | 2.4 s |

The rebuild is what every table change costs, and roughly what a new phone pays to
catch up. A phone in a browser will be slower than Node on a Mac (not measured).
`compactEvents` exists only under `@livestore/common/dist/sync/next` and nothing calls
it, so there's no compaction in 0.5.0. Every phone holds its store's whole log.

### 5. Phoenix as the backend

From [custom sync providers](https://docs.livestore.dev/sync-providers/custom/) and the
in-process model in `src/server.ts`, which LiveStore syncs through in every test:

- The client numbers events; the server keeps one ordered log per store and accepts a
  push only if it starts at its head + 1 (otherwise `ServerAheadError`, and the client
  pulls and rebases). One push at a time per store; pulls in parallel.
- Phoenix would need: an `events` table per store (sequence number, parent, name, args
  as JSON, client and session ids), a push endpoint holding a per-store lock (like our
  `org_versions` lock), a pull endpoint from a cursor with paging, and live pull, which
  our poke channel could carry. The client side is a `SyncBackend` in TypeScript over
  HTTP and the channel; `src/server.ts`'s `makeDeviceBackend` is the template.
- Estimate: a few days for both halves. The work is fine; the gap is that server-side
  validation in Elixir has nowhere to send a refusal (Q2), and any server-side report
  (season totals across phones) would need the events replayed in Elixir too.

### 6. Svelte 5

`@livestore/svelte` 0.5.0 is one function, `createStore`, which patches `store.query` to
register a `SvelteSet` dependency when called inside `$effect.tracking()`. It needs
Svelte 5.31 or later (Courtside has 5.41) and expects a top-level `await` in the
component. Small enough to understand, and to replace with our own binding. Not tried
in a browser.

### 7. Sign-in and tenants

[Auth](https://docs.livestore.dev/patterns/auth/): "LiveStore doesn't include built-in
authentication or authorization support." You pass a `syncPayload` (a token) or forward
headers, and check them in the backend; the examples' access checks are empty stubs and
target Cloudflare Durable Objects. A tenant is a `storeId`; one store per organization
would sync everything to every phone, as ours does today, and per-program access would
mean one store per program.

### Practice data

Drill results have server rules that depend on other rows ("makes can't exceed shots",
lowering a run's setup below someone's makes). In LiveStore each would be a
materializer reading state (hitting #503 in dev) and skipping deterministically. Two
coaches changing makes and shots at once would both see their change until a pull, then
one becomes "won't count", similar to today, but decided by log order on each phone
rather than by the server, and subject to the app-version problem in Q2.

## If we adopted it anyway

Not recommended, but the cost would be: write the Phoenix event log and the TypeScript
`SyncBackend` (days); move every rule into materializers that skip, never throw; bump a
state table with every new event; build our own "not saved to the server" indicator,
probably by tracking the backend's acknowledged head; work around #503 in dev (or patch
it, as forks have); and accept that phones on old versions can disagree. Worth
revisiting if LiveStore adds a refusal answer to push and a server-level sync status.

## Ideas worth keeping in our own sync

- Plays as small add/edit/delete changes with a position key, which phase 2 already
  plans.
- A "won't count" list computed on the phone, which our "Won't sync" marking already
  is.
- A local SQLite for querying (box scores, season totals) could be worth it later, but
  isn't needed at Courtside's sizes.

## Versions and setup

`@livestore/livestore`, `adapter-node`, `common`, `svelte`, `utils`, `peer-deps`:
0.5.0. They need Effect 4.0.3; `package.json` pins it and related packages with
`overrides` to install cleanly. Tests run with `NODE_ENV=production` because of #503.

## Sources

- LiveStore docs index: https://docs.livestore.dev/llms.txt
- How LiveStore works: https://docs.livestore.dev/overview/how-livestore-works
- Syncing: https://docs.livestore.dev/building-with-livestore/syncing
- Custom sync providers: https://docs.livestore.dev/sync-providers/custom/
- App evolution: https://docs.livestore.dev/patterns/app-evolution/
- Auth: https://docs.livestore.dev/patterns/auth/
- Issue #503, hash mismatch with `ctx.query`: https://github.com/livestorejs/livestore/issues/503
- Source read: `@livestore/common/dist/leader-thread/materialize-event.js` (dev-only
  hash check), `.../schema/state/sqlite/persistence.js` (state database name),
  `.../sync/next/compact-events.d.ts`
