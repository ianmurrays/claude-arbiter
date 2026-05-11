---
name: configure
description: Configure this session's identity in the arbiter. Set name, role, and check hub status. Use when registering this session as a worker (grandfathering) or checking connection status.
user-invocable: true
allowed-tools:
  - mcp__arbiter__set_status
  - mcp__arbiter__list_sessions
---

# Arbiter Configuration

## Check Status
Call `list_sessions` to see this session's registration and all connected sessions.

## Set Identity
This session auto-registers with the hub on startup using:
- **Name**: derived from `ARBITER_SESSION_NAME` env var, or the project directory basename
- **Role**: from `ARBITER_SESSION_ROLE` env var (default: "worker")

To change the name or role, restart Claude Code with the env vars:
```
ARBITER_SESSION_NAME="my-service" ARBITER_SESSION_ROLE="worker" claude --dangerously-load-development-channels plugin:arbiter@claude-arbiter
```

## Grandfathering

If this session was started independently and you want to join an existing arbiter:
1. Make sure the arbiter plugin is installed (`/plugin install arbiter@claude-arbiter`)
2. The session auto-registers with the hub on startup
3. Call `list_sessions` to verify this session appears in the list
4. Tell the manager session your name so they can dispatch tasks to you

## Hub Status

The hub auto-starts when the first session connects. It auto-stops after 60 seconds with no connections. If the hub is not running, this session will attempt to start it automatically.

To check: look at `~/.claude/channels/arbiter/hub.pid` for the hub process PID.
