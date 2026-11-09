// Question 2: rules without a server veto.
//
// In Courtside today the server runs every mutation and can refuse it; the phone shows
// the refusal and drops the change. In LiveStore every device applies every event
// itself, so a rule is only as strong as the materializers on every device.

import { afterEach, expect, test } from 'vitest'
import { head, makeDevice, until, type Device } from '../src/device.ts'
import { events, playRuleViolation } from '../src/schema.ts'
import { SyncServer } from '../src/server.ts'

const open: Device[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((d) => d.shutdown().catch(() => {})))
})

const game = events.gameCreated({ id: 'g1', opponent: 'Lincoln' })
// Breaks "the other team's plays can't have a player".
const badPlay = events.playRecorded({
  id: 'bad', game_id: 'g1', recorded_by: 'old', side: 'them', player_id: 'ava',
  stat: 'fg2_made', assist_player_id: null, period: 1, position: '00001-old',
})
const goodPlay = (id: string) =>
  events.playRecorded({
    id, game_id: 'g1', recorded_by: 'a', side: 'us', player_id: 'ava',
    stat: 'fg2_made', assist_player_id: null, period: 1, position: `00002-${id}`,
  })

test('a phone on old code that lacks a rule shows the bad play; phones with the rule hide it', async () => {
  const server = new SyncServer()
  const old = await makeDevice('phone-old', server, { rules: 'none' })
  const current = await makeDevice('phone-new', server, { rules: 'skip' })
  open.push(old, current)

  old.store.commit(game, badPlay)
  await until(() => head(current) === 2, 10_000, 'new phone to pull')

  // The event is in everyone's log; there's no server to refuse it.
  expect(server.events.map((e) => e.name)).toEqual(['v1.GameCreated', 'v1.PlayRecorded'])
  // The two phones now disagree about the box score, and keep disagreeing.
  expect(old.plays().map((p) => p.id)).toEqual(['bad'])
  expect(current.plays()).toEqual([])
  expect(current.refused().map((r) => r.reason)).toEqual(["The other team's plays can't have a player."])
})

test('a server that refuses an event wedges the phone: later good events never arrive', async () => {
  const server = new SyncServer()
  server.validate = (ev) => {
    if (ev.name !== 'v1.PlayRecorded') return { ok: true }
    const reason = playRuleViolation(ev.args as any)
    return reason ? { ok: false, reason } : { ok: true }
  }
  const old = await makeDevice('phone-old', server, { rules: 'none' })
  open.push(old)

  old.store.commit(game)
  await until(() => server.events.length === 1, 10_000, 'game to reach the server')
  old.store.commit(badPlay, goodPlay('good-1'))
  await new Promise((r) => setTimeout(r, 2_000))
  old.store.commit(goodPlay('good-2'))
  await new Promise((r) => setTimeout(r, 2_000))

  // The SyncBackend contract has no "this event is refused" answer. The backend can only
  // fail the push (UnknownError here), so the client retries the same batch for ever and
  // nothing after the bad event reaches the server.
  expect(server.events.map((e) => (e.args as any).id)).toEqual(['g1'])
  expect(server.refusedPushes.length).toBeGreaterThan(1)
  // The phone still shows all three plays as if saved, with no error the app can see.
  expect(old.plays().map((p) => p.id).sort()).toEqual(['bad', 'good-1', 'good-2'])
  // And the store says it's synced: syncStatus() covers session -> leader on the device,
  // not leader -> server, so the app can't show "3 plays not saved".
  expect(old.store.syncStatus()).toMatchObject({ pendingCount: 0, isSynced: true })
})

test('a materializer that throws on a bad pulled event loses the batch and stops that phone syncing', async () => {
  const server = new SyncServer()
  const old = await makeDevice('phone-old', server, { rules: 'none' })
  const strict = await makeDevice('phone-strict', server, { rules: 'throw' })
  open.push(old, strict)

  old.store.commit(game)
  await until(() => head(strict) === 1, 10_000, 'strict phone to get the game')
  old.store.commit(badPlay, goodPlay('good-1'))
  await until(() => server.events.length === 3, 10_000, 'server to get both')
  await new Promise((r) => setTimeout(r, 3_000))

  // Throwing is LiveStore's documented way to reject an event in a materializer. On the
  // pull path the error is only logged (Die in the leader): the phone's head moves past
  // the batch, but the batch's state changes are rolled back, so the good play that came
  // with the bad one is lost on this phone too. Nothing reaches the app.
  expect(head(strict)).toBe(3)
  expect(strict.plays()).toEqual([])

  // And it stops syncing: a later play never arrives.
  old.store.commit(goodPlay('good-2'))
  await new Promise((r) => setTimeout(r, 3_000))
  expect(head(strict)).toBe(3)
  expect(strict.plays()).toEqual([])
  expect(old.plays().map((p) => p.id)).toEqual(['bad', 'good-1', 'good-2'])
})
