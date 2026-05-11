#!/bin/sh
# Source this file from your .zshrc or .bashrc:
#   source "$(find ~/.claude/plugins/cache/claude-arbiter/arbiter -name arbiter.sh -path '*/shell/*' 2>/dev/null | head -1)"
#
# Or if you have the repo checked out locally:
#   source ~/Development/claude-arbiter/arbiter/shell/arbiter.sh

ARBITER_CHANNEL="plugin:arbiter@claude-arbiter"

_arbiter_find_prompt() {
  find ~/.claude/plugins/cache/claude-arbiter/arbiter -name "$1" -path "*/prompts/*" 2>/dev/null | head -1
}

arbiter() {
  local prompt_file
  prompt_file=$(_arbiter_find_prompt "manager.txt")

  ARBITER_SESSION_ROLE=manager claude \
    --dangerously-load-development-channels "$ARBITER_CHANNEL" \
    ${prompt_file:+--append-system-prompt-file "$prompt_file"} \
    -n "arbiter" \
    "$@"
}

# Usage: arbiter-worker <name> [extra claude flags...]
arbiter-worker() {
  local name="${1:?Usage: arbiter-worker <name> [claude flags...]}"
  shift
  local prompt_file
  prompt_file=$(_arbiter_find_prompt "worker.txt")

  ARBITER_SESSION_NAME="$name" ARBITER_SESSION_ROLE=worker claude \
    --dangerously-load-development-channels "$ARBITER_CHANNEL" \
    ${prompt_file:+--append-system-prompt-file "$prompt_file"} \
    -n "worker:$name" \
    "$@"
}
