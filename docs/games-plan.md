# Plan: organizations, seasons and game stats

Two phases:
1. Restructure the practice data so it's organized by organization, program, team and
   season.
2. Add games: live entry by a manager, corrections from film, and team-level opponent
   stats.

The terms used here are defined in [`GLOSSARY.md`](../GLOSSARY.md). The decision to
scope data by organization is
[ADR 0001](adr/0001-scope-sync-by-organization.md). Evidence about existing apps is in
[`research/game-stat-apps.md`](research/game-stat-apps.md).

Nothing is deployed and the dev data is disposable, so the existing migration is
rewritten rather than migrated.

## Decisions

- **Structure:** organization (a school) → program (girls' or boys' basketball) → team
  (varsity or JV). A program has a `sport`; `basketball` is the only value for now.
- **Players belong to a program.** A roster entry puts a player on a team for a season,
  with a jersey number. A player can be on two teams in one season. "Active" means "on
  a roster this season".
- **A season** belongs to the organization and has a name and dates. A date belongs to
  the season whose range contains it. The app creates the season for a school year
  (August 1 to July 31) the first time a date in it is used. That also works offline.
- **Drill runs belong to the program**, and their season comes from their date, so
  JV and varsity can share a practice. **Games belong to a team.**
- **Generic vs. basketball-specific.** Organizations, programs, teams, seasons, roster
  entries, drills, drill runs and games are generic. The play stats, game rules, box
  score math and live screen live in a `basketball` module on the server and on the
  client, chosen by the program's sport.
- **Every edit sends only the fields it changes,** so "the most recent write wins, per
  field" holds. A `*.put` mutation creates the row when it doesn't exist (and then
  needs the required fields) and otherwise changes only the fields it sends.
- **"Most recent" means last to reach the server.** That's a known limit, documented
  with a test: a phone that was offline for hours overwrites newer edits to the same
  fields when it syncs.
- **No sign-in yet.** Access stays on the local network or tailnet. The manager uses
  the coach's phone or a team device.

---

## Phase 1: restructure practice

### Schema

Every synced table gets `organization_id`, `version` and `deleted`.

```
organizations    id, name
org_versions     organization_id, version        (the counter; replaces server_meta)
programs         id, organization_id, name, sport
seasons          id, organization_id, name, starts_on, ends_on
teams            id, program_id, name, default_rules (json, phase 2)
players          id, program_id, name
roster_entries   id, team_id, season_id, player_id, jersey     unique (team, season, player)
drills           id, program_id, name, kind, default_setup, archived
drill_runs       id, program_id, date, drill_id, setup
results          id, drill_run_id, player_id, value, setup     unique (run, player)
clients          id, organization_id, last_mutation_id
```

- Seasons in an organization can't overlap. The server checks this.
- Push and pull take an `organization_id`. The server keeps a dev seed with one
  organization, one program (girls' basketball) and one team, and the phone uses it.
  When sign-in arrives, the session supplies the organization instead.
- A push locks its organization's row in `org_versions`. Pull runs in a snapshot and
  filters by organization.

### Mutations

| name | rules |
|------|-------|
| `program.put`, `team.put`, `season.put` | names required; season dates valid and not overlapping |
| `roster.put` | player, team and season exist in the same organization; one entry per team, season and player |
| `roster.remove` | tombstones the entry; the player's past results and plays stay |
| `player.put`, `drill.put` | as today, but only sent fields change; a drill's kind still can't change |
| `run.*`, `result.*` | as today, scoped to a program. The date must fall in a season. |

### Client

- New tables in the stores. Because the dev data is disposable, a schema version bump
  can clear the phone's data.
- A program picker in the header and a season picker. Both are remembered on the phone.
- Roster tab: the roster for each team this season, with jersey numbers. Adding a
  player creates them and their roster entry in one step.
- Drill entry lists every player on any of the program's rosters this season, with an
  optional team filter.
- History: filter by season and by team.

### Tests

- Server:
  - each new rule, accepted and rejected;
  - an edit that sends one field leaves the others alone;
  - two organizations' pushes don't affect each other's versions or pulls.
- Engine:
  - two phones edit different fields of the same player, and both changes survive;
  - a phone that was offline overwrites a newer edit to the same field, which is the
    documented limit;
  - creating a season offline before the first practice of the year.
- Existing practice tests keep passing after the restructure.

### Steps (one commit each)

1. Rewrite the migration and the schemas, add organization scoping and the counter
   per organization to push and pull, add the new mutators, and update the tests.
2. Make every edit send only its changed fields, on client and server.
3. Update the client sync layer: types, mutators, stores and the fake server.
4. Update the UI: the program and season pickers, the roster for each team, and the
   filters.
5. Update `docs/sync-protocol.md` (organizations, partial updates, the arrival-order
   limit) and the README.

---

## Phase 2: games

### Schema

```
games  id, organization_id, team_id, date, opponent, home_away, status,
       rules (json), official_us, official_them
plays  id, organization_id, game_id, side, player_id, stat, foul_type,
       assist_player_id, drawn_by_player_id, period, clock, video_at,
       position, recorded_at
```

- **`status`** is `live`, `final` or `reviewed`. It's informational only and never locks
  a game, because corrections from film come after a game is final.
- **`official_us` and `official_them`** hold the score from the scorebook. They're
  optional and entered when the game is marked final. Records use them when they're
  set and fall back to the score from plays.
- **`rules`** is copied from the team's `default_rules` when the game is created and can
  be edited for that game, so changing a team's default never rewrites old games.
- **`side`** is `us` or `them`. Plays for `them` have no player. Plays for `us` may have
  none: team rebounds, bench technicals, or "someone scored, fix it from film".
- **`stat`** (basketball): `ft_made`, `ft_missed`, `fg2_made`, `fg2_missed`,
  `fg3_made`, `fg3_missed`, `oreb`, `dreb`, `stl`, `blk`, `tov`, `foul`. The server
  checks it against the program's sport.
- **`foul_type`**: `personal` (the default), `offensive`, `technical` or `flagrant`, on
  fouls only. An offensive foul counts as a foul and a turnover in the box score; it's
  one play, not two.
- **`assist_player_id`**: on our made field goals only, and never the shooter.
- **`drawn_by_player_id`**: our player who was fouled, on opponent fouls only.
- **`position`**: a sort key between the play's neighbors. Live plays go at the end;
  "add play after this one" in review puts a play exactly where it belongs. Ties
  (rare, since one live scorer is expected) are broken by the play's id.
- **`period`** is required; **`clock`** (seconds left in the period) and **`video_at`**
  (seconds into the film) are optional and editable. They're shown in the play-by-play
  but don't decide its order.
- **Players**: any player in the program can appear in a game, roster entry or not, so
  call-ups and old games both work.

### Game rules

These are basketball rules, stored as JSON on teams and games:

- the period type and count, such as 4 quarters or 2 halves;
- the period length and overtime length, used to check clock entries;
- when team fouls reset: each period or each half;
- the bonus: the foul it starts at, and whether it's one-and-one or two shots;
- the double bonus, if any;
- the fouls needed to foul out, and the technicals needed for an ejection;
- which foul types count toward team fouls and personal fouls.

There are presets for current NFHS high school, older NFHS, NCAA men and NCAA women,
plus a custom option. **Every preset value, including how each foul type counts, must
be checked against the current rule books before it ships.** The research flagged its
NFHS bonus rule as from memory.

### Mutations

| name | rules |
|------|-------|
| `game.put` | team exists; opponent required; date valid; status, home or away, and rules valid |
| `game.delete` | tombstones the game and its plays |
| `play.put` | game exists and isn't deleted; the side and player rule; the stat is in the sport's list; the assist, foul type and drawn-by rules above; period ≥ 1; clock within the period's length |
| `play.delete` | no-op if already gone |

`play.put` creates or edits a play, sending only the changed fields like every other
`*.put`.

Rejection messages, matched on client and server:
- "That game was deleted."
- "That play was deleted." (an edit to a play another phone deleted)
- "The other team's plays can't have a player."
- "Only made shots can have an assist." / "A player can't assist their own shot."

### Live screen

```
┌────────────────────────────────────┐
│ vs Lincoln   [Q2 ▾]   38 – 31      │
│ Team fouls: us 3 · them 5 BONUS    │
├────────────────────────────────────┤
│ [4 Ava ·2F] [8 Riley] [11 Sam ·1F] │  ← player first (or Team)
│ [12 Jo] [15 Mia ·4F] [22 Kai] [Team]│
├────────────────────────────────────┤
│  FT ✓  FT ✗   2 ✓  2 ✗   3 ✓  3 ✗  │  ← then the stat
│  OREB  DREB  STL  BLK  TO  F       │
├────────────────────────────────────┤
│ Them: +1 FT✗ +2 +3 miss DREB OREB TO F │
├────────────────────────────────────┤
│ Assist? [players…]          [skip] │  ← follow-up prompt
├────────────────────────────────────┤
│ Q2  Riley 2 ✓ (ast Ava)          ✎ │
│ Q2  Them DREB                    ✎ │  ← last 3–5 plays, editable
│ Q2  Sam F                        ✎ │
│                [Undo "Riley 2 ✓"]  │
└────────────────────────────────────┘
```

- **Player first, then the stat:** two taps. The selected player stays selected, so
  an and-one is three taps. The research found stat-first more common but no evidence
  either order is faster. Player-first keeps the and-one case short.
- **Follow-up prompts, all skippable**, dismissed by the next tap:
  - after our make: "Assist?" with players;
  - after any miss: "Rebound?" with players, Team or Them;
  - after our F: "Offensive / Technical / Flagrant";
  - after their F: "Fouled?" with players.
- **Foul counts on each player button**; the bonus shows beside team fouls, from the
  game's rules.
- **`Them: miss`** records a two-point miss, because nobody can tell a 2 from a 3 on a
  miss in real time.
- **Every tap is saved on the phone before the screen shows it.** A test closes and
  reopens the app mid-game.
- **Undo** deletes the last play this phone added, synced or not, and says what it
  removed.
- **No lineups or running clock.** The screen stays awake, as drill entry does.

### Review screen and box score

- The play-by-play grouped by period. Tapping a play opens an edit sheet: side, player,
  stat, foul type, assist, drawn by, period, clock and film time, with a delete button.
  "Add play after" inserts with the same sheet.
- A status control (live, final, reviewed). Marking a game final asks for the official
  score.
- **Mismatch flag**: "Plays total 52–48, official 54–48: 2 points missing for us",
  shown in review and in the game list.
- **Hints, not rules**: plays with no player on our side ("fix from film"), and clock
  values out of order.
- **Box score**: for each player, plus team and opponent totals:
  - points, field goals made and attempted, 3s, free throws;
  - offensive, defensive and total rebounds;
  - assists, steals, blocks;
  - turnovers, including offensive fouls;
  - fouls, fouls drawn.
- Tapping a box score cell lists the plays behind it, ready to edit or delete. A play
  can be added from there.

### Season totals and comparing practice to games

- Season totals for each player across a team's games, with per-game averages.
- Practice compared with games for matching skills, starting with free throw
  percentage: drill runs of free throw drills against `ft_made` and `ft_missed` in
  games. A drill gets an optional "matches game stat" link to make this explicit.

### Client and tests

- **Replay performance check, before any UI.** Today every pending mutation copies its
  table's `Map`. A full game offline is around 400 pending plays, replayed after every
  tap. Measure on a phone-class CPU throttle. If a tap takes more than about 16 ms,
  copy each table once per replay instead. The change stays inside `replay.ts` and
  `mutators.ts`.
- **`basketball` module** (`stats`, `rules`, `boxScore`, `playOrder`) with unit
  tests:
  - each preset's bonus and foul-out math;
  - an offensive foul counted as a turnover;
  - assists and fouls drawn counted for the right player;
  - the official score mismatch;
  - ordering by position.
- **Server tests:** each rule above; an edit to a deleted play is rejected; deleting a
  game tombstones its plays; the database checks back up the side and player rule and
  the assist rule.
- **Engine tests:**
  - a film edit on one phone while another phone is offline, then both sync;
  - an edit to a play another phone deleted is rejected, and the play stays gone;
  - plays added to a game another phone deleted are rejected and shown as "Won't sync";
  - closing the app mid-game loses nothing.
- **End-to-end (Playwright):** live entry with the phone going offline and back, and a
  film correction on one phone showing up on another. No test of two phones scoring
  live at once (see below).

### Steps (one commit each)

1. Server: migration, schemas, mutators, the `basketball` validation module, pull and tests.
2. Client sync layer: types, mutators, stores, fake server and engine tests.
3. The replay performance check, and the fix if it's needed.
4. Client `basketball` module: rules presets (after checking the rule books), box
   score, order, and tests.
5. UI: the games tab, game list and "New game" sheet, and rules on the team settings.
6. UI: the live screen.
7. UI: the review screen, box score, official score and mismatch flag.
8. UI: season totals and comparing practice to games.
9. Docs, then the end-to-end run.

---

## Later, and not blocked by this design

- **Split scorer roles**, such as one phone for shots and one for everything else.
  Plays support it; it needs a role per phone and a filtered live screen.
- **Sign-in**, which would limit a coach to their own program, and deploying.
- **Other sports:** a sport module with its own stats, rules, box score and live screen.
- **Sharing drills between programs**, head-to-head history and opponents as records.
- Lineups, minutes, plus-minus, shot charts, individual opposing players, playing film
  in the app, and exporting games as CSV.
- **If Courtside becomes a product**, student data privacy (FERPA and state laws), and
  whether to keep the hand-rolled sync. The engine boundary allows a library to replace
  it.
