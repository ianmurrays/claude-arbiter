#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { connect, type Socket } from 'net'
import { spawn } from 'child_process'
import { readFileSync, existsSync, appendFileSync } from 'fs'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import {
  ensureStateDir,
  HUB_SOCKET_PATH,
  HUB_PID_FILE,
  isProcessAlive,
} from './src/registry'
import {
  type MessageEnvelope,
  type SessionInfo,
  type RegisterPayload,
  type TaskPayload,
  type QuestionPayload,
  type AnswerPayload,
  type PermissionRequestPayload,
  type PermissionResponsePayload,
  type StatusUpdatePayload,
  type TaskCompletePayload,
  makeEnvelope,
  serialize,
  parseLines,
} from './src/protocol'

function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''")
}

import { STATE_DIR } from './src/registry'
const LOG_FILE = join(STATE_DIR, 'server.log')
function log(msg: string) {
  const line = `[${new Date().toISOString()}] [${process.pid}] ${msg}\n`
  process.stderr.write(`arbiter: ${msg}\n`)
  try { appendFileSync(LOG_FILE, line) } catch {}
}

const SESSION_NAME = process.env.ARBITER_SESSION_NAME
  || basename(process.cwd())
const SESSION_ROLE = (process.env.ARBITER_SESSION_ROLE ?? 'worker') as 'manager' | 'worker'

const isManager = SESSION_ROLE === 'manager'

const pendingQuestions = new Map<string, { resolve: (answer: string) => void; reject: (err: Error) => void }>()
const pendingListRequests = new Map<string, { resolve: (sessions: SessionInfo[]) => void; reject: (err: Error) => void }>()

let hubSocket: Socket | null = null
let hubBuffer = ''
let registered = false
let reconnecting = false
let reconnectAttempt = 0
let reconnectScheduled = false
let heartbeatInterval: ReturnType<typeof setInterval> | null = null

const managerInstructions = `You are a session manager orchestrating multiple Claude Code sessions.

Messages from worker sessions arrive as <channel source="arbiter" from_session="..." message_type="...">.

Message types:
- task_complete: Worker finished a task. The content has the summary.
- status_update: Worker reporting progress or state change.
- question: Worker needs input. Use respond_to_worker with the question_id from the meta.
- permission_request: Worker needs tool approval. Use respond_permission with the request_id from the meta.

Tools:
- list_sessions: See all connected sessions and their status.
- send_task: Dispatch a task to a worker by name.
- spawn_session: Start a new Claude Code worker in a tmux pane.
- respond_to_worker: Answer a worker's question.
- respond_permission: Allow or deny a worker's tool permission request.
- broadcast: Send a message to all workers.
- set_status: Update your own status or current task description.

When workers are spawned via cmux, list_sessions shows their surface ID as [cmux: <id>].
To send input to a worker terminal: cmux send --surface <id> "<text>" && cmux send-key --surface <id> Enter`

const workerInstructions = `You are a worker session connected to a session manager.

Tasks arrive as <channel source="arbiter" from_session="..." message_type="task">.
Answers to your questions arrive as <channel source="arbiter" message_type="answer">.

Tools:
- report_status: Send a progress update to the manager.
- ask_manager: Ask the manager (human) a question. Returns the answer.
- task_complete: Signal that you finished a task with a summary.
- set_status: Update your own status or current task description.`

const mcp = new Server(
  { name: 'arbiter', version: '0.7.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions: isManager ? managerInstructions : workerInstructions,
  },
)

mcp.setNotificationHandler(
  z.object({
    method: z.literal('notifications/claude/channel/permission_request'),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  }),
  async ({ params }) => {
    if (isManager) return

    const payload: PermissionRequestPayload = {
      requestId: params.request_id,
      toolName: params.tool_name,
      description: params.description,
      inputPreview: params.input_preview,
    }
    sendToHub('permission_request', '*', payload as unknown as Record<string, unknown>)
  },
)

function sendToHub(type: MessageEnvelope['type'], to: string, payload: Record<string, unknown>) {
  if (!hubSocket || !registered) {
    log(`not connected to hub, cannot send ${type}`)
    return false
  }
  const msg = makeEnvelope(type, SESSION_NAME, to, payload)
  hubSocket.write(serialize(msg))
  return true
}

function rejectAllPending(reason: string) {
  const err = new Error(reason)
  for (const [id, pending] of pendingQuestions) {
    pending.reject(err)
    pendingQuestions.delete(id)
  }
  for (const [id, pending] of pendingListRequests) {
    pending.reject(err)
    pendingListRequests.delete(id)
  }
}

function onHubMessage(msg: MessageEnvelope) {
  switch (msg.type) {
    case 'registered':
      registered = true
      reconnectAttempt = 0
      log(`registered as "${SESSION_NAME}" (${SESSION_ROLE})`)
      break

    case 'error':
      log(`hub error: ${msg.payload.message}`)
      break

    case 'pong':
      break

    case 'answer': {
      const payload = msg.payload as unknown as AnswerPayload
      const pending = pendingQuestions.get(payload.questionId)
      if (pending) {
        pending.resolve(payload.answer)
        pendingQuestions.delete(payload.questionId)
      }
      deliverAsChannel(msg)
      break
    }

    case 'permission_response': {
      const payload = msg.payload as unknown as PermissionResponsePayload
      void mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: payload.requestId,
          behavior: payload.behavior,
        },
      })
      break
    }

    case 'session_list': {
      const sessions = msg.payload.sessions as SessionInfo[]
      for (const [id, pending] of pendingListRequests) {
        pending.resolve(sessions)
        pendingListRequests.delete(id)
      }
      break
    }

    default:
      log(`delivering ${msg.type} from "${msg.from}" as channel notification`)
      deliverAsChannel(msg)
      break
  }
}

function deliverAsChannel(msg: MessageEnvelope) {
  const contentParts: string[] = []

  if (msg.payload.description) contentParts.push(String(msg.payload.description))
  else if (msg.payload.summary) contentParts.push(String(msg.payload.summary))
  else if (msg.payload.message) contentParts.push(String(msg.payload.message))
  else if (msg.payload.question) contentParts.push(String(msg.payload.question))
  else if (msg.payload.answer) contentParts.push(String(msg.payload.answer))
  else contentParts.push(JSON.stringify(msg.payload))

  if (msg.payload.context) contentParts.push(`\nContext: ${msg.payload.context}`)

  const meta: Record<string, string> = {
    from_session: msg.from,
    message_type: msg.type,
  }

  if (msg.payload.taskId) meta.task_id = String(msg.payload.taskId)
  if (msg.payload.questionId) meta.question_id = String(msg.payload.questionId)
  if (msg.payload.requestId) meta.request_id = String(msg.payload.requestId)
  if (msg.payload.toolName) meta.tool_name = String(msg.payload.toolName)
  if (msg.payload.inputPreview) meta.input_preview = String(msg.payload.inputPreview)
  if (msg.payload.status) meta.status = String(msg.payload.status)
  if (msg.payload.priority) meta.priority = String(msg.payload.priority)
  if (msg.payload.options) meta.options = JSON.stringify(msg.payload.options)
  if (msg.payload.multiSelect != null) meta.multi_select = String(msg.payload.multiSelect)

  mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: contentParts.join('\n'),
      meta,
    },
  }).catch(err => {
    log(`failed to deliver channel notification: ${err}`)
  })
}

function ensureHub(): boolean {
  ensureStateDir()
  log(`ensureHub: checking ${HUB_PID_FILE}, socket at ${HUB_SOCKET_PATH}`)

  try {
    const pid = parseInt(readFileSync(HUB_PID_FILE, 'utf8'), 10)
    log(`ensureHub: hub.pid=${pid}, alive=${isProcessAlive(pid)}`)
    if (pid > 1 && isProcessAlive(pid)) return true
  } catch (e) {
    log(`ensureHub: no hub.pid or read error: ${e}`)
  }

  log('starting hub...')
  const hubPath = join(import.meta.dir, 'src', 'hub.ts')
  const child = spawn('bun', ['run', hubPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
    cwd: import.meta.dir,
  })
  child.stderr!.on('data', (chunk: Buffer) => {
    log(`hub stderr: ${chunk.toString().trim()}`)
  })
  child.on('exit', (code) => {
    if (code !== 0) log(`hub process exited with code ${code}`)
  })
  child.unref()

  for (let i = 0; i < 20; i++) {
    Bun.sleepSync(100)
    if (existsSync(HUB_SOCKET_PATH)) return true
  }

  log('failed to start hub')
  return false
}

function connectToHub() {
  log(`connectToHub called (reconnecting=${reconnecting})`)
  if (reconnecting) return
  reconnecting = true
  reconnectScheduled = false

  if (!ensureHub()) {
    log('connectToHub: ensureHub failed')
    reconnecting = false
    scheduleReconnect()
    return
  }

  log(`connectToHub: connecting to ${HUB_SOCKET_PATH}`)
  const socket = connect(HUB_SOCKET_PATH)

  socket.on('connect', () => {
    hubSocket = socket
    hubBuffer = ''
    reconnecting = false

    const payload: RegisterPayload = {
      name: SESSION_NAME,
      role: SESSION_ROLE,
      project: process.env.PWD ?? process.cwd(),
      pid: process.pid,
      cmuxSurfaceId: process.env.CMUX_SURFACE_ID,
      cmuxWorkspaceId: process.env.CMUX_WORKSPACE_ID,
    }
    socket.write(serialize(makeEnvelope('register', SESSION_NAME, 'hub', payload as unknown as Record<string, unknown>)))

    if (!heartbeatInterval) {
      heartbeatInterval = setInterval(() => {
        if (hubSocket && registered) {
          hubSocket.write(serialize(makeEnvelope('ping', SESSION_NAME, 'hub', {})))
        }
      }, 10_000)
    }
  })

  socket.on('data', chunk => {
    hubBuffer += chunk.toString()
    const { messages, remainder } = parseLines(hubBuffer)
    hubBuffer = remainder
    for (const msg of messages) {
      onHubMessage(msg)
    }
  })

  socket.on('close', () => {
    log('disconnected from hub')
    hubSocket = null
    registered = false
    reconnecting = false
    rejectAllPending('Disconnected from hub')
    scheduleReconnect()
  })

  socket.on('error', err => {
    log(`hub connection error: ${err.message}`)
    hubSocket = null
    registered = false
    reconnecting = false
  })
}

function scheduleReconnect() {
  if (reconnectScheduled) return
  reconnectScheduled = true
  reconnectAttempt++
  const delay = Math.min(1000 * reconnectAttempt, 15_000)
  setTimeout(connectToHub, delay)
}

function requestSessionList(): Promise<SessionInfo[]> {
  return new Promise((resolve, reject) => {
    if (!hubSocket || !registered) {
      reject(new Error('Not connected to hub'))
      return
    }

    const requestId = randomUUID()
    pendingListRequests.set(requestId, { resolve, reject })

    hubSocket.write(serialize(makeEnvelope('session_list_request', SESSION_NAME, 'hub', {})))

    setTimeout(() => {
      if (pendingListRequests.has(requestId)) {
        pendingListRequests.delete(requestId)
        reject(new Error('session list request timed out'))
      }
    }, 5000)
  })
}

const listSessionsTool = {
  name: 'list_sessions',
  description: 'List all connected sessions with their name, role, project directory, and status.',
  inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
}

const setStatusTool = {
  name: 'set_status',
  description: 'Update this session\'s status or current task description in the registry.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      status: { type: 'string', description: 'Status text' },
      current_task: { type: 'string', description: 'What you\'re currently working on' },
    },
  },
}

const managerTools = [
  listSessionsTool,
  {
    name: 'send_task',
    description: 'Send a task to a named worker session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_name: { type: 'string', description: 'Name of the target worker session' },
        description: { type: 'string', description: 'What the worker should do' },
        context: { type: 'string', description: 'Additional context (file references, constraints, etc.)' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Task priority' },
      },
      required: ['session_name', 'description'],
    },
  },
  {
    name: 'spawn_session',
    description: 'Start a new Claude Code worker session in a tmux pane.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_dir: { type: 'string', description: 'Absolute path to the project directory' },
        name: { type: 'string', description: 'Session name (defaults to directory basename)' },
        initial_task: { type: 'string', description: 'Initial task to send after session starts' },
        use_cmux: { type: 'boolean', description: 'Use cmux instead of tmux' },
      },
      required: ['project_dir'],
    },
  },
  {
    name: 'respond_to_worker',
    description: 'Answer a question from a worker session. Use the question_id from the channel notification meta.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_name: { type: 'string', description: 'Name of the worker session' },
        question_id: { type: 'string', description: 'The question_id from the notification' },
        answer: { type: 'string', description: 'Your answer' },
      },
      required: ['session_name', 'question_id', 'answer'],
    },
  },
  {
    name: 'respond_permission',
    description: 'Allow or deny a permission request from a worker session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_name: { type: 'string', description: 'Name of the worker session' },
        request_id: { type: 'string', description: 'The request_id from the notification' },
        behavior: { type: 'string', enum: ['allow', 'deny'], description: 'Whether to allow or deny' },
      },
      required: ['session_name', 'request_id', 'behavior'],
    },
  },
  {
    name: 'broadcast',
    description: 'Send a message to all connected worker sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'The message to broadcast' },
      },
      required: ['message'],
    },
  },
  setStatusTool,
]

const workerTools = [
  {
    name: 'report_status',
    description: 'Send a progress update to the manager session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Current status (e.g., "in_progress", "blocked")' },
        message: { type: 'string', description: 'Description of current progress' },
        task_id: { type: 'string', description: 'The task ID this relates to' },
      },
      required: ['status', 'message'],
    },
  },
  {
    name: 'ask_manager',
    description: 'Ask the manager (human) a question and wait for the answer. Use this when you need clarification or a decision.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'The question to ask' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['label', 'description'],
          },
          description: 'Optional choices to present',
        },
        multi_select: { type: 'boolean', description: 'Allow multiple selections' },
      },
      required: ['question'],
    },
  },
  {
    name: 'task_complete',
    description: 'Signal that you finished a task. Sends the result summary to the manager.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task ID' },
        summary: { type: 'string', description: 'What was accomplished' },
        details: { type: 'string', description: 'Detailed results or notes' },
      },
      required: ['task_id', 'summary'],
    },
  },
  setStatusTool,
  listSessionsTool,
]

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: isManager ? managerTools : workerTools,
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>

  try {
    switch (req.params.name) {
      case 'list_sessions': {
        const sessions = await requestSessionList()
        if (sessions.length === 0) {
          return { content: [{ type: 'text', text: 'No sessions connected.' }] }
        }
        const lines = sessions.map(s =>
          `${s.name} (${s.role}) — ${s.status} — ${s.project}${s.currentTask ? ` [${s.currentTask}]` : ''}${s.cmuxSurfaceId ? ` [cmux: ${s.cmuxSurfaceId}]` : ''}`
        )
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'send_task': {
        const taskId = randomUUID()
        const payload: TaskPayload = {
          taskId,
          description: args.description as string,
          context: args.context as string | undefined,
          priority: args.priority as 'low' | 'normal' | 'high' | undefined,
        }
        const sent = sendToHub('task', args.session_name as string, payload as unknown as Record<string, unknown>)
        if (!sent) return { content: [{ type: 'text', text: 'Failed: not connected to hub' }], isError: true }
        return { content: [{ type: 'text', text: `Task sent to "${args.session_name}" (id: ${taskId})` }] }
      }

      case 'spawn_session': {
        const projectDir = args.project_dir as string
        const name = (args.name as string) ?? basename(projectDir)
        const useCmux = args.use_cmux as boolean | undefined
        const initialTask = args.initial_task as string | undefined

        const escapedName = shellEscape(name)
        const escapedProjectDir = shellEscape(projectDir)
        const env = `ARBITER_SESSION_NAME='${escapedName}' ARBITER_SESSION_ROLE='worker'`
        const channelFlag = `--dangerously-load-development-channels plugin:arbiter@claude-arbiter`
        const claudeCmd = `${env} claude ${channelFlag}`

        let spawnCmd: string
        if (useCmux) {
          spawnCmd = `cmux new-workspace --name '${escapedName}' --cwd '${escapedProjectDir}' --command '${claudeCmd}'`
        } else {
          spawnCmd = `tmux split-window -h -c '${escapedProjectDir}' "${claudeCmd}"`
        }

        let spawnStderr = ''
        let spawnExitCode: number | null = null

        const child = spawn('sh', ['-c', spawnCmd], { stdio: ['ignore', 'ignore', 'pipe'] })
        child.stderr!.on('data', (chunk: Buffer) => {
          spawnStderr += chunk.toString()
        })
        child.on('exit', (code) => {
          spawnExitCode = code
          if (code !== 0) {
            log(`spawn_session "${name}" exited with code ${code}: ${spawnStderr.trim()}`)
          }
        })
        child.unref()

        let found = false
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000))
          if (spawnExitCode !== null && spawnExitCode !== 0) break
          try {
            const sessions = await requestSessionList()
            if (sessions.some(s => s.name === name)) {
              found = true
              break
            }
          } catch {}
        }

        if (found) {
          let result = `Session "${name}" spawned and connected.`
          if (initialTask) {
            const taskId = randomUUID()
            sendToHub('task', name, { taskId, description: initialTask } as unknown as Record<string, unknown>)
            result += ` Initial task dispatched (id: ${taskId}).`
          }
          return { content: [{ type: 'text', text: result }] }
        }

        if (spawnExitCode !== null && spawnExitCode !== 0) {
          let msg = `Spawn command failed (exit code ${spawnExitCode}).`
          if (spawnStderr.trim()) msg += `\nstderr: ${spawnStderr.trim()}`
          return { content: [{ type: 'text', text: msg }], isError: true }
        }

        return { content: [{ type: 'text', text: `Session spawned but "${name}" has not registered yet. It may still be starting up. Check list_sessions in a moment.` }] }
      }

      case 'respond_to_worker': {
        const payload: AnswerPayload = {
          questionId: args.question_id as string,
          answer: args.answer as string,
        }
        const sent = sendToHub('answer', args.session_name as string, payload as unknown as Record<string, unknown>)
        if (!sent) return { content: [{ type: 'text', text: 'Failed: not connected to hub' }], isError: true }
        return { content: [{ type: 'text', text: `Answer sent to "${args.session_name}"` }] }
      }

      case 'respond_permission': {
        const payload: PermissionResponsePayload = {
          requestId: args.request_id as string,
          behavior: args.behavior as 'allow' | 'deny',
        }
        const sent = sendToHub('permission_response', args.session_name as string, payload as unknown as Record<string, unknown>)
        if (!sent) return { content: [{ type: 'text', text: 'Failed: not connected to hub' }], isError: true }
        return { content: [{ type: 'text', text: `Permission ${args.behavior}ed for "${args.session_name}"` }] }
      }

      case 'broadcast': {
        const sent = sendToHub('broadcast', '*', { message: args.message as string })
        if (!sent) return { content: [{ type: 'text', text: 'Failed: not connected to hub' }], isError: true }
        return { content: [{ type: 'text', text: 'Broadcast sent to all sessions.' }] }
      }

      case 'report_status': {
        const payload: StatusUpdatePayload = {
          taskId: args.task_id as string | undefined,
          status: args.status as string,
          message: args.message as string,
        }
        const sent = sendToHub('status_update', '*', payload as unknown as Record<string, unknown>)
        if (!sent) return { content: [{ type: 'text', text: 'Failed: not connected to hub' }], isError: true }
        return { content: [{ type: 'text', text: 'Status update sent.' }] }
      }

      case 'ask_manager': {
        const questionId = randomUUID()
        const payload: QuestionPayload = {
          questionId,
          question: args.question as string,
          options: args.options as QuestionPayload['options'],
          multiSelect: args.multi_select as boolean | undefined,
        }

        const answerPromise = new Promise<string>((resolve, reject) => {
          pendingQuestions.set(questionId, { resolve, reject })
          setTimeout(() => {
            if (pendingQuestions.has(questionId)) {
              pendingQuestions.delete(questionId)
              reject(new Error('Question timed out after 5 minutes'))
            }
          }, 5 * 60 * 1000)
        })

        const sent = sendToHub('question', '*', payload as unknown as Record<string, unknown>)
        if (!sent) return { content: [{ type: 'text', text: 'Failed: not connected to hub' }], isError: true }

        const answer = await answerPromise
        return { content: [{ type: 'text', text: answer }] }
      }

      case 'task_complete': {
        const payload: TaskCompletePayload = {
          taskId: args.task_id as string,
          summary: args.summary as string,
          details: args.details as string | undefined,
        }
        const sent = sendToHub('task_complete', '*', payload as unknown as Record<string, unknown>)
        if (!sent) return { content: [{ type: 'text', text: 'Failed: not connected to hub' }], isError: true }
        return { content: [{ type: 'text', text: 'Task completion reported.' }] }
      }

      case 'set_status': {
        const payload: StatusUpdatePayload = {
          status: (args.status as string) ?? 'active',
          message: (args.current_task as string) ?? '',
        }
        sendToHub('status_update', 'hub', payload as unknown as Record<string, unknown>)
        return { content: [{ type: 'text', text: 'Status updated.' }] }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `${req.params.name} failed: ${msg}` }], isError: true }
  }
})

log(`starting: name=${SESSION_NAME}, role=${SESSION_ROLE}, cwd=${process.cwd()}, pid=${process.pid}`)

await mcp.connect(new StdioServerTransport())
log('MCP transport connected, calling connectToHub')

connectToHub()

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  rejectAllPending('Session shutting down')
  if (hubSocket) {
    hubSocket.destroy()
    hubSocket = null
  }
  process.exit(0)
}

process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGHUP', shutdown)

const bootPpid = process.ppid
setInterval(() => {
  const orphaned =
    (process.platform !== 'win32' && process.ppid !== bootPpid) ||
    process.stdin.destroyed ||
    process.stdin.readableEnded
  if (orphaned) shutdown()
}, 5000).unref()
