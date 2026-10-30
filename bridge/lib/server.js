// Loopback HTTP + SSE surface over the harness Session Controller.
//
// Design notes
// ------------
// * Every route is a projection over services that already exist in the
//   Desktop host, so the extension sees exactly what the desktop UI sees.
// * The listener binds 127.0.0.1 only and requires a per-process random token.
//   The token and port are published in `$DSH_HOME/vscode-panel/bridge.json`
//   (owner-only file), which is the only handshake the extension performs.
// * Streaming is plain SSE: a `fetch()` body in Node is enough to consume it,
//   no WebSocket handshake, no third-party dependency.
// * One SSE connection == one `sessionController.follow()` iterator. When the
//   client goes away the abort signal tears the iterator down.

import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const MAX_BODY_BYTES = 4 * 1024 * 1024
const SNAPSHOT_MESSAGES = 80
const HEARTBEAT_MS = 15_000
const NOT_FOUND_RETRY_MS = 400
const NOT_FOUND_RETRY_LIMIT = 40

/**
 * Start the bridge.
 * @param {any} ctx - host context carrying `sessionController`.
 * @param {{ host?: string, port?: number, discoveryFile?: string, logger?: (m: string, e?: unknown) => void }} [options]
 * @returns {{ ready: Promise<void>, port: number, token: string, discoveryFile: string, dispose: () => void }}
 */
export function startBridge(ctx, options = {}) {
  const log = options.logger ?? (() => {})
  const bindHost = options.host ?? '127.0.0.1'
  const token = randomBytes(32).toString('hex')
  const startedAt = Date.now()
  const dshHome = resolveDshHome()
  const discoveryFile = options.discoveryFile ?? join(dshHome, 'vscode-panel', 'bridge.json')

  /** @type {Set<import('node:http').ServerResponse>} */
  const globalStreams = new Set()
  let disposed = false
  let boundPort = 0

  const controller = () => {
    const service = ctx.sessionController
    if (service === undefined) throw bridgeError(503, 'session-controller-unavailable', 'Session Controller is not mounted in this host')
    return service
  }

  /** @type {import('node:http').Server} */
  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (response.headersSent) {
        try { response.end() } catch { /* client already gone */ }
        return
      }
      const status = Number.isInteger(error?.status) ? error.status : 500
      sendJson(response, status, { error: { code: error?.code ?? 'internal', message: messageOf(error) } })
    })
  })

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, bindHost, () => {
      boundPort = /** @type {import('node:net').AddressInfo} */ (server.address()).port
      try {
        publishDiscovery()
      } catch (error) {
        log('cannot publish discovery file', error)
      }
      resolve()
    })
  })

  // ── discovery ────────────────────────────────────────────────────────────

  function publishDiscovery() {
    const profile = ctx.get?.('profileContext')?.name ?? null
    const payload = {
      version: 1,
      kind: 'dsh-vscode-panel-bridge',
      port: boundPort,
      token,
      pid: process.pid,
      startedAt,
      dshHome,
      profile,
      appVersion: process.env.DSH_CLIENT_VERSION ?? null,
    }
    mkdirSync(dirname(discoveryFile), { recursive: true })
    const body = `${JSON.stringify(payload, null, 2)}\n`
    writeFileSync(discoveryFile, body, { mode: 0o600 })
    // A per-profile copy lets the client prefer the Desktop host when a second
    // host (for example `dsh web`) shares the same DSH_HOME.
    if (profile !== null) writeFileSync(profileDiscoveryFile(discoveryFile, profile), body, { mode: 0o600 })
  }

  // ── routing ──────────────────────────────────────────────────────────────

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = request.method ?? 'GET'

    // Cheap liveness probe; leaks nothing beyond build identity.
    if (path === '/v1/health' && method === 'GET') {
      sendJson(response, 200, {
        ok: true,
        name: 'dsh-vscode-panel-bridge',
        pid: process.pid,
        startedAt,
        port: boundPort,
        profile: ctx.get?.('profileContext')?.name ?? null,
        appVersion: process.env.DSH_CLIENT_VERSION ?? null,
      })
      return
    }

    if (!isAuthorized(request, url)) {
      sendJson(response, 401, { error: { code: 'unauthorized', message: 'missing or invalid bridge token' } })
      return
    }

    if (path === '/v1/models' && method === 'GET') {
      const catalog = await controller().modelCatalog()
      sendJson(response, 200, catalog)
      return
    }

    if (path === '/v1/sessions' && method === 'GET') {
      const items = await listSessions()
      sendJson(response, 200, { items })
      return
    }

    if (path === '/v1/sessions' && method === 'POST') {
      const body = await readJson(request)
      const created = await controller().create({
        ...(typeof body.cwd === 'string' && body.cwd.length > 0 ? { cwd: body.cwd } : {}),
        ...(typeof body.agentPreset === 'string' && body.agentPreset.length > 0 ? { agentPreset: body.agentPreset } : {}),
        ...(typeof body.sessionId === 'string' && body.sessionId.length > 0 ? { sessionId: body.sessionId } : {}),
      })
      sendJson(response, 200, created)
      return
    }

    const sessionMatch = /^\/v1\/sessions\/([^/]+)\/(events|history)$/u.exec(path)
    if (sessionMatch !== null) {
      const sessionId = decodeURIComponent(sessionMatch[1])
      if (sessionMatch[2] === 'events' && method === 'GET') {
        openSessionStream(request, response, sessionId)
        return
      }
      if (sessionMatch[2] === 'history' && method === 'GET') {
        const throughSeq = Number(url.searchParams.get('throughSeq'))
        if (!Number.isFinite(throughSeq)) {
          throw bridgeError(400, 'bad-request', 'throughSeq (the follow cursor) is required to page history')
        }
        const beforeRaw = url.searchParams.get('beforeSeq')
        const page = await controller().page({
          address: { kind: 'session', sessionId },
          throughSeq,
          ...(beforeRaw === null ? {} : { beforeSeq: Number(beforeRaw) }),
          maxMessages: clampInt(url.searchParams.get('maxMessages'), 20, 200, 60),
        }, AbortSignal.timeout(20_000))
        sendJson(response, 200, page)
        return
      }
    }

    if (path === '/v1/prompt' && method === 'POST') {
      const body = await readJson(request)
      const sessionId = requireString(body.sessionId, 'sessionId')
      const text = typeof body.text === 'string' ? body.text : ''
      const images = Array.isArray(body.images) ? body.images : []
      if (text.trim().length === 0 && images.length === 0) {
        throw bridgeError(400, 'bad-request', 'prompt content must include text or an image')
      }
      const content = []
      if (text.trim().length > 0) content.push({ type: 'text', text })
      for (const image of images) {
        const mediaType = requireString(image?.mediaType, 'images[].mediaType')
        const data = requireString(image?.data, 'images[].data')
        content.push({
          type: 'image',
          mediaType,
          data,
          ...(typeof image?.name === 'string' && image.name.length > 0 ? { name: image.name } : {}),
        })
      }
      const requestId = typeof body.requestId === 'string' && body.requestId.length > 0 ? body.requestId : `vsc-${randomBytes(8).toString('hex')}`
      const accepted = await controller().prompt({
        sessionId,
        requestId,
        mode: body.mode === 'steer' ? 'steer' : 'queue',
        content,
        clientTimeZone: timeZone(),
      }, AbortSignal.timeout(120_000))
      sendJson(response, 200, { ...accepted, requestId })
      return
    }

    if (path === '/v1/rename' && method === 'POST') {
      const body = await readJson(request)
      const sessionId = requireString(body.sessionId, 'sessionId')
      const title = requireString(body.title, 'title')
      const value = await controller().rename({ sessionId, title })
      sendJson(response, 200, value)
      return
    }

    if (path === '/v1/fork' && method === 'POST') {
      const body = await readJson(request)
      const sessionId = requireString(body.sessionId, 'sessionId')
      const value = await controller().fork({
        sessionId,
        ...(Number.isFinite(Number(body.atSeq)) ? { atSeq: Number(body.atSeq) } : {}),
      })
      sendJson(response, 200, value)
      return
    }

    if (path === '/v1/cancel' && method === 'POST') {
      const body = await readJson(request)
      const sessionId = requireString(body.sessionId, 'sessionId')
      const value = await controller().cancel({ sessionId })
      sendJson(response, 200, value)
      return
    }

    if (path === '/v1/model' && method === 'POST') {
      const body = await readJson(request)
      const sessionId = requireString(body.sessionId, 'sessionId')
      const provider = requireString(body.provider, 'provider')
      const model = requireString(body.model, 'model')
      const value = await controller().selectModel({
        sessionId,
        provider,
        model,
        ...(typeof body.reasoningEffort === 'string' && body.reasoningEffort.length > 0 ? { reasoningEffort: body.reasoningEffort } : {}),
      })
      sendJson(response, 200, value)
      return
    }

    if (path === '/v1/attachment' && method === 'GET') {
      const sessionId = requireString(url.searchParams.get('sessionId'), 'sessionId')
      const attachmentId = requireString(url.searchParams.get('attachmentId'), 'attachmentId')
      const value = await controller().attachment({ sessionId, attachmentId })
      sendJson(response, 200, value)
      return
    }

    if (path === '/v1/events' && method === 'GET') {
      openGlobalStream(request, response)
      return
    }

    sendJson(response, 404, { error: { code: 'not-found', message: `no route for ${method} ${path}` } })
  }

  function isAuthorized(request, url) {
    const header = request.headers['x-dsh-bridge-token']
    const bearer = request.headers.authorization
    const query = url.searchParams.get('token')
    return header === token
      || (typeof bearer === 'string' && bearer === `Bearer ${token}`)
      || query === token
  }

  // ── session listing ──────────────────────────────────────────────────────

  async function listSessions() {
    const value = await controller().list({}, AbortSignal.timeout(30_000))
    return value.items.map(summarize)
  }

  function summarize(summary) {
    const values = summary.projections?.values ?? {}
    const model = values.modelSelection?.next ?? values.modelSelection?.lastUsed ?? null
    return {
      id: summary.sessionId,
      title: pickTitle(values),
      updatedAt: summary.updatedAt,
      running: summary.running === true,
      blank: summary.blank === true,
      cwd: summary.cwd ?? null,
      parentId: summary.parentSessionId ?? null,
      origin: summary.origin ?? null,
      agentAvailable: summary.agentAvailable === true,
      model: model === null ? null : { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort ?? null },
      lastPromptAt: values.sessionListMetadata?.lastPromptAt ?? null,
    }
  }

  // ── streaming ────────────────────────────────────────────────────────────

  function openSessionStream(request, response, sessionId) {
    const abort = new AbortController()
    let closed = false
    let heartbeat

    const send = (payload) => {
      if (closed) return
      try {
        response.write(`data: ${JSON.stringify(payload)}\n\n`)
      } catch {
        close()
      }
    }

    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      abort.abort()
      try { response.end() } catch { /* already closed */ }
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write('retry: 1000\n\n')
    heartbeat = setInterval(() => {
      if (!closed) {
        try { response.write(': ping\n\n') } catch { close() }
      }
    }, HEARTBEAT_MS)
    request.on('close', close)
    response.on('close', close)

    void (async () => {
      const service = ctx.sessionController
      if (service === undefined) {
        send({ kind: 'error', code: 'session-controller-unavailable', message: 'Session Controller is not mounted in this host' })
        close()
        return
      }
      let notFoundAttempts = 0
      while (!closed) {
        try {
          const frames = service.follow({
            address: { kind: 'session', sessionId },
            assistantStream: true,
            maxMessages: SNAPSHOT_MESSAGES,
          }, abort.signal)
          for await (const frame of frames) {
            if (closed) break
            if (frame.type === 'snapshot') {
              notFoundAttempts = 0
              send({
                kind: 'snapshot',
                sessionId,
                cursor: frame.cursor,
                header: frame.header,
                records: frame.records,
                hasMore: frame.hasMore,
                projections: frame.projections,
                assistantStream: frame.assistantStream ?? null,
              })
            } else if (frame.type === 'event') {
              send({ kind: 'event', event: frame.event })
            } else if (frame.type === 'assistant-stream') {
              send({ kind: 'assistant', frame: frame.frame })
            }
          }
          break
        } catch (error) {
          if (closed) break
          // A brand-new Session has no log until its first prompt lands; wait
          // for it instead of failing the panel.
          if (codeOf(error) === 'session/not-found' && notFoundAttempts < NOT_FOUND_RETRY_LIMIT) {
            notFoundAttempts += 1
            await delay(NOT_FOUND_RETRY_MS)
            continue
          }
          send({ kind: 'error', code: codeOf(error) ?? 'follow-failed', message: messageOf(error) })
          break
        }
      }
      close()
    })()
  }

  function openGlobalStream(request, response) {
    let closed = false
    let heartbeat
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write('retry: 1000\n\n')
    globalStreams.add(response)
    heartbeat = setInterval(() => {
      if (!closed) {
        try { response.write(': ping\n\n') } catch { /* handled by close */ }
      }
    }, HEARTBEAT_MS)
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      globalStreams.delete(response)
      try { response.end() } catch { /* already closed */ }
    }
    request.on('close', close)
    response.on('close', close)
  }

  function broadcast(payload) {
    const line = `data: ${JSON.stringify(payload)}\n\n`
    for (const stream of globalStreams) {
      try { stream.write(line) } catch { globalStreams.delete(stream) }
    }
  }

  const unsubscribe = [
    ['api-session/added', (summary) => broadcast({ kind: 'session-added', session: summarize(summary) })],
    ['api-session/removed', (sessionId) => broadcast({ kind: 'session-removed', sessionId })],
    ['api-session/status', (sessionId, running) => broadcast({ kind: 'session-status', sessionId, running })],
    ['api-session/activity', (sessionId, updatedAt) => broadcast({ kind: 'session-activity', sessionId, updatedAt })],
    ['api-session/error', (sessionId, message) => broadcast({ kind: 'session-error', sessionId, message })],
  ].map(([event, listener]) => ctx.on(event, listener))

  // ── teardown ─────────────────────────────────────────────────────────────

  function dispose() {
    if (disposed) return
    disposed = true
    for (const off of unsubscribe) {
      try { off?.() } catch { /* cordis disposers are idempotent */ }
    }
    for (const stream of globalStreams) {
      try { stream.end() } catch { /* ignore */ }
    }
    globalStreams.clear()
    try { server.close() } catch { /* ignore */ }
    // Only remove files this instance still owns: another host sharing DSH_HOME
    // may have overwritten them, and deleting its file would strand the client.
    removeIfOurs(discoveryFile)
    const profile = ctx.get?.('profileContext')?.name
    if (typeof profile === 'string' && profile.length > 0) {
      removeIfOurs(profileDiscoveryFile(discoveryFile, profile))
    }
  }

  function removeIfOurs(file) {
    try {
      const info = JSON.parse(readFileSync(file, 'utf8'))
      if (info?.token !== token) return
      rmSync(file, { force: true })
    } catch {
      // Missing or unreadable: nothing to clean up.
    }
  }

  return { ready, token, discoveryFile, get port() { return boundPort }, dispose }
}

// ── helpers ────────────────────────────────────────────────────────────────

function profileDiscoveryFile(baseFile, profile) {
  return join(dirname(baseFile), `bridge.${profile}.json`)
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.length > 0) return configured
  return join(homedir(), '.dsh')
}

function pickTitle(values) {
  const title = values?.title
  if (typeof title === 'string') return title
  if (typeof title?.title === 'string') return title.title
  return ''
}

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampInt(raw, min, max, fallback) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw bridgeError(400, 'bad-request', `${name} must be a non-empty string`)
  }
  return value
}

function bridgeError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function codeOf(error) {
  return typeof error?.code === 'string' ? error.code : undefined
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw bridgeError(413, 'payload-too-large', 'request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw bridgeError(400, 'bad-request', 'request body must be JSON')
  }
}
