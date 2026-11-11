# Handoff: Courtside

You're picking up a half-built project. Read this whole file before changing anything.

> **Superseded where they disagree.** A design review with the coach on 2026-11-07
> replaced parts of this file, including its "don't reopen" decisions and the ban on
> sync libraries. Where this file disagrees with these, they win:
> [`docs/games-plan.md`](docs/games-plan.md), [`GLOSSARY.md`](GLOSSARY.md) and
> [`docs/adr/`](docs/adr/). Keeping the sync hand-rolled is now a choice made on its
> merits (server authority, offline writes, Phoenix), not a rule.

## What this is

A stat tracker for a high school basketball program. During practice, players finish a
drill and report a number to the coach, who enters it on a phone; any drill works. In
games, a scorer records each play live, the coach corrects the plays from film, and box
scores and season totals come from them.

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

## Sync protocol

[`docs/sync-protocol.md`](docs/sync-protocol.md) is the full and current write-up:
Replicache-style push and pull, one version counter per organization taken under a
row lock, tombstones, rejections through pull, every change (mutation) and its
arguments, restoring deleted games and runs, and the change log behind history. The
rules for each change are in `server/lib/courtside/sync/mutators.ex` and
`web/src/lib/sync/mutators.ts`, kept in step by the shared cases in `spec/mutations/`.

## Current state

**Phases 1 and 2 of [`docs/games-plan.md`](docs/games-plan.md) are done**, along with
both spikes (`docs/research/`). Phase 1 organized the data by organization, program,
team and season. Phase 2 added games, with one commit per step:

- Games and plays on the server and the phone, with the rules in both (`basketball.ex`,
  `sync/basketball.ts`) and team rules presets, Minnesota (MSHSL) included.
- The Games tab: the game list, a new game sheet, and rules chosen per team.
- The live screen: player then stat, the same 12-key pad for us and them, follow-up
  questions (assist, rebound, foul type, fouled player, steal and turnover pairs, block
  and miss pairs), team fouls and the bonus, and foul trouble.
- Review: the play-by-play with edits from film, the box score (tap a number for its
  plays), game status, the official score and the mismatch flag.
- Season totals per team, and practice vs games for drills linked to a game stat.
- Restoring a game or drill run another phone deleted, with the changes refused
  because of it.
- Undo on the live and practice entry screens, and history with revert on plays,
  games and players.
- End-to-end tests (`web/e2e/`, `npm run test:e2e`) against the dev servers.

Tests: `mix test` (server), `npm test` (web: mutators, replay, stores, the engine with
simulated phones, UI helpers), `npm run check` (types), `npm run test:e2e`.

## Next steps

Phase 3 (the Tauri mobile app) and phase 4 (sign-in) in `docs/games-plan.md`. Sign-in
must ship before any server is reachable from outside the tailnet.

Known follow-ups, not urgent:
- Several tabs open on one device: share state through a `BroadcastChannel` or a lock.
- Cleaning up old tombstones.
- Deleting a student's data must also blank them in the change log, before Courtside
  becomes a product.
- History covers plays, games and players; drill runs and results could use it too.
- Undo is on the live and practice entry screens only.
- Games played counts games with any stat, since minutes aren't recorded.
- Practice vs games shows the difference even on a handful of game attempts.
- The season picker is an unstyled native `<select>`.
- On the entry screen with a team filter, the summary line still covers the whole
  drill run.
- `web/src-tauri/` is untracked build output from the Tauri spike.

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
