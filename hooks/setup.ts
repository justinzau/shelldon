// Pure helpers for `/crab setup`: no `$`, so they are easy to test.

/** A settings.json `statusLine`, as far as setup cares. */
export type StatusLine = {
  type?: string
  command?: string
  refreshInterval?: number
  [field: string]: unknown
}

/** The command setup points the status line at. `~` is the shell's to expand. */
export const SHELLDON_COMMAND = 'sh ~/.claude/shelldon/statusline.sh'
/** Text that marks a status line script as one that prints the crab. */
const FRAMES_MARK = 'shelldon/frames'

export function isShelldonCommand(command: string | undefined): boolean {
  return command !== undefined && command.includes('shelldon/statusline.sh')
}

export function printsCrab(scriptText: string): boolean {
  return scriptText.includes(FRAMES_MARK)
}

/**
 * Paths in a status line command that may be the script it runs, spelled so
 * this process can open them: `~` and `$HOME` expanded, and on Windows Git
 * Bash's `/c/...` turned into `C:/...`.
 */
export function scriptPathsIn(command: string, home: string, isWindows: boolean): string[] {
  return command
    .split(/\s+/)
    .map(token => token.replace(/^["']|["']$/g, ''))
    .filter(token => token.includes('/') || token.includes('\\'))
    .map(token => token.replace(/^(~|\$HOME|\$\{HOME\})(?=[/\\])/, home))
    .map(token => (isWindows ? token.replace(/^\/([a-z])\//i, (_, d: string) => `${d.toUpperCase()}:/`) : token))
}

/**
 * The status line setup installs, wrapping `previous`: Shelldon's command,
 * re-run every second, keeping the previous line's other fields (padding).
 * `previousCommand` is what the new script runs first, if anything.
 */
export function wrapStatusLine(previous: StatusLine | undefined): {
  statusLine: StatusLine
  previousCommand: string | undefined
} {
  const { type, command, refreshInterval, ...rest } = previous ?? {}
  return {
    statusLine: { ...rest, type: 'command', command: SHELLDON_COMMAND, refreshInterval: 1 },
    previousCommand: type === 'command' && command !== undefined && command.trim() !== '' ? command : undefined,
  }
}
