import { afterEach, expect, test } from 'vitest'
import { makeDevice, until, type Device } from '../src/device.ts'
import { events } from '../src/schema.ts'
import { SyncServer } from '../src/server.ts'

const play = (id: string, by: string) =>
  events.playRecorded({
    id, game_id: 'g1', recorded_by: by, side: 'us', player_id: 'ava',
    stat: 'fg2_made', assist_player_id: null, period: 1, position: 'a0',
  })

const open: Device[] = []
afterEach(async () => {
  process.env.NODE_ENV = 'production'
  await Promise.all(open.splice(0).map((d) => d.shutdown().catch(() => {})))
})

test('a play goes from phone A through the server to phone B, live', async () => {
  const server = new SyncServer()
  const a = await makeDevice('phone-a', server)
  const b = await makeDevice('phone-b', server)
  open.push(a, b)
  a.store.commit(events.gameCreated({ id: 'g1', opponent: 'Lincoln' }), play('p1', 'phone-a'))
  expect(a.plays()).toHaveLength(1) // shown at once, before any sync
  await until(() => b.plays().length === 1, 10_000, 'B to receive the play')
  // What the server stores per event: the client numbers it, the server only checks.
  expect(Object.keys(server.events[1]!).sort()).toEqual(['args', 'clientId', 'name', 'parentSeqNum', 'seqNum', 'sessionId'])
  expect(server.events.map((e) => [e.seqNum, e.parentSeqNum])).toEqual([[1, 0], [2, 1]])
})

// Finding: in dev mode (NODE_ENV !== 'production') LiveStore compares a "materializer
// hash" computed by the leader with the session's. For events pulled in one batch the
// leader computes it before the earlier events of the batch are applied (issue #503),
// so a materializer that reads state (here: "does the game exist?") hashes differently,
// the session raises MaterializerHashMismatchError, and with the default
// onSyncError: 'ignore' the phone just stops receiving. Nothing is thrown to the app.
test('dev mode: a state-reading materializer stalls a phone that pulls game + play in one batch', async () => {
  process.env.NODE_ENV = 'development'
  const server = new SyncServer()
  const a = await makeDevice('phone-a', server)
  open.push(a)
  a.store.commit(events.gameCreated({ id: 'g1', opponent: 'Lincoln' }), play('p1', 'phone-a'))
  await until(() => server.events.length === 2, 10_000, 'server to get both')

  const checked = await makeDevice('phone-b', server, { rules: 'skip' })
  const unchecked = await makeDevice('phone-c', server, { rules: 'none' })
  open.push(checked, unchecked)
  await until(() => unchecked.plays().length === 1, 10_000, 'phone without state reads to receive')
  await new Promise((r) => setTimeout(r, 3000))
  expect(checked.plays()).toHaveLength(0)
  expect(checked.store.syncStatus().localHead).toBe('e0')
})
