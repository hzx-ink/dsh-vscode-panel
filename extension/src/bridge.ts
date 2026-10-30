import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface BridgeInfo {
  version?: number
  kind?: string
  port: number
  token: string
  pid?: number
  profile?: string | null
  appVersion?: string | null
  dshHome?: string
  startedAt?: number
}

export interface BridgeLocation {
  baseUrl: string
  token: string
  info: BridgeInfo
  file: string
}

export class BridgeUnavailableError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
    this.name = 'BridgeUnavailableError'
  }
}

export class BridgeHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'BridgeHttpError'
  }
}

export function resolveDshHome(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim()
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

export function defaultBridgeFile(home: string): string {
  return join(home, 'vscode-panel', 'bridge.json')
}

/**
 * Minimal client for the loopback bridge published by the DSH host plugin.
 * Discovery is a file read plus a health probe, so a stale file (host closed)
 * is reported as "unavailable" instead of producing confusing socket errors.
 */
export class BridgeClient {
  readonly file: string

  constructor(home?: string, bridgeFile?: string) {
    const resolvedHome = resolveDshHome(home)
    this.file = bridgeFile && bridgeFile.trim().length > 0 ? bridgeFile.trim() : defaultBridgeFile(resolvedHome)
  }

  async discover(): Promise<BridgeLocation> {
    // Prefer the Desktop host's own file: `dsh web` shares the same DSH_HOME and
    // would otherwise win the generic file by writing it last.
    const candidates = [join(dirname(this.file), 'bridge.desktop.json'), this.file]
    let failure: unknown
    for (const file of candidates) {
      try {
        return await this.readLocation(file)
      } catch (error) {
        failure = error
      }
    }
    throw failure instanceof Error ? failure : new BridgeUnavailableError('未找到桥接文件', this.file)
  }

  private async readLocation(file: string): Promise<BridgeLocation> {
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch {
      throw new BridgeUnavailableError('未找到桥接文件', file)
    }

    let info: BridgeInfo
    try {
      info = JSON.parse(raw) as BridgeInfo
    } catch {
      throw new BridgeUnavailableError('桥接文件不是有效的 JSON', file)
    }

    if (info.kind !== undefined && info.kind !== 'dsh-vscode-panel-bridge') {
      throw new BridgeUnavailableError('桥接文件不属于本扩展', file)
    }
    if (!Number.isInteger(info.port) || info.port <= 0 || info.port > 65535 || typeof info.token !== 'string') {
      throw new BridgeUnavailableError('桥接文件缺少端口或令牌', file)
    }

    const location: BridgeLocation = {
      baseUrl: `http://127.0.0.1:${info.port}/v1`,
      token: info.token,
      info,
      file,
    }

    try {
      await this.get<{ ok: boolean }>(location, '/health', 2500)
    } catch (error) {
      throw new BridgeUnavailableError('桌面版 DeepSeek Harness 未响应', error instanceof Error ? error.message : String(error))
    }

    return location
  }

  async get<T>(location: BridgeLocation, path: string, timeoutMs = 30_000): Promise<T> {
    return this.request<T>(location, path, { method: 'GET' }, timeoutMs)
  }

  async post<T>(location: BridgeLocation, path: string, body: unknown, timeoutMs = 120_000): Promise<T> {
    return this.request<T>(location, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }, timeoutMs)
  }

  private async request<T>(location: BridgeLocation, path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${location.baseUrl}${path}`, {
        ...init,
        headers: { 'x-dsh-bridge-token': location.token, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new BridgeUnavailableError('无法连接桌面版 DeepSeek Harness', error instanceof Error ? error.message : String(error))
    }

    const text = await response.text()
    if (!response.ok) {
      let code = `http-${response.status}`
      let message = text || response.statusText
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
        if (parsed.error?.code) code = parsed.error.code
        if (parsed.error?.message) message = parsed.error.message
      } catch {
        // Non-JSON error body: keep the raw text.
      }
      throw new BridgeHttpError(response.status, code, message)
    }

    if (text.length === 0) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new BridgeHttpError(response.status, 'bad-json', '桥接返回了无法解析的内容')
    }
  }

  /**
   * Open an SSE endpoint. Returns a disposer; callbacks are never invoked after
   * the disposer runs.
   */
  openStream(
    location: BridgeLocation,
    path: string,
    onData: (payload: any) => void,
    onError: (error: Error) => void,
    onOpen?: () => void,
  ): () => void {
    const abort = new AbortController()
    let closed = false

    const close = () => {
      if (closed) return
      closed = true
      abort.abort()
    }

    void (async () => {
      try {
        const response = await fetch(`${location.baseUrl}${path}`, {
          headers: { 'x-dsh-bridge-token': location.token, accept: 'text/event-stream' },
          signal: abort.signal,
        })
        if (!response.ok || response.body === null) {
          throw new BridgeHttpError(response.status, `http-${response.status}`, `事件流返回 ${response.status}`)
        }
        onOpen?.()

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            for (const line of block.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                onData(JSON.parse(line.slice(6)))
              } catch {
                // Ignore malformed frames rather than tearing down the stream.
              }
            }
            boundary = buffer.indexOf('\n\n')
          }
        }

        if (!closed) onError(new Error('事件流已结束'))
      } catch (error) {
        if (!closed) {
          onError(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })()

    return close
  }
}
