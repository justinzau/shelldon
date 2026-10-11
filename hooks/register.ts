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
import { isShelldonCommand, printsCrab, scriptPathsIn, wrapStatusLine } from './setup'
import type { StatusLine } from './setup'

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
/** How long after `/crab uninstall` answers the plugin asks to be uninstalled. */
const UNINSTALL_DELAY_MS = 500
/** A frame untouched this long belongs to a session that died without cleaning up. */
const STALE_FRAME_MS = 60 * 60 * 1000

// Module state is rebuilt on every load; the crab itself lives in $.store.
let key = ''
let home = ''
/** ~/.claude/shelldon: frames, the status line script, what setup replaced. */
let shelldonDir = ''
/** The user settings.json setup edits (CLAUDE_CONFIG_DIR, else ~/.claude). */
let settingsPath = ''
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

/** Deletes a directory and everything in it, the same way. */
async function deleteDir($: EngineInterface, path: string) {
  const argv = isWindows
    ? ['cmd', '/c', 'rmdir', '/s', '/q', path.replace(/\//g, '\\')]
    : ['rm', '-rf', path]
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

/**
 * Copies the plugin's status line script to ~/.claude/shelldon, where the
 * settings point (the plugin's own folder moves with every update). CRs are
 * dropped: sh chokes on a CRLF checkout.
 */
async function installScript($: EngineInterface) {
  const text = (await $.fs.read(`${$.plugin.root}/statusline/shelldon.sh`)).replace(/\r/g, '')
  const target = `${shelldonDir}/statusline.sh`
  if ((await $.fs.exists(target)) && (await $.fs.read(target)) === text) return
  await $.fs.write(target, text)
}

/**
 * Whether the status line already prints the crab: it is Shelldon's own, or
 * a script it runs reads the frames (a hand-made one, as the README shows).
 */
async function crabInStatusLine($: EngineInterface): Promise<boolean> {
  const line = (await $.settings.read()).statusLine as StatusLine | undefined
  if (line?.command === undefined) return false
  if (isShelldonCommand(line.command)) return true
  for (const path of scriptPathsIn(line.command, home, isWindows)) {
    try {
      if ((await $.fs.stat(path)).kind === 'file' && printsCrab(await $.fs.read(path))) return true
    } catch {
      // Not a file this process can read: not the script.
    }
  }
  return false
}

/** The user settings.json, parsed; undefined when it exists but is not JSON. */
async function readUserSettings($: EngineInterface): Promise<Record<string, unknown> | undefined> {
  if (!(await $.fs.exists(settingsPath))) return {}
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(settingsPath))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Names the settings sources above the user's that set their own status line. */
async function overridingSources($: EngineInterface): Promise<string[]> {
  const found: string[] = []
  for (const source of ['project', 'local', 'flag', 'policy'] as const) {
    if ((await $.settings.read({ source })).statusLine !== undefined) found.push(source)
  }
  return found
}

/**
 * `/crab setup`: points the status line at Shelldon's script, which runs the
 * previous command first, so nothing the person had is lost. What it replaced
 * is kept beside the script for `/crab setup undo`.
 */
async function setup($: EngineInterface): Promise<string> {
  if (await crabInStatusLine($)) return 'Your crab is already in your status line. 🦀'
  const settings = await readUserSettings($)
  if (settings === undefined) {
    return `${settingsPath} isn't valid JSON, so I left it alone. Fix it and run /crab setup again.`
  }
  const previous = settings.statusLine as StatusLine | undefined
  const overrides = await overridingSources($)
  const overrideNote =
    overrides.length > 0
      ? `\nNote: your ${overrides.join(' and ')} settings set their own status line, which wins over yours here. Remove it there to see the crab.`
      : ''
  if (isShelldonCommand(previous?.command)) {
    return `Shelldon's status line is already in your user settings.${overrideNote}`
  }

  const { statusLine, previousCommand } = wrapStatusLine(previous)
  await installScript($)
  await $.fs.write(`${shelldonDir}/previous-statusline.json`, `${JSON.stringify(previous ?? null)}\n`)
  if (previousCommand !== undefined) {
    await $.fs.write(`${shelldonDir}/previous-command`, `${previousCommand}\n`)
  } else {
    await deleteFiles($, [`${shelldonDir}/previous-command`])
  }
  await $.fs.write(settingsPath, `${JSON.stringify({ ...settings, statusLine }, null, 2)}\n`)

  const kept = previousCommand !== undefined ? ' Your old status line stays on top; the crab goes under it.' : ''
  return `🦀 Done! Your crab is in your status line.${kept}\nUndo any time with /crab setup undo.${overrideNote}`
}

/**
 * `/crab uninstall`: everything an uninstall leaves undone. The engine gives
 * a plugin no word when it is uninstalled, so the frame would stay on the
 * status line; this stops the crab, clears its frame and setup, removes
 * ~/.claude/shelldon (the crabs themselves stay in $.store, for a reinstall),
 * then asks Claude Code to uninstall the plugin.
 */
async function uninstall($: EngineInterface): Promise<string> {
  const path = framePath
  framePath = '' // stops the timer drawing it back
  if (path !== '') await deleteFiles($, [path])
  const undone = (await $.fs.exists(`${shelldonDir}/previous-statusline.json`))
    ? `${await undoSetup($)}\n`
    : ''
  await deleteDir($, shelldonDir)
  // A command cannot run another from its own hook (it would wait on itself),
  // so the uninstall goes from a timer, once this command has answered.
  $.clock.after(UNINSTALL_DELAY_MS, () => {
    void $.command.run({ command: 'plugin', args: 'uninstall shelldon@shelldon' }).catch(() => undefined)
  })
  return [
    `${undone}🦀 Your crab has left the status line. Uninstalling Shelldon...`,
    'If it still shows in /plugin, finish with: /plugin uninstall shelldon@shelldon',
    'Your crabs are kept, so they come back if you reinstall.',
  ].join('\n')
}

/** `/crab setup undo`: puts back the status line setup replaced. */
async function undoSetup($: EngineInterface): Promise<string> {
  const savedPath = `${shelldonDir}/previous-statusline.json`
  if (!(await $.fs.exists(savedPath))) return "Setup hasn't been run, so there's nothing to undo."
  const settings = await readUserSettings($)
  if (settings === undefined) {
    return `${settingsPath} isn't valid JSON, so I left it alone. Fix it and run /crab setup undo again.`
  }
  const current = settings.statusLine as StatusLine | undefined
  const files = [savedPath, `${shelldonDir}/previous-command`, `${shelldonDir}/statusline.sh`]
  if (!isShelldonCommand(current?.command)) {
    await deleteFiles($, files)
    return 'Your status line was changed after setup, so I left it as it is.'
  }

  const previous = JSON.parse(await $.fs.read(savedPath)) as StatusLine | null
  const { statusLine: _, ...rest } = settings
  await $.fs.write(
    settingsPath,
    `${JSON.stringify(previous === null ? rest : { ...rest, statusLine: previous }, null, 2)}\n`,
  )
  await deleteFiles($, files)
  return previous === null
    ? 'Removed the crab from your status line.'
    : 'Put your previous status line back.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    key = `crab:${(await $.session.cwd()).toLowerCase()}`
    const userProfile = await $.env.get('USERPROFILE')
    isWindows = userProfile !== undefined
    home = userProfile ?? (await $.env.get('HOME')) ?? ''
    shelldonDir = `${home}/.claude/shelldon`
    settingsPath = `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`}/settings.json`
    framesDir = `${shelldonDir}/frames`
    framePath = `${framesDir}/${await $.session.id()}.txt`
    await sweepFrames($)
    await load($)
    if (crab === undefined) await save($, hatch(await $.clock.now()))
    await $.command.register({
      name: 'crab',
      description: 'Check on your crab, put it in your status line, hatch a new one, or uninstall',
      argumentHint: '[setup | setup undo | hatch | uninstall]',
      immediate: true,
    })
    await draw($)
    $.clock.every(FRAME_MS, () => void draw($))

    // A plugin update ships a new script: keep the installed copy current.
    if (await $.fs.exists(`${shelldonDir}/statusline.sh`)) await installScript($)
    // Once ever: say how to see the crab, unless the status line shows it.
    if ((await $.store.get('setupHintShown')) !== true && !(await crabInStatusLine($))) {
      $.ui.toast('🦀 Your crab hatched! Run /crab setup to see it in your status line.', {
        timeoutMs: 15_000,
      })
      await $.store.set('setupHintShown', true)
    }

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
    const args = e.args.trim().split(/\s+/).join(' ')
    if (args === 'setup') return { text: await setup($) }
    if (args === 'setup undo') return { text: await undoSetup($) }
    if (args === 'uninstall') return { text: await uninstall($) }
    if (args !== '' && args !== 'hatch') {
      return { text: `Unknown: /crab ${args}\nTry /crab, /crab setup, /crab setup undo, /crab hatch or /crab uninstall.` }
    }

    const now = await $.clock.now()
    await load($)
    if (args === 'hatch') {
      if (crab !== undefined && moodOf(crab, now) !== 'dead') {
        return { text: 'Your crab is still alive. Take care of it!' }
      }
      await save($, hatch(now))
      walk = START_WALK
      await draw($)

      return { text: '🥚 → 🦀 A new crab hatched! Keep working in this repo to feed it.' }
    }

    const hint = (await crabInStatusLine($))
      ? ''
      : '\nRun /crab setup to see it in your status line.'
    return { text: `${report(crab, now)}${hint}` }
  })
}
