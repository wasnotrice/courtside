// Question 3: changing a play's shape once events are stored.
//
// LiveStore events are immutable, so a new shape is a new event name (v2.PlayRecorded
// with foul_type). State tables are derived, so changing them means rematerializing.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { head, makeDevice, until, type Device } from '../src/device.ts'
import { events, playRecordedV2 } from '../src/schema.ts'
import { SyncServer } from '../src/server.ts'

const open: Device[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((d) => d.shutdown().catch(() => {})))
})

const foul = playRecordedV2({
  id: 'f1', game_id: 'g1', recorded_by: 'new', side: 'us', player_id: 'ava',
  stat: 'foul', assist_player_id: null, period: 1, position: '00001-new', foul_type: 'offensive',
})

test('a v1 phone skips a v2 play; upgrading shows it only if the state tables change too', async () => {
  const server = new SyncServer()
  const dir = mkdtempSync(join(tmpdir(), 'livestore-spike-'))
  const upgraded = await makeDevice('phone-new', server, { v2: true })
  let old = await makeDevice('phone-old', server, { dir })
  open.push(upgraded)

  upgraded.store.commit(events.gameCreated({ id: 'g1', opponent: 'Lincoln' }), foul)
  await until(() => head(old) === 2, 10_000, 'old phone to pull')

  // The old phone has the event in its log but no materializer for it: the play is
  // missing from its screen (and box score) until the app updates.
  expect(upgraded.plays().map((p) => [p.id, p.foul_type])).toEqual([['f1', 'offensive']])
  expect(old.plays()).toEqual([])

  // Updating the app adds the v2 materializer. That alone doesn't help: the state
  // database is keyed by a hash of the *tables*, so LiveStore keeps the old state and
  // never replays the event it skipped. Not even after reconnecting.
  await old.shutdown()
  old = await makeDevice('phone-old', server, { dir, v2: true })
  await new Promise((r) => setTimeout(r, 1_000))
  expect(head(old)).toBe(2)
  expect(old.plays()).toEqual([])

  // Changing the tables in the same release forces a rebuild from the stored event log,
  // and the play appears.
  await old.shutdown()
  const t0 = performance.now()
  old = await makeDevice('phone-old', undefined, { dir, v2: true, bumpState: true })
  console.log(`reopen with changed tables (rebuild): ${(performance.now() - t0).toFixed(0)} ms`)
  open.push(old)
  expect(old.plays().map((p) => [p.id, p.foul_type])).toEqual([['f1', 'offensive']])
})

test("with unknownEventHandling 'fail', a v1 phone stops syncing at the first v2 event", async () => {
  const server = new SyncServer()
  const upgraded = await makeDevice('phone-new', server, { v2: true })
  const strict = await makeDevice('phone-old', server, { unknownEvents: 'fail' })
  open.push(upgraded, strict)

  upgraded.store.commit(events.gameCreated({ id: 'g1', opponent: 'Lincoln' }))
  await until(() => head(strict) === 1, 10_000, 'game')
  upgraded.store.commit(foul)
  await until(() => server.events.length === 2, 10_000, 'server')
  await new Promise((r) => setTimeout(r, 1_000))
  upgraded.store.commit(
    events.playRecorded({
      id: 'p2', game_id: 'g1', recorded_by: 'new', side: 'us', player_id: 'ava',
      stat: 'fg2_made', assist_player_id: null, period: 1, position: '00002-new',
    }),
  )
  await until(() => server.events.length === 3, 10_000, 'server')
  await new Promise((r) => setTimeout(r, 2_000))
  // 'fail' stops this phone at the v2 event: the later v1 play never arrives.
  expect(head(strict)).toBe(2)
  expect(strict.plays()).toEqual([])
})
