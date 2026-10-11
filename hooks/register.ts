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
const RELOAD_EVERY_FRAMES = 30
/** No turn for this many ticks and the crab dozes: the scene stops moving. */
const IDLE_TICKS = 10 * 60
/** While dozing, redraw only this often (food %, a crab fed elsewhere). */
const IDLE_REDRAW_TICKS = 60
/** Columns left free at the row's end, so it never wraps. */
const MARGIN = 2
/** A frame untouched this long belongs to a session that died without cleaning up. */
const STALE_FRAME_MS = 60 * 60 * 1000

// Module state is rebuilt on every load; the crab itself lives in $.store.
let key = ''
let framesDir = ''
let framePath = ''
let isWindows = false
let crab: Crab | undefined
let shown = ''
let tick = 0
/** Ticks the scene has moved; frozen while the crab dozes. */
let frame = 0
/** Ticks since the last turn started or ended. */
let quietTicks = 0
let columns = 80
let walk: Walk = START_WALK

async function load($: EngineInterface) {
  crab = (await $.store.get(key)) as Crab | undefined
}

async function save($: EngineInterface, next: Crab) {
  crab = next
  await $.store.set(key, next)
}

/** Deletes files; $.fs cannot, so the host's own delete command does. */
async function deleteFiles($: EngineInterface, paths: readonly string[]) {
  if (paths.length === 0) return
  const argv = isWindows
    ? ['cmd', '/c', 'del', '/q', '/f', ...paths.map(p => p.replace(/\//g, '\\'))]
    : ['rm', '-f', ...paths]
  await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
}

/** Sweeps frames left empty by older versions or by sessions that crashed. */
async function sweepFrames($: EngineInterface) {
  if (!(await $.fs.exists(framesDir))) return
  const now = await $.clock.now()
  const stale = (await $.fs.list(framesDir))
    .filter(f => f.kind === 'file' && (f.size === 0 || now - f.mtimeMs > STALE_FRAME_MS))
    .map(f => `${framesDir}/${f.name}`)
  await deleteFiles($, stale)
}

/**
 * Steps the crab, then writes the frame the status line command prints, and
 * only when it changed. After IDLE_TICKS without a turn the crab dozes: no
 * stepping and no waves, one cheap redraw a minute. That redraw always
 * writes, so other sessions' sweeps never take a dozing session's frame for
 * a dead one.
 */
async function draw($: EngineInterface) {
  if (framePath === '') return
  const isDozing = ++quietTicks > IDLE_TICKS
  if (isDozing && quietTicks % IDLE_REDRAW_TICKS !== 0) return
  if (tick++ % RELOAD_EVERY_FRAMES === 0 || isDozing) await load($)
  const now = await $.clock.now()
  const width = columns - MARGIN
  if (!isDozing) {
    frame++
    const mood = crab === undefined ? 'dead' : moodOf(crab, now)
    const cells = beachCells(width)
    // The saved crab says a shrimp is due: put it on the beach if it is not.
    if (crab?.hasShrimp === true && mood !== 'dead') walk = dropShrimp(walk, cells, Math.random)
    const hadShrimp = walk.shrimp !== null
    walk = wander(walk, cells, mood, Math.random)
    if (hadShrimp && walk.shrimp === null && crab !== undefined) {
      await save($, { ...crab, hasShrimp: false })
    }
  }
  const line = segmentsAnsi(scene(crab, now, width, walk, frame))
  if (line === shown && !isDozing) return
  shown = line
  await $.fs.write(framePath, `${line}\n`)
}

/** A turn starting or ending wakes the crab. */
function wake() {
  quietTicks = 0
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    key = `crab:${(await $.session.cwd()).toLowerCase()}`
    const userProfile = await $.env.get('USERPROFILE')
    isWindows = userProfile !== undefined
    const home = userProfile ?? (await $.env.get('HOME')) ?? ''
    framesDir = `${home}/.claude/shelldon/frames`
    framePath = `${framesDir}/${await $.session.id()}.txt`
    await sweepFrames($)
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
    if (framePath !== '') {
      const path = framePath
      framePath = '' // stops the timer writing it back
      await deleteFiles($, [path])
    }
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    wake()
    return next(e)
  })

  // Every turn, the main one and subagents', feeds the crab what it spent;
  // feeding marks a shrimp due, which the next draw puts on the beach.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    wake()
    const usage = e.usage
    if (usage !== undefined && key !== '') {
      await load($)
      const now = await $.clock.now()
      const tokens =
        usage.input_tokens + usage.output_tokens + (usage.cache_creation_input_tokens ?? 0)
      if (crab !== undefined) await save($, feed(crab, tokens, now))
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
