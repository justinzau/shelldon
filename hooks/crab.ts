// Pure crab logic: no `$`, so it is easy to test.

/** A run of the scene's text, drawn in one style. */
export type CrabPetSegment = { text: string; color?: string; dim?: boolean }

export type Crab = {
  /** Food (0-100) as of `fedAt`. */
  food: number
  /** Last time the crab ate, ms since epoch. */
  fedAt: number
  bornAt: number
  /** How many tokens the last meal was, for the `+12.4k` flash. */
  lastMeal: number
  /**
   * A 🍤 is waiting on the beach, uneaten. Kept with the crab rather than in
   * memory, so a plugin reload never sweeps it away.
   */
  hasShrimp?: boolean
}

export type Mood = 'happy' | 'okay' | 'hungry' | 'starving' | 'dead'

/**
 * Where the crab is on the beach and where it is headed; `shrimp` is the
 * cell a dropped 🍤 lies on, `eaten` how many ticks the crab has chewed it.
 */
export type Walk = {
  pos: number
  target: number
  restTicks: number
  shrimp: number | null
  eaten: number
}

export const START_WALK: Walk = { pos: 0, target: 0, restTicks: 0, shrimp: null, eaten: 0 }

const HOUR = 3_600_000
const DAY = 24 * HOUR

export const TOKENS_PER_FOOD = 2_000
/** A full crab empties in 3 days. */
export const DECAY_PER_HOUR = 100 / 72
/** No food for 7 days and the crab dies. */
export const DIES_AFTER_MS = 7 * DAY
const FLASH_MS = 5_000
/** Share of the scene that is ocean. */
const OCEAN_SHARE = 0.18
const MIN_BEACH_CELLS = 4
const STATS_ROOM = 26

export function hatch(now: number): Crab {
  return { food: 80, fedAt: now, bornAt: now, lastMeal: 0 }
}

export function foodNow(crab: Crab, now: number): number {
  const hours = Math.max(0, now - crab.fedAt) / HOUR
  return Math.max(0, crab.food - hours * DECAY_PER_HOUR)
}

export function isDead(crab: Crab, now: number): boolean {
  return now - crab.fedAt > DIES_AFTER_MS
}

export function moodOf(crab: Crab, now: number): Mood {
  if (isDead(crab, now)) return 'dead'
  const food = foodNow(crab, now)
  if (food >= 60) return 'happy'
  if (food >= 25) return 'okay'
  if (food > 0) return 'hungry'
  return 'starving'
}

/** Feeds a living crab `tokens`; a dead crab stays dead. */
export function feed(crab: Crab, tokens: number, now: number): Crab {
  if (tokens <= 0 || isDead(crab, now)) return crab
  const meal = Math.max(1, tokens / TOKENS_PER_FOOD)
  return {
    ...crab,
    food: Math.min(100, foodNow(crab, now) + meal),
    fedAt: now,
    lastMeal: tokens,
    hasShrimp: true,
  }
}

/** Chance per tick that the crab takes a step, by mood. */
const STEP_CHANCE: Record<Mood, number> = {
  happy: 0.9,
  okay: 0.6,
  hungry: 0.3,
  starving: 0,
  dead: 0,
}

/** Ticks (seconds) the crab sits chewing a shrimp before it is gone. */
export const EAT_TICKS = 8
/** A crab heading for food never dawdles below this. */
const FOOD_STEP_CHANCE = 0.9

/** Drops a 🍤 on a random cell away from the crab; one shrimp at a time. */
export function dropShrimp(walk: Walk, cells: number, rand: () => number): Walk {
  if (walk.shrimp !== null || cells < 2) return walk
  const spot = Math.floor(rand() * (cells - 1))
  return { ...walk, shrimp: spot >= walk.pos ? spot + 1 : spot, eaten: 0 }
}

/**
 * One tick of the walk. With a shrimp down, the crab heads straight for it
 * and chews it for EAT_TICKS; otherwise it scuttles toward a random target,
 * rests a while on arrival, then picks a new spot anywhere on the beach.
 */
export function wander(walk: Walk, cells: number, mood: Mood, rand: () => number): Walk {
  const last = Math.max(0, cells - 1)
  const pos = Math.min(walk.pos, last)
  const shrimp = walk.shrimp === null ? null : Math.min(walk.shrimp, last)
  const step = (target: number, chance: number) =>
    rand() < chance ? pos + Math.sign(target - pos) : pos

  if (shrimp !== null) {
    if (pos === shrimp) {
      const eaten = walk.eaten + 1
      return eaten >= EAT_TICKS
        ? { pos, target: pos, restTicks: 4, shrimp: null, eaten: 0 }
        : { pos, target: pos, restTicks: 0, shrimp, eaten }
    }
    const chance = Math.max(STEP_CHANCE[mood], FOOD_STEP_CHANCE)
    return { pos: step(shrimp, chance), target: shrimp, restTicks: 0, shrimp, eaten: 0 }
  }

  const target = Math.min(walk.target, last)
  if (walk.restTicks > 0) return { ...walk, pos, target, restTicks: walk.restTicks - 1 }
  if (pos === target) {
    return {
      ...walk,
      pos,
      target: Math.floor(rand() * cells),
      restTicks: Math.floor(rand() * 6),
    }
  }
  return { ...walk, pos: step(target, STEP_CHANCE[mood]), target }
}

/** Terminal columns a string takes: emoji count two, joiners none. */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0x200d) continue
    width += cp >= 0x1f000 ? 2 : 1
  }
  return width
}

const WAVES = '~≈~~≈~ ~≈≈~ ~~≈~ ≈~~ '
const SEA_BLUE = '#3b82f6'
const FOAM_BLUE = '#7dd3fc'
const SAND_YELLOW = '#eab308'
/** Ticks per column the waves roll. */
const WAVE_TICKS = 2

/** Blue swell with light blue crests (≈), the 🌊 shore at its right end. */
function ocean(cols: number, tick: number): CrabPetSegment[] {
  if (cols < 2) return [{ text: ' '.repeat(Math.max(0, cols)) }]
  // The waves roll right, in toward the shore, one column every WAVE_TICKS.
  const shift = Math.floor(tick / WAVE_TICKS)
  const out: CrabPetSegment[] = []
  for (let i = 0; i < cols - 2; i++) {
    const ch = WAVES[(((i - shift) % WAVES.length) + WAVES.length) % WAVES.length] ?? ' '
    const color = ch === '≈' ? FOAM_BLUE : SEA_BLUE
    const prev = out[out.length - 1]
    if (prev !== undefined && prev.color === color) prev.text += ch
    else out.push({ text: ch, color })
  }
  out.push({ text: '🌊' })
  return out
}

export function segmentsText(segments: readonly CrabPetSegment[]): string {
  return segments.map(s => s.text).join('')
}

/** The scene as one line of ANSI-colored text, for a status line command. */
export function segmentsAnsi(segments: readonly CrabPetSegment[]): string {
  const ESC = '\x1b['
  return segments
    .map(s => {
      const rgb = s.color?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
      if (rgb) {
        const [r, g, b] = rgb.slice(1).map(h => parseInt(h, 16))
        return `${ESC}38;2;${r};${g};${b}m${s.text}${ESC}0m`
      }
      return s.dim === true ? `${ESC}2m${s.text}${ESC}0m` : s.text
    })
    .join('')
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

function ago(ms: number): string {
  const days = Math.floor(ms / DAY)
  if (days >= 1) return `${days}d`
  const hours = Math.floor(ms / HOUR)
  return hours >= 1 ? `${hours}h` : `${Math.max(1, Math.floor(ms / 60_000))}m`
}

const TAG: Record<Mood, string> = {
  happy: 'happy',
  okay: 'okay',
  hungry: 'hungry 💧',
  starving: 'starving 💤',
  dead: '',
}

function stats(crab: Crab | undefined, now: number, walk: Walk): string {
  if (crab === undefined) return '🥚 /crab hatch'
  const mood = moodOf(crab, now)
  if (mood === 'dead') return `🪦 starved ${ago(now - crab.fedAt - DIES_AFTER_MS)} ago · /crab hatch`
  const tag = walk.eaten > 0 ? 'nom nom' : TAG[mood]
  const flash =
    now - crab.fedAt < FLASH_MS && crab.lastMeal > 0 ? ` +${formatTokens(crab.lastMeal)}` : ''
  return `🍖 ${Math.round(foodNow(crab, now))}% ${tag}${flash}`
}

/** Ocean columns for `width`: a fixed share of the row. */
function oceanCols(width: number): number {
  return Math.max(2, Math.floor(width * OCEAN_SHARE))
}

/**
 * Beach cells (two columns each, as wide as 🦀) for `width`: what the ocean
 * and a fixed room for the stats leave, so the beach holds still as they change.
 */
export function beachCells(width: number): number {
  return Math.max(MIN_BEACH_CELLS, Math.floor((width - oceanCols(width) - STATS_ROOM) / 2))
}

/** The whole row: ocean, beach with the crab, then its stats, `width` wide. */
export function scene(
  crab: Crab | undefined,
  now: number,
  width: number,
  walk: Walk,
  tick: number,
): CrabPetSegment[] {
  const tail = stats(crab, now, walk)
  const cells = beachCells(width)
  const mood = crab === undefined ? 'dead' : moodOf(crab, now)
  const who = crab === undefined ? '🥚' : mood === 'dead' ? '🪦' : '🦀'
  const pos = Math.min(walk.pos, cells - 1)
  const shrimp = mood === 'dead' || walk.shrimp === null ? -1 : Math.min(walk.shrimp, cells - 1)

  // Every beach cell is two columns: sand, the crab, or a shrimp it has not reached.
  const beach: CrabPetSegment[] = []
  for (let i = 0; i < cells; i++) {
    const thing = i === pos ? who : i === shrimp ? '🍤' : null
    const prev = beach[beach.length - 1]
    if (thing !== null) beach.push({ text: thing })
    else if (prev?.color === SAND_YELLOW) prev.text += ' ·'
    else beach.push({ text: ' ·', color: SAND_YELLOW })
  }

  // Stats shorter than their room leave blanks at the end; longer ones (the
  // tombstone's) take columns from the ocean.
  const sea = oceanCols(width)
  const slack = width - sea - cells * 2 - 1 - displayWidth(tail)
  return [
    ...ocean(sea + Math.min(0, slack), tick),
    ...beach,
    { text: ` ${tail}${' '.repeat(Math.max(0, slack))}` },
  ]
}

export function report(crab: Crab | undefined, now: number): string {
  if (crab === undefined) return 'No crab lives here yet. Run /crab hatch to get one.'
  const mood = moodOf(crab, now)
  if (mood === 'dead') {
    return `Your crab starved. Nobody fed it for ${ago(now - crab.fedAt)}. Run /crab hatch for a new one.`
  }
  const left = Math.max(0, DIES_AFTER_MS - (now - crab.fedAt))
  return [
    `🦀 ${mood}, food ${Math.round(foodNow(crab, now))}%`,
    `Age ${ago(now - crab.bornAt)}, last fed ${ago(now - crab.fedAt)} ago.`,
    `It dies if nobody works in this repo for ${ago(left)}.`,
  ].join('\n')
}
