# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.0] - 2026-05-15

### Changed

- Rewritten manager prompt to establish pure orchestrator role (never touches files directly)
- Expanded manage skill into full command center with dumb terminal, browser surface, and discovery support

### Added

- Dumb terminal management: spawn, send input, read screen, close
- Browser surface management: open, navigate, snapshot, interact, extract data
- Discovery and adoption of existing cmux surfaces on startup
- Workspace management: status indicators, notifications, progress bars
- Workflow recipes for common multi-surface scenarios (dev env, bug investigation, deploy verification)

## [0.6.2] - 2026-05-12

### Fixed

- `spawn_session` and hub spawn calls used `stdio: 'ignore'`, silently swallowing errors. Both now capture stderr and log non-zero exit codes.
- `spawn_session` polling loop now breaks early when the child process exits with a non-zero code, and returns the stderr/exit code to the caller instead of a generic "not registered yet" message.

## [0.6.1] - 2026-05-12

### Fixed

- `spawn_session` cmux branch used nonexistent `cmux surface create` command. Replaced with `cmux new-workspace --name <name> --cwd <path> --command <cmd>`.
- MCP server version field was stuck at 0.1.0; synced to 0.6.1.

## [0.6.0] - 2026-05-12

### Added

- Sessions now register their `CMUX_SURFACE_ID` and `CMUX_WORKSPACE_ID` with the hub.
- `list_sessions` output shows `[cmux: <id>]` annotation for cmux-spawned workers.
- Manager and skill instructions explain how to use `cmux send` / `cmux send-key` with the surface ID.

## [0.5.0] - 2026-05-11

### Fixed

- Session project directory reporting now uses `process.env.PWD` instead of `process.cwd()` so sessions register with the Claude Code working directory, not the plugin directory set by `bun --cwd`.

## [0.4.0] - 2026-05-11

### Fixed

- Manager shell alias now sets `ARBITER_SESSION_NAME="manager"` explicitly so it doesn't default to the cwd basename and collide with other sessions started from the same directory.

## [0.3.0] - 2026-05-11

_Version bump to force cache refresh. No functional changes._

## [0.2.0] - 2026-05-11

### Added

- `--yolo` flag for `arbiter` and `arbiter-worker` aliases (maps to `--dangerously-skip-permissions`).

### Fixed

- `--append-system-prompt` argument splitting.
- Use `--append-system-prompt` with `$(cat)` instead of nonexistent `--append-system-prompt-file` flag.
- Shell source line no longer errors when the plugin isn't cached yet.

### Changed

- Shell aliases moved to a sourceable file.

## [0.1.0] - 2026-05-11

### Added

- Initial release: multi-session orchestration plugin for Claude Code.
- Start/spawn worker sessions in tmux or cmux.
- Dispatch structured tasks to named workers.
- Relay `AskUserQuestion` prompts from workers to manager.
- Relay permission requests from workers to manager.
- Session auto-registration and heartbeat monitoring.
- Configurable session names (auto-derived or explicit).
- README with install instructions and usage guide.
- Manager system prompt (engineering manager role, delegation-focused).
- Worker system prompt (task execution, status reporting).
- Skill references and tool inventory in system prompts.
- Shell aliases for `.zshrc`/`.bashrc`.
- Logo.

### Fixed

- Hub startup race condition resolved with exclusive lock file (`O_EXCL` file creation for `hub.lock`).

### Changed

- Install instructions simplified to use `/plugin` commands.
