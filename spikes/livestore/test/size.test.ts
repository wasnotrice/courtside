// Question 4: how big a season's log gets, and how long a phone takes to open it.

import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { makeDevice, type Device } from '../src/device.ts'
import { scriptGame } from '../src/game.ts'
import { events } from '../src/schema.ts'
import { SyncServer } from '../src/server.ts'

const open: Device[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((d) => d.shutdown().catch(() => {})))
})

const du = (dir: string): Record<string, number> => {
  const out: Record<string, number> = {}
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else out[p.slice(dir.length + 1)] = s.size
    }
  }
  walk(dir)
  return out
}
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`

test('a season: 25 games of ~440 events each', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'livestore-season-'))
  const server = new SyncServer()
  let phone = await makeDevice('phone', server, { dir })

  const t0 = performance.now()
  let total = 0
  for (let g = 0; g < 25; g++) {
    const id = `g${g}`
    const evs = [events.gameCreated({ id, opponent: `Opponent ${g}` }), ...scriptGame(id, 400, g + 1).map((o) => o.event)]
    // One commit per tap, as on the live screen.
    for (const e of evs) phone.store.commit(e as any)
    total += evs.length
  }
  const tCommit = performance.now() - t0
  const live = phone.plays().filter((p) => !p.deleted).length
  await new Promise<void>((resolve) => {
    const tick = () => (server.events.length === total ? resolve() : setTimeout(tick, 50))
    tick()
  })
  await phone.shutdown()

  const files = du(dir)
  const onDisk = Object.values(files).reduce((a, b) => a + b, 0)
  const wire = JSON.stringify(server.events).length

  let t = performance.now()
  phone = await makeDevice('phone', undefined, { dir })
  const tOpen = performance.now() - t
  expect(phone.plays().filter((p) => !p.deleted).length).toBe(live)
  await phone.shutdown()

  t = performance.now()
  phone = await makeDevice('phone', undefined, { dir, bumpState: true })
  const tRebuild = performance.now() - t
  open.push(phone)
  expect(phone.plays().filter((p) => !p.deleted).length).toBe(live)

  console.log(
    [
      `events: ${total} (${live} live plays)`,
      `commit, one per tap: ${tCommit.toFixed(0)} ms total, ${(tCommit / total).toFixed(2)} ms each`,
      `on disk: ${kb(onDisk)} ${JSON.stringify(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, kb(v)])))}`,
      `server log as JSON: ${kb(wire)} (${(wire / total).toFixed(0)} bytes/event)`,
      `cold open: ${tOpen.toFixed(0)} ms; open with a state rebuild from the log: ${tRebuild.toFixed(0)} ms`,
    ].join('\n'),
  )
})
