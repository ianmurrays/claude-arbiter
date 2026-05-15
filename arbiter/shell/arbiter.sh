#!/bin/sh
# Arbiter — multi-session orchestration for Claude Code
#
# Sourcing from an installed plugin (default):
#   arbiter_sh="$(find ~/.claude/plugins/cache/claude-arbiter/arbiter -name arbiter.sh -path '*/shell/*' 2>/dev/null | head -1)"
#   [ -n "$arbiter_sh" ] && source "$arbiter_sh"
#
# Sourcing from a local dev checkout (loads plugin from disk, no cache):
#   source /path/to/claude-arbiter/arbiter/shell/arbiter.sh

ARBITER_CHANNEL="plugin:arbiter@claude-arbiter"

# Derive paths from this script's location
_arbiter_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ARBITER_PLUGIN_DIR="$_arbiter_script_dir/.."
ARBITER_PLUGIN_ROOT="$(cd "$_arbiter_script_dir/../.." && pwd)"

# Detect dev mode: if we're NOT inside the plugin cache, use --plugin-dir
if echo "$_arbiter_script_dir" | grep -q '/.claude/plugins/cache/'; then
  ARBITER_LOAD_FLAG="--dangerously-load-development-channels"
  ARBITER_LOAD_ARG="$ARBITER_CHANNEL"
else
  ARBITER_LOAD_FLAG="--plugin-dir"
  ARBITER_LOAD_ARG="$ARBITER_PLUGIN_ROOT"
fi

_arbiter_find_prompt() {
  local f="$ARBITER_PLUGIN_DIR/prompts/$1"
  [ -f "$f" ] && echo "$f"
}

_arbiter_extract_yolo() {
  ARBITER_YOLO_FLAGS=""
  ARBITER_REMAINING_ARGS=""
  for arg in "$@"; do
    case "$arg" in
      --yolo) ARBITER_YOLO_FLAGS="--dangerously-skip-permissions" ;;
      *)      ARBITER_REMAINING_ARGS="$ARBITER_REMAINING_ARGS $arg" ;;
    esac
  done
}

arbiter() {
  _arbiter_extract_yolo "$@"
  local prompt_file prompt_content
  prompt_file=$(_arbiter_find_prompt "manager.txt")
  [ -n "$prompt_file" ] && prompt_content="$(cat "$prompt_file")"

  if [ -n "$prompt_content" ]; then
    ARBITER_SESSION_NAME="manager" ARBITER_SESSION_ROLE=manager claude \
      $ARBITER_LOAD_FLAG "$ARBITER_LOAD_ARG" \
      --append-system-prompt "$prompt_content" \
      -n "arbiter" \
      $ARBITER_YOLO_FLAGS \
      $ARBITER_REMAINING_ARGS
  else
    ARBITER_SESSION_NAME="manager" ARBITER_SESSION_ROLE=manager claude \
      $ARBITER_LOAD_FLAG "$ARBITER_LOAD_ARG" \
      -n "arbiter" \
      $ARBITER_YOLO_FLAGS \
      $ARBITER_REMAINING_ARGS
  fi
}

# Usage: arbiter-worker <name> [--yolo] [extra claude flags...]
arbiter-worker() {
  local name="${1:?Usage: arbiter-worker <name> [--yolo] [claude flags...]}"
  shift
  _arbiter_extract_yolo "$@"
  local prompt_file prompt_content
  prompt_file=$(_arbiter_find_prompt "worker.txt")
  [ -n "$prompt_file" ] && prompt_content="$(cat "$prompt_file")"

  if [ -n "$prompt_content" ]; then
    ARBITER_SESSION_NAME="$name" ARBITER_SESSION_ROLE=worker claude \
      $ARBITER_LOAD_FLAG "$ARBITER_LOAD_ARG" \
      --append-system-prompt "$prompt_content" \
      -n "worker:$name" \
      $ARBITER_YOLO_FLAGS \
      $ARBITER_REMAINING_ARGS
  else
    ARBITER_SESSION_NAME="$name" ARBITER_SESSION_ROLE=worker claude \
      $ARBITER_LOAD_FLAG "$ARBITER_LOAD_ARG" \
      -n "worker:$name" \
      $ARBITER_YOLO_FLAGS \
      $ARBITER_REMAINING_ARGS
  fi
}
