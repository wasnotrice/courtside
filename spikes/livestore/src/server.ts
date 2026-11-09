// An in-process stand-in for "Phoenix as a LiveStore sync backend".
//
// `SyncServer` is what the server would have to do: keep one ordered log per store,
// accept a push only when it starts right after the current head (otherwise answer
// ServerAheadError so the client pulls and rebases), serve pulls from a cursor, and
// notify live pullers. `validate` is the hook where server-side rules would run.
//
// `makeDeviceBackend` is the client half (the `SyncBackend` interface from
// @livestore/common). In Courtside it would wrap HTTP push/pull plus the Phoenix
// channel poke; here it calls the server object directly. Each device gets an
// `online` switch so tests can go offline and back.

import { ServerAheadError, SyncBackend, UnknownError, type LiveStoreEvent } from '@livestore/common'
import { EventSequenceNumber } from '@livestore/common/schema'
import { Effect, Option, Queue, Stream, SubscriptionRef } from '@livestore/utils/effect'

type Ev = LiveStoreEvent.Global.Encoded

export type Verdict = { ok: true } | { ok: false; reason: string }

export class SyncServer {
  events: Ev[] = []
  pushCalls = 0
  refusedPushes: { reason: string; batch: Ev[] }[] = []
  private listeners = new Set<(batch: Ev[]) => void>()

  /** Server-side rule check for one event against the events accepted so far. */
  validate: (event: Ev, accepted: readonly Ev[]) => Verdict = () => ({ ok: true })

  get head(): number {
    return this.events.at(-1)?.seqNum ?? 0
  }

  push(batch: readonly Ev[]): { ok: true } | { ok: false; kind: 'ahead'; head: number } | { ok: false; kind: 'refused'; reason: string } {
    this.pushCalls++
    // The protocol: the client numbers its events head+1, head+2… and the server only
    // accepts a batch that continues its log. Anything else means "pull first".
    if (batch[0]!.seqNum !== this.head + 1) return { ok: false, kind: 'ahead', head: this.head }
    for (const ev of batch) {
      const verdict = this.validate(ev, this.events)
      if (!verdict.ok) {
        this.refusedPushes.push({ reason: verdict.reason, batch: [...batch] })
        return { ok: false, kind: 'refused', reason: verdict.reason }
      }
    }
    this.events.push(...batch)
    for (const l of this.listeners) l([...batch])
    return { ok: true }
  }

  pull(cursor: number): Ev[] {
    return this.events.filter((e) => e.seqNum > cursor)
  }

  listen(fn: (batch: Ev[]) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export interface Device {
  online: SubscriptionRef.SubscriptionRef<boolean>
}

export const makeDeviceBackend =
  (server: SyncServer, opts: { startOnline?: boolean; onBackend?: (online: SubscriptionRef.SubscriptionRef<boolean>) => void } = {}): SyncBackend.SyncBackendConstructor =>
  () =>
    Effect.gen(function* () {
      const isConnected = yield* SubscriptionRef.make(opts.startOnline ?? true)
      opts.onBackend?.(isConnected)

      // One live queue per backend connection, fed by the server (the poke).
      const live = yield* Queue.unbounded<Ev[]>()
      const stop = server.listen((batch) => void Queue.offerUnsafe(live, batch))
      yield* Effect.addFinalizer(() => Effect.sync(stop))

      const cursorOf = (cursor: Option.Option<{ eventSequenceNumber: number }>) =>
        Option.match(cursor, { onNone: () => EventSequenceNumber.Client.ROOT.global as number, onSome: (c) => c.eventSequenceNumber as number })

      const toItem = (batch: Ev[]): SyncBackend.PullResItem => ({
        batch: batch.map((eventEncoded) => ({ eventEncoded, metadata: Option.none() })),
        pageInfo: SyncBackend.pageInfoNoMore,
      })

      return SyncBackend.of({
        isConnected,
        connect: Effect.void,
        ping: Effect.void,
        pull: (cursor, options) => {
          const from = cursorOf(cursor)
          if (options?.live !== true) return Stream.make(toItem(server.pull(from)))
          // Live pull: everything after the cursor, then whatever the server accepts later
          // (Courtside's poke, except it carries the events).
          return Stream.suspend(() => {
            const initial = server.pull(from)
            const last = initial.at(-1)?.seqNum ?? from
            return Stream.concat(
              Stream.make(toItem(initial)),
              Stream.fromQueue(live).pipe(
                Stream.map((batch) => batch.filter((e) => e.seqNum > last)),
                Stream.filter((batch) => batch.length > 0),
                Stream.map(toItem),
              ),
            )
          })
        },
        push: (batch) =>
          Effect.suspend(() => {
            const res = server.push(batch)
            if (res.ok) return Effect.void
            if (res.kind === 'ahead')
              return Effect.fail(
                new ServerAheadError({
                  minimumExpectedNum: EventSequenceNumber.Global.make(res.head + 1),
                  providedNum: EventSequenceNumber.Global.make(batch[0]!.seqNum),
                }),
              )
            // There is no "this event is refused" error in the SyncBackend contract.
            // UnknownError is the only fit, and the leader retries it forever.
            return Effect.fail(new UnknownError({ cause: new Error(`refused: ${res.reason}`) }))
          }),
        metadata: { name: 'courtside-spike', description: 'in-process stand-in for a Phoenix backend' },
        supports: { pullPageInfoKnown: true, pullLive: true },
      })
    })
