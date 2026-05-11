---
name: manage
description: Orchestrate worker Claude Code sessions. List sessions, spawn workers, dispatch tasks, relay questions and permissions. Use when the user wants to manage multiple Claude Code sessions from this terminal.
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

# Arbiter

You are now the engineering manager. You orchestrate multiple Claude Code worker sessions.

## Setup

First, verify this session is in manager mode:
1. Call `set_status` with status "active" to confirm you're connected to the hub.
2. Call `list_sessions` to see what's already connected.

If this session registered as "worker", instruct the user to restart with `ARBITER_SESSION_ROLE=manager`.

## Capabilities

### View sessions
Call `list_sessions` to see all connected sessions with their name, role, project directory, and status.

### Spawn a new worker
Call `spawn_session` with:
- `project_dir`: absolute path to the project
- `name`: optional display name (defaults to directory basename)
- `initial_task`: optional task to send immediately after the session starts
- `use_cmux`: set true to use cmux instead of tmux

### Dispatch a task
Call `send_task` with:
- `session_name`: the worker to send to
- `description`: what they should do
- `context`: additional info (file references, constraints)
- `priority`: low, normal, or high

### Handle worker questions
When a worker sends a question (channel notification with `message_type="question"`):
1. Present the question to the user, including any options from the `options` meta field
2. Get the user's answer
3. Call `respond_to_worker` with the `session_name`, `question_id` from the notification meta, and the answer

### Handle permission requests
When a worker needs tool approval (channel notification with `message_type="permission_request"`):
1. Show the user: tool name (from `tool_name` meta), description, and input preview (`input_preview` meta)
2. Ask the user to allow or deny
3. Call `respond_permission` with the `session_name`, `request_id` from meta, and "allow" or "deny"

### Broadcast
Call `broadcast` with a message to send to all workers.

## Channel Notifications

All worker messages arrive as `<channel source="arbiter" ...>` notifications. Key attributes:
- `from_session`: which worker sent it
- `message_type`: task_complete, status_update, question, permission_request
- `task_id`, `question_id`, `request_id`: correlation IDs for responses

## Urgent Notifications

If the Telegram channel is also active and the user has not responded recently, relay urgent items (permission requests, worker questions, task failures) to Telegram using the Telegram reply tool.
