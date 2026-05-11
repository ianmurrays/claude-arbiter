# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
