import { expect, test } from 'claude-code/testing'

import {
  beachCells,
  DIES_AFTER_MS,
  displayWidth,
  dropShrimp,
  EAT_TICKS,
  feed,
  hatch,
  moodOf,
  scene,
  segmentsAnsi,
  segmentsText,
  START_WALK,
  wander,
} from './crab'
import type { Crab, Walk } from './crab'

const T0 = 1_700_000_000_000
const HOUR = 3_600_000

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    return seed / 4_294_967_296
  }
}

const row = (crab: Crab, at: number, walk: Walk = START_WALK, tick = 0, width = 100) =>
  segmentsText(scene(crab, at, width, walk, tick))

test('the ocean is on the left, the beach and crab on the right', () => {
  const line = row(hatch(T0), T0)
  expect(line.indexOf('🌊')).toBeLessThan(line.indexOf('🦀'))
  expect(line.indexOf('🦀')).toBeLessThan(line.indexOf('🍖'))
  expect(line).toContain('🍖 80% happy')
})

test('waves are blue with light blue crests and roll; the sand is yellow', () => {
  const segments = scene(hatch(T0), T0, 100, START_WALK, 0)
  const colors = new Set(segments.filter(s => /[~≈]/.test(s.text)).map(s => s.color))
  expect([...colors].sort()).toEqual(['#3b82f6', '#7dd3fc'])
  expect(segments.filter(s => s.text.includes('·')).every(s => s.color === '#eab308')).toBe(true)
  expect(row(hatch(T0), T0, START_WALK, 0)).toBe(row(hatch(T0), T0, START_WALK, 1))
  expect(row(hatch(T0), T0, START_WALK, 0)).not.toBe(row(hatch(T0), T0, START_WALK, 2))
})

test('the status line gets the scene in ANSI truecolor', () => {
  const ansi = segmentsAnsi(scene(hatch(T0), T0, 100, START_WALK, 0))
  expect(ansi).toContain('\x1b[38;2;59;130;246m')
  expect(ansi).toContain('\x1b[38;2;234;179;8m · ·')
  expect(ansi.replace(/\x1b\[[0-9;]*m/g, '')).toBe(row(hatch(T0), T0))
})

test('the row fills the width exactly, at any width and mood', () => {
  const walk: Walk = { ...START_WALK, pos: 3, shrimp: 6 }
  for (const width of [60, 80, 120, 200]) {
    for (const at of [T0, T0 + 1000, T0 + 40 * HOUR, T0 + DIES_AFTER_MS + HOUR]) {
      const fed = feed(hatch(T0), 50_000, T0)
      expect(displayWidth(row(fed, at, walk, 7, width))).toBe(width)
    }
  }
})

test('food decays to hungry, then starving', () => {
  const crab = hatch(T0)
  expect(moodOf(crab, T0 + 40 * HOUR)).toBe('hungry')
  expect(moodOf(crab, T0 + 60 * HOUR)).toBe('starving')
})

test('tokens feed it and flash the meal size', () => {
  const fed = feed({ ...hatch(T0), food: 10 }, 100_000, T0)
  expect(fed.food).toBe(60)
  expect(row(fed, T0 + 1000)).toContain('+100.0k')
  expect(row(fed, T0 + 60_000)).not.toContain('+100.0k')
})

test('it dies after a week unfed and cannot be fed back', () => {
  const crab = hatch(T0)
  const later = T0 + DIES_AFTER_MS + HOUR
  expect(moodOf(crab, later)).toBe('dead')
  expect(row(crab, later)).toContain('🪦')
  expect(feed(crab, 1_000_000, later)).toEqual(crab)
})

test('feeding marks a shrimp due, saved with the crab', () => {
  expect(hatch(T0).hasShrimp).toBe(undefined)
  expect(feed(hatch(T0), 5_000, T0 + 1000).hasShrimp).toBe(true)
  const dead = hatch(T0)
  expect(feed(dead, 5_000, T0 + DIES_AFTER_MS + HOUR).hasShrimp).toBe(undefined)
})

test('a shrimp lands on the beach away from the crab, one at a time', () => {
  const rand = seeded(3)
  for (let i = 0; i < 200; i++) {
    const walk = dropShrimp({ ...START_WALK, pos: i % 20 }, 20, rand)
    expect(walk.shrimp).not.toBe(walk.pos)
    expect(walk.shrimp! >= 0 && walk.shrimp! < 20).toBe(true)
  }
  const down: Walk = { ...START_WALK, shrimp: 9 }
  expect(dropShrimp(down, 20, rand)).toEqual(down)
  expect(row(hatch(T0), T0, down)).toContain('🍤')
})

test('the crab walks up beside the shrimp and eats it there, the shrimp showing until gone', () => {
  const rand = seeded(11)
  const crab = hatch(T0)
  for (const [from, shrimp, beside] of [
    [2, 12, 11],
    [18, 12, 13],
    [5, 0, 1],
    [3, 19, 18],
  ] as const) {
    let walk: Walk = { ...START_WALK, pos: from, target: from, shrimp }
    let ticks = 0
    while (walk.eaten === 0) {
      walk = wander(walk, 20, 'hungry', rand)
      expect(walk.pos).not.toBe(shrimp)
      if (++ticks > 300) throw new Error('never reached the shrimp')
    }
    expect(walk.pos).toBe(beside)
    for (let i = 1; i < EAT_TICKS; i++) {
      expect(row(crab, T0, walk)).toContain('🍤')
      expect(row(crab, T0, walk)).toContain('nom nom')
      walk = wander(walk, 20, 'happy', rand)
      expect(walk.pos).toBe(beside)
    }
    expect(walk.shrimp).toBe(null)
    expect(row(crab, T0, walk)).not.toContain('🍤')
    expect(row(crab, T0, walk)).not.toContain('nom nom')
  }
})

test('a happy crab wanders the whole beach and never leaves it', () => {
  const cells = beachCells(120)
  const rand = seeded(42)
  const seen = new Set<number>()
  let walk = START_WALK
  for (let i = 0; i < 5000; i++) {
    walk = wander(walk, cells, 'happy', rand)
    expect(walk.pos >= 0 && walk.pos < cells).toBe(true)
    seen.add(walk.pos)
  }
  expect(seen.size).toBe(cells)
})

test('a starving crab stays put', () => {
  const rand = seeded(7)
  let walk: Walk = { ...START_WALK, pos: 5, target: 20 }
  for (let i = 0; i < 100; i++) walk = wander(walk, 40, 'starving', rand)
  expect(walk.pos).toBe(5)
})
