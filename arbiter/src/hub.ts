#!/usr/bin/env bun
import { createServer, type Socket } from 'net'
import { writeFileSync, unlinkSync, readFileSync, openSync, closeSync } from 'fs'
import {
  ensureStateDir,
  writeRegistry,
  HUB_SOCKET_PATH,
  HUB_PID_FILE,
  STATE_DIR,
  isProcessAlive,
} from './registry'
import { join } from 'path'
import {
  type MessageEnvelope,
  type SessionInfo,
  type RegisterPayload,
  serialize,
  parseLines,
  makeEnvelope,
} from './protocol'

ensureStateDir()

const LOCK_FILE = join(STATE_DIR, 'hub.lock')
let lockFd: number
try {
  lockFd = openSync(LOCK_FILE, 'wx')
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
    try {
      const stalePid = parseInt(readFileSync(HUB_PID_FILE, 'utf8'), 10)
      if (stalePid > 1 && isProcessAlive(stalePid)) {
        process.stderr.write(`arbiter hub: another hub is running (pid=${stalePid}), exiting\n`)
        process.exit(0)
      }
      unlinkSync(LOCK_FILE)
      lockFd = openSync(LOCK_FILE, 'wx')
    } catch {
      process.stderr.write('arbiter hub: failed to acquire lock, exiting\n')
      process.exit(1)
    }
  } else {
    process.stderr.write(`arbiter hub: lock error: ${err}, exiting\n`)
    process.exit(1)
  }
}

try { unlinkSync(HUB_SOCKET_PATH) } catch {}

writeFileSync(HUB_PID_FILE, String(process.pid))
closeSync(lockFd)

const HUB_STARTED_AT = Date.now()

type ConnectedSession = {
  socket: Socket
  info: SessionInfo
  buffer: string
}

const MANAGER_ROUTED_TYPES = new Set([
  'status_update', 'task_complete', 'question', 'permission_request',
])

const sessions = new Map<string, ConnectedSession>()
let idleTimer: ReturnType<typeof setTimeout> | null = null
const IDLE_TIMEOUT_MS = 60_000

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  if (sessions.size === 0) {
    idleTimer = setTimeout(() => {
      process.stderr.write('arbiter hub: no connections for 60s, shutting down\n')
      shutdown()
    }, IDLE_TIMEOUT_MS)
  } else {
    idleTimer = null
  }
}

function persistRegistry() {
  const data: Record<string, SessionInfo> = {}
  for (const [name, conn] of sessions) {
    data[name] = { ...conn.info }
  }
  writeRegistry({ sessions: data, hubPid: process.pid, hubStartedAt: HUB_STARTED_AT })
}

function routeMessage(msg: MessageEnvelope, senderSocket: Socket) {
  if (msg.to === '*') {
    if (MANAGER_ROUTED_TYPES.has(msg.type)) {
      for (const [name, conn] of sessions) {
        if (name !== msg.from && conn.info.role === 'manager') {
          conn.socket.write(serialize(msg))
        }
      }
    } else {
      for (const [name, conn] of sessions) {
        if (name !== msg.from) {
          conn.socket.write(serialize(msg))
        }
      }
    }
    return
  }

  const target = sessions.get(msg.to)
  if (target) {
    process.stderr.write(`arbiter hub: routing ${msg.type} from "${msg.from}" to "${msg.to}"\n`)
    target.socket.write(serialize(msg))
  } else {
    const err = makeEnvelope('error', 'hub', msg.from, {
      originalId: msg.id,
      message: `session "${msg.to}" not found`,
    })
    senderSocket.write(serialize(err))
  }
}

function handleMessage(msg: MessageEnvelope, socket: Socket) {
  switch (msg.type) {
    case 'register': {
      const payload = msg.payload as unknown as RegisterPayload
      const name = payload.name

      if (sessions.has(name)) {
        const existing = sessions.get(name)!
        if (!isProcessAlive(existing.info.pid)) {
          sessions.delete(name)
          process.stderr.write(`arbiter hub: evicted dead session "${name}" (pid=${existing.info.pid})\n`)
        } else {
          const err = makeEnvelope('error', 'hub', name, {
            message: `name "${name}" is already registered`,
          })
          socket.write(serialize(err))
          return
        }
      }

      const info: SessionInfo = {
        name,
        role: payload.role,
        project: payload.project,
        pid: payload.pid,
        status: 'active',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      }

      sessions.set(name, { socket, info, buffer: '' })
      persistRegistry()
      resetIdleTimer()

      const confirmation = makeEnvelope('registered', 'hub', name, { name })
      socket.write(serialize(confirmation))

      for (const [otherName, conn] of sessions) {
        if (otherName !== name && conn.info.role === 'manager') {
          const notification = makeEnvelope('status_update', name, otherName, {
            status: 'connected',
            message: `Session "${name}" (${payload.role}) connected from ${payload.project}`,
          })
          conn.socket.write(serialize(notification))
        }
      }

      process.stderr.write(`arbiter hub: registered "${name}" (${payload.role}) from ${payload.project}\n`)
      break
    }

    case 'session_list_request': {
      const list: SessionInfo[] = []
      for (const [, conn] of sessions) {
        list.push({ ...conn.info })
      }
      const response = makeEnvelope('session_list', 'hub', msg.from, { sessions: list })
      socket.write(serialize(response))
      break
    }

    case 'ping': {
      const session = findSessionBySocket(socket)
      if (session) {
        session.info.lastSeen = Date.now()
      }
      const pong = makeEnvelope('pong', 'hub', msg.from, {})
      socket.write(serialize(pong))
      break
    }

    default:
      routeMessage(msg, socket)
      break
  }
}

function findSessionBySocket(socket: Socket): ConnectedSession | undefined {
  for (const [, conn] of sessions) {
    if (conn.socket === socket) return conn
  }
  return undefined
}

function removeSession(socket: Socket) {
  for (const [name, conn] of sessions) {
    if (conn.socket === socket) {
      sessions.delete(name)
      persistRegistry()
      resetIdleTimer()
      process.stderr.write(`arbiter hub: session "${name}" disconnected\n`)

      for (const [, other] of sessions) {
        if (other.info.role === 'manager') {
          const notification = makeEnvelope('status_update', name, other.info.name, {
            status: 'disconnected',
            message: `Session "${name}" disconnected`,
          })
          other.socket.write(serialize(notification))
        }
      }
      return
    }
  }
}

const server = createServer(socket => {
  let buffer = ''

  socket.on('data', chunk => {
    buffer += chunk.toString()
    const { messages, remainder } = parseLines(buffer)
    buffer = remainder
    for (const msg of messages) {
      handleMessage(msg, socket)
    }
  })

  socket.on('close', () => removeSession(socket))
  socket.on('error', err => {
    process.stderr.write(`arbiter hub: socket error: ${err.message}\n`)
    removeSession(socket)
  })
})

const livenessInterval = setInterval(() => {
  const deadNames: string[] = []
  for (const [name, conn] of sessions) {
    if (!isProcessAlive(conn.info.pid)) {
      deadNames.push(name)
    }
  }
  for (const name of deadNames) {
    const conn = sessions.get(name)
    if (conn) {
      process.stderr.write(`arbiter hub: session "${name}" pid ${conn.info.pid} is dead, removing\n`)
      conn.socket.destroy()
      removeSession(conn.socket)
    }
  }
}, 30_000)

function shutdown() {
  if (livenessInterval) clearInterval(livenessInterval)
  for (const [, conn] of sessions) {
    conn.socket.destroy()
  }
  server.close()
  try { unlinkSync(HUB_SOCKET_PATH) } catch {}
  try { unlinkSync(HUB_PID_FILE) } catch {}
  try { unlinkSync(LOCK_FILE) } catch {}
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(HUB_SOCKET_PATH, () => {
  process.stderr.write(`arbiter hub: listening on ${HUB_SOCKET_PATH} (pid=${process.pid})\n`)
  resetIdleTimer()
})
