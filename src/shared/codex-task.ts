export type CodexTaskPhase = 'starting' | 'running' | 'waiting-approval' | 'waiting-input' | 'review' | 'stopping' | 'stopped' | 'taken-over' | 'failed' | 'disconnected'

export type CodexAvailability = {
  state: 'unknown' | 'ready' | 'not-installed' | 'not-logged-in' | 'unsupported' | 'error'
  executable?: string
  accountType?: string
  message?: string
}

export type CodexTaskMessage = {
  id: string
  kind: 'assistant' | 'command' | 'file-change' | 'status'
  text: string
  at: string
}

export type CodexTask = {
  id: string
  root: string
  threadId?: string
  turnId?: string
  phase: CodexTaskPhase
  prompt: string
  relativePath?: string
  activity: string
  messages: CodexTaskMessage[]
  changedFiles: string[]
  startedAt: string
  updatedAt: string
  error?: string
}

export type CodexQuestion = {
  id: string
  header: string
  question: string
  isSecret?: boolean
  options?: { label: string; description: string }[]
}

export type CodexApproval = {
  id: string
  kind: 'command' | 'file-change' | 'question'
  command?: string
  cwd?: string
  reason?: string
  files?: { path: string; diff?: string }[]
  questions?: CodexQuestion[]
}

export type CodexTaskSnapshot = {
  spaceId: string
  root: string
  availability: CodexAvailability
  task: CodexTask | null
  approvals: CodexApproval[]
}

export type CodexTaskInput = { prompt: string; relativePath?: string }
export type CodexApprovalResponse = { id: string; decision?: 'approve' | 'decline'; answers?: Record<string, string[]> }

export function codexTaskIsActive(task: CodexTask | null | undefined): boolean {
  return !!task && ['starting', 'running', 'waiting-approval', 'waiting-input', 'stopping'].includes(task.phase)
}
