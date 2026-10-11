import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { isShelldonCommand, scriptPathsIn, SHELLDON_COMMAND, wrapStatusLine } from './setup'

const HOME = 'C:/home'
const SETTINGS = `${HOME}/.claude/settings.json`
const DIR = `${HOME}/.claude/shelldon`

/**
 * A home folder in memory beneath the plugin: files, settings sources, and
 * deletes through `$.process.run`, so setup runs without touching the disk.
 */
function world(on: On, files: Map<string, string>, sources: Record<string, object> = {}) {
  mock.clock(on)
  mock.store(on, { setupHintShown: true })
  mock.env(on, { USERPROFILE: HOME })
  const slash = (path: string) => path.replace(/\\/g, '/')
  const isDir = (path: string) => [...files.keys()].some(k => k.startsWith(`${path}/`))
  const userSettings = () => {
    try {
      return JSON.parse(files.get(SETTINGS) ?? '{}') as object
    } catch {
      return {} // the engine runs on without a settings file it cannot parse
    }
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/repo' }))
  on('session.id', () => ({ value: 'sid' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', ($, e) => ({ value: files.has(slash(e.path)) || isDir(slash(e.path)) }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', ($, e) => {
    if (!files.has(slash(e.path))) throw new Error(`ENOENT ${slash(e.path)}`)
    return { value: { kind: 'file', size: files.get(slash(e.path))!.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    if (slash(e.path).endsWith('/statusline/shelldon.sh') && !slash(e.path).startsWith(HOME)) {
      return { value: 'SCRIPT\r\n' }
    }
    const text = files.get(slash(e.path))
    if (text === undefined) throw new Error(`ENOENT ${slash(e.path)}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(slash(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    for (const path of e.argv.slice(5)) files.delete(path.replace(/\\/g, '/'))
    const ran = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    return { value: ran }
  })
  on('settings.read', ($, e) => {
    if (e.source === 'user') return { value: userSettings() }
    if (e.source !== undefined) return { value: sources[e.source] ?? {} }
    return { value: Object.assign({}, userSettings(), ...Object.values(sources)) }
  })
}

async function start($: Engine) {
  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true } as never)
}

async function crab($: Engine, args: string) {
  return (await $.command.run({ command: 'crab', args } as never)).text ?? ''
}

const userSettings = (files: Map<string, string>) => JSON.parse(files.get(SETTINGS)!)

test('with no status line, setup adds Shelldon’s, and undo removes it', async ($, on) => {
  const files = new Map([[SETTINGS, JSON.stringify({ theme: 'dark' })]])
  world(on, files)
  await start($)

  expect(await crab($, 'setup')).toContain('Done')
  expect(userSettings(files)).toEqual({
    theme: 'dark',
    statusLine: { type: 'command', command: SHELLDON_COMMAND, refreshInterval: 1 },
  })
  expect(files.get(`${DIR}/statusline.sh`)).toBe('SCRIPT\n')
  expect(files.has(`${DIR}/previous-command`)).toBe(false)
  expect(await crab($, 'setup')).toContain('already')

  expect(await crab($, 'setup undo')).toContain('Removed')
  expect(userSettings(files)).toEqual({ theme: 'dark' })
  expect(files.has(`${DIR}/statusline.sh`)).toBe(false)
  expect(await crab($, 'setup undo')).toContain('nothing to undo')
})

test('setup wraps an existing status line, and undo puts it back exactly', async ($, on) => {
  const mine = { type: 'command', command: 'sh ~/mine.sh', padding: 2 }
  const files = new Map([[SETTINGS, JSON.stringify({ statusLine: mine })]])
  world(on, files)
  await start($)

  expect(await crab($, 'setup')).toContain('old status line stays on top')
  expect(userSettings(files).statusLine).toEqual({
    type: 'command',
    command: SHELLDON_COMMAND,
    refreshInterval: 1,
    padding: 2,
  })
  expect(files.get(`${DIR}/previous-command`)).toBe('sh ~/mine.sh\n')

  expect(await crab($, 'setup undo')).toContain('previous status line back')
  expect(userSettings(files).statusLine).toEqual(mine)
})

test('setup leaves a status line alone when its script already prints the crab', async ($, on) => {
  const files = new Map([
    [SETTINGS, JSON.stringify({ statusLine: { type: 'command', command: 'sh /c/home/line.sh' } })],
    ['C:/home/line.sh', 'cat "$HOME/.claude/shelldon/frames/$id.txt"'],
  ])
  world(on, files)
  await start($)
  const before = files.get(SETTINGS)
  expect(await crab($, 'setup')).toContain('already in your status line')
  expect(files.get(SETTINGS)).toBe(before)
})

test('setup never rewrites a settings file it cannot parse', async ($, on) => {
  const files = new Map([[SETTINGS, '{ "theme": "dark", oops']])
  world(on, files)
  await start($)
  expect(await crab($, 'setup')).toContain("isn't valid JSON")
  expect(files.get(SETTINGS)).toBe('{ "theme": "dark", oops')
})

test('setup says when project settings hide the user status line', async ($, on) => {
  const files = new Map([[SETTINGS, '{}']])
  world(on, files, { project: { statusLine: { type: 'command', command: 'echo project' } } })
  await start($)
  expect(await crab($, 'setup')).toContain('your project settings set their own status line')
})

test('wrapStatusLine keeps a command to run first, and only a real one', () => {
  expect(wrapStatusLine(undefined).previousCommand).toBe(undefined)
  expect(wrapStatusLine({ type: 'command', command: '  ' }).previousCommand).toBe(undefined)
  expect(wrapStatusLine({ type: 'command', command: 'sh x.sh' }).previousCommand).toBe('sh x.sh')
  expect(isShelldonCommand(wrapStatusLine(undefined).statusLine.command)).toBe(true)
})

test('scriptPathsIn finds the script, spelled for this machine', () => {
  expect(scriptPathsIn('sh /c/Users/me/line.sh', 'C:/Users/me', true)).toEqual(['C:/Users/me/line.sh'])
  expect(scriptPathsIn('bash ~/line.sh --x', '/home/me', false)).toEqual(['/home/me/line.sh'])
  expect(scriptPathsIn('"$HOME/s p.sh"', '/home/me', false)).toEqual(['/home/me/s'])
  expect(scriptPathsIn('node script.js', '/home/me', false)).toEqual([])
})
