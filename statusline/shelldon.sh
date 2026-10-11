#!/bin/sh
# Shelldon's status line, installed by `/crab setup` (undo: `/crab setup undo`).
#
# Runs the status line command you had before, if any, then prints the crab
# under it. Plain POSIX sh, and fork-free apart from your own command: every
# process costs ~70ms under Git Bash on Windows, and Claude Code cancels a
# run still going when the next 1-second refresh fires.

dir="$HOME/.claude/shelldon"

# The JSON Claude Code sends, read with the shell's own `read` (no `cat`).
input=''
while IFS= read -r line || [ -n "$line" ]; do
  input="$input$line"
done

# Your previous status line, exactly as you had it.
if [ -s "$dir/previous-command" ]; then
  IFS= read -r previous < "$dir/previous-command" || [ -n "$previous" ]
  printf '%s' "$input" | eval "$previous"
fi

# The crab: this session's frame, found by the "session_id" in the input.
case $input in
  *'"session_id"'*)
    rest=${input#*'"session_id"'}
    rest=${rest#*'"'}
    session_id=${rest%%'"'*}
    frame="$dir/frames/${session_id}.txt"
    if [ -n "$session_id" ] && [ -s "$frame" ]; then
      IFS= read -r crab < "$frame" || [ -n "$crab" ]
      printf '%s\n' "$crab"
    fi
    ;;
esac
