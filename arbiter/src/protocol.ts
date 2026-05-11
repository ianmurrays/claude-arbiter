import { randomUUID } from 'crypto'

export type SessionRole = 'manager' | 'worker'
export type SessionStatus = 'active' | 'idle' | 'busy' | 'disconnected'

export type MessageType =
  | 'register'
  | 'registered'
  | 'session_list_request'
  | 'session_list'
  | 'task'
  | 'status_update'
  | 'task_complete'
  | 'question'
  | 'answer'
  | 'permission_request'
  | 'permission_response'
  | 'broadcast'
  | 'ping'
  | 'pong'
  | 'error'

export type MessageEnvelope = {
  id: string
  type: MessageType
  from: string
  to: string
  timestamp: number
  payload: Record<string, unknown>
}

export type RegisterPayload = {
  name: string
  role: SessionRole
  project: string
  pid: number
}

export type TaskPayload = {
  taskId: string
  description: string
  context?: string
  priority?: 'low' | 'normal' | 'high'
}

export type StatusUpdatePayload = {
  taskId?: string
  status: string
  message: string
}

export type TaskCompletePayload = {
  taskId: string
  summary: string
  details?: string
}

export type QuestionPayload = {
  questionId: string
  taskId?: string
  question: string
  options?: Array<{ label: string; description: string }>
  multiSelect?: boolean
}

export type AnswerPayload = {
  questionId: string
  answer: string
}

export type PermissionRequestPayload = {
  requestId: string
  toolName: string
  description: string
  inputPreview: string
}

export type PermissionResponsePayload = {
  requestId: string
  behavior: 'allow' | 'deny'
}

export type SessionInfo = {
  name: string
  role: SessionRole
  project: string
  pid: number
  status: SessionStatus
  registeredAt: number
  lastSeen: number
  currentTask?: string
}

export function makeEnvelope(
  type: MessageType,
  from: string,
  to: string,
  payload: Record<string, unknown>,
): MessageEnvelope {
  return {
    id: randomUUID(),
    type,
    from,
    to,
    timestamp: Date.now(),
    payload,
  }
}

export function serialize(msg: MessageEnvelope): string {
  return JSON.stringify(msg) + '\n'
}

function deserialize(line: string): MessageEnvelope | null {
  try {
    return JSON.parse(line.trim()) as MessageEnvelope
  } catch {
    return null
  }
}

export function parseLines(buffer: string): { messages: MessageEnvelope[]; remainder: string } {
  const messages: MessageEnvelope[] = []
  let remainder = buffer
  let idx: number
  while ((idx = remainder.indexOf('\n')) !== -1) {
    const line = remainder.slice(0, idx)
    remainder = remainder.slice(idx + 1)
    if (line.trim()) {
      const msg = deserialize(line)
      if (msg) messages.push(msg)
    }
  }
  return { messages, remainder }
}
