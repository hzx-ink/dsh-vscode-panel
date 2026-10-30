/**
 * Wire vocabulary shared by the extension host and the webview.
 *
 * The host owns all state; the webview renders it and posts intents back.
 */

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: ModelReasoningEffort[]
    defaultEffort?: string
  }
}

export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelCatalogModel[]
}

export interface ModelCatalog {
  default: ModelSelection
  routableProviders: string[]
  groups: ModelProviderGroup[]
  failures: { id: string; name: string; message: string }[]
}

export interface SessionRow {
  id: string
  title: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd: string | null
  parentId: string | null
  origin: string | null
  agentAvailable: boolean
  model: ModelSelection | null
  lastPromptAt: number | null
}

export interface CodeContext {
  id: string
  path: string
  relPath: string
  startLine: number
  endLine: number
  language: string
  text: string
  truncated: boolean
}

/** One image pasted or dropped into the composer (base64 without the data: prefix). */
export interface ChatImage {
  id: string
  name: string
  mediaType: string
  data: string
}

/** Token accounting for one assistant message. */
export interface TokenUsageView {
  input: number
  output: number
  total?: number
  cacheRead?: number
}

export type ChatItem =
  | { id: string; kind: 'user'; time: number; text: string; contexts: CodeContext[]; images?: ChatImage[] }
  | {
      id: string
      kind: 'assistant'
      time: number
      text: string
      reasoning: string
      model: string
      interrupted: boolean
      usage?: TokenUsageView
    }
  | {
      id: string
      kind: 'tool'
      time: number
      name: string
      args: string
      result: string
      status: 'running' | 'ok' | 'error'
    }
  | { id: string; kind: 'notice'; time: number; text: string }

export interface LiveReply {
  text: string
  reasoning: string
  turn: number
  step: number
}

export interface UiState {
  connection: ConnectionState
  connectionDetail: string
  sessionId: string | null
  sessionTitle: string
  sessions: SessionRow[]
  models: ModelCatalog | null
  selection: ModelSelection | null
  recentModels: ModelSelection[]
  pinnedModels: ModelSelection[]
  items: ChatItem[]
  running: boolean
  hasMore: boolean
  contexts: CodeContext[]
  workspace: string | null
  filterWorkspace: boolean
  error: string | null
}

export type HostMessage =
  | { type: 'state'; state: UiState }
  | { type: 'append'; item: ChatItem }
  | { type: 'prepend'; items: ChatItem[] }
  | { type: 'trim'; count: number }
  | { type: 'update'; item: ChatItem }
  | { type: 'replace'; fromId: string; item: ChatItem }
  | { type: 'live'; live: LiveReply | null }
  | { type: 'status'; running: boolean }
  | { type: 'title'; title: string }
  | { type: 'hasMore'; value: boolean }
  | { type: 'sessions'; sessions: SessionRow[] }
  | { type: 'context'; context: CodeContext }
  | { type: 'showSessions' }
  | { type: 'restoreDraft'; text: string }
  | { type: 'toast'; level: 'info' | 'error'; message: string }
  | { type: 'focusComposer' }

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'prompt'; text: string; requestId: string; images?: ChatImage[] }
  | { type: 'cancel' }
  | { type: 'newSession' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string }
  | { type: 'forkSession'; sessionId: string }
  | { type: 'setModel'; selection: ModelSelection }
  | { type: 'pinModel'; selection: ModelSelection; pinned: boolean }
  | { type: 'removeContext'; id: string }
  | { type: 'addSelection' }
  | { type: 'refresh' }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'loadOlder' }
  | { type: 'setFilter'; all: boolean }
  | { type: 'launchDesktop' }
  | { type: 'installBridge' }
  | { type: 'openSettings' }
  | { type: 'copyText'; text: string }
  | { type: 'openExternal'; url: string }
