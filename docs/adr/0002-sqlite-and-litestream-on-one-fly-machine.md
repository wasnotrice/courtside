# Run the server on SQLite with Litestream, on one Fly machine

Courtside serves one team, in one state, from one server. Fly's managed Postgres costs
about $38 a month before storage, a lot for a few hundred plays a week. Instead the
server keeps its data in a SQLite file on a Fly volume, and Litestream streams every
change to object storage, so backups are continuous rather than nightly and there's no
database server to run. Offline-first makes one machine enough: when it's down for a
deploy or a restore, phones keep recording and sync when it's back.

What the sync needs from the database beyond plain Ecto (serializing pushes and reading
a pull in one snapshot) sits behind `Courtside.Database`, so Postgres can come back by
adding one module.

## Considered options

- **Fly Managed Postgres.** No code changes and nothing to run, but the cost doesn't
  fit the project. Still the move if Courtside outgrows one machine.
- **Postgres on a Fly volume, run by us.** No code changes, but upgrades, backups and
  tuning by hand, for a database server the load doesn't need.
- **Distributed SQLite (LiteFS).** Replicas near readers in several regions buy nothing
  for one team whose phones already hold their own copy, and they add a FUSE layer and
  primary election. Fly shut down LiteFS Cloud in 2025.

## Consequences

- SQLite allows one writing transaction at a time, so pushes are serialized across
  every organization, not just within one as ADR 0001 describes. Version order still
  matches commit order within each organization; schools would just wait on each other.
  At one team's load that wait is negligible.
- Restoring from Litestream may lose the last few seconds of writes. Run
  `Courtside.Organizations.new_data_id!/1` for each organization after a restore, so
  phones pull from scratch, and their pending changes resend.
- Dev and tests need no database server: each is a file in `server/`.
- The migrations have no Postgres-only SQL, and UUIDs are stored as 16-byte blobs, so
  moving back means copying the data, not reshaping it.
