#!/bin/sh
# Arbiter — multi-session orchestration for Claude Code
#
# Add to your .zshrc or .bashrc:
#   [ -f ~/.arbiter.sh ] && source ~/.arbiter.sh
#
# Or source directly from the plugin cache:
#   arbiter_sh="$(find ~/.claude/plugins/cache/claude-arbiter/arbiter -name arbiter.sh -path '*/shell/*' 2>/dev/null | head -1)"
#   [ -n "$arbiter_sh" ] && source "$arbiter_sh"

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
