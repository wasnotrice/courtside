// Question 1: a full game recorded offline on two phones, then synced.

import { afterEach, expect, test } from 'vitest'
import { head, makeDevice, until, type Device } from '../src/device.ts'
import { scriptGame } from '../src/game.ts'
import { events } from '../src/schema.ts'
import { SyncServer } from '../src/server.ts'

const open: Device[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((d) => d.shutdown().catch(() => {})))
})

const comparable = (d: Device) => d.plays().map(({ id, side, player_id, stat, assist_player_id, deleted, position }) => ({ id, side, player_id, stat, assist_player_id, deleted, position }))

test('400 plays with edits and undos, recorded offline on two phones, all arrive and agree', async () => {
  const server = new SyncServer()
  const a = await makeDevice('phone-a', server)
  const b = await makeDevice('phone-b', server)
  open.push(a, b)

  a.store.commit(events.gameCreated({ id: 'g1', opponent: 'Lincoln' }))
  await until(() => head(b) === 1, 10_000, 'B to get the game')

  a.setOnline(false)
  b.setOnline(false)
  const ops = scriptGame('g1', 400)
  const counts = { a: 0, b: 0 }
  for (const op of ops) {
    ;(op.phone === 'a' ? a : b).store.commit(op.event as any)
    counts[op.phone]++
  }
  const total = counts.a + counts.b
  console.log('events per phone', counts, 'total', total)
  // While offline each phone shows only its own plays.
  const aOffline = a.plays().filter((p) => !p.deleted).length
  const bOffline = b.plays().filter((p) => !p.deleted).length
  // What syncStatus reports while offline (session -> leader only, see write-up).
  console.log('offline syncStatus A', a.store.syncStatus())
  expect(server.events).toHaveLength(1)

  const t0 = performance.now()
  a.setOnline(true)
  await until(() => server.events.length === 1 + counts.a, 20_000, 'A to push')
  const tA = performance.now()
  b.setOnline(true)
  await until(() => server.events.length === 1 + total, 30_000, 'B to rebase and push')
  const tB = performance.now()
  await until(() => head(a) === 1 + total && head(b) === 1 + total, 30_000, 'both at head')
  const tDone = performance.now()
  console.log(`sync: A pushed ${counts.a} in ${(tA - t0).toFixed(0)} ms; B rebased+pushed ${counts.b} in ${(tB - tA).toFixed(0)} ms; both converged after ${(tDone - t0).toFixed(0)} ms`)

  // Everything arrived, once.
  expect(new Set(server.events.map((e) => e.seqNum)).size).toBe(1 + total)
  // Both phones agree, row for row.
  expect(comparable(a)).toEqual(comparable(b))
  expect(a.plays().filter((p) => !p.deleted).length).toBe(aOffline + bOffline)
  expect(a.refused()).toEqual([])

  // Order in the log: all of A's batch, then all of B's (rebased), each phone's own
  // events in the order it made them.
  const byClient = server.events.slice(1).map((e) => e.clientId)
  const firstB = byClient.indexOf('phone-b')
  expect(byClient.slice(0, firstB).every((c) => c === 'phone-a')).toBe(true)
  expect(byClient.slice(firstB).every((c) => c === 'phone-b')).toBe(true)
  // Order on screen comes from `position`, not from the log: plays interleave by game time.
  const shown = a.plays().filter((p) => !p.deleted).map((p) => p.recorded_by)
  const switches = shown.filter((p, i) => i > 0 && p !== shown[i - 1]).length
  console.log('phone switches in play-by-play order', switches)
  expect(switches).toBeGreaterThan(50)
})

test('concurrent offline edits of the same play: the later push wins per field', async () => {
  const server = new SyncServer()
  const a = await makeDevice('phone-a', server)
  const b = await makeDevice('phone-b', server)
  open.push(a, b)
  a.store.commit(
    events.gameCreated({ id: 'g1', opponent: 'Lincoln' }),
    events.playRecorded({
      id: 'p1', game_id: 'g1', recorded_by: 'a', side: 'us', player_id: 'ava',
      stat: 'fg2_made', assist_player_id: null, period: 1, position: '00001-a',
    }),
  )
  await until(() => b.plays().length === 1, 10_000, 'B to get p1')
  a.setOnline(false)
  b.setOnline(false)
  // A fixes the shooter and adds an assist. B, later in wall time, fixes the period and shooter.
  a.store.commit(events.playEdited({ id: 'p1', player_id: 'riley', assist_player_id: 'jo' }))
  b.store.commit(events.playEdited({ id: 'p1', player_id: 'sam', period: 2 }))
  // B reaches the server first, A second.
  b.setOnline(true)
  await until(() => server.events.length === 3, 10_000, 'B push')
  a.setOnline(true)
  await until(() => server.events.length === 4, 10_000, 'A push')
  await until(() => head(a) === 4 && head(b) === 4, 10_000, 'converge')
  const pa = a.plays()[0]!
  const pb = b.plays()[0]!
  expect(pa).toEqual(pb)
  // Arrival order decides, per field, exactly like Courtside's "last to reach the server wins".
  expect({ player: pa.player_id, assist: pa.assist_player_id, period: pa.period }).toEqual({ player: 'riley', assist: 'jo', period: 2 })
})

test('an offline edit to a play another phone deleted: dropped the same way everywhere', async () => {
  const server = new SyncServer()
  const a = await makeDevice('phone-a', server)
  const b = await makeDevice('phone-b', server)
  open.push(a, b)
  a.store.commit(
    events.gameCreated({ id: 'g1', opponent: 'Lincoln' }),
    events.playRecorded({
      id: 'p1', game_id: 'g1', recorded_by: 'a', side: 'us', player_id: 'ava',
      stat: 'fg2_made', assist_player_id: null, period: 1, position: '00001-a',
    }),
  )
  await until(() => b.plays().length === 1, 10_000, 'B to get p1')
  a.setOnline(false)
  b.store.commit(events.playDeleted({ id: 'p1' }))
  await until(() => server.events.length === 3, 10_000, 'delete reaches server')
  a.store.commit(events.playEdited({ id: 'p1', player_id: 'riley' }))
  expect(a.plays()[0]!.player_id).toBe('riley') // A's screen shows its edit while offline
  a.setOnline(true)
  await until(() => head(a) === 4 && head(b) === 4, 10_000, 'converge')
  // The edit is in the log (no server veto) but the materializer ignores it on both phones.
  expect(server.events.at(-1)!.name).toBe('v1.PlayEdited')
  expect(a.plays()[0]).toMatchObject({ deleted: true, player_id: 'ava' })
  expect(a.plays()).toEqual(b.plays())
  expect(a.refused().map((r) => r.reason)).toEqual(['That play was deleted.'])
  expect(b.refused().map((r) => r.reason)).toEqual(['That play was deleted.'])
})
