import type { ChatImage, ChatItem, LiveReply, TokenUsageView } from './protocol'

/**
 * Folds the harness Session log into the flat chat transcript the webview
 * renders. Pure with respect to the wire: the controller decides what to post.
 */

export type ProjectionOp =
  | { kind: 'append'; item: ChatItem }
  | { kind: 'update'; item: ChatItem }
  | { kind: 'replace'; fromId: string; item: ChatItem }
  | { kind: 'live'; live: LiveReply | null }
  | { kind: 'running'; running: boolean }
  | { kind: 'title'; title: string }

interface LiveAttempt {
  id: string
  turn: number
  step: number
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

function reasoningOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'reasoning') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

function timeOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function idOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function imagesOf(content: unknown): ChatImage[] {
  if (!Array.isArray(content)) return []
  const images: ChatImage[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || (block as { type?: string }).type !== 'image') continue
    const ref = (block as { attachment?: any }).attachment
    if (!ref || typeof ref.attachmentId !== 'string') continue
    images.push({
      id: ref.attachmentId,
      name: typeof ref.name === 'string' && ref.name.length > 0 ? ref.name : '图片',
      mediaType: typeof ref.mediaType === 'string' ? ref.mediaType : 'image/png',
      data: '',
    })
  }
  return images
}

function usageOf(raw: any): TokenUsageView | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = Number(raw.inputTokens)
  const output = Number(raw.outputTokens)
  if (!Number.isFinite(input) && !Number.isFinite(output)) return undefined
  const total = Number(raw.totalTokens)
  const cacheRead = Number(raw.cacheReadTokens)
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    ...(Number.isFinite(total) ? { total } : {}),
    ...(Number.isFinite(cacheRead) ? { cacheRead } : {}),
  }
}

/** Build transcript items from a contiguous run of wire records. */
export function recordsToItems(records: readonly any[]): ChatItem[] {
  const items: ChatItem[] = []
  const toolIndex = new Map<string, number>()

  for (const record of records) {
    const event = record?.type === 'event' ? record.event : record
    if (!event || typeof event.type !== 'string') continue
    const seq = typeof event.seq === 'number' ? event.seq : 0
    const time = timeOf(event.time, Date.now())

    switch (event.type) {
      case 'user/message': {
        // `user/message` carries the message itself as its data payload.
        const message = event.data?.message ?? event.data
        if (message?.source?.kind !== 'user') break
        const text = textOf(message.content)
        if (text.trim().length === 0) break
        const images = imagesOf(message.content)
        items.push({ id: `u:${seq}`, kind: 'user', time, text, contexts: [], ...(images.length > 0 ? { images } : {}) })
        break
      }
      case 'assistant/message': {
        const message = event.data?.message
        const text = textOf(message?.content)
        const reasoning = reasoningOf(message?.content)
        if (text.trim().length === 0 && reasoning.trim().length === 0) break
        items.push({
          id: `a:${seq}`,
          kind: 'assistant',
          time,
          text,
          reasoning,
          model: idOf(message?.source?.model),
          interrupted: event.data?.interrupted === true,
          ...(usageOf(event.data?.usage) ? { usage: usageOf(event.data?.usage) } : {}),
        })
        break
      }
      case 'tool/call': {
        const callId = idOf(event.data?.callId)
        if (callId.length === 0) break
        const item: ChatItem = {
          id: `t:${callId}`,
          kind: 'tool',
          time,
          name: idOf(event.data?.name) || 'tool',
          args: typeof event.data?.arguments === 'string' ? event.data.arguments : '',
          result: '',
          status: 'running',
        }
        toolIndex.set(callId, items.length)
        items.push(item)
        break
      }
      case 'tool/result': {
        const callId = idOf(event.data?.message?.toolCallId) || idOf(event.data?.callId)
        const index = toolIndex.get(callId)
        if (index === undefined) break
        const item = items[index]
        if (item.kind !== 'tool') break
        const result = textOf(event.data?.message?.content)
        const failed = event.data?.message?.isError === true
        items[index] = {
          ...item,
          result,
          status: failed ? 'error' : 'ok',
        }
        break
      }
      default:
        break
    }
  }

  return items
}

export class SessionProjector {
  items: ChatItem[] = []
  live: LiveReply | null = null
  cursor = 0
  hasMore = false
  title = ''
  running = false

  private toolIndex = new Map<string, number>()
  private attempt: LiveAttempt | null = null
  private readonly failedSteps = new Set<string>()

  reset(): void {
    this.items = []
    this.live = null
    this.cursor = 0
    this.hasMore = false
    this.title = ''
    this.running = false
    this.toolIndex.clear()
    this.attempt = null
    this.failedSteps.clear()
  }

  /** Apply the follow-stream opening frame. */
  hydrate(payload: any): void {
    const records = Array.isArray(payload?.records) ? payload.records : []

    // Local echoes are written before the opening snapshot arrives. Keep the
    // ones the snapshot does not already contain — a prompt admitted before the
    // snapshot is already durable there, and keeping its echo would duplicate
    // the bubble forever (no later event would replace it).
    const durableRpcIds = new Set<string>()
    for (const record of records) {
      const event = record?.type === 'event' ? record.event : record
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
        const rpcId = event.data.source.rpcId
        if (typeof rpcId === 'string') durableRpcIds.add(rpcId)
      }
    }
    const optimistic = this.items.filter(
      (item) => item.id.startsWith('local:') && !durableRpcIds.has(item.id.slice('local:'.length)),
    )

    this.reset()
    this.cursor = typeof payload?.cursor === 'number' ? payload.cursor : 0
    this.hasMore = payload?.hasMore === true
    this.items = [...recordsToItems(records), ...optimistic]
    this.reindexTools()

    const values = payload?.projections?.values ?? {}
    const title = values?.title
    this.title = typeof title === 'string' ? title : typeof title?.title === 'string' ? title.title : ''
    for (const record of records) {
      const event = record?.type === 'event' ? record.event : record
      if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.length > 0) {
        this.title = event.data.title
      }
    }

    const baseline = payload?.assistantStream?.activeAttempt
    if (baseline && typeof baseline === 'object') {
      const attemptId = idOf(baseline.attemptId)
      this.attempt = { id: attemptId, turn: Number(baseline.turn) || 0, step: Number(baseline.step) || 0 }
      let text = ''
      let reasoning = ''
      for (const member of Array.isArray(baseline.stream) ? baseline.stream : []) {
        const chunk = member?.chunk
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') reasoning += chunk.text
      }
      this.live = { text, reasoning, turn: this.attempt.turn, step: this.attempt.step }
    }
  }

  /** Fold one durable Session event. */
  applyEvent(event: any): ProjectionOp[] {
    const ops: ProjectionOp[] = []
    if (!event || typeof event.type !== 'string') return ops
    const seq = typeof event.seq === 'number' ? event.seq : 0
    const time = timeOf(event.time, Date.now())
    this.cursor = Math.max(this.cursor, seq)

    switch (event.type) {
      case 'user/message': {
        // `user/message` carries the message itself as its data payload.
        const message = event.data?.message ?? event.data
        if (message?.source?.kind !== 'user') break
        const text = textOf(message.content)
        if (text.trim().length === 0) break
        const rpcId = idOf(message.source?.rpcId)
        const optimistic = rpcId.length > 0
          ? this.items.findIndex((item) => item.kind === 'user' && item.id === `local:${rpcId}`)
          : -1
        if (optimistic >= 0) {
          const previous = this.items[optimistic]
          const previousId = previous.id
          const item: ChatItem = {
            id: `u:${seq}`,
            kind: 'user',
            time,
            text: previous.kind === 'user' ? previous.text : text,
            contexts: previous.kind === 'user' ? previous.contexts : [],
            ...(previous.kind === 'user' && previous.images ? { images: previous.images } : {}),
          }
          this.items[optimistic] = item
          // The id changes from the local echo to the durable seq, so the view
          // must replace by the *old* id instead of appending a second bubble.
          ops.push({ kind: 'replace', fromId: previousId, item })
        } else {
          const images = imagesOf(message.content)
          const item: ChatItem = { id: `u:${seq}`, kind: 'user', time, text, contexts: [], ...(images.length > 0 ? { images } : {}) }
          this.items.push(item)
          ops.push({ kind: 'append', item })
        }
        this.running = true
        ops.push({ kind: 'running', running: true })
        break
      }

      case 'assistant/message': {
        const message = event.data?.message
        const text = textOf(message?.content)
        const reasoning = reasoningOf(message?.content)
        this.clearLiveForStep(event.data?.turn, event.data?.step, ops)
        if (text.trim().length === 0 && reasoning.trim().length === 0) break
        const item: ChatItem = {
          id: `a:${seq}`,
          kind: 'assistant',
          time,
          text,
          reasoning,
          model: idOf(message?.source?.model),
          interrupted: event.data?.interrupted === true,
          ...(usageOf(event.data?.usage) ? { usage: usageOf(event.data?.usage) } : {}),
        }
        this.items.push(item)
        ops.push({ kind: 'append', item })
        break
      }

      case 'assistant/attempt': {
        // A failed/aborted attempt is retried; surface one notice per step so a
        // silent retry loop does not look like the agent is stuck.
        const stream = Array.isArray(event.data?.stream) ? event.data.stream : []
        let reason: any
        for (let index = stream.length - 1; index >= 0; index -= 1) {
          const chunk = stream[index]?.chunk
          if (chunk?.type === 'finish' && chunk.reason !== undefined) {
            reason = chunk.reason
            break
          }
        }
        const kind = reason?.kind
        if (kind === 'error' || kind === 'aborted') {
          const key = `${String(event.data?.turn)}:${String(event.data?.step)}`
          if (!this.failedSteps.has(key)) {
            this.failedSteps.add(key)
            const detail = reason?.failure?.message ?? reason?.error?.message ?? (kind === 'aborted' ? '已中止' : '模型调用失败')
            const item: ChatItem = {
              id: `n:${seq}`,
              kind: 'notice',
              time,
              text: `一次尝试失败，已自动重试：${detail}`,
            }
            this.items.push(item)
            ops.push({ kind: 'append', item })
          }
        }
        break
      }

      case 'tool/call': {
        const callId = idOf(event.data?.callId)
        if (callId.length === 0) break
        const item: ChatItem = {
          id: `t:${callId}`,
          kind: 'tool',
          time,
          name: idOf(event.data?.name) || 'tool',
          args: typeof event.data?.arguments === 'string' ? event.data.arguments : '',
          result: '',
          status: 'running',
        }
        this.toolIndex.set(callId, this.items.length)
        this.items.push(item)
        ops.push({ kind: 'append', item })
        break
      }

      case 'tool/result': {
        const callId = idOf(event.data?.message?.toolCallId) || idOf(event.data?.callId)
        const index = this.toolIndex.get(callId)
        if (index === undefined) break
        const previous = this.items[index]
        if (previous?.kind !== 'tool') break
        const item: ChatItem = {
          ...previous,
          result: textOf(event.data?.message?.content),
          status: event.data?.message?.isError === true ? 'error' : 'ok',
        }
        this.items[index] = item
        ops.push({ kind: 'update', item })
        break
      }

      case 'turn/end': {
        this.running = false
        ops.push({ kind: 'running', running: false })
        this.attempt = null
        if (this.live !== null) {
          this.live = null
          ops.push({ kind: 'live', live: null })
        }
        const reason = event.data?.reason
        const kind = typeof reason === 'string' ? reason : reason?.kind
        if (typeof kind === 'string' && kind !== 'completed') {
          const item: ChatItem = {
            id: `n:${seq}`,
            kind: 'notice',
            time,
            text: kind === 'aborted' ? '本轮已中断' : `本轮结束：${kind}`,
          }
          this.items.push(item)
          ops.push({ kind: 'append', item })
        }
        break
      }

      case 'step/end': {
        this.clearLiveForStep(event.data?.turn, event.data?.step, ops)
        break
      }

      case 'session/title': {
        const title = event.data?.title
        if (typeof title === 'string' && title.length > 0 && title !== this.title) {
          this.title = title
          ops.push({ kind: 'title', title })
        }
        break
      }

      default:
        break
    }

    return ops
  }

  /** Fold one transient assistant stream frame (token deltas). */
  applyAssistantFrame(frame: any): ProjectionOp[] {
    if (!frame || typeof frame !== 'object') return []

    if (frame.type === 'start') {
      this.attempt = {
        id: idOf(frame.attemptId),
        turn: Number(frame.turn) || 0,
        step: Number(frame.step) || 0,
      }
      this.live = { text: '', reasoning: '', turn: this.attempt.turn, step: this.attempt.step }
      return [{ kind: 'live', live: this.live }]
    }

    if (frame.type === 'chunk') {
      if (this.live === null || this.attempt === null || frame.attemptId !== this.attempt.id) return []
      const chunk = frame.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        this.live = { ...this.live, text: this.live.text + chunk.text }
        return [{ kind: 'live', live: this.live }]
      }
      if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        this.live = { ...this.live, reasoning: this.live.reasoning + chunk.text }
        return [{ kind: 'live', live: this.live }]
      }
      return []
    }

    if (frame.type === 'end') {
      this.attempt = null
      if (this.live === null) return []
      this.live = null
      return [{ kind: 'live', live: null }]
    }

    return []
  }

  private clearLiveForStep(turn: unknown, step: unknown, ops: ProjectionOp[]): void {
    if (this.attempt === null || this.live === null) return
    if (Number(turn) !== this.attempt.turn || Number(step) !== this.attempt.step) return
    this.attempt = null
    this.live = null
    ops.push({ kind: 'live', live: null })
  }

  /**
   * Bound the transcript for very long sessions: drop the oldest items and mark
   * the window as truncated so "load older" can page them back in.
   * @param maxItems - maximum retained items.
   * @returns how many leading items were dropped.
   */
  trim(maxItems: number): number {
    if (this.items.length <= maxItems) return 0
    const dropped = this.items.length - maxItems
    this.items.splice(0, dropped)
    this.reindexTools()
    this.hasMore = true
    return dropped
  }

  private reindexTools(): void {
    this.toolIndex.clear()
    this.items.forEach((item, index) => {
      if (item.kind === 'tool') this.toolIndex.set(item.id.slice(2), index)
    })
  }
}
