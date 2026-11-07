# Plan: game stats

Track games alongside practice: live entry during the game, corrections from film
afterward, and team-level stats for the opponent. Same roster, same sync protocol.

## Model

```
games        id, date, opponent, home_away, status, version, deleted
game_events  id, game_id, side, player_id (nullable), stat, period,
             clock (nullable), video_at (nullable), recorded_at, version, deleted
```

- **Events are the source of truth.** Box scores, the score and the play-by-play are
  computed from them, on the server only if ever needed and on the phone always.
  Nothing stores totals, so two devices can never overwrite each other's counts.
- **`side`** is `us` or `them`. Events for `them` must have no player. Events for `us`
  may have none: team rebounds, team turnovers, or "someone scored, fix it from film".
- **`stat`**: `ft_made`, `ft_missed`, `fg2_made`, `fg2_missed`, `fg3_made`,
  `fg3_missed`, `oreb`, `dreb`, `ast`, `stl`, `blk`, `tov`, `foul`. Any stat is allowed
  on either side.
- **`period`**: 1 to 4, then 5, 6, … for overtime.
- **`clock`**: seconds left in the period, optional. Live entry usually skips it; film
  review fills it in.
- **`video_at`**: seconds into the film, optional. Unused by the UI at first, but it's
  cheap to keep now and lets a later version jump to the play.
- **`recorded_at`**: the device's time when the event was added. It breaks ties in the
  play-by-play order and is never edited.
- **Order**: period, then clock counting down (events without a clock sort by
  `recorded_at` among themselves), then `recorded_at`.
- **`status`**: `live`, `final` or `reviewed`. It's informational only: film
  corrections happen after a game is final, so no status locks a game.
- **Players**: any player, active or not, can appear in a game's events, so editing an
  old game still works after someone leaves the roster.

## Mutations

| name | args | rules |
|------|------|-------|
| `game.put` | full game | opponent required, date valid, `home_away` and `status` known |
| `game.delete` | id | tombstones the game and its events (like `run.delete`) |
| `game_event.add` | full event | game is live (not deleted), player exists, side/player rule, stat known, period ≥ 1, clock ≥ 0 |
| `game_event.update` | id + **only the changed fields** | event and game are live, same rules on the result |
| `game_event.delete` | id | no-op if already gone |

**`game_event.update` sends only the fields that changed.** That's what makes the
existing rule (the most recent write wins, *per field*) true for events: one device
fixing the player and another fixing the clock both keep their change. The existing
`*.put` mutations send whole rows, so this is the first partial update. It's worth a
paragraph in `docs/sync-protocol.md`.

Rejection messages, matched on client and server:
- "That game was deleted." (add or update into a deleted game)
- "That play was deleted." (update of a tombstoned event)
- "The other team's plays can't have a player."
- "That player is no longer on the roster." (unknown player id)

## Work, in order (one commit each)

1. **Server.** Migration (two tables, foreign keys, checks on `side`, `stat` and
   `period`, and `player_id IS NULL` when `side = 'them'`), schemas in a new
   `Courtside.Games` module, the five mutators in `sync/mutators.ex`, and both tables
   added to pull in `sync.ex`. Tests in `sync_test.exs`:
   - each rule above, accepted and rejected;
   - a partial update changes only the fields it names;
   - an update to a deleted event, and an add to a deleted game, are rejected;
   - `game.delete` tombstones the events, and pull reports them;
   - the database check backs up the side/player rule.
2. **Client sync layer.** Types, mutators matching the server's, `applyPull` for the
   two tables, Dexie schema `version(2)` (existing practice data stays as is) and the
   memory store, and the fake server. Engine tests across two devices:
   - two scorekeepers offline, both add events: after syncing, both phones hold all of them;
   - device A edits an event's player while B edits its clock: both changes survive;
   - A edits an event that B deleted: the rejection shows on A, and the event stays gone;
   - A logs plays into a game that B deleted: rejected, and shown as "Won't sync".
3. **Replay performance check.** Today every pending mutation copies its table's `Map`.
   A long game offline is around 400 pending events, replayed after every tap.
   Measure computing the view with 400 pending events on a phone-class CPU throttle.
   If one tap takes more than about 16 ms, copy each table once per replay instead of once per mutation.
   That change stays inside `replay.ts` and `mutators.ts`.
4. **Game stats logic** (`ui/games.ts` with tests): play-by-play order, box score per
   player, team totals (with and without a player), opponent totals, score, shooting
   percentages, and team fouls in the current period.
5. **UI, in three commits:**
   - **Games tab**, a fifth tab. It holds the list of games (date, opponent, score,
     status) and a "New game" sheet (opponent, date, home or away). History stays
     drills-only.
   - **Live screen** (below).
   - **Review screen.** The play-by-play grouped by period. Tapping a play opens an
     edit sheet for side, player, stat, period, clock and film time, with a delete
     button. "Add play" inserts one with the same sheet, and the order puts it in
     place by period and clock. A status control sets live, final or reviewed. The
     box score sits on its own tab within the game.
6. **Docs.** `docs/sync-protocol.md` (partial updates, the two tables), README, handoff.
7. **End-to-end run** in Playwright with two phones:
   - live entry on both phones;
   - one phone offline, then back online;
   - a film correction on one phone showing up on the other.

## Live screen

```
┌────────────────────────────────────┐
│ vs Lincoln        Q2   38 – 31     │
│ Team fouls: us 3 · them 4          │
├────────────────────────────────────┤
│ [4 Ava  ·2F] [8 Riley] [11 Sam ·1F]│  ← tap a player (or "Team")
│ [12 Jo] [15 Mia ·4F] [22 Kai] [Team]│
├────────────────────────────────────┤
│  FT ✓  FT ✗   2 ✓  2 ✗   3 ✓  3 ✗  │  ← then a stat; the event is recorded
│  OREB  DREB  AST  STL  BLK  TO  F  │
├────────────────────────────────────┤
│ Them: +1 +2 +3  miss  OREB TO F    │  ← one tap each, no player
├────────────────────────────────────┤
│ Last: Riley 3 ✓ (Q2)        [Undo] │
└────────────────────────────────────┘
```

- Player first, then stat: two taps per play. The selected player stays selected, so
  "made 2, then the and-one free throw" is three taps.
- Each player button shows their foul count. Foul trouble is the stat a coach needs live.
- "Team" is the player-less `us` side.
- The `Them: miss` button records `fg2_missed`, a two-point miss, because nobody
  can tell 2 from 3 on a miss in real time. Fix it from film if it matters.
- Undo deletes the last event this device added, even if it hasn't synced yet.
- A period control (Q1–Q4, OT) sits in the header. Events take the current period.
- The screen stays awake, as drill entry does.

## Out of scope for now

- Lineups, substitutions, minutes and plus-minus.
- Shot locations and shot charts.
- Individual opponent players.
- Playing the video in the app (`video_at` is stored for later).
- Season totals across games. They're easy to add to the box score logic later.
- Exporting games as CSV.

## Open question

- **Do two people ever score the same game?** The design works either way. The
  answer only decides how much the two-scorekeeper tests and end-to-end run matter
  compared with undo and speed.
