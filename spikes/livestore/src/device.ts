// A "phone": a LiveStore store on the Node adapter, wired to the in-process server,
// with an online switch.

import { makeAdapter } from '@livestore/adapter-node'
import { createStorePromise, queryDb, type Store } from '@livestore/livestore'
import { Effect, SubscriptionRef } from '@livestore/utils/effect'
import { makeGameSchema, tables, type SchemaOptions } from './schema.ts'
import { makeDeviceBackend, type SyncServer } from './server.ts'

export interface Device {
  name: string
  store: Store<any>
  setOnline: (online: boolean) => void
  plays: () => (typeof tables.plays.Type)[]
  refused: () => (typeof tables.refused.Type)[]
  shutdown: () => Promise<void>
}

export interface DeviceOptions extends SchemaOptions {
  online?: boolean
  storeId?: string
  /** 'in-memory' (default) or a directory for the fs storage. */
  dir?: string
  onSyncError?: 'shutdown' | 'ignore'
  syncPayload?: any
  /** Supply a ready-made schema instead of building one from the options. */
  schema?: any
}

export const makeDevice = async (name: string, server: SyncServer | undefined, opts: DeviceOptions = {}): Promise<Device> => {
  let online: SubscriptionRef.SubscriptionRef<boolean> | undefined
  const adapter = makeAdapter({
    storage: opts.dir ? { type: 'fs', baseDirectory: opts.dir } : { type: 'in-memory' },
    clientId: name,
    sessionId: `${name}-session`,
    ...(server
      ? {
          sync: {
            backend: makeDeviceBackend(server, { startOnline: opts.online ?? true, onBackend: (ref) => (online = ref) }),
            onSyncError: opts.onSyncError ?? 'ignore',
          },
        }
      : {}),
  })
  const store = await createStorePromise({
    adapter,
    schema: opts.schema ?? makeGameSchema(opts),
    storeId: opts.storeId ?? 'org-1',
    disableDevtools: true,
    syncPayload: opts.syncPayload,
  } as any)
  const playsQ = queryDb(tables.plays.select().orderBy([{ col: 'position', direction: 'asc' }, { col: 'id', direction: 'asc' }]), { label: `plays-${name}` })
  const refusedQ = queryDb(tables.refused.select(), { label: `refused-${name}` })
  return {
    name,
    store,
    setOnline: (v) => {
      if (!online) throw new Error('no sync backend')
      Effect.runSync(SubscriptionRef.set(online, v))
    },
    plays: () => store.query(playsQ) as any,
    refused: () => store.query(refusedQ) as any,
    shutdown: () => store.shutdownPromise(),
  }
}

export const until = async (cond: () => boolean, timeoutMs = 10_000, label = 'condition') => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}
