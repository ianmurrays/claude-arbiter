<p align="center">
  <img src="logo.png" alt="Claude Arbiter" width="400">
</p>

# Arbiter

Orchestrate multiple Claude Code sessions from a single terminal.

Arbiter lets one **manager** Claude Code session dispatch tasks to and receive responses from multiple **worker** sessions across different projects. Communication flows through a Unix domain socket hub that auto-starts and auto-stops.

## Features

- **Start/spawn workers** in tmux or cmux panes from the manager session
- **Dispatch tasks** to named worker sessions
- **Relay questions** — workers can ask the manager (human) for clarification
- **Relay permissions** — worker tool approvals are forwarded to the manager
- **Auto-discovery** — sessions register automatically on startup
- **Grandfather existing sessions** — any running session with the plugin can join

## Install

In any Claude Code session:

```
/plugin marketplace add ianmurrays/claude-arbiter
/plugin install arbiter@claude-arbiter
```

## Usage

### Start the manager

```bash
ARBITER_SESSION_ROLE=manager claude \
  --dangerously-load-development-channels plugin:arbiter@claude-arbiter \
  --append-system-prompt-file ~/.claude/plugins/cache/claude-arbiter/arbiter/*/prompts/manager.txt \
  -n "arbiter"
```

### Start a worker

```bash
ARBITER_SESSION_NAME=api-service ARBITER_SESSION_ROLE=worker claude \
  --dangerously-load-development-channels plugin:arbiter@claude-arbiter \
  --append-system-prompt-file ~/.claude/plugins/cache/claude-arbiter/arbiter/*/prompts/worker.txt \
  -n "worker:api-service"
```

Or have the manager spawn workers for you — just tell it:
> "Spawn a worker in ~/projects/api-service to fix the auth bug"

### Shell aliases (recommended)

Add one line to your `~/.zshrc` or `~/.bashrc`:

```bash
source "$(find ~/.claude/plugins/cache/claude-arbiter/arbiter -name arbiter.sh -path '*/shell/*' 2>/dev/null | head -1)"
```

This gives you two commands:

```bash
# Terminal 1 — start the manager
arbiter

# Terminal 2 — start a worker
cd ~/projects/api-service
arbiter-worker api-service

# Terminal 3 — start another worker
cd ~/projects/frontend
arbiter-worker frontend
```

## Architecture

```
  Manager Claude Code          Worker A                Worker B
       │                         │                       │
  [MCP server] ──────┐    [MCP server]            [MCP server]
                     │          │                       │
                     ▼          ▼                       ▼
              ┌──────────────────────────────────────────┐
              │           Hub (Unix socket)               │
              │   ~/.claude/channels/arbiter/hub.sock     │
              └──────────────────────────────────────────┘
```

- **Hub**: Auto-starts when the first session connects, auto-stops after 60s with no connections. Routes messages between sessions. Worker messages (questions, permissions, status updates) are routed only to manager sessions.
- **MCP server**: Each Claude Code session gets its own instance. Exposes different tools depending on role (manager vs. worker).
- **State**: `~/.claude/channels/arbiter/` — hub.sock, hub.pid, sessions.json, server.log

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ARBITER_SESSION_ROLE` | `manager` or `worker` | `worker` |
| `ARBITER_SESSION_NAME` | Display name for the session | Project directory basename |
| `ARBITER_STATE_DIR` | Override state directory location | `~/.claude/channels/arbiter/` |

## Skills

- `/arbiter:manage` — Manager-side orchestration (list sessions, dispatch tasks, relay questions)
- `/arbiter:configure` — Configure session identity, check hub status

## Manager tools

| Tool | Description |
|------|-------------|
| `list_sessions` | See all connected sessions |
| `send_task` | Dispatch a task to a worker |
| `spawn_session` | Start a new worker in tmux/cmux |
| `respond_to_worker` | Answer a worker's question |
| `respond_permission` | Allow/deny a worker's tool permission |
| `broadcast` | Message all workers |

## Worker tools

| Tool | Description |
|------|-------------|
| `report_status` | Send progress update to manager |
| `ask_manager` | Ask the human a question (blocks until answered) |
| `task_complete` | Signal task completion |

## License

MIT
