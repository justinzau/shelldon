import type { EngineInterface, Register } from 'claude-code'

import {
  beachCells,
  dropShrimp,
  feed,
  hatch,
  moodOf,
  report,
  scene,
  segmentsAnsi,
  START_WALK,
  wander,
} from './crab'
import type { Crab, Walk } from './crab'

/** One tick a second: the status line re-reads the frame once a second. */
const FRAME_MS = 1000
/** Re-read the store this often, so a crab fed in another session shows up. */
const RELOAD_EVERY_FRAMES = 10
/** Columns left free at the row's end, so it never wraps. */
const MARGIN = 2

// Module state is rebuilt on every load; the crab itself lives in $.store.
let key = ''
let framePath = ''
let crab: Crab | undefined
let shown = ''
let tick = 0
let columns = 80
let walk: Walk = START_WALK

async function load($: EngineInterface) {
  crab = (await $.store.get(key)) as Crab | undefined
}

async function save($: EngineInterface, next: Crab) {
  crab = next
  await $.store.set(key, next)
}

/** Steps the crab, then writes the frame the status line command prints. */
async function draw($: EngineInterface) {
  if (framePath === '') return
  if (tick++ % RELOAD_EVERY_FRAMES === 0) await load($)
  const now = await $.clock.now()
  const width = columns - MARGIN
  const mood = crab === undefined ? 'dead' : moodOf(crab, now)
  walk = wander(walk, beachCells(width), mood, Math.random)
  const line = segmentsAnsi(scene(crab, now, width, walk, tick))
  if (line === shown) return
  shown = line
  await $.fs.write(framePath, line)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    key = `crab:${(await $.session.cwd()).toLowerCase()}`
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    framePath = `${home}/.claude/crab-pet/frames/${await $.session.id()}.txt`
    await load($)
    if (crab === undefined) await save($, hatch(await $.clock.now()))
    await $.command.register({
      name: 'crab',
      description: 'Check on your crab, or hatch a new one',
      argumentHint: '[hatch]',
      immediate: true,
    })
    await draw($)
    $.clock.every(FRAME_MS, () => void draw($))

    return next(e)
  })

  // A status line command is told no width the mod can read, but every
  // render is: borrow the band's draw to learn the terminal's, draw nothing.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport !== undefined) columns = e.viewport.columns
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (framePath !== '') await $.fs.write(framePath, '')
    return next(e)
  })

  // Every turn, the main one and subagents', feeds the crab what it spent,
  // and drops a shrimp on the beach for it to go and eat.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
    if (usage !== undefined && key !== '') {
      await load($)
      const now = await $.clock.now()
      const tokens =
        usage.input_tokens + usage.output_tokens + (usage.cache_creation_input_tokens ?? 0)
      if (crab !== undefined && moodOf(crab, now) !== 'dead') {
        await save($, feed(crab, tokens, now))
        walk = dropShrimp(walk, beachCells(columns - MARGIN), Math.random)
      }
      await draw($)
    }

    return result
  })

  on('command.run', { command: 'crab' }, async ($, e) => {
    const now = await $.clock.now()
    await load($)
    if (e.args.trim() === 'hatch') {
      if (crab !== undefined && moodOf(crab, now) !== 'dead') {
        return { text: 'Your crab is still alive. Take care of it!' }
      }
      await save($, hatch(now))
      walk = START_WALK
      await draw($)

      return { text: '🥚 → 🦀 A new crab hatched! Keep working in this repo to feed it.' }
    }

    return { text: report(crab, now) }
  })
}
