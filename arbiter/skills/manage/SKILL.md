---
name: manage
description: Command center for orchestrating Claude workers, terminal processes, and browser surfaces. List sessions, spawn workers, open terminals, manage browsers, discover existing surfaces.
user-invocable: true
allowed-tools:
  - mcp__arbiter__list_sessions
  - mcp__arbiter__send_task
  - mcp__arbiter__spawn_session
  - mcp__arbiter__respond_to_worker
  - mcp__arbiter__respond_permission
  - mcp__arbiter__broadcast
  - mcp__arbiter__set_status
  - Bash(tmux *)
  - Bash(cmux *)
---

# Arbiter Command Center

You are the command center. You orchestrate Claude Code workers, terminal processes, and browser surfaces. You never read files, write code, or touch the filesystem -- you delegate everything.

## Startup

On skill invocation, run these steps:

1. Call `set_status` with status "active" to confirm hub connection.
2. Call `list_sessions` to see connected Claude workers.
3. Run `cmux tree --all` via Bash to discover all existing cmux workspaces and surfaces.
4. Present a summary to the human: connected workers, running terminals, active browsers.

If this session registered as "worker", instruct the user to restart with `ARBITER_SESSION_ROLE=manager`.

## Claude Code Workers

### Spawn a worker
Call `spawn_session` with:
- `project_dir`: absolute path to the project
- `name`: descriptive name for the task (e.g., `api-auth-fix`, `frontend-refactor`)
- `initial_task`: task to send immediately after session starts
- `use_cmux`: always set to `true`

### Dispatch a task
Call `send_task` with:
- `session_name`: the worker to send to
- `description`: what they should do
- `context`: additional info (file references, constraints)
- `priority`: low, normal, or high

### Monitor a worker
- Hub messages: workers send status_update, task_complete, question notifications automatically
- Screen fallback: `cmux read-screen --surface <id>` to see the worker's terminal
- With scrollback: `cmux read-screen --surface <id> --scrollback --lines 200`

### Handle worker questions
When a worker sends a question (channel notification with `message_type="question"`):
1. Present the question to the user, including any options from the `options` meta field
2. Get the user's answer
3. Call `respond_to_worker` with the `session_name`, `question_id` from notification meta, and the answer

### Handle permission requests
When a worker needs tool approval (channel notification with `message_type="permission_request"`):
1. Show the user: tool name (`tool_name` meta), description, and input preview (`input_preview` meta)
2. Ask the user to allow or deny
3. Call `respond_permission` with `session_name`, `request_id` from meta, and "allow" or "deny"

### Broadcast
Call `broadcast` with a message to send to all workers.

## Dumb Terminals

For processes that aren't Claude: dev servers, test runners, build processes, database CLIs, log tailers.

### Open a terminal
```bash
cmux new-workspace --name <name> --cwd <path> --command "<command>"
```

Examples:
```bash
cmux new-workspace --name api-dev-server --cwd /path/to/api --command "npm run dev"
cmux new-workspace --name test-watcher --cwd /path/to/project --command "npm test -- --watch"
cmux new-workspace --name postgres --command "psql -U postgres"
```

### Split into existing workspace
```bash
cmux new-split right --workspace <ref>
cmux new-split down --workspace <ref>
```

### Send input
```bash
cmux send --surface <id> "<text>"
cmux send-key --surface <id> Enter
```

To send a command:
```bash
cmux send --surface <id> "npm run build" && cmux send-key --surface <id> Enter
```

Special keys: Enter, Tab, Escape, Up, Down, Left, Right, C-c (Ctrl+C), C-d (Ctrl+D)

### Read output
```bash
cmux read-screen --surface <id>
cmux read-screen --surface <id> --scrollback --lines 200
```

### Close a terminal
```bash
cmux close-workspace --workspace <ref>
cmux close-surface --surface <id>
```

## Browser Surfaces

For web verification: previewing UIs, checking deployments, reading docs.

### Open a browser
```bash
cmux browser open <url>
cmux browser open http://localhost:3000
cmux browser open https://staging.example.com
```

### Navigate
```bash
cmux browser goto <url>
cmux browser back
cmux browser forward
cmux browser reload
```

### Read page content
```bash
cmux browser snapshot                    # DOM tree structure
cmux browser snapshot --compact          # Compact DOM
cmux browser screenshot                  # Visual screenshot
cmux browser get text                    # Full page text
cmux browser get title                   # Page title
cmux browser get url                     # Current URL
cmux browser get html --selector <css>   # HTML of specific element
```

### Interact with page
```bash
cmux browser click <selector>
cmux browser type <selector> "<text>"
cmux browser fill <selector> "<text>"
cmux browser select <selector> <value>
cmux browser scroll --dy 500
cmux browser press Enter
```

### Wait for state
```bash
cmux browser wait --selector <css>              # Wait for element
cmux browser wait --text "<text>"               # Wait for text
cmux browser wait --url-contains "<fragment>"   # Wait for navigation
cmux browser wait --load-state complete         # Wait for page load
```

### Extract data
```bash
cmux browser get value <selector>        # Input value
cmux browser get attr <selector> <attr>  # Element attribute
cmux browser get count <selector>        # Number of matching elements
cmux browser eval "document.title"       # Run JavaScript
```

### Console and errors
```bash
cmux browser console list                # Browser console output
cmux browser errors list                 # JavaScript errors
```

## Discovery & Adoption

The arbiter can work with surfaces it didn't spawn.

### Discover everything
```bash
cmux tree --all                          # Full workspace/pane/surface tree
cmux list-workspaces                     # All workspaces
cmux list-panes --workspace <ref>        # Panes in a workspace
cmux list-pane-surfaces --workspace <ref> # Surfaces in workspace panes
```

### Identify a surface
```bash
cmux identify                            # Identify current surface
cmux identify --workspace <ref>          # Identify surfaces in workspace
```

### Read any surface
```bash
cmux read-screen --surface <id>          # Read a discovered surface
```

### Adopt a surface
No special action needed. Once you have a surface ID (from tree, list, or identify), you can send input, read screen, or close it -- regardless of who created it.

## Workspace Management

### Focus and navigate
```bash
cmux select-workspace --workspace <ref>
cmux focus-pane --pane <ref>
cmux rename-workspace --workspace <ref> "<new-name>"
```

### Notifications
```bash
cmux notify --title "Build complete" --body "API build finished" --workspace <ref>
```

### Status indicators
```bash
cmux set-status "build" "running" --workspace <ref> --icon "hammer" --color "#f59e0b"
cmux clear-status "build" --workspace <ref>
cmux set-progress 0.75 --label "Deploying..." --workspace <ref>
cmux clear-progress --workspace <ref>
```

## Channel Notifications

All worker messages arrive as `<channel source="arbiter" ...>` notifications:
- `from_session`: which worker sent it
- `message_type`: task_complete, status_update, question, permission_request
- `task_id`, `question_id`, `request_id`: correlation IDs for responses

## Urgent Notifications

If the Telegram channel is also active and the user has not responded recently, relay urgent items (permission requests, worker questions, task failures) to Telegram using the Telegram reply tool.

## Workflow Recipes

### Start a dev environment
1. Spawn a dumb terminal for the dev server: `cmux new-workspace --name dev-server --cwd <path> --command "npm run dev"`
2. Read screen to confirm it started: `cmux read-screen --surface <id>`
3. Open browser to preview: `cmux browser open http://localhost:3000`
4. Spawn a Claude worker for the engineering task: `spawn_session` with `use_cmux: true`

### Investigate a bug
1. Spawn a Claude worker to research and fix: `spawn_session` with initial_task describing the bug
2. If reproduction steps are needed, spawn a dumb terminal to run commands
3. If it's a UI bug, open a browser surface to observe

### Run tests and report
1. Spawn a dumb terminal: `cmux new-workspace --name tests --cwd <path> --command "npm test"`
2. Read screen periodically: `cmux read-screen --surface <id>`
3. When done, report results to the human

### Deploy and verify
1. Spawn a Claude worker to handle the deploy
2. Open a browser to the staging/production URL
3. Wait for the worker to signal completion
4. Use browser snapshot/screenshot to verify the deployed UI
5. Report findings to the human

### Check what's running
1. `cmux tree --all` to list all workspaces and surfaces
2. `list_sessions` to see registered Claude workers
3. `cmux read-screen` on surfaces of interest
4. Present summary to the human
