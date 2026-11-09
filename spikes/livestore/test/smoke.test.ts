import { afterEach, expect, test } from 'vitest'
import { head, makeDevice, until, type Device } from '../src/device.ts'
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

// Finding: in dev mode (NODE_ENV !== 'production'; isDevEnv() in
// @livestore/common/dist/leader-thread/materialize-event.js) LiveStore compares a hash of
// each materializer's output between the leader and the session. A materializer that
// reads state with ctx.query can hash differently while a pulled batch is rebased, so
// the session raises MaterializerHashMismatchError and, with onSyncError: 'ignore', the
// phone silently stops converging. Open upstream as livestorejs/livestore#503 (since
// July 2025). Production builds skip the check, which is why the rest of the suite runs
// with NODE_ENV=production (test/setup.ts).
const deletedPlayScenario = async (rules: 'skip' | 'none') => {
  const server = new SyncServer()
  const a = await makeDevice('phone-a', server, { rules })
  const b = await makeDevice('phone-b', server, { rules })
  open.push(a, b)
  a.store.commit(events.gameCreated({ id: 'g1', opponent: 'Lincoln' }), play('p1', 'phone-a'))
  await until(() => b.plays().length === 1, 10_000, 'B to get p1')
  a.setOnline(false)
  b.store.commit(events.playDeleted({ id: 'p1' }))
  await until(() => server.events.length === 3, 10_000, 'delete reaches server')
  a.store.commit(events.playEdited({ id: 'p1', player_id: 'riley' }))
  a.setOnline(true)
  return until(() => head(a) === 4 && head(b) === 4, 5_000, 'converge').then(
    () => 'converged',
    () => 'stalled'
  )
}

test('dev mode: rebasing an edit whose materializer reads state stalls sync (livestore#503)', async () => {
  process.env.NODE_ENV = 'development'
  expect(await deletedPlayScenario('skip')).toBe('stalled')
})

test('dev mode: the same scenario converges when materializers do not read state', async () => {
  process.env.NODE_ENV = 'development'
  expect(await deletedPlayScenario('none')).toBe('converged')
})
