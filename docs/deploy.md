# Deploying Courtside

Courtside runs on Fly.io as one machine in Chicago (`ord`). The decisions behind this
are in the "Hosting" section of [`games-plan.md`](games-plan.md) and
[ADR 0002](adr/0002-sqlite-and-litestream-on-one-fly-machine.md).

- **One image** (`Dockerfile`): Phoenix serves the API, the socket and the web app
  from one address, so there's no CORS and the socket's origin is the page's own.
- **The database** is a SQLite file on a Fly volume, `/data/courtside.db`.
- **Litestream** runs the server as its child process (`server/rel/overlays/bin/`).
  It streams every change to a Tigris bucket, and on a machine whose volume is empty it
  restores from the bucket before the server starts.
- **Boot** migrates the database, then starts Phoenix. If the volume was empty, it
  also gives every organization a new data id, so phones pull from scratch rather than
  trust cursors that may be ahead of the restored data.

**Don't deploy before device tokens.** A deploy is public at `courtside.fly.dev`, and
until device tokens land (stage 1 in the plan), anyone who finds it can read and change
everything, students' names included.

## First deploy

Run these from the repository root, in your own Fly organization. If the name
`courtside` is taken, pick another and change `app` and `PHX_HOST` in `fly.toml`.

```sh
fly apps create courtside --org personal
fly volumes create courtside_data --app courtside --region ord --size 1
fly storage create --app courtside --name courtside-backups   # sets BUCKET_NAME and AWS_* secrets
fly secrets set --app courtside SECRET_KEY_BASE="$(openssl rand -base64 48)"
fly deploy --ha=false
```

`--ha=false` matters: by default Fly starts two machines, and SQLite allows only one.

Then create the school. Programs, teams, seasons and the roster are set up in the app.

```sh
fly ssh console -C '/app/bin/courtside eval "Courtside.Release.create_organization(\"Central High\")"'
```

Open `https://courtside.fly.dev` on each phone, add it to the home screen, and open it
from there from then on.

**Check the backup works** before relying on it: restore it to a scratch file on the
machine and check that the file is there.

```sh
fly ssh console -C 'litestream restore -config /app/litestream.yml -o /tmp/check.db /data/courtside.db'
fly ssh console -C 'ls -l /tmp/check.db'
```

## Deploying a change

```sh
fly deploy
```

The server is down for a few seconds while the machine restarts. Phones keep recording
and sync when it's back.

## Watching it

```sh
fly status
fly logs          # Phoenix and Litestream both log here
```

`/api/health` answers when the server is up and can reach its database. Fly checks it
every 30 seconds.

## Backups and restoring

There are two layers:

- **Litestream** streams each change to the bucket within seconds. It keeps a daily
  snapshot for a week (`server/rel/overlays/litestream.yml`), so a restore can go back
  to any point in that week.
- **Fly volume snapshots**, taken daily by Fly and kept for 5 days by default.

**If the volume is lost or corrupted:** create a new, empty volume with the same name
and restart the machine. Boot restores the latest data from the bucket and gives each
organization a new data id. The last few seconds of writes may be missing; phones pull
everything again, so anything they had synced but the restore lacks disappears from them
too.

```sh
fly volumes create courtside_data --app courtside --region ord --size 1
fly machine destroy <old machine id> --force    # the one attached to the old volume
fly deploy --ha=false
```

**To look at an earlier point,** for example before a bad change, restore it to a
scratch file with `-timestamp`:

```sh
fly ssh console -C 'litestream restore -config /app/litestream.yml -timestamp 2026-12-01T18:00:00Z -o /tmp/restore.db /data/courtside.db'
```

Putting an earlier point back in place isn't scripted yet. The live file can't be
swapped while Litestream and Phoenix have it open, so it needs a maintenance step;
work it out before the first time it's needed, not during it. Afterward, run
`Courtside.Release.after_restore` so phones pull from scratch.

## Upgrading pinned versions

The `Dockerfile` pins Elixir, Erlang, Debian, Node and Litestream. Litestream's download
is checked against the SHA-256 from the release's `checksums.txt`; when bumping the
version, update the checksum from that file too.
