# claudepets

A 🦀 that lives in your Claude Code status line.

```
~≈~~≈~ ~≈≈~ ~~≈~ ≈~~ ~≈~🌊 · · · 🦀 · · · · · · · · 🍤 · · · · · 🍖 81% happy +12.4k
```

- It wanders a beach beside a rolling ocean.
- Every Claude turn feeds it the tokens it spent and drops a 🍤 on the beach; the crab walks over and eats it.
- Food runs out over 3 days. Leave a repo alone for 7 days and its crab starves 🪦.
- One crab per repo, hatched the first time you open Claude Code there.

## Install

```
/plugin install crab-pet --marketplace <owner>/claudepets
```

Answer `y` to add the marketplace, then pick a scope.

## Show it in your status line

The plugin writes each frame, ANSI-colored, to
`~/.claude/crab-pet/frames/<session_id>.txt`. Print it from your status line
command, and have Claude Code re-run that command every second:

```json
"statusLine": {
  "type": "command",
  "command": "sh ~/.claude/statusline-command.sh",
  "refreshInterval": 1
}
```

```sh
input=$(cat)
# ... your own status line ...
session_id=$(printf '%s' "$input" | jq -r --binary '.session_id // empty')
crab_frame="$HOME/.claude/crab-pet/frames/${session_id}.txt"
[ -n "$session_id" ] && [ -s "$crab_frame" ] && cat "$crab_frame" && printf '\n'
```

Keep the command under a second: Claude Code cancels a run still going when
the next refresh fires. On Windows (Git Bash) each extra process costs about
100ms, so do as much as you can in a single `jq` call.

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
