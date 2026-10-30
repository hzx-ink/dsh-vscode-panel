import * as vscode from 'vscode'
import { existsSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findBundledBridge, findDshInstall } from './locator'
import { BridgeClient, BridgeHttpError, type BridgeLocation, BridgeUnavailableError } from './bridge'
import { recordsToItems, SessionProjector } from './projector'
import type {
  ChatImage,
  ChatItem,
  CodeContext,
  HostMessage,
  ModelCatalog,
  ModelSelection,
  SessionRow,
  UiState,
  WebviewMessage,
} from './protocol'

const LAST_SESSION_KEY = 'dsh.lastSessionId'
const MODEL_KEY = 'dsh.model'
const FILTER_KEY = 'dsh.filterWorkspace'
const RECONNECT_MS = 2000
const LIVE_THROTTLE_MS = 55
const MAX_TRANSCRIPT_ITEMS = 400
const PINNED_KEY = 'dsh.pinnedModels'
const RECENT_KEY = 'dsh.recentModels'

export class ChatController implements vscode.Disposable {
  private view?: vscode.WebviewView
  private client: BridgeClient
  private location?: BridgeLocation
  private readonly projector = new SessionProjector()
  private readonly state: UiState

  private closeSession?: () => void
  private closeGlobal?: () => void
  private messageSubscription?: vscode.Disposable
  private reconnectTimer?: NodeJS.Timeout
  private liveTimer?: NodeJS.Timeout
  private lastLiveFlush = 0
  private connecting = false
  private disposed = false
  private sessionSeq = 0

  private contexts: CodeContext[] = []
  private pinned: ModelSelection[] = []
  private recent: ModelSelection[] = []
  private selection: ModelSelection | null = null
  private modelDirty = false
  private oldestSeq = 0
  private readonly hydratedAttachments = new Set<string>()
  private readonly output: vscode.OutputChannel
  private readonly statusItem: vscode.StatusBarItem
  /** Last text editor with focus: the webview steals focus when its buttons are used. */
  private lastEditor?: vscode.TextEditor

  constructor(private readonly context: vscode.ExtensionContext) {
    this.client = new BridgeClient(
      vscode.workspace.getConfiguration('dsh').get<string>('home'),
      vscode.workspace.getConfiguration('dsh').get<string>('bridgeFile'),
    )

    this.output = vscode.window.createOutputChannel('DeepSeek Harness')
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.statusItem.command = 'dsh.focusChat'
    this.statusItem.name = 'DeepSeek Harness 引用'

    const storedModel = context.globalState.get<ModelSelection>(MODEL_KEY)
    this.selection = storedModel ?? null
    this.pinned = context.globalState.get<ModelSelection[]>(PINNED_KEY) ?? []
    this.recent = context.globalState.get<ModelSelection[]>(RECENT_KEY) ?? []

    this.lastEditor = vscode.window.activeTextEditor
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.lastEditor = editor
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('dsh.home') && !event.affectsConfiguration('dsh.bridgeFile')) return
        // Re-point the client at the new DSH home without reloading the window.
        this.client = new BridgeClient(
          vscode.workspace.getConfiguration('dsh').get<string>('home'),
          vscode.workspace.getConfiguration('dsh').get<string>('bridgeFile'),
        )
        this.closeSession?.()
        this.closeSession = undefined
        this.closeGlobal?.()
        this.closeGlobal = undefined
        this.location = undefined
        this.log('settings changed; reconnecting')
        void this.connect(true)
      }),
    )

    this.state = {
      connection: 'connecting',
      connectionDetail: '正在连接桌面版 DeepSeek Harness…',
      sessionId: null,
      sessionTitle: '',
      sessions: [],
      models: null,
      selection: this.selection,
      recentModels: this.recent.slice(),
      pinnedModels: this.pinned.slice(),
      items: this.projector.items,
      running: false,
      hasMore: false,
      contexts: [],
      workspace: workspaceRoot(),
      filterWorkspace: context.globalState.get<boolean>(FILTER_KEY) ?? false,
      error: null,
    }

    this.log(`controller ready · extension ${String(context.extension.packageJSON.version ?? '?')} · workspace ${workspaceRoot() ?? '(none)'}`)
  }

  /** Append one line to the "DeepSeek Harness" output channel. */
  log(line: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${line}`)
  }

  showLog(): void {
    this.output.show(true)
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  attach(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    }
    view.webview.html = renderHtml(view.webview, this.context.extensionUri)
    // Re-resolving the same view (hide/show) must not stack listeners: a second
    // listener would submit every prompt twice.
    this.messageSubscription?.dispose()
    this.messageSubscription = view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.onMessage(message)
    })
    view.onDidDispose(() => {
      this.messageSubscription?.dispose()
      this.messageSubscription = undefined
      this.view = undefined
      this.stopStreams()
    })
    void this.connect()
  }

  dispose(): void {
    this.disposed = true
    this.messageSubscription?.dispose()
    this.messageSubscription = undefined
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.liveTimer) clearTimeout(this.liveTimer)
    this.statusItem.dispose()
    this.output.dispose()
    this.stopStreams()
  }

  private stopStreams(): void {
    this.closeSession?.()
    this.closeSession = undefined
    this.closeGlobal?.()
    this.closeGlobal = undefined
  }

  // ── connection ───────────────────────────────────────────────────────────

  async connect(force = false): Promise<void> {
    if (this.connecting || this.disposed) return
    if (this.location && !force) return
    this.connecting = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    // A forced refresh may follow a Desktop restart: drop the sockets bound to
    // the previous port before re-discovering.
    if (force) {
      this.closeSession?.()
      this.closeSession = undefined
      this.closeGlobal?.()
      this.closeGlobal = undefined
    }
    this.setConnection('connecting', '正在连接桌面版 DeepSeek Harness…')

    try {
      this.location = await this.client.discover()
      const info = this.location.info
      const detail = `已连接 · ${info.profile ?? 'desktop'}${info.pid ? ` · pid ${info.pid}` : ''}`
      this.setConnection('connected', detail)
      this.openGlobalStream()
      // Catalog and session list are independent reads; do not serialize them.
      await Promise.all([this.refreshModels(), this.refreshSessions()])
      await this.restoreSession()
    } catch (error) {
      this.location = undefined
      const detail = error instanceof BridgeUnavailableError
        ? `${error.message}${error.detail ? `（${error.detail}）` : ''}`
        : error instanceof Error ? error.message : String(error)
      this.setConnection('disconnected', detail)
      this.scheduleReconnect()
    } finally {
      this.connecting = false
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connect()
    }, RECONNECT_MS)
  }

  private setConnection(connection: UiState['connection'], detail: string): void {
    this.state.connection = connection
    this.state.connectionDetail = detail
    this.post({ type: 'state', state: this.snapshot() })
  }

  private openGlobalStream(): void {
    if (!this.location) return
    this.closeGlobal?.()
    this.closeGlobal = this.client.openStream(
      this.location,
      '/events',
      (payload) => this.onGlobalEvent(payload),
      () => {
        // The global stream is a convenience; the discovery loop owns recovery.
      },
    )
  }

  private onGlobalEvent(payload: any): void {
    switch (payload?.kind) {
      case 'session-added': {
        if (payload.session) this.upsertSession(payload.session)
        break
      }
      case 'session-removed': {
        this.state.sessions = this.state.sessions.filter((row) => row.id !== payload.sessionId)
        this.post({ type: 'sessions', sessions: this.state.sessions })
        break
      }
      case 'session-status': {
        const row = this.state.sessions.find((item) => item.id === payload.sessionId)
        if (row) {
          row.running = payload.running === true
          this.post({ type: 'sessions', sessions: this.state.sessions })
        }
        if (payload.sessionId === this.state.sessionId) {
          this.state.running = payload.running === true
          this.post({ type: 'status', running: this.state.running })
        }
        break
      }
      case 'session-activity': {
        const row = this.state.sessions.find((item) => item.id === payload.sessionId)
        if (row) {
          row.updatedAt = payload.updatedAt
          this.sortSessions()
          this.post({ type: 'sessions', sessions: this.state.sessions })
        }
        break
      }
      case 'session-error': {
        if (payload.sessionId === this.state.sessionId) {
          this.toast('error', payload.message)
        }
        break
      }
      default:
        break
    }
  }

  private upsertSession(row: SessionRow): void {
    if (row.origin === 'subagent' || row.parentId) return
    const index = this.state.sessions.findIndex((item) => item.id === row.id)
    if (index >= 0) this.state.sessions[index] = row
    else this.state.sessions.push(row)
    this.sortSessions()
    this.post({ type: 'sessions', sessions: this.state.sessions })
  }

  private sortSessions(): void {
    this.state.sessions.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  // ── catalog + list ───────────────────────────────────────────────────────

  private async refreshModels(): Promise<void> {
    if (!this.location) return
    try {
      const catalog = await this.client.get<ModelCatalog>(this.location, '/models')
      this.state.models = catalog
      this.ensureSelection(catalog)
      this.post({ type: 'state', state: this.snapshot() })
    } catch (error) {
      this.toast('error', `读取模型列表失败：${messageOf(error)}`)
    }
  }

  private ensureSelection(catalog: ModelCatalog): void {
    const all = catalog.groups.flatMap((group) => group.models.map((model) => ({ provider: group.id, model: model.id })))
    const current = this.selection
    const exists = current !== null && all.some((entry) => entry.provider === current.provider && entry.model === current.model)
    if (exists) return
    const fallback = catalog.default
    if (fallback) {
      this.selection = { provider: fallback.provider, model: fallback.model, ...(fallback.reasoningEffort ? { reasoningEffort: fallback.reasoningEffort } : {}) }
      this.state.selection = this.selection
      void this.context.globalState.update(MODEL_KEY, this.selection)
    }
  }

  private async refreshSessions(): Promise<void> {
    if (!this.location) return
    try {
      const value = await this.client.get<{ items: SessionRow[] }>(this.location, '/sessions')
      this.state.sessions = (value.items ?? []).filter((row) => row.origin !== 'subagent' && !row.parentId)
      this.sortSessions()
      this.post({ type: 'sessions', sessions: this.state.sessions })
    } catch (error) {
      this.toast('error', `读取会话列表失败：${messageOf(error)}`)
    }
  }

  private async restoreSession(): Promise<void> {
    const last = this.context.workspaceState.get<string>(LAST_SESSION_KEY)
    const target = last && this.state.sessions.some((row) => row.id === last) ? last : undefined
    if (target) {
      await this.openSession(target)
      return
    }
    // No remembered session: show a clean composer, the list still has history.
    if (this.state.sessionId !== null) {
      this.closeSession?.()
      this.closeSession = undefined
      this.projector.reset()
      this.state.items = this.projector.items
      this.state.hasMore = false
    }
    this.state.sessionId = null
    this.state.sessionTitle = ''
    this.post({ type: 'state', state: this.snapshot() })
  }

  // ── session streaming ────────────────────────────────────────────────────

  async openSession(sessionId: string): Promise<void> {
    if (!this.location) {
      this.toast('error', '尚未连接桌面版 DeepSeek Harness')
      return
    }
    if (this.state.sessionId === sessionId && this.closeSession) return

    this.closeSession?.()
    this.closeSession = undefined
    this.projector.reset()
    this.hydratedAttachments.clear()
    // Composer attachments survive a session switch: a shortcut may have
    // queued a selection before this panel was even visible.
    this.oldestSeq = 0
    this.state.sessionId = sessionId
    this.state.sessionTitle = this.state.sessions.find((row) => row.id === sessionId)?.title ?? ''
    this.state.items = this.projector.items
    this.state.hasMore = false
    this.state.error = null
    const row = this.state.sessions.find((item) => item.id === sessionId)
    this.state.running = row?.running ?? false
    if (row?.model) {
      this.selection = row.model
      this.state.selection = row.model
    }
    this.post({ type: 'state', state: this.snapshot() })
    this.startSessionStream(sessionId)
    void this.context.workspaceState.update(LAST_SESSION_KEY, sessionId)
  }

  private startSessionStream(sessionId: string): void {
    if (!this.location) return
    const token = ++this.sessionSeq
    this.closeSession = this.client.openStream(
      this.location,
      `/sessions/${encodeURIComponent(sessionId)}/events`,
      (payload) => {
        if (token !== this.sessionSeq) return
        this.onSessionFrame(sessionId, payload)
      },
      (error) => {
        if (token !== this.sessionSeq) return
        this.onSessionStreamError(sessionId, error)
      },
    )
  }

  private onSessionStreamError(sessionId: string, error: Error): void {
    if (this.state.sessionId !== sessionId) return
    const wasConnected = this.state.connection === 'connected'
    this.closeSession = undefined
    this.state.running = false
    this.post({ type: 'status', running: false })
    // A restarted Desktop changes both port and token, so re-discover instead
    // of retrying the same dead socket.
    this.location = undefined
    this.setConnection('disconnected', '与桌面版 DeepSeek Harness 的连接已断开')
    if (wasConnected) this.toast('error', `连接中断：${messageOf(error)}`)
    this.scheduleReconnect()
  }

  private onSessionFrame(sessionId: string, payload: any): void {
    if (this.state.sessionId !== sessionId) return

    if (payload?.kind === 'snapshot') {
      this.projector.hydrate(payload)
      this.state.items = this.projector.items
      this.state.hasMore = this.projector.hasMore
      if (this.projector.title.length > 0) this.state.sessionTitle = this.projector.title
      this.oldestSeq = minSeq(this.projector.items)
      if (this.projector.live) this.post({ type: 'live', live: this.projector.live })
      this.post({ type: 'state', state: this.snapshot() })
      this.scheduleImageHydration()
      return
    }

    if (payload?.kind === 'event') {
      const event = payload.event
      const ops = this.projector.applyEvent(event)
      this.applyOps(ops)
      if (event?.type === 'turn/end') {
        this.state.running = false
        this.post({ type: 'status', running: false })
        // The list row is already kept current by `api-session/activity` and
        // `api-session/status`; no full list refresh per turn.
      }
      return
    }

    if (payload?.kind === 'assistant') {
      this.applyOps(this.projector.applyAssistantFrame(payload.frame))
      return
    }

    if (payload?.kind === 'error') {
      this.toast('error', payload.message ?? '会话流出错')
    }
  }

  private applyOps(ops: ReturnType<SessionProjector['applyEvent']>): void {
    for (const op of ops) {
      switch (op.kind) {
        case 'append':
          this.post({ type: 'append', item: op.item })
          break
        case 'update':
          this.post({ type: 'update', item: op.item })
          break
        case 'replace':
          this.post({ type: 'replace', fromId: op.fromId, item: op.item })
          break
        case 'running':
          this.state.running = op.running
          this.post({ type: 'status', running: op.running })
          break
        case 'live':
          this.queueLive(op.live)
          break
        case 'title': {
          this.state.sessionTitle = op.title
          const row = this.state.sessions.find((item) => item.id === this.state.sessionId)
          if (row) row.title = op.title
          // A dedicated message keeps the transcript untouched (no full re-render).
          this.post({ type: 'title', title: op.title })
          this.post({ type: 'sessions', sessions: this.state.sessions })
          break
        }
        default:
          break
      }
    }

    if (this.projector.items.some((item) => item.kind === 'user' && item.images?.some((image) => image.data.length === 0))) {
      this.scheduleImageHydration()
    }

    // Very long sessions: keep the DOM and the state payload bounded.
    if (this.projector.items.length > MAX_TRANSCRIPT_ITEMS) {
      const dropped = this.projector.trim(MAX_TRANSCRIPT_ITEMS)
      if (dropped > 0) {
        this.state.hasMore = true
        this.post({ type: 'trim', count: dropped })
      }
    }
  }

  /**
   * History carries image references, not bytes. Fetch each referenced image once
   * so reopened sessions still render thumbnails.
   */
  private scheduleImageHydration(): void {
    const sessionId = this.state.sessionId
    if (!this.location || !sessionId) return
    for (const item of this.projector.items) {
      if (item.kind !== 'user' || !item.images) continue
      for (const image of item.images) {
        if (image.data.length > 0 || image.id.length === 0 || this.hydratedAttachments.has(image.id)) continue
        this.hydratedAttachments.add(image.id)
        void this.fetchAttachment(sessionId, image.id).then((data) => {
          if (!data) return
          const current = this.projector.items.find((candidate) => candidate.id === item.id)
          if (!current || current.kind !== 'user' || !current.images) return
          const index = this.projector.items.indexOf(current)
          const updated: ChatItem = {
            ...current,
            images: current.images.map((entry) => (entry.id === image.id ? { ...entry, data } : entry)),
          }
          this.projector.items[index] = updated
          this.post({ type: 'update', item: updated })
        })
      }
    }
  }

  private async fetchAttachment(sessionId: string, attachmentId: string): Promise<string | undefined> {
    if (!this.location) return undefined
    try {
      const value = await this.client.get<{ data?: string }>(
        this.location,
        `/attachment?sessionId=${encodeURIComponent(sessionId)}&attachmentId=${encodeURIComponent(attachmentId)}`,
        30_000,
      )
      return typeof value?.data === 'string' ? value.data : undefined
    } catch (error) {
      this.log(`attachment ${attachmentId} unavailable: ${messageOf(error)}`)
      return undefined
    }
  }

  private queueLive(live: { text: string; reasoning: string; turn: number; step: number } | null): void {
    const flush = () => {
      this.liveTimer = undefined
      this.lastLiveFlush = Date.now()
      this.post({ type: 'live', live: this.projector.live })
    }
    if (live === null) {
      if (this.liveTimer) {
        clearTimeout(this.liveTimer)
        this.liveTimer = undefined
      }
      flush()
      return
    }
    const elapsed = Date.now() - this.lastLiveFlush
    if (elapsed >= LIVE_THROTTLE_MS) {
      flush()
      return
    }
    if (!this.liveTimer) {
      this.liveTimer = setTimeout(flush, LIVE_THROTTLE_MS - elapsed)
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────

  async sendPrompt(text: string, requestId: string, images: ChatImage[] = []): Promise<void> {
    const trimmed = text.trim()
    if (trimmed.length === 0 && images.length === 0) return
    if (!this.location) {
      this.toast('error', '尚未连接桌面版 DeepSeek Harness')
      this.post({ type: 'restoreDraft', text })
      return
    }

    const contexts = this.contexts.slice()
    const body = buildPrompt(trimmed, contexts)
    if (process.env.DSH_PANEL_DEBUG === '1') {
      console.error(`[dsh-panel] sendPrompt contexts=${contexts.length} images=${images.length} body=${body.length}`)
    }
    const isNewSession = this.state.sessionId === null

    const optimistic: ChatItem = {
      id: `local:${requestId}`,
      kind: 'user',
      time: Date.now(),
      text: trimmed,
      contexts,
      ...(images.length > 0 ? { images } : {}),
    }
    this.projector.items.push(optimistic)
    this.post({ type: 'append', item: optimistic })

    this.contexts = []
    this.state.contexts = []
    this.syncStatus()

    try {
      let sessionId = this.state.sessionId
      if (!sessionId) {
        sessionId = await this.createSession()
        this.state.sessionId = sessionId
        void this.context.workspaceState.update(LAST_SESSION_KEY, sessionId)
        this.startSessionStream(sessionId)
      }
      if (this.selection && (this.modelDirty || isNewSession)) {
        try {
          await this.applyModel(sessionId, this.selection)
          this.modelDirty = false
          this.rememberModel(this.selection)
        } catch (error) {
          this.toast('error', `切换模型失败：${messageOf(error)}`)
        }
      }
      await this.client.post(this.location, '/prompt', {
        sessionId,
        text: body,
        requestId,
        ...(images.length > 0
          ? { images: images.map((image) => ({ mediaType: image.mediaType, data: image.data, name: image.name })) }
          : {}),
      })
      this.state.running = true
      this.post({ type: 'status', running: true })
      this.post({ type: 'state', state: this.snapshot() })
    } catch (error) {
      this.projector.items = this.projector.items.filter((item) => item.id !== `local:${requestId}`)
      this.state.items = this.projector.items
      this.post({ type: 'state', state: this.snapshot() })
      this.post({ type: 'restoreDraft', text })
      this.toast('error', `发送失败：${messageOf(error)}`)
    }
  }

  /** Remember the last few model choices for the picker's "最近使用" group. */
  private rememberModel(selection: ModelSelection): void {
    const same = (left: ModelSelection, right: ModelSelection) =>
      left.provider === right.provider && left.model === right.model && (left.reasoningEffort ?? '') === (right.reasoningEffort ?? '')
    this.recent = [selection, ...this.recent.filter((item) => !same(item, selection))].slice(0, 5)
    this.state.recentModels = this.recent.slice()
    void this.context.globalState.update(RECENT_KEY, this.recent)
  }

  async setPinned(selection: ModelSelection, pinned: boolean): Promise<void> {
    const same = (left: ModelSelection, right: ModelSelection) =>
      left.provider === right.provider && left.model === right.model
    this.pinned = pinned
      ? [selection, ...this.pinned.filter((item) => !same(item, selection))]
      : this.pinned.filter((item) => !same(item, selection))
    this.state.pinnedModels = this.pinned.slice()
    await this.context.globalState.update(PINNED_KEY, this.pinned)
    this.post({ type: 'state', state: this.snapshot() })
  }

  async renameSession(sessionId: string): Promise<void> {
    if (!this.location) return
    const row = this.state.sessions.find((item) => item.id === sessionId)
    const input = await vscode.window.showInputBox({
      prompt: '会话标题',
      value: row?.title ?? (sessionId === this.state.sessionId ? this.state.sessionTitle : ''),
      validateInput: (value) => (value.trim().length === 0 ? '标题不能为空' : undefined),
    })
    if (input === undefined) return
    const title = input.trim()
    if (title.length === 0) return
    try {
      const value = await this.client.post<{ title: string }>(this.location, '/v1/rename', { sessionId, title })
      const accepted = value?.title ?? title
      if (row) row.title = accepted
      if (this.state.sessionId === sessionId) {
        this.state.sessionTitle = accepted
        this.post({ type: 'title', title: accepted })
      }
      this.post({ type: 'sessions', sessions: this.state.sessions })
      this.log(`renamed ${sessionId} -> ${accepted}`)
    } catch (error) {
      this.toast('error', `重命名失败：${messageOf(error)}`)
    }
  }

  async forkSession(sessionId: string): Promise<void> {
    if (!this.location) return
    try {
      const value = await this.client.post<{ sessionId: string }>(this.location, '/v1/fork', { sessionId })
      if (!value?.sessionId) throw new Error('桌面版未返回新会话')
      await this.refreshSessions()
      await this.openSession(value.sessionId)
      this.log(`forked ${sessionId} -> ${value.sessionId}`)
      this.toast('info', '已从当前会话创建分支')
    } catch (error) {
      this.toast('error', `创建分支失败：${messageOf(error)}`)
    }
  }

  private async createSession(): Promise<string> {
    if (!this.location) throw new BridgeUnavailableError('未连接')
    const created = await this.client.post<{ sessionId: string }>(this.location, '/sessions', {
      ...(workspaceRoot() ? { cwd: workspaceRoot() } : {}),
    })
    if (!created?.sessionId) throw new Error('桌面版未返回会话标识')
    return created.sessionId
  }

  private async applyModel(sessionId: string, selection: ModelSelection): Promise<void> {
    if (!this.location) return
    await this.client.post(this.location, '/model', { sessionId, ...selection })
  }

  async cancel(): Promise<void> {
    if (!this.location || !this.state.sessionId) return
    try {
      await this.client.post(this.location, '/cancel', { sessionId: this.state.sessionId })
    } catch (error) {
      this.toast('error', `停止失败：${messageOf(error)}`)
    }
  }

  async newSession(): Promise<void> {
    this.closeSession?.()
    this.closeSession = undefined
    this.sessionSeq += 1
    this.projector.reset()
    this.hydratedAttachments.clear()
    this.oldestSeq = 0
    this.state.sessionId = null
    this.state.sessionTitle = ''
    this.state.items = this.projector.items
    this.state.hasMore = false
    this.state.running = false
    this.post({ type: 'state', state: this.snapshot() })
    this.post({ type: 'focusComposer' })
    await this.context.workspaceState.update(LAST_SESSION_KEY, undefined)
  }

  async setModel(selection: ModelSelection): Promise<void> {
    this.selection = selection
    this.state.selection = selection
    this.modelDirty = true
    this.rememberModel(selection)
    await this.context.globalState.update(MODEL_KEY, selection)
    this.post({ type: 'state', state: this.snapshot() })
    if (this.location && this.state.sessionId) {
      try {
        await this.applyModel(this.state.sessionId, selection)
        this.modelDirty = false
      } catch (error) {
        this.toast('error', `切换模型失败：${messageOf(error)}`)
      }
    }
  }

  async loadOlder(): Promise<void> {
    if (!this.location || !this.state.sessionId || !this.state.hasMore) return
    const sessionId = this.state.sessionId
    try {
      const page = await this.client.get<{ records: any[]; hasMore: boolean }>(
        this.location,
        `/sessions/${encodeURIComponent(sessionId)}/history?throughSeq=${this.projector.cursor}&beforeSeq=${this.oldestSeq}&maxMessages=60`,
      )
      const items = recordsToItems(page.records ?? [])
      const known = new Set(this.projector.items.map((item) => item.id))
      const fresh = items.filter((item) => !known.has(item.id))
      if (fresh.length > 0) {
        this.projector.items.unshift(...fresh)
        this.post({ type: 'prepend', items: fresh })
      }
      this.state.hasMore = page.hasMore === true
      this.oldestSeq = minSeq(fresh) || this.oldestSeq
      this.post({ type: 'hasMore', value: this.state.hasMore })
    } catch (error) {
      this.toast('error', `加载更早消息失败：${messageOf(error)}`)
    }
  }

  addContext(context: CodeContext): void {
    this.contexts.push(context)
    this.state.contexts = this.contexts.slice()
    this.post({ type: 'context', context })
    this.syncStatus()
    this.log(`context +${context.relPath}:${context.startLine}-${context.endLine} (${context.text.length} chars, ${this.contexts.length} pending)`)
  }

  removeContext(id: string): void {
    this.contexts = this.contexts.filter((item) => item.id !== id)
    this.state.contexts = this.contexts.slice()
    this.post({ type: 'state', state: this.snapshot() })
    this.syncStatus()
  }

  async addSelectionFromEditor(): Promise<void> {
    const editor = this.resolveEditor()
    this.log(`command addSelection · editor=${editor ? editor.document.uri.fsPath : 'none'} · selection=${editor ? (editor.selection.isEmpty ? 'empty' : `${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`) : '-'}`)
    if (!editor) {
      this.toast('error', '当前没有打开的编辑器')
      void vscode.window.showWarningMessage('DeepSeek Harness：当前没有打开的编辑器')
      return
    }
    if (editor.selection.isEmpty) {
      this.toast('info', '请先在编辑器里选中一段代码')
      void vscode.window.showInformationMessage('DeepSeek Harness：请先在编辑器里选中一段代码，再按 Ctrl+Alt+A')
      return
    }
    this.addContext(await contextFromSelection(editor, editor.selection))
    await this.revealPanel()
  }

  async addWholeFile(): Promise<void> {
    const editor = this.resolveEditor()
    this.log(`command addFile · editor=${editor ? editor.document.uri.fsPath : 'none'}`)
    if (!editor) {
      this.toast('error', '当前没有打开的编辑器')
      void vscode.window.showWarningMessage('DeepSeek Harness：当前没有打开的编辑器')
      return
    }
    const lastLine = new vscode.Position(Math.max(0, editor.document.lineCount - 1), 0)
    const range = new vscode.Range(new vscode.Position(0, 0), lastLine)
    this.addContext(await contextFromSelection(editor, range))
    await this.revealPanel()
  }

  /**
   * The panel's own buttons steal focus, which makes `activeTextEditor`
   * undefined; fall back to the last editor the user actually worked in.
   */
  private resolveEditor(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor
    if (active && !active.document.isClosed) {
      this.lastEditor = active
      return active
    }
    const remembered = this.lastEditor
    if (remembered && !remembered.document.isClosed) return remembered
    return undefined
  }

  /** Focus the panel, and report rather than swallow a failure to do so. */
  private async revealPanel(): Promise<void> {
    try {
      await vscode.commands.executeCommand('dsh.chat.focus')
    } catch (error) {
      this.log(`focus failed: ${messageOf(error)}`)
      void vscode.window.showWarningMessage('DeepSeek Harness：无法打开面板，请在活动栏手动打开后重试。')
    }
  }

  /** Show pending code references in the status bar so the shortcut has visible feedback. */
  private syncStatus(): void {
    const count = this.contexts.length
    if (count === 0) {
      this.statusItem.hide()
      return
    }
    this.statusItem.text = `$(comment-discussion) DSH 已引用 ${count} 段`
    this.statusItem.tooltip = `${this.contexts.map((item) => `${item.relPath}:${item.startLine}-${item.endLine}`).join('\n')}\n点击打开对话面板`
    this.statusItem.show()
  }

  private toast(level: 'info' | 'error', message: string): void {
    this.post({ type: 'toast', level, message })
  }

  // ── webview plumbing ─────────────────────────────────────────────────────

  private snapshot(): UiState {
    return {
      ...this.state,
      items: this.projector.items,
      selection: this.selection,
      recentModels: this.recent.slice(),
      pinnedModels: this.pinned.slice(),
      contexts: this.contexts.slice(),
      workspace: workspaceRoot(),
    }
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message)
  }

  postState(): void {
    this.post({ type: 'state', state: this.snapshot() })
  }

  async onMessage(message: WebviewMessage): Promise<void> {
    switch (message?.type) {
      case 'ready':
        this.postState()
        break
      case 'prompt':
        await this.sendPrompt(message.text, message.requestId, message.images ?? [])
        break
      case 'cancel':
        await this.cancel()
        break
      case 'newSession':
        await this.newSession()
        break
      case 'selectSession':
        await this.openSession(message.sessionId)
        break
      case 'renameSession':
        await this.renameSession(message.sessionId)
        break
      case 'forkSession':
        await this.forkSession(message.sessionId)
        break
      case 'setModel':
        await this.setModel(message.selection)
        break
      case 'pinModel':
        await this.setPinned(message.selection, message.pinned)
        break
      case 'removeContext':
        this.removeContext(message.id)
        break
      case 'addSelection':
        await this.addSelectionFromEditor()
        break
      case 'refresh':
        await this.connect(true)
        break
      case 'loadOlder':
        await this.loadOlder()
        break
      case 'setFilter':
        this.state.filterWorkspace = !message.all
        await this.context.globalState.update(FILTER_KEY, this.state.filterWorkspace)
        this.postState()
        break
      case 'openFile':
        await openFileAt(message.path, message.line)
        break
      case 'launchDesktop':
        await this.launchDesktop()
        break
      case 'installBridge':
        await this.installBridge()
        break
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'dsh.')
        break
      case 'copyText':
        await vscode.env.clipboard.writeText(message.text)
        break
      case 'openExternal':
        try {
          await vscode.env.openExternal(vscode.Uri.parse(message.url))
        } catch (error) {
          this.toast('error', `无法打开链接：${messageOf(error)}`)
        }
        break
      default:
        break
    }
  }

  showSessions(): void {
    this.post({ type: 'showSessions' })
  }

  /** Small read-only surface for diagnostics and integration tests. */
  diagnostics(): {
    connection: UiState['connection']
    detail: string
    sessionId: string | null
    models: number
    sessions: number
    contexts: number
    items: number
    running: boolean
  } {
    return {
      connection: this.state.connection,
      detail: this.state.connectionDetail,
      sessionId: this.state.sessionId,
      models: this.state.models?.groups.reduce((total, group) => total + group.models.length, 0) ?? 0,
      sessions: this.state.sessions.length,
      contexts: this.contexts.length,
      items: this.projector.items.length,
      running: this.state.running,
    }
  }

  async pickModel(): Promise<void> {
    const catalog = this.state.models
    if (!catalog || catalog.groups.length === 0) {
      this.toast('error', '模型目录为空，请确认桌面版已配置可用模型')
      return
    }
    const picks = catalog.groups.flatMap((group) => group.models.map((model) => ({
      label: model.name,
      description: group.name,
      detail: model.id,
      selection: {
        provider: group.id,
        model: model.id,
        ...(model.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : {}),
      } as ModelSelection,
    })))
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: '选择模型（来自桌面版 DeepSeek Harness）',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (picked) await this.setModel(picked.selection)
  }

  /**
   * Install the bundled bridge plugin into the desktop app's profile so a fresh
   * machine works without cloning this repository.
   */
  async installBridge(): Promise<void> {
    const configured = vscode.workspace.getConfiguration('dsh').get<string>('desktopPath') || undefined
    const install = findDshInstall(configured)
    const tgz = findBundledBridge(this.context.extensionPath)
    if (!install) {
      void vscode.window.showErrorMessage(
        '未找到 DeepSeek Harness 桌面版安装目录。请先在设置 dsh.desktopPath 指向 DeepSeek Harness.exe。',
      )
      return
    }
    if (!tgz) {
      void vscode.window.showErrorMessage('这个扩展包内没有找到桥接插件，请重新安装扩展。')
      return
    }
    const home =
      vscode.workspace.getConfiguration('dsh').get<string>('home') || process.env.DSH_HOME || join(homedir(), '.dsh')
    const profile = vscode.workspace.getConfiguration('dsh').get<string>('profile') || 'desktop'
    const confirmed = await vscode.window.showWarningMessage(
      `将把桥接插件安装到 ${join(home, 'profiles', profile)}。安装完成后需要重启桌面版 DeepSeek Harness。继续？`,
      { modal: true },
      '安装',
    )
    if (confirmed !== '安装') return

    this.log(`installing bridge ${tgz} into ${home} (profile ${profile}) via ${install.cli}`)
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在安装 DeepSeek Harness 桥接插件…', cancellable: false },
        () =>
          new Promise<void>((resolve, reject) => {
            execFile(
              'cmd.exe',
              ['/c', `"${install.cli}" plugin --profile ${profile} add "${tgz}"`],
              {
                cwd: install.root,
                env: { ...process.env, DSH_HOME: home },
                windowsHide: true,
                timeout: 5 * 60_000,
                maxBuffer: 8 * 1024 * 1024,
              },
              (error, stdout, stderr) => {
                if (stdout) this.log(stdout.trim().slice(-2000))
                if (stderr) this.log(stderr.trim().slice(-2000))
                if (error) reject(error)
                else resolve()
              },
            )
          }),
      )
      const marker = join(home, 'profiles', profile, 'package.json')
      this.log(`bridge install finished; profile package.json present=${existsSync(marker)}`)
      const action = await vscode.window.showInformationMessage(
        '桥接插件已安装。请重启桌面版 DeepSeek Harness，然后点「刷新」重新连接。',
        '重启桌面版',
      )
      if (action === '重启桌面版') this.launchDesktopFromCommand()
    } catch (error) {
      this.log(`bridge install failed: ${messageOf(error)}`)
      void vscode.window.showErrorMessage(`桥接插件安装失败：${messageOf(error)}`)
    }
  }

  async launchDesktopFromCommand(): Promise<void> {
    await this.launchDesktop()
  }

  private async launchDesktop(): Promise<void> {
    const configured = vscode.workspace.getConfiguration('dsh').get<string>('desktopPath') ?? ''
    const candidates = [configured, 'D:\\dsh\\DeepSeek Harness.exe', `${process.env.LOCALAPPDATA ?? ''}\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe`]
      .filter((path) => path && path.length > 0)
    const executable = candidates.find((path) => existsSync(path))
    if (!executable) {
      this.toast('error', '找不到 DeepSeek Harness 可执行文件，请在设置里填写 dsh.desktopPath')
      return
    }
    try {
      const child = spawn(executable, [], { detached: true, stdio: 'ignore' })
      child.unref()
      this.toast('info', '正在启动 DeepSeek Harness…')
      setTimeout(() => void this.connect(true), 4000)
    } catch (error) {
      this.toast('error', `启动失败：${messageOf(error)}`)
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return null
  return folders[0].uri.fsPath
}

async function contextFromSelection(editor: vscode.TextEditor, range: vscode.Range): Promise<CodeContext> {
  const document = editor.document
  const maxLines = Math.max(20, vscode.workspace.getConfiguration('dsh').get<number>('maxContextLines') ?? 400)
  const startLine = range.start.line + 1
  const requestedEnd = range.end.line + 1
  const endLine = Math.min(requestedEnd, startLine + maxLines - 1)
  const start = new vscode.Position(startLine - 1, range.start.character)
  const end = endLine === requestedEnd
    ? range.end
    : new vscode.Position(endLine - 1, document.lineAt(endLine - 1).range.end.character)
  const text = document.getText(new vscode.Range(start, end))
  const relPath = vscode.workspace.asRelativePath(document.uri, false)
  return {
    id: randomUUID(),
    path: document.uri.fsPath,
    relPath,
    startLine,
    endLine,
    language: document.languageId,
    text,
    truncated: requestedEnd > endLine,
  }
}

function buildPrompt(text: string, contexts: CodeContext[]): string {
  if (contexts.length === 0) return text
  const format = vscode.workspace.getConfiguration('dsh').get<string>('contextFormat') ?? 'fenced'
  const blocks = contexts.map((context) => {
    const header = `\`${context.relPath}\` (L${context.startLine}-${context.endLine})${context.truncated ? ' · 已截断' : ''}`
    if (format === 'plain') {
      const indented = context.text.split('\n').map((line) => `    ${line}`).join('\n')
      return `${header}\n${indented}`
    }
    return `${header}\n\`\`\`${context.language}\n${context.text}\n\`\`\``
  })
  return `${text}\n\n---\n${blocks.join('\n\n')}\n`
}

function minSeq(items: readonly ChatItem[]): number {
  let min = Number.MAX_SAFE_INTEGER
  for (const item of items) {
    const match = /^[ua]:(\d+)$/u.exec(item.id)
    if (match) min = Math.min(min, Number(match[1]))
  }
  return min === Number.MAX_SAFE_INTEGER ? 0 : min
}

async function openFileAt(path: string, line?: number): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    const editor = await vscode.window.showTextDocument(document, { preview: true })
    if (typeof line === 'number' && line > 0) {
      const position = new vscode.Position(Math.max(0, line - 1), 0)
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`无法打开文件：${messageOf(error)}`)
  }
}

function messageOf(error: unknown): string {
  if (error instanceof BridgeHttpError) return `${error.message}（${error.code}）`
  if (error instanceof Error) return error.message
  return String(error)
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'))
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'))
  const nonce = randomUUID().replace(/-/gu, '')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${styleUri}" />
<title>DeepSeek Harness</title>
</head>
<body>
<div id="app" aria-live="polite"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
