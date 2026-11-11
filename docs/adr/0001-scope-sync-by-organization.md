# Scope all synced data by organization, with a version counter per organization

Courtside serves one coach today, but it may become a product for many schools. Every
synced row belongs to an organization, and pull returns only that organization's rows.
The global version that orders pushes moves from one `server_meta` row to one counter
per organization. With a single global counter, every push from every school would queue
behind one row lock. Moving to a counter per organization later would mean rewriting
every table and invalidating the cursors stored on every phone, while doing it now costs
one column per table. Sign-in, roles and billing are left out until they're needed:
they can be added later without changing the data or the protocol.

## Considered options

- **Keep the global counter and add organizations later.** Rejected: it's the
  expensive part to change once phones hold cursors.
- **A counter per program.** Rejected: an organization is the natural tenant (one
  school), seasons are shared across its programs, and one phone pulls the whole
  organization until sign-in can narrow it to a program.

## Consequences

- Each push takes its organization's counter lock, so pushes from different schools
  never wait on each other. Pushes within one organization stay serialized, which keeps
  the guarantee that version order matches commit order (see `docs/sync-protocol.md`).
- Limiting a coach to their own program later is a filter on pull. It doesn't change
  the cursor, because versions within an organization still increase in commit order.
