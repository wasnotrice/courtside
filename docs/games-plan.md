# Plan: organizations, seasons and game stats

Three phases, with two spikes between the first and second:
1. Restructure the practice data so it's organized by organization, program, team and
   season, and make offline data safer on the web.
2. Spikes, each time-boxed and thrown away afterward: Tauri on iOS, and LiveStore for
   games.
3. Add games: live entry by a manager, corrections from film, and team-level opponent
   stats.
4. Ship Courtside as a Tauri mobile app.
5. Sign-in. It can come any time after phase 1, but it must ship before any server is
   reachable from outside the tailnet.

(The headings below call these phase 1, the spikes, phase 2, phase 3 and phase 4.)

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
- **No sign-in until phase 4; the tailnet is the gate.** Until then, anything that
  reaches the server can read and change everything. In dev, Vite listens on
  `localhost` only and is reached through `tailscale serve`, so only devices signed into
  the coach's tailnet get in. Never run it with `--host` on a shared network: Vite
  proxies `/api` and `/socket` to Phoenix, so school or gym Wi-Fi would expose
  students' names to anyone on it. The manager uses the coach's phone or a team device
  on the tailnet.

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

### Ready for sign-in

Sign-in isn't built, but three things are done now so that adding it later doesn't
touch every mutator, the stores or the sync engine:

- **Every server mutator takes a context** describing who is acting. For now it holds
  only the organization. Later it holds the user, and checks such as "this user may
  only change girls' basketball" live in one place.
- **The phone's local database is named after the organization.** One phone can then
  hold more than one organization, and signing out can delete exactly one.
- **An authorization failure is a sync failure, never a rejection.** A phone that comes
  back after a game with an expired session must keep its pending plays queued and
  retry after sign-in. The engine already treats HTTP errors this way; a test pins it
  down.

### Hardening sync

Three holes that sign-in alone wouldn't close, fixed while push, pull and pokes are
being rewritten:

- **Poke topics per organization** (`sync:<org_id>` instead of one `"sync"` topic), so a
  phone is only woken by changes in its own organization, and joining a topic can be
  checked once sign-in exists.
- **A client ID belongs to one organization.** A push or pull with a client ID
  registered to another organization is refused. Otherwise anyone who learned a client
  ID could read that phone's rejections or push as it.
- **Limits on push size:** a cap on the request body and on mutations per push, so one
  bad client can't hold the organization's lock.

### Mutations

| name | rules |
|------|-------|
| `program.put`, `team.put`, `season.put` | names required; season dates valid and not overlapping |
| `roster.put` | player, team and season exist in the same organization; one entry per team, season and player |
| `roster.remove` | tombstones the entry; the player's past results and plays stay |
| `player.put`, `drill.put` | as today, but only sent fields change; a drill's kind still can't change |
| `run.*`, `result.*` | as today, scoped to a program. The date must fall in a season. |

### Client

- New tables in the stores.
- **A schema upgrade never discards pending changes.** It's fine to throw away the
  phone's copy of the server's data and pull it again, because the server still has
  it. The pending queue exists only on the phone: an upgrade carries it over (rewriting
  old mutations into the new shape if needed), or syncs it before upgrading. Zero
  lists this exact problem, writes stranded by a schema change, as a blocker for its
  own offline support. A store test upgrades a database that has pending changes and
  checks they survive.
- A program picker in the header and a season picker. Both are remembered on the phone.
- Roster tab: the roster for each team this season, with jersey numbers. Adding a
  player creates them and their roster entry in one step.
- Drill entry lists every player on any of the program's rosters this season, with an
  optional team filter.
- History: filter by season and by team.

### Offline safety and the server address

- **A configurable server address.** Today the app calls `/api` and `/socket` on its
  own address through Vite's proxy. The transport takes a base URL instead (the same
  address by default), and Phoenix allows cross-origin requests from the app's
  addresses. The Tauri app (phase 3) needs this, and it's cheaper now than retrofitted.
- **Persistent storage on the web.** The app calls `navigator.storage.persist()`, and
  the sync inspector shows whether it was granted. Without it, the browser can evict
  the queue when the phone runs low on space.
- **Install to the home screen.** The README tells the manager to add Courtside to the
  home screen and only ever open it from there. On iOS that exempts it from Safari
  deleting a site's storage after 7 days without a visit, makes persistent storage
  likely to be granted, and avoids the home screen app and Safari holding separate
  copies.
- **One address in dev.** Storage belongs to the app's address, so plays recorded at
  `localhost`, the LAN address and the tailnet name live in three separate places. The
  README says to pick the tailnet name and stick with it. A guard that redirects other
  addresses was considered and dropped, since the Tauri app removes the problem.
- **A server data ID.** Pull returns an ID for the server's data, created with the
  database and changed whenever it's reset or restored. When a phone sees a new ID, it
  throws away its copy of the server's data and pulls from scratch, keeping its pending
  queue. Without it, a phone keeps rows a reset server no longer has. In production,
  point-in-time recovery is the real protection, so a restore never loses confirmed
  changes the phones have already dropped.

### Tests

- Server:
  - each new rule, accepted and rejected;
  - an edit that sends one field leaves the others alone;
  - two organizations' pushes don't affect each other's versions or pulls;
  - a client ID registered to one organization is refused by another;
  - a push over the size limits is refused before it takes the lock;
  - a poke reaches only phones in the organization that changed.
- Engine:
  - two phones edit different fields of the same player, and both changes survive;
  - a phone that was offline overwrites a newer edit to the same field, which is the
    documented limit;
  - creating a season offline before the first practice of the year;
  - a new server data ID makes the phone pull from scratch, drop rows the server no
    longer has and keep its pending changes;
  - a push that fails with HTTP 401 leaves every pending change queued, with none
    marked rejected, and the next successful sync sends them.
- Store: upgrading the schema with pending changes in the queue keeps every one.
- Every new and changed mutator gets shared JSON cases, so both sides are checked.
- Existing practice tests keep passing after the restructure.

### Keeping client and server mutators in step

Nothing checks today that the TypeScript and Elixir mutators agree. The worst drift is
silent: if the phone sends a field under a name the server doesn't know, Ecto's `cast`
drops it, the server accepts the change, and the next pull erases it from the phone.
Two guards, built before the restructure, which rewrites every mutator:

- **Shared test cases in JSON** (`spec/mutations/*.json`). Each case lists the starting
  rows, one mutation, and either the rows afterward or the exact rejection message.
  Vitest runs them through the TypeScript mutators; ExUnit runs them through the Elixir
  mutators against the database. One file covers rules, argument names and messages
  on both sides.
- **The server rejects unknown argument keys** ("Unknown field: assist_id") instead of
  dropping them, so a mismatched name fails loudly in development.

Generating code from a shared schema was considered and skipped: it needs a schema
format and a generator for each language, for about fifteen mutations.

### Steps (one commit each)

0. Shared JSON mutation cases, run by both test suites against today's mutators, and
   strict argument keys on the server.
1. Rewrite the migration and the schemas, add organization scoping and the counter
   per organization to push and pull, pass a context to every mutator, add the new
   mutators and the server data ID, allow cross-origin requests, harden sync (poke
   topics per organization, client IDs tied to their organization, push limits), and
   update the tests.
2. Make every edit send only its changed fields, on client and server.
3. Update the client sync layer: types, mutators, stores (one local database per
   organization) and the fake server, a configurable server address, persistent
   storage, the server data ID, plus the 401 test.
4. Update the UI: the program and season pickers, the roster for each team, and the
   filters.
5. Update `docs/sync-protocol.md` (organizations, partial updates, the arrival-order
   limit, the server data ID) and the README (home screen install, one dev address,
   Vite on `localhost` behind `tailscale serve`).

---

## Spikes, between phases 1 and 2

Both run after phase 1, when the structure has settled, and before game-day features
depend on their answers. Each is time-boxed, lives on its own branch and is thrown away;
what's kept is a short write-up in `docs/research/`. They're independent and can run in
either order.

### Tauri on iOS (about a day)

Get today's app running in the iOS simulator inside Tauri 2, and check:
- IndexedDB works inside the app and survives restarts;
- `crypto.randomUUID` exists in Tauri's web view;
- push, pull and WebSocket pokes reach Phoenix from the app's own address (CORS);
- keeping the screen awake works, through the web API or a plugin.

The sandbox can build for the simulator but can't sign builds, so a run on a real phone
is on Eric's side. If a check fails, phase 3 changes before phase 2 builds on it.

**Done (2026-11-09): it works.** See [`research/tauri-spike.md`](research/tauri-spike.md).
In the iOS simulator, the unchanged app synced with Phoenix, got pokes, and kept its
IndexedDB data across restarts, an update and a launch with the server down. The web
wake lock was refused; phase 3 below lists the fixes. Code on branch `spike/tauri`.

### LiveStore for games (two to three days)

The question: is an event-sourced library with no server authority a better fit for
plays than Courtside's own sync? Plays are already events that are only added to, so
games are the fairest test. The spike builds a stripped-down live screen (player, stat,
undo) on LiveStore, behind the same engine surface the UI uses (`snapshot`, `subscribe`,
`mutate`), and answers:
- **Offline:** a full game recorded offline on two devices, then synced. Does
  everything arrive, and in a sensible order?
- **Rules without a server veto:** how "only made shots can have an assist" holds when
  every device applies events itself, including a device running older code.
- **Schema changes:** what it takes to change a play's shape once events are stored.
- **Size:** how big a season's event log gets on a phone, and what compaction does.
- **Phoenix:** whether Phoenix can be a custom sync backend (ordered events from a
  cursor, plus notifications), or whether it needs Cloudflare or Node.
- **Svelte:** how well the Svelte integration works with Svelte 5.
- **Sign-in:** LiveStore's auth docs were unfinished on 2026-11-07; check again.

**Deciding:** if LiveStore is clearly better for plays, phase 2's sync work (steps 1–3)
is replanned around it before it starts. Otherwise phase 2 goes ahead as written, and
the write-up records why.

**Done (2026-11-09): stay hand-rolled.** See
[`research/livestore-spike.md`](research/livestore-spike.md). LiveStore handled offline
plays well, but its sync protocol has no way for the server to refuse a change, rules
depend on every phone's app version, and a phone can't tell it's unsynced. Phase 2 goes
ahead as written. The spike's code is on branch `spike/livestore`.

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
│ Them                               │
│  FT ✓  FT ✗   2 ✓  2 ✗   3 ✓  3 ✗  │  ← the same pad, team only
│  OREB  DREB  STL  BLK  TO  F       │
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
  - after their F: "Fouled?" with players;
  - steals and turnovers, and blocks and missed shots, are pairs, and whichever half
    is recorded asks for the other: after our TO, "Stolen?"; after their STL,
    "Turnover by?"; after a missed field goal, the rebound question also offers
    "Blocked" (and asks who, if it was ours); after a block, the shot it stopped (whose,
    if ours, then 2 or 3), placed just before the block, then the rebound.
- **Foul counts on each player button**; the bonus shows beside team fouls, from the
  game's rules.
- **The other team gets the same stat pad as ours,** every button in the same place,
  so the scorer's hands learn one layout. Their plays are team only: no player.
- **Every tap is saved on the phone before the screen shows it.** A test closes and
  reopens the app mid-game.
- **Undo** reverses this phone's last change, synced or not, and says what it
  removed (see "Undo and history").
- **No lineups or running clock.** The screen stays awake, as drill entry does.
- **Unsynced warning at the end of a game.** Marking a game final, or leaving the live
  screen, with plays still unsynced shows how many and asks the scorer to get signal
  before closing the app or handing the phone back.

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

### Restoring from a refusal

When another phone deletes a game or a drill run, every change recorded into it
offline is refused, and dismissing those refusals would lose them for good. Deletes
are tombstones, so the refusal can offer a way back:
- The refusals are grouped by the game or run they went into, one note each, on Games
  or Practice: "A game was deleted on another phone. 3 changes recorded into it on Wed,
  Nov 11 weren't saved." with **Restore the game** (or **Restore the drill**).
- **Restoring** sends `game.restore` or `run.restore` (just the id). The phone never
  sees deleted rows, so it can't rebuild the game itself: the server revives the row,
  plus the plays or results deleted along with it (those carrying the delete's
  version; ones deleted on their own before stay deleted). This needs a connection.
  Once the game is back on the phone, the refused changes are queued again as new
  changes, including edits to plays that came back with the game.
- If the game is already back (another phone restored it), the note offers **Save them
  again**, which only queues the changes again.
- An edit to a deleted game is refused ("That game was deleted.") rather than written
  to the deleted row, so it's grouped and restored the same way.
- **Dismiss** still works, after a second tap: "Dismissing loses them for good."

### Undo and history

The phone keeps no history: once the server confirms a change and the next pull
arrives, the old value is gone from the phone. So undo and history come from two
places, and both end by sending an ordinary change through sync, checked by the
rules like any other.

**Undo (on the phone, offline, recent changes only).** The only moment the phone
reliably knows a field's old value is when the change is made. So `AppState.mutate`
records each change's *reverse* at that moment, from the current view:
- adding a play, a drill run or a roster entry: the reverse deletes or removes it;
- an edit (`*.put`, `result.set_value`, `result.set_setup`): the reverse is the same
  change with the fields' current values, sending only those fields.

Reverses live in memory, newest first, for the screen they were made on; reloading
the app clears them. Undo sends the reverse rather than pulling the change out of the
queue, because the change may already be on its way to the server or confirmed. If
someone else changed the same field in between, undo overwrites theirs (the last
change to reach the server wins); on the live screen, with one scorer, that's rare.

**History (on the server, online, any change by anyone).** An append-only
`change_log` table, written in the same transaction as each push:
- organization, version, client, mutation id and name, and (once sign-in exists) user;
- the arguments, and whether the change was accepted or refused, with the reason;
- for accepted changes, each changed field's value before and after, from the Ecto
  changeset.

It isn't sent to phones in sync: pull stays "the current rows", phones don't carry a
growing log, and student data stays on the server. `GET /api/history` returns a row's
entries newest first (and later a game's edits, or recent changes for the
organization), filtered like pull. Phones show it when online and say "History needs a
connection" when not.

- **Revert from history** sends the entry's before values as an ordinary change. If
  the field has changed since, the sheet warns first ("Changed again since, to 44 by
  the assistant's phone. Revert anyway?").
- The log is a record, not a source to rebuild rows from: old changes ran under old
  rules.
- **Deleting a student's data** must blank their name and arguments in the log too;
  write that purge before Courtside becomes a product.
- **Size:** about 256 bytes per change, a few MB per program per season.

### Season totals and comparing practice to games

- **Games, then Season**, for one team at a time: each player's totals across the
  season's games, or per game (counts averaged, shots as percentages). GP counts the
  games a player has any stat in, since there's no record of minutes or who played.
  Tapping a player lists their games; tapping a game opens its box score.
- **Practice vs games**: a makes drill can name the game stat it practices (`game_stat`:
  free throws, 2-point or 3-point shots), set in History's Edit drill. For each linked
  stat, every player's makes and attempts in the season's runs of those drills, against
  the same shots in games, and the difference in percentage points. Practice counts
  only results with a known number of shots.

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
  the assist rule; every push writes the change log, accepted and refused, with before
  and after values; history is filtered by organization.
- **Undo tests:** the reverse of each kind of change restores the view exactly,
  offline; undoing a change that has already synced sends a reverse change.
- **Engine tests:**
  - a film edit on one phone while another phone is offline, then both sync;
  - an edit to a play another phone deleted is rejected, and the play stays gone;
  - plays added to a game another phone deleted are rejected and shown as "Won't sync";
  - closing the app mid-game loses nothing.
- **End-to-end (Playwright):** live entry with the phone going offline and back, and a
  film correction on one phone showing up on another. No test of two phones scoring
  live at once (see below).

### Steps (one commit each)

1. Server: migration, schemas, mutators, the `basketball` validation module, pull and
   tests; the change log and `GET /api/history`.
2. Client sync layer: types, mutators, stores, fake server and engine tests.
3. The replay performance check, and the fix if it's needed.
4. Client `basketball` module: rules presets (after checking the rule books), box
   score, order, and tests.
5. UI: the games tab, game list and "New game" sheet, and rules on the team settings.
6. UI: the live screen.
7. UI: the review screen, box score, official score and mismatch flag.
8. UI: season totals and comparing practice to games.
9. Restoring a deleted game or drill run from a refusal, with engine tests.
10. Undo (reverses captured in `AppState.mutate`) on the live and entry screens, and a
    history sheet with revert on the review and roster screens.
11. Docs, then the end-to-end run.

---

## Phase 3: Tauri mobile app

Courtside ships as a Tauri 2 app for iOS (and Android if wanted), wrapping the same
static SvelteKit build. The steps depend on the spike's findings; the outline:

- **Why:** a Tauri app serves its files from a fixed internal address, so its storage
  doesn't depend on any hostname, and it isn't subject to Safari's 7-day deletion.
- **The server address** comes from settings, using phase 1's configurable transport.
- **The service worker is web-only.** Tauri bundles the app's files, so it starts
  offline without a cached app shell. The web version keeps its service worker.
- **Optional: a SQLite store** behind `LocalStore`, using Tauri's SQL plugin, so the
  queue lives in the app's own files rather than the web view's storage. It must pass
  the same store contract tests as Dexie and the memory store. Decide after the spike:
  IndexedDB inside a Tauri app may be durable enough.
- **Signing and distribution** (Xcode, TestFlight) are on Eric's side; the sandbox can't
  sign builds.
- **Without sign-in, the app reaches the server over the tailnet,** with the Tailscale
  app on the phone. A server outside the tailnet waits for phase 4.

From the spike:
- **Safe areas:** `viewport-fit=cover` and `env(safe-area-inset-*)` padding; the header
  currently draws under the status bar.
- **Keep the screen awake natively** (a small plugin setting
  `UIApplication.isIdleTimerDisabled` while the entry or live screen is open). The web
  Wake Lock request was refused in the web view.
- **Storage message:** the "add to the home screen" advice is for the browser only.
- **Production socket origin:** Phoenix's `check_origin` must allow `tauri://localhost`.
- **HTTPS to the server** over the tailnet; plain HTTP to other hosts is blocked by App
  Transport Security unless exempted.
- **CocoaPods** on the build Mac, or the empty-Podfile workaround (see the write-up).

---

## Phase 4: sign-in

Required before any public deploy; it can run any time after phase 1. Phase 1's
context, local database per organization and 401 handling make it additive.

### Accounts

- **`mix phx.gen.auth`** (Phoenix 1.8) for users: magic-link sign-in, optional
  passwords, sudo mode for sensitive actions, and a table tracking every token.
  "Sign in with Google" can follow, since many schools use Google accounts.
- **Membership and roles:** a user belongs to an organization, with a role per program:
  - **coach:** everything in the program;
  - **manager:** records and edits games;
  - maybe **read-only** for players and parents.

### Device tokens

`phx.gen.auth` has no API tokens. Phoenix's API authentication guide adds a 365-day
bearer token, stored only as a hash in the same table and checked by a plug. Courtside
follows that guide, with two changes:

- **Its own `"device"` context.** The guide's tokens expire when the user's email
  changes, and changing the password deletes every token. A manager's phone shouldn't
  be signed out mid-season by an unrelated account change.
- **One token per device, with a name and a last-used time.** Signing in names the
  device ("Team iPad"). The coach sees a list of devices and can revoke any of them,
  for example when a phone is lost. A token unused for 365 days expires; using it keeps
  it alive.

**No refresh tokens.** The access-plus-refresh pair exists because self-contained tokens
such as JWTs can't be revoked. These tokens are opaque and looked up in Postgres on
every request. Every push and pull is a database transaction anyway, and deleting the
row revokes the token at once. A refresh token would add failures an offline app has
to avoid: it could expire while the phone is offline, two refreshes could race, and
requests would fail while one is in progress.

### Enforcement

- **Server:** a plug on `/api` reads `Authorization: Bearer …` and turns the token into
  the context: user, organization, and the programs the user can use. The socket's
  `connect` checks the same token, and joining `sync:<org_id>` checks the organization.
- **Pull** filters by the user's programs.
- **Each mutator** checks the program of the rows it touches against the context,
  which phase 1 makes a check in one place. A refused change is a rejection with a
  reason ("You can't change boys' basketball"); a missing or revoked token is a 401.
- **Client IDs belong to a device token**, so one device can't push as another.
- **Recording who made each change:** a nullable column on synced rows. Changes from
  before sign-in have no author.

### Phone

- The token is stored on the device: IndexedDB on the web, the system keychain in
  Tauri.
- A 401 shows a "sign in again" screen while the queue waits, then syncs. Phase 1 tests
  this.
- Signing out deletes that organization's local database, after warning about
  unsynced changes.

---

## Later, and not blocked by this design

- **Split scorer roles**, such as one phone for shots and one for everything else.
  Plays support it; it needs a role per phone and a filtered live screen.
- **Deploying** a server outside the tailnet, after phase 4. Deploys are Eric's.
- **Other sports:** a sport module with its own stats, rules, box score and live screen.
- **Sharing drills between programs**, head-to-head history and opponents as records.
- Lineups, minutes, plus-minus, shot charts, individual opposing players, playing film
  in the app, and exporting games as CSV.
- **If Courtside becomes a product**, student data privacy (FERPA and state laws), and
  whether to keep the hand-rolled sync. The engine boundary allows a library to replace
  it.
