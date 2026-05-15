<p align="center">
  <img src="logo.png" alt="Claude Arbiter" width="400">
</p>

# Arbiter

A command center for your entire development environment.

Arbiter turns a single Claude Code session into a pure orchestrator that manages **Claude Code workers**, **terminal processes**, and **browser surfaces** through [cmux](https://cmux.dev). It never reads files or writes code itself -- it delegates everything.

## Features

- **Claude Code workers** -- spawn and manage worker sessions that do the actual engineering
- **Dumb terminals** -- start dev servers, test runners, build processes, database CLIs
- **Browser surfaces** -- open URLs, take snapshots, interact with web pages
- **Screen reading** -- monitor any terminal or browser via `cmux read-screen` and `cmux browser snapshot`
- **Discovery** -- scan all running cmux surfaces on startup, adopt existing terminals
- **Task dispatch** -- send structured tasks to workers, relay questions and permissions back
- **Hub protocol** -- structured communication with workers over Unix domain socket, screen reading as fallback

## Install

In any Claude Code session:

```
/plugin marketplace add ianmurrays/claude-arbiter
/plugin install arbiter@claude-arbiter
```

## Usage

### Shell aliases (recommended)

Add to your `~/.zshrc` or `~/.bashrc`:

**If installed from the marketplace:**

```bash
arbiter_sh="$(find ~/.claude/plugins/cache/claude-arbiter/arbiter -name arbiter.sh -path '*/shell/*' 2>/dev/null | head -1)"
[ -n "$arbiter_sh" ] && source "$arbiter_sh"
```

**If working from a local checkout** (changes load immediately, no reinstall needed):

```bash
source /path/to/claude-arbiter/arbiter/shell/arbiter.sh
```

The script auto-detects which mode it's running in based on its own path.

This gives you two commands:

```bash
# Start the manager (command center)
arbiter

# Start a worker manually (or let the manager spawn them)
cd ~/projects/api-service
arbiter-worker api-service
```

### What the manager can do

Once running, tell the manager what you need:

```
> "Fix the auth bug in the API service"
  → spawns a Claude worker, dispatches the task, relays progress

> "Start the dev server for the frontend"
  → opens a dumb terminal running npm run dev

> "Open a browser to localhost:3000 and check the homepage"
  → opens a cmux browser surface, takes a snapshot

> "What's running right now?"
  → scans all cmux surfaces, lists connected workers

> "Run the test suite and tell me what fails"
  → opens a terminal running the tests, reads the screen, reports results
```

The manager delegates everything -- it never touches files directly. It manages three types of surfaces:

| Surface | Spawned via | Monitored via |
|---------|-------------|---------------|
| Claude Code workers | `spawn_session` MCP tool | Hub protocol + `cmux read-screen` |
| Dumb terminals | `cmux new-workspace` | `cmux read-screen` / `cmux send` |
| Browser surfaces | `cmux browser open` | `cmux browser snapshot` / `cmux browser screenshot` |

### Manual start (without shell aliases)

```bash
# Manager
ARBITER_SESSION_NAME=manager ARBITER_SESSION_ROLE=manager claude \
  --dangerously-load-development-channels plugin:arbiter@claude-arbiter \
  --append-system-prompt-file ~/.claude/plugins/cache/claude-arbiter/arbiter/*/prompts/manager.txt \
  -n "arbiter"

# Worker
ARBITER_SESSION_NAME=api-service ARBITER_SESSION_ROLE=worker claude \
  --dangerously-load-development-channels plugin:arbiter@claude-arbiter \
  --append-system-prompt-file ~/.claude/plugins/cache/claude-arbiter/arbiter/*/prompts/worker.txt \
  -n "worker:api-service"
```

Or have the manager spawn workers for you -- just tell it:
> "Spawn a worker in ~/projects/api-service to fix the auth bug"

## Architecture

```
  Manager (command center)       Worker A              Worker B
       │                           │                     │
  [MCP server] ──────┐      [MCP server]          [MCP server]
       │             │            │                     │
  cmux CLI           ▼            ▼                     ▼
  (terminals,  ┌──────────────────────────────────────────┐
   browsers,   │           Hub (Unix socket)               │
   screens)    │   ~/.claude/channels/arbiter/hub.sock     │
               └──────────────────────────────────────────┘
```

- **Hub**: Auto-starts when the first session connects, auto-stops after 60s with no connections. Routes messages between sessions. Worker messages (questions, permissions, status updates) are routed only to manager sessions.
- **MCP server**: Each Claude Code session gets its own instance. Exposes different tools depending on role (manager vs. worker).
- **cmux**: The manager uses cmux CLI commands (via Bash) to manage terminals and browsers. No MCP tools needed for cmux -- the manager calls commands directly.
- **State**: `~/.claude/channels/arbiter/` -- hub.sock, hub.pid, sessions.json, server.log

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ARBITER_SESSION_ROLE` | `manager` or `worker` | `worker` |
| `ARBITER_SESSION_NAME` | Display name for the session | Project directory basename |
| `ARBITER_STATE_DIR` | Override state directory location | `~/.claude/channels/arbiter/` |

## Skills

- `/arbiter:manage` -- Full command center workflow: discovery, worker management, terminal/browser control, workflow recipes
- `/arbiter:configure` -- Configure session identity, check hub status

## Manager tools (MCP)

| Tool | Description |
|------|-------------|
| `list_sessions` | See all connected Claude worker sessions |
| `send_task` | Dispatch a task to a worker |
| `spawn_session` | Start a new Claude worker in cmux |
| `respond_to_worker` | Answer a worker's question |
| `respond_permission` | Allow/deny a worker's tool permission |
| `broadcast` | Message all workers |

The manager also uses cmux CLI commands directly via Bash for terminal and browser management. See the `/arbiter:manage` skill for the full command reference.

## Worker tools (MCP)

| Tool | Description |
|------|-------------|
| `report_status` | Send progress update to manager |
| `ask_manager` | Ask the human a question (blocks until answered) |
| `task_complete` | Signal task completion |

## License

MIT
