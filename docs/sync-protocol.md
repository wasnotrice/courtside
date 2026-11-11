# How Courtside syncs

This explains how the app stays usable on the court with no signal, and how
two phones that both edited offline end up agreeing. The design follows
Replicache's push/pull model with a *global version*, kept per organization (a
school; see [ADR 0001](adr/0001-scope-sync-by-organization.md)). All the code is
our own.

## The idea in one paragraph

Every change starts on the phone. The phone saves the change, shows it right
away and puts it in a queue. When there's signal, the phone sends the queue to
the server (**push**) and then asks for everything that changed since it last
checked (**pull**). The server's copy is the truth. The phone shows the
server's data with its own queued changes replayed on top. When the server
confirms a queued change, the phone drops it from the queue, because the change
is now part of the server's data.

## What lives on the phone

All of this is kept in IndexedDB, so it survives closing the app. There's one
database per organization (`courtside-<organization id>`):

| Name | What it is |
|---|---|
| **base** | The server's data as of the last pull: programs, seasons, teams, players, roster entries, drills, drill runs, results. |
| **pending** | Queued changes, each with a number that goes up by one per phone (1, 2, 3…). |
| **cursor** | The server version the base reflects. |
| **data id** | Which copy of the server's data the base came from (see "When the server's data is reset"). |
| **last mutation id** | The highest of this phone's change numbers the server has handled. |
| **rejections** | Changes the server refused, kept until the coach dismisses them. |
| **client id** | A random id for this phone, created on first launch. |

The screen shows the **view**: the base with the pending changes replayed on
top, using the same rules the server uses (`web/src/lib/sync/mutators.ts`).
The view is recomputed after every change and every pull.

## Changes (mutations)

The app makes these changes. Each one has a name and arguments:

| Name | Arguments | Notes |
|---|---|---|
| `program.put` | id, name, sport | One sport for one gender, such as girls' basketball. The sport can't change. |
| `season.put` | id, name, starts_on, ends_on | A school year. Seasons in an organization can't overlap. |
| `team.put` | id, program_id, name | Varsity, JV. A team can't move to another program. |
| `player.put` | id, program_id, name | A player can't move to another program. |
| `roster.put` | id, team_id, season_id, player_id, jersey | Puts a player on a team for a season. Once per team and season; an entry can't move. |
| `roster.remove` | id | Takes a player off a team for that season. |
| `drill.put` | id, program_id, name, kind, default_setup, archived | A drill's kind can't change after it's created. |
| `run.create` | id, program_id, date, drill_id, setup | Starts a drill at a practice. The date must fall in a season. Makes drills need a number of shots. |
| `run.set_setup` | id, setup | Refused if it would leave someone with more makes than shots. |
| `run.delete` | id | Removes the run and its results. |
| `result.set_value` | drill_run_id, player_id, value | Checked per kind. Makes can't exceed shots. |
| `result.set_setup` | drill_run_id, player_id, setup | One player's own setup. `null` goes back to the run's. |
| `result.clear` | drill_run_id, player_id | Removes the result. |

**A `*.put` changes only the fields it sends.** When the id is new it creates
the row, and then needs the required fields. Otherwise a field sent as `null` is
cleared and a field left out keeps its value. The app sends just the fields the
coach changed, so two phones editing different fields of the same row both keep
their change.

**Unknown arguments are refused** ("Unknown field: …") rather than ignored, so a
field name the phone and server disagree on fails loudly instead of being
dropped.

Ids are UUIDs created on the phone, so a phone never has to ask the server for
an id before it can save something. Ids are unique across all organizations.
Rows in another organization are invisible: referring to one gets the same
message as referring to a row that doesn't exist, and creating a row with an
id another organization holds is refused without saying why.

The rules run twice. The phone checks a change before queuing it, so the coach
hears "51 makes is more than 50 shots" immediately. The server checks it again
when the change arrives, against its own data, which may include other phones'
changes. When the two disagree, the server wins.

The two sets of rules are written twice, in TypeScript and Elixir. The cases in
`spec/mutations/*.json` are run by both test suites, so the rules, the argument
names and the messages can't drift apart without a test failing.

## Push

`POST /api/push` with `{organization_id, client_id, mutations: [{id, name, args}, …]}`

A push carries at most 500 changes and 1 MB; the phone sends at most 200 at a
time and goes again for the rest. The server handles the whole push in one
database transaction:

1. **Bump the organization's version.** The first step is
   `UPDATE org_versions SET version = version + 1` for the push's organization.
   That locks the organization's row until the transaction ends, so pushes in one
   organization run one at a time and versions are handed out in the order the
   pushes commit. Pushes in different organizations don't wait for each other.
   Every row the push writes is stamped with that version.
2. **Skip what it has already seen.** The server stores each phone's last
   mutation id. Any change with an id at or below it was handled before, so
   it's skipped. This makes it safe for a phone to resend a push whose response
   was lost.
3. **Apply each change in its own savepoint.** If a change breaks a rule, or
   crashes, the server rolls back just that change, writes a rejection with the
   reason, and moves on. The rejected change still counts as handled, so one
   bad change can't block the rest of the queue forever.

A client id belongs to the organization it first used. Using it with another
is refused.

After the transaction commits, the server **pokes** every phone connected to
that organization.

**HTTP errors are never rejections.** An unknown organization (404), a client
id from another organization (403), an oversized push (413), a missing or
expired sign-in (401, once sign-in exists) and network failures all leave every
pending change queued. The phone retries; nothing is marked refused.

## Pull

`GET /api/pull?organization_id=…&client_id=…&cursor=N`

The server returns every row in the organization whose version is above `N`,
including deleted rows, plus:

- `cursor`: the organization's current version, which the phone saves for its
  next pull,
- `data_id`: which copy of the data this is (see below),
- `last_mutation_id`: so the phone can drop the changes the server has handled,
- `rejections`: this phone's rejections recorded since `N`.

The pull reads one consistent snapshot of the database (`REPEATABLE READ`), so
the rows and the new cursor always match.

The phone applies a pull in one IndexedDB transaction: it writes the rows into
the base, removes the deleted ones, saves the cursor, drops confirmed changes
from the queue and stores new rejections. Then it recomputes the view.

**Deletes are tombstones.** A deleted row stays in the database with
`deleted = true` and a new version. Otherwise a pull couldn't tell a phone that
a row it has is gone.

## Why one version per organization, and why the lock matters

Each pull asks for "everything above my cursor", so the versions must never
let a row slip past a cursor. Suppose push A got version 7 and push B got
version 8, but B committed first. A phone pulling between the two commits would
get B's rows and move its cursor to 8. It would never see A's version-7 rows.

Taking the organization's `org_versions` row lock first prevents this. Push B can't get a
version until push A has committed. `server/test/courtside/sync_concurrency_test.exs`
runs 20 concurrent pushes against a phone pulling in a loop and checks that no
row is skipped. When the version is deliberately assigned outside the lock, the
test fails.

## When the phone syncs

Push and pull run one at a time, push first. A sync starts:

- after every change,
- when the server pokes (a Phoenix channel at `/socket`, topic
  `sync:<organization id>`, event `poke`; a poke carries no data, it just means
  "pull"),
- when the browser comes back online or the page becomes visible,
- every 30 seconds while the page is visible,
- when the coach taps **Pull now** in the Sync tab.

A failed sync is retried after 1, 2, 4… seconds, up to 30. A failed push
doesn't skip the pull, so a phone that can receive but not send still gets
updates.

## Conflicts

**The last change to reach the server wins, field by field.** Two coaches
entering 38 and 41 makes for the same player end up with whichever arrived
second, on both phones. Numbers like these can't be merged, so a CRDT wouldn't
help. Changes to *different* fields of the same row both survive, because each
edit sends only the fields it changed.

"Last" means last to reach the server, not last made. A phone that was offline
for hours overwrites newer edits to the same fields when it finally syncs.
Fixing that would need trustworthy device clocks; for one team the case is
rare, and `engine.test.ts` has a test showing it.

Some conflicts break a rule rather than overwrite a value. For example, one
phone removes a drill from the practice while another, offline, enters a result
for it. The second change is rejected when it arrives. The coach sees the
rejection next to the player, on the Practice screen and in the Sync tab until
they dismiss it. Rejections are never dropped silently.

Between the pull that brings in the delete and the server's rejection, the
phone already knows its queued change no longer applies. The Sync tab and the
entry screen mark it "Won't sync".

## When the server's data is reset or restored

Restoring a backup, or recreating the dev database, turns the server's versions
back. A phone's cursor would then point past data the server no longer has, and
the phone would keep rows that are gone.

So every organization's data has a **data id**, returned by every pull. It's
created with the organization and changed by `Courtside.Organizations.new_data_id!/1`,
which a restore must run. When a pull returns a different data id, or a cursor
lower than the phone's, the phone throws away its base and pulls from scratch.
It keeps its queue: pending changes exist only on the phone.

In production the real protection is point-in-time recovery, so a restore never
loses changes the server confirmed and the phones already dropped from their
queues.

## Upgrading the phone's database

A new version of the app can change the IndexedDB schema. An upgrade may throw
away the base, since the next pull brings it back, but never the queue.
`store.test.ts` upgrades a real version 1 database with pending changes and
checks they survive.

## Starting over

**Reset local data** in the Sync tab erases the phone's data, including unsynced
changes, and makes it a new client with a new id. Everything already synced
comes back with the next pull. The phone needs a new id because the server
would skip the new client's changes 1, 2, 3… as already handled under the old
id.

## Known limits

- Two tabs open on one phone each sync on their own and don't see each other's
  changes until they pull.
- Every phone pulls its whole organization, every program included. Sign-in will
  narrow that to the coach's programs.
- The last change to reach the server wins, even if it was made earlier.
- Tombstones are never cleaned up.
- No sign-in. Until then, keep the server on a private network or tailnet.
