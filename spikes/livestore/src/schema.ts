// Games and plays as LiveStore events, following docs/games-plan.md phase 2.
//
// `makeGameSchema(options)` builds the schema so tests can run devices with different
// "app versions": with or without rule checks in the materializers, and with or
// without the v2 foul_type event.

import { Events, Schema, State, defineMaterializer, makeSchema } from '@livestore/livestore'

export const STATS = [
  'ft_made', 'ft_missed', 'fg2_made', 'fg2_missed', 'fg3_made', 'fg3_missed',
  'oreb', 'dreb', 'stl', 'blk', 'tov', 'foul',
] as const
export type Stat = (typeof STATS)[number]
export const MADE_FG: readonly Stat[] = ['fg2_made', 'fg3_made']

const Side = Schema.Literals(['us', 'them'])
const StatS = Schema.Literals(STATS)
const NullableString = Schema.NullOr(Schema.String)

export const tables = {
  games: State.SQLite.table({
    name: 'games',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      opponent: State.SQLite.text(),
      deleted: State.SQLite.boolean({ default: false }),
    },
  }),
  plays: State.SQLite.table({
    name: 'plays',
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      game_id: State.SQLite.text(),
      side: State.SQLite.text(),
      player_id: State.SQLite.text({ nullable: true }),
      stat: State.SQLite.text(),
      foul_type: State.SQLite.text({ nullable: true }),
      assist_player_id: State.SQLite.text({ nullable: true }),
      period: State.SQLite.integer(),
      position: State.SQLite.text(),
      recorded_by: State.SQLite.text(),
      deleted: State.SQLite.boolean({ default: false }),
    },
  }),
  /** Plays the materializer refused, so the screen can show "won't count" instead of hiding them. */
  refused: State.SQLite.table({
    name: 'refused',
    columns: {
      // Play, event and global sequence number: the same on every device.
      id: State.SQLite.text({ primaryKey: true }),
      play_id: State.SQLite.text(),
      event: State.SQLite.text(),
      reason: State.SQLite.text(),
    },
  }),
}

const playFields = {
  side: Side,
  player_id: NullableString,
  stat: StatS,
  assist_player_id: NullableString,
  period: Schema.Int,
  position: Schema.String,
}

export const events = {
  gameCreated: Events.synced({
    name: 'v1.GameCreated',
    schema: Schema.Struct({ id: Schema.String, opponent: Schema.String }),
  }),
  gameDeleted: Events.synced({
    name: 'v1.GameDeleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
  playRecorded: Events.synced({
    name: 'v1.PlayRecorded',
    schema: Schema.Struct({ id: Schema.String, game_id: Schema.String, recorded_by: Schema.String, ...playFields }),
  }),
  /** Partial edit: only the fields sent change, like Courtside's `*.put`. */
  playEdited: Events.synced({
    name: 'v1.PlayEdited',
    schema: Schema.Struct({
      id: Schema.String,
      side: Schema.optionalKey(Side),
      player_id: Schema.optionalKey(NullableString),
      stat: Schema.optionalKey(StatS),
      assist_player_id: Schema.optionalKey(NullableString),
      period: Schema.optionalKey(Schema.Int),
      position: Schema.optionalKey(Schema.String),
    }),
  }),
  playDeleted: Events.synced({
    name: 'v1.PlayDeleted',
    schema: Schema.Struct({ id: Schema.String }),
  }),
}

/** The v2 event a newer app version adds (foul_type). */
export const playRecordedV2 = Events.synced({
  name: 'v2.PlayRecorded',
  schema: Schema.Struct({
    id: Schema.String,
    game_id: Schema.String,
    recorded_by: Schema.String,
    ...playFields,
    foul_type: Schema.NullOr(Schema.Literals(['personal', 'offensive', 'technical', 'flagrant'])),
  }),
})

export type PlayRow = typeof tables.plays.Type
type PlayShape = Pick<PlayRow, 'side' | 'player_id' | 'stat' | 'assist_player_id'> & { foul_type?: string | null }

/** The phase 2 rules, with Courtside's messages. Returns null when the play is fine. */
export const playRuleViolation = (p: PlayShape): string | null => {
  if (p.side === 'them' && p.player_id != null) return "The other team's plays can't have a player."
  if (p.assist_player_id != null && !(p.side === 'us' && MADE_FG.includes(p.stat as Stat)))
    return 'Only made shots can have an assist.'
  if (p.assist_player_id != null && p.assist_player_id === p.player_id) return "A player can't assist their own shot."
  if (p.foul_type != null && p.stat !== 'foul') return 'Only fouls have a foul type.'
  return null
}

/**
 * How a materializer treats an event that breaks a rule:
 * - 'none': no checks (an old app version that predates the rule);
 * - 'throw': throw, which LiveStore documents as rolling back and halting;
 * - 'skip': deterministically ignore the event and record it in `refused`.
 */
export type RuleMode = 'none' | 'throw' | 'skip'

export interface SchemaOptions {
  rules?: RuleMode
  /** Include the v2.PlayRecorded event (a newer app version). */
  v2?: boolean
  unknownEvents?: 'warn' | 'ignore' | 'fail'
}

export const makeGameSchema = (opts: SchemaOptions = {}) => {
  const rules = opts.rules ?? ((process.env.SPIKE_RULES as RuleMode | undefined) ?? 'skip')
  const allEvents: Record<string, any> = { ...events }
  if (opts.v2) allEvents.playRecordedV2 = playRecordedV2

  const refuse = (playId: string, event: string, reason: string, ctx: any) => {
    if (rules === 'throw') throw new Error(reason)
    const id = `${playId}:${event}:${JSON.stringify(ctx.event.seqNum?.global ?? ctx.event.seqNum)}`
    return tables.refused.insert({ id, play_id: playId, event, reason }).onConflict('id', 'replace')
  }

  // Raw SQL: the query builder's `.first({ fallback: () => null })` threw
  // "SchemaError: Expected object | null" inside the leader for pulled events (0.5.0).
  const rowById = (ctx: any, table: string, id: string): any =>
    (ctx.query({ query: `SELECT * FROM ${table} WHERE id = $id`, bindValues: { id } }) as any[])[0] ?? null

  const record = (args: any, eventName: string, ctx: any) => {
    if (rules !== 'none') {
      const game = rowById(ctx, "games", args.game_id)
      if (game == null || game.deleted) return refuse(args.id, eventName, 'That game was deleted.', ctx)
      const reason = playRuleViolation(args)
      if (reason) return refuse(args.id, eventName, reason, ctx)
    }
    return tables.plays.insert({ foul_type: null, ...args })
  }

  const handlers: Record<string, any> = {
    [events.gameCreated.name]: defineMaterializer(events.gameCreated, ({ id, opponent }) =>
      tables.games.insert({ id, opponent }),
    ),
    [events.gameDeleted.name]: defineMaterializer(events.gameDeleted, ({ id }) => [
      tables.games.update({ deleted: true }).where({ id }),
      tables.plays.update({ deleted: true }).where({ game_id: id }),
    ]),
    [events.playRecorded.name]: defineMaterializer(events.playRecorded, (args, ctx) =>
      record(args, events.playRecorded.name, ctx),
    ),
    [events.playEdited.name]: defineMaterializer(events.playEdited, ({ id, ...changes }, ctx) => {
      const current = rowById(ctx, "plays", id)
      if (rules !== 'none') {
        if (current == null || current.deleted) return refuse(id, events.playEdited.name, 'That play was deleted.', ctx)
        const reason = playRuleViolation({ ...current, ...changes })
        if (reason) return refuse(id, events.playEdited.name, reason, ctx)
      }
      if (Object.keys(changes).length === 0) return []
      return tables.plays.update(changes).where({ id })
    }),
    [events.playDeleted.name]: defineMaterializer(events.playDeleted, ({ id }) =>
      tables.plays.update({ deleted: true }).where({ id }),
    ),
  }
  if (opts.v2)
    handlers[playRecordedV2.name] = defineMaterializer(playRecordedV2, (args, ctx) =>
      record(args, playRecordedV2.name, ctx),
    )

  const state = State.SQLite.makeState({ tables, materializers: State.SQLite.materializers(allEvents as typeof events, handlers as any) })
  return makeSchema({
    events: allEvents as typeof events,
    state,
    unknownEventHandling: { strategy: opts.unknownEvents ?? 'warn' } as any,
  })
}
