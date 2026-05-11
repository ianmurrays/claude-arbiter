import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { SessionInfo } from './protocol'

export const STATE_DIR = join(
  process.env.ARBITER_STATE_DIR ?? join(process.env.HOME ?? '', '.claude', 'channels', 'arbiter'),
)

const SESSIONS_FILE = join(STATE_DIR, 'sessions.json')
export const HUB_SOCKET_PATH = join(STATE_DIR, 'hub.sock')
export const HUB_PID_FILE = join(STATE_DIR, 'hub.pid')

export type RegistryData = {
  sessions: Record<string, SessionInfo>
  hubPid?: number
  hubStartedAt?: number
}

export function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
}

export function readRegistry(): RegistryData {
  try {
    const raw = readFileSync(SESSIONS_FILE, 'utf8')
    return JSON.parse(raw) as RegistryData
  } catch {
    return { sessions: {} }
  }
}

export function writeRegistry(data: RegistryData): void {
  ensureStateDir()
  const tmp = SESSIONS_FILE + '.tmp.' + process.pid
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  renameSync(tmp, SESSIONS_FILE)
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
