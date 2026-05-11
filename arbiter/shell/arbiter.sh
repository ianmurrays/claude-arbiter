#!/bin/sh
# Arbiter — multi-session orchestration for Claude Code
#
# Add to your .zshrc or .bashrc:
#   arbiter_sh="$(find ~/.claude/plugins/cache/claude-arbiter/arbiter -name arbiter.sh -path '*/shell/*' 2>/dev/null | head -1)"
#   [ -n "$arbiter_sh" ] && source "$arbiter_sh"

ARBITER_CHANNEL="plugin:arbiter@claude-arbiter"

_arbiter_find_prompt() {
  find ~/.claude/plugins/cache/claude-arbiter/arbiter -name "$1" -path "*/prompts/*" 2>/dev/null | head -1
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
      --dangerously-load-development-channels "$ARBITER_CHANNEL" \
      --append-system-prompt "$prompt_content" \
      -n "arbiter" \
      $ARBITER_YOLO_FLAGS \
      $ARBITER_REMAINING_ARGS
  else
    ARBITER_SESSION_NAME="manager" ARBITER_SESSION_ROLE=manager claude \
      --dangerously-load-development-channels "$ARBITER_CHANNEL" \
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
      --dangerously-load-development-channels "$ARBITER_CHANNEL" \
      --append-system-prompt "$prompt_content" \
      -n "worker:$name" \
      $ARBITER_YOLO_FLAGS \
      $ARBITER_REMAINING_ARGS
  else
    ARBITER_SESSION_NAME="$name" ARBITER_SESSION_ROLE=worker claude \
      --dangerously-load-development-channels "$ARBITER_CHANNEL" \
      -n "worker:$name" \
      $ARBITER_YOLO_FLAGS \
      $ARBITER_REMAINING_ARGS
  fi
}
