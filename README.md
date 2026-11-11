# Courtside

A practice stat tracker for a high school basketball program. Players finish a
drill and call out a number; the coach enters it on a phone. It works with no
signal and syncs when there is one. Data is organized by school
(organization), program (girls' or boys' basketball), team (varsity, JV) and
season; [GLOSSARY.md](GLOSSARY.md) defines the terms.

The project is also an experiment in offline-first design with hand-rolled
sync. [docs/sync-protocol.md](docs/sync-protocol.md) explains how the sync
works and why.

- `server/`: Phoenix API (Elixir) with Postgres. It's the source of truth and
  runs the business rules.
- `web/`: SvelteKit single-page app. It keeps all data on the device in
  IndexedDB.

## Run it

You need Elixir 1.15 or later, Node 22 and Docker (for Postgres).

```sh
docker compose up -d                        # Postgres 17 on port 5433

cd server
mix setup                                   # deps, database, migration, dev seed
mix phx.server                              # API on http://localhost:4000

cd web
npm install
npm run dev                                 # app on https://localhost:5173
```

Open https://localhost:5173 in a phone-sized window and accept the certificate
warning once. Vite serves HTTPS with a self-signed certificate
(`@vitejs/plugin-basic-ssl`) and proxies `/api` and `/socket` to Phoenix, so
there's no CORS to set up.

The dev seed (`server/priv/repo/seeds.exs`) creates one organization with a
girls' basketball program and a varsity team, and the app uses it by default.
Until sign-in exists, the app's server and organization come from
`VITE_COURTSIDE_API` (empty means the page's own address) and
`VITE_COURTSIDE_ORG`.

**There's no sign-in yet, so keep the app private.** Anyone who can reach the
dev server can read and change everything, including students' names. Don't run
`npm run dev -- --host` on a shared network such as school or gym Wi-Fi: Vite
passes `/api` to Phoenix, so everyone on the network could reach the data. To
use a real phone, go through your tailnet (below).

**Offline on a real phone needs a trusted certificate.** Over the self-signed
certificate the page is secure, so syncing and pokes work. But browsers refuse to
register a service worker over a certificate they don't trust, even after you
click through the warning, so the app won't open with no signal. The simplest fix
is Tailscale Serve, which gives the dev server a real certificate at a stable,
private address. With the phone on the same tailnet, and MagicDNS and HTTPS
certificates turned on in the Tailscale admin console:

```sh
tailscale serve --bg https+insecure://localhost:5173
```

Then open the `https://<machine>.<tailnet>.ts.net` address it prints. `tailscale
serve reset` stops it. On macOS the CLI is
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` if `tailscale` isn't on
your PATH.

**Use one address in dev.** The browser keeps local data, unsynced changes
included, per address: `localhost`, a LAN address and the tailnet name are three
separate stores. Pick the tailnet name and stick with it.

**On a phone, add Courtside to the home screen** and always open it from there.
On iOS, Safari deletes a site's storage after 7 days without a visit, unless
it's on the home screen; the home screen app is also likelier to get persistent
storage, so the queue isn't evicted when the phone is low on space. The home
screen app may keep its own storage, separate from Safari's, so don't switch
between them. The Sync tab shows whether storage is persistent.

**Already have Postgres on another port?** The server reads `PGPORT`, for
example `PGPORT=5432 mix phx.server`. The username and password are
`postgres`/`postgres`.

## Test it

```sh
cd server && mix test       # protocol, rules, JSON endpoints, channels, concurrent pushes
cd web && npm test          # client mutators, replay, stores, sync engine, UI helpers
cd web && npm run check     # types
```

`mix test` includes a concurrency test that runs real transactions outside the
SQL sandbox, against the test database.

Both suites run the shared cases in `spec/mutations/`: each gives the starting
rows, one change, and the rows afterward or the exact refusal message. That
keeps the TypeScript and Elixir rules from drifting apart. See
`spec/mutations/README.md`.

The web tests run two or more simulated devices against an in-memory fake
server (`web/src/lib/sync/testing/fake-server.ts`). The fake follows the same
protocol, so those tests check the sync behavior.

## Try the sync by hand

Open the app in two browser windows, one of them private, so each one is a
separate device. The **Sync** tab in each window shows what that device knows:
its client id, cursor, pending changes and rejections. It also has a
**Simulate offline** switch, so you don't need DevTools. Things worth trying:

- Turn both offline, enter different makes for the same player on each, then
  turn them back on one at a time. The last one to sync wins on both.
- Turn one offline and change a player's jersey; on the other, rename the same
  player. Turn the first back on. Both changes survive, because each edit sends
  only the field it changed.
- Turn one offline and enter a result. On the other, remove that drill from the
  practice. Turn the first back on. Its result is rejected, and the rejection
  stays visible until you dismiss it.
- Enter 40 makes, then lower the run's shots to 30 on another device. The
  change that reaches the server second is rejected.

## Layout

```
server/lib/courtside/sync.ex           push and pull, scoped by organization
server/lib/courtside/sync/mutators.ex  business rules (authoritative)
server/lib/courtside/schema/           one Ecto schema per table
spec/mutations/                        rule cases both test suites run
web/src/lib/sync/                      the client sync layer; the UI only talks to engine.ts
web/src/lib/sync/mutators.ts           the same rules in TypeScript, for instant feedback
web/src/lib/ui/                        Svelte components, ported from docs/prototype.html
```
