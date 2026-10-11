# shelldon

A 🦀 that lives in your Claude Code status line.

```
~≈~~≈~ ~≈≈~ ~~≈~ ≈~~ ~≈~🌊 · · · 🦀 · · · · · · · · 🍤 · · · · · 🍖 81% happy +12.4k
```

- It wanders a beach beside a rolling ocean.
- Every Claude turn feeds it the tokens it spent and drops a 🍤 on the beach; the crab walks up beside it and eats it.
- Food runs out over 3 days. Leave a repo alone for 7 days and its crab starves 🪦.
- One crab per repo, hatched the first time you open Claude Code there.

## Install

```
/plugin install shelldon --marketplace justinzau/shelldon
```

Answer `y` to add the marketplace, then pick a scope.

## Show it in your status line

The plugin writes each frame, ANSI-colored, to
`~/.claude/shelldon/frames/<session_id>.txt`. Print it from your status line
command, and have Claude Code re-run that command every second:

```json
"statusLine": {
  "type": "command",
  "command": "sh ~/.claude/statusline-command.sh",
  "refreshInterval": 1
}
```

Add this to the end of your status line script. It starts no processes: the
session id is cut out with parameter expansion, and the frame is read with
the shell's own `read` (no `jq`, no `cat`).

```sh
# input holds the JSON Claude Code sent on stdin, e.g. read with:
#   IFS= read -r -d '' input        (bash; fork-free, unlike input=$(cat))
case $input in
  *'"session_id"'*)
    rest=${input#*'"session_id"'}; rest=${rest#*'"'}; session_id=${rest%%'"'*}
    crab_frame="$HOME/.claude/shelldon/frames/${session_id}.txt"
    if [ -n "$session_id" ] && [ -s "$crab_frame" ]; then
      IFS= read -r crab < "$crab_frame" || [ -n "$crab" ]
      printf '%s\n' "$crab"
    fi ;;
esac
```

## Performance

- **No tokens.** The plugin never calls the model; it reads the token counts
  Claude Code already reports at the end of each turn.
- **No background processes.** One timer inside Claude Code ticks once a
  second, and writes the frame file only when the scene changed.
- **It dozes.** After 10 minutes without a turn the scene stops moving and
  redraws once a minute. The next turn wakes it.
- **The status line command is the real cost**, since `refreshInterval: 1`
  runs it every second. Keep it fast: every process it starts (a pipe,
  `$(...)`, `cat`, each `jq`) costs about 1ms on macOS and Linux but about
  70ms under Git Bash on Windows. Do your own fields in one `jq` call, feed
  it with a here-string (`jq ... <<< "$input"`) rather than a pipe, and use
  the snippet above for the crab. Claude Code cancels a run still going when
  the next refresh fires, so a slow script shows no crab at all.
- Want it lighter still? `refreshInterval: 2` halves the cost; the crab
  moves in two-second hops.

## Commands

- `/crab` shows its mood, age and how long until it starves.
- `/crab hatch` hatches a new crab once the old one has died.

## Develop

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

Tune the crab in `hooks/crab.ts` (food, decay, speeds, colors) and `hooks/register.ts` (frame rate).
