// Drives the plugin's real crab logic through a short story and prints each
// frame's segments as JSON: wander, get fed, walk to the shrimp, eat, wander.
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const repo = process.argv[2]
const crabLib = await import(pathToFileURL(`${repo}/hooks/crab.ts`).href)
const { hatch, feed, moodOf, wander, dropShrimp, beachCells, scene, EAT_TICKS } = crabLib

const WIDTH = 100
const T0 = Date.UTC(2026, 9, 10, 17, 0, 0)

let seed = 7
const rand = () => {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
  return seed / 4_294_967_296
}

const cells = beachCells(WIDTH)
let crab = { ...hatch(T0 - 3_600_000), food: 76 }
let walk = { pos: 6, target: 14, restTicks: 0, shrimp: null, eaten: 0 }
const frames = []

function tick(i) {
  const now = T0 + i * 1000
  const mood = moodOf(crab, now)
  if (crab.hasShrimp) walk = dropShrimp(walk, cells, rand)
  const had = walk.shrimp !== null
  walk = wander(walk, cells, mood, rand)
  if (had && walk.shrimp === null) crab = { ...crab, hasShrimp: false }
  frames.push(scene(crab, now, WIDTH, walk, i))
}

let i = 0
for (; i < 8; i++) tick(i)
// Claude finishes a turn: the crab is fed and a shrimp lands far from it.
crab = feed(crab, 12_400, T0 + i * 1000)
walk = { ...walk, shrimp: walk.pos > cells / 2 ? 3 : cells - 4 }
crab = { ...crab, hasShrimp: true }
let guard = 0
while ((walk.shrimp !== null || guard < 2) && guard++ < 80) tick(i++)
for (let k = 0; k < 6; k++) tick(i++)

writeFileSync(process.argv[3], JSON.stringify({ width: WIDTH, eatTicks: EAT_TICKS, frames }))
