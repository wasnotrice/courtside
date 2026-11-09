// A scripted game: a deterministic stream of plays, edits and undos, split between two
// phones (one scores us, one scores them), so tests can replay "a full game offline".

import { events, MADE_FG, STATS, type Stat } from './schema.ts'

export const ROSTER = ['ava', 'riley', 'sam', 'jo', 'mia', 'kai', 'lee', 'max']

/** A small deterministic PRNG so every run records the same game. */
export const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

/** Position key: game second, zero-padded, then the phone, so ties break by phone. */
export const positionAt = (second: number, phone: string) => `${String(second).padStart(5, '0')}-${phone}`

export type Op = { phone: 'a' | 'b'; event: ReturnType<(typeof events)[keyof typeof events]> }

/**
 * Builds a game of `plays` plays: phone a records ours, phone b theirs. About 1 in 15
 * plays is followed by an edit (change player or stat) and 1 in 30 by an undo of the
 * phone's own last play. Returns the ops in game-time order.
 */
export const scriptGame = (gameId: string, plays = 400, seed = 1): Op[] => {
  const r = rng(seed)
  const ops: Op[] = []
  const lastOwn: Record<'a' | 'b', string | null> = { a: null, b: null }
  for (let i = 0; i < plays; i++) {
    const phone: 'a' | 'b' = r() < 0.6 ? 'a' : 'b'
    const side = phone === 'a' ? 'us' : 'them'
    const stat = STATS[Math.floor(r() * STATS.length)] as Stat
    const player = side === 'us' && r() < 0.95 ? ROSTER[Math.floor(r() * ROSTER.length)]! : null
    let assist: string | null = null
    if (side === 'us' && MADE_FG.includes(stat) && r() < 0.5) {
      assist = ROSTER.filter((p) => p !== player)[Math.floor(r() * (ROSTER.length - 1))]!
    }
    const id = `${gameId}-p${i}`
    ops.push({
      phone,
      event: events.playRecorded({
        id, game_id: gameId, recorded_by: phone, side, player_id: player, stat,
        assist_player_id: assist, period: 1 + Math.floor((i / plays) * 4), position: positionAt(i * 6, phone),
      }),
    })
    lastOwn[phone] = id
    const roll = r()
    if (roll < 1 / 15 && side === 'us') {
      // Fix the shooter, keeping the assist rule intact.
      const newPlayer = ROSTER.find((p) => p !== player && p !== assist)!
      ops.push({ phone, event: events.playEdited({ id, player_id: newPlayer }) })
    } else if (roll < 1 / 15) {
      ops.push({ phone, event: events.playEdited({ id, stat: 'tov' }) })
    } else if (roll < 1 / 15 + 1 / 30 && lastOwn[phone]) {
      ops.push({ phone, event: events.playDeleted({ id: lastOwn[phone]! }) })
      lastOwn[phone] = null
    }
  }
  return ops
}
