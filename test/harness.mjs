// Headless end-to-end harness: boots the real extension host code against a
// stubbed VS Code API and the live DSH bridge.
//
//   node test/harness.mjs [--home <dshHome>] [--timeout 120000]

import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

process.env.DSH_HOME = argOf('home', join(root, '.test-home'))
const timeout = Number(argOf('timeout', '150000'))

const vscode = require(join(here, 'vscode-stub.cjs'))
vscode.__setWorkspaceFolder(root)

const extension = require(join(root, '.tmp', 'extension-harness.cjs'))

const messages = []
const handlers = []
const globalState = new Map()
const workspaceState = new Map()

const context = {
  subscriptions: [],
  extensionUri: vscode.Uri.file(join(root, 'extension')),
  extension: { packageJSON: { version: '0.1.0' } },
  globalState: {
    get: (key) => globalState.get(key),
    update: async (key, value) => {
      globalState.set(key, value)
    },
  },
  workspaceState: {
    get: (key) => workspaceState.get(key),
    update: async (key, value) => {
      workspaceState.set(key, value)
    },
  },
}

const fail = (message) => {
  console.error(`FAIL: ${message}`)
  const toasts = messages.filter((m) => m.type === 'toast')
  if (toasts.length > 0) {
    console.error('toasts:')
    for (const toast of toasts) console.error(`  [${toast.level}] ${toast.message}`)
  }
  const channels = vscode.__state.outputChannels
  if (channels) {
    for (const [name, lines] of channels) {
      console.error(`output channel ${name}:`)
      for (const line of lines.slice(-20)) console.error(`  ${line}`)
    }
  }
  const recent = messages.slice(-8).map((m) => m.type)
  console.error(`recent messages: ${recent.join(', ')}`)
  process.exit(1)
}

const waitFor = async (predicate, label, ms = timeout) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  fail(`timed out waiting for ${label}`)
}

extension.activate(context)

const provider = vscode.__state.providers.get('dsh.chat')
if (!provider) fail('view provider was not registered')

const view = {
  visible: true,
  webview: {
    options: {},
    html: '',
    cspSource: 'vscode-webview:',
    asWebviewUri: (uri) => uri,
    postMessage: (message) => {
      messages.push(message)
      return Promise.resolve(true)
    },
    onDidReceiveMessage: (callback) => {
      handlers.push(callback)
      return { dispose() {} }
    },
  },
  onDidDispose: () => ({ dispose() {} }),
}

provider.resolveWebviewView(view)
if (!view.webview.html.includes('main.js')) fail('webview HTML was not rendered')
handlers[handlers.length - 1]({ type: 'ready' })

console.log('webview attached, waiting for connection…')
await waitFor(
  () => messages.some((m) => m.type === 'state' && m.state.connection === 'connected' && m.state.models),
  'connected state with models',
)

const connected = messages.filter((m) => m.type === 'state' && m.state.connection === 'connected').pop()
console.log(`connected: ${connected.state.connectionDetail}`)
console.log(`models: ${connected.state.models.groups.map((g) => `${g.id}(${g.models.length})`).join(', ')}`)
if (connected.state.models.groups.length === 0) fail('no models from the desktop host')

// Pin a model and confirm the pinned order reaches the view state.
{
  const group = connected.state.models.groups[0]
  const model = group.models[0]
  handlers[handlers.length - 1]({ type: 'pinModel', selection: { provider: group.id, model: model.id }, pinned: true })
  await waitFor(
    () => messages.some((m) => m.type === 'state' && (m.state.pinnedModels ?? []).length === 1),
    'pinned model in state',
    8_000,
  )
  console.log(`pinned: ${group.id}/${model.id}`)
}

const before = messages.length
handlers[handlers.length - 1]({ type: 'prompt', text: '请只回复两个字：收到', requestId: 'harness-1' })

await waitFor(
  () => messages.slice(before).some((m) => m.type === 'append' && m.item.kind === 'assistant' && m.item.text.trim().length > 0),
  'assistant reply',
)
await waitFor(
  () => messages.slice(before).some((m) => m.type === 'status' && m.running === false),
  'turn completion',
)

const slice = messages.slice(before)
const user = slice.find((m) => m.type === 'append' && m.item.kind === 'user')
const assistant = slice.filter((m) => m.type === 'append' && m.item.kind === 'assistant').pop()
const live = slice.filter((m) => m.type === 'live' && m.live)
const sessionState = messages.filter((m) => m.type === 'state' && m.state.sessionId).pop()

console.log(`user echo: ${user ? JSON.stringify(user.item.text) : 'MISSING'}`)
console.log(`assistant: ${assistant ? JSON.stringify(assistant.item.text.slice(0, 80)) : 'MISSING'}`)
console.log(`  usage: ${JSON.stringify(assistant?.item?.usage ?? null)}`)
console.log(`live frames: ${live.length}`)
console.log(`session: ${sessionState?.state.sessionId ?? 'MISSING'} · ${sessionState?.state.sessionTitle ?? ''}`)
if (assistant?.item?.usage) {
  console.log(`  tokens: in=${assistant.item.usage.input} out=${assistant.item.usage.output}`)
}

if (!user) fail('no optimistic user echo')
if (!assistant) fail('no assistant item')
if (!sessionState?.state.sessionId) fail('no active session in state')

// The transcript must survive a re-resolve (sidebar hidden/shown).
const secondView = { ...view, webview: { ...view.webview, html: '', postMessage: (m) => { messages.push(m); return Promise.resolve(true) } } }
provider.resolveWebviewView(secondView)
handlers[handlers.length - 1]({ type: 'ready' })
await waitFor(() => messages.some((m) => m.type === 'state' && m.state.items.some((i) => i.kind === 'assistant')), 're-resolved state with items')

// ── phase 2: editor selection → context chip → fenced prompt ────────────────

const snippet = ['export function add(a: number, b: number): number {', '  return a + b', '}']
const document = {
  uri: vscode.Uri.file(join(root, 'extension', 'src', 'sample.ts')),
  languageId: 'typescript',
  lineCount: snippet.length,
  getText: (range) => snippet.slice(range.start.line, range.end.line + 1).join('\n'),
  lineAt: (line) => ({ range: { end: { character: snippet[line].length } } }),
}
const editor = {
  document,
  selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(2, 1)),
}
vscode.__setActiveEditor(editor)

const beforeContext = messages.length
await vscode.commands.executeCommand('dsh.addSelectionToChat')
const contextMessage = messages.slice(beforeContext).find((m) => m.type === 'context')
if (!contextMessage) fail('selection did not produce a context chip')
console.log(`context: ${contextMessage.context.relPath} L${contextMessage.context.startLine}-${contextMessage.context.endLine}`)
if (contextMessage.context.text !== snippet.join('\n')) fail('context text does not match the selection')

const beforeSecond = messages.length
handlers[handlers.length - 1]({ type: 'prompt', text: '这段代码做了什么？只回答一句。', requestId: 'harness-2' })
await waitFor(
  () => messages.slice(beforeSecond).some((m) => m.type === 'append' && m.item.kind === 'assistant'),
  'second assistant reply',
)

const sessionId = messages.filter((m) => m.type === 'state' && m.state.sessionId).pop().state.sessionId
const bridgeDir = join(process.env.DSH_HOME, 'vscode-panel')
const discoveryPath = existsSync(join(bridgeDir, 'bridge.desktop.json'))
  ? join(bridgeDir, 'bridge.desktop.json')
  : join(bridgeDir, 'bridge.json')
const discovery = JSON.parse(readFileSync(discoveryPath, 'utf8'))
const headers = { 'x-dsh-bridge-token': discovery.token }
const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/sessions/${sessionId}/events`, { headers })
const reader = response.body.getReader()
const decoder = new TextDecoder()
let raw = ''
let snapshot = null
while (snapshot === null) {
  const { done, value } = await reader.read()
  if (done) break
  raw += decoder.decode(value, { stream: true })
  const match = raw.match(/data: (.*)\n\n/)
  if (match) {
    const payload = JSON.parse(match[1])
    if (payload.kind === 'snapshot') snapshot = payload
  }
}
await reader.cancel()

const userMessages = (snapshot?.records ?? [])
  .map((record) => record.event)
  .filter((event) => event.type === 'user/message' && event.data.source.kind === 'user')
const lastUser = userMessages[userMessages.length - 1]
const promptText = lastUser?.data?.content?.map((block) => block.text).join('') ?? ''
console.log(`prompt sent to desktop (${promptText.length} chars), fenced: ${promptText.includes('```typescript')}`)
if (!promptText.includes('```typescript')) fail('prompt did not carry the fenced code context')
if (!promptText.includes('export function add')) fail('prompt did not carry the selected code')

// ── image round-trip: send, then re-open the Session and hydrate the thumbnail
{
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const beforeImage = messages.length
  handlers[handlers.length - 1]({
    type: 'prompt',
    text: '看这张图，一句话说明。',
    requestId: 'harness-image',
    images: [{ id: 'local-image', name: 'dot.png', mediaType: 'image/png', data: PNG }],
  })
  await waitFor(
    () =>
      messages
        .slice(beforeImage)
        .some((m) => m.type === 'append' && m.item.kind === 'user' && (m.item.images ?? []).length === 1),
    'optimistic image echo',
  )
  await waitFor(
    () => messages.slice(beforeImage).some((m) => m.type === 'status' && m.running === false),
    'image turn completion',
    120_000,
  )
  console.log('image prompt: ok')

  // A reconnect re-reads the Session snapshot: the image starts as a
  // placeholder and is then hydrated from the attachment endpoint.
  const beforeHydrate = messages.length
  handlers[handlers.length - 1]({ type: 'refresh' })
  await waitFor(
    () =>
      messages.slice(beforeHydrate).some(
        (m) =>
          m.type === 'update' &&
          m.item.kind === 'user' &&
          (m.item.images ?? []).some((image) => image.data.length > 0),
      ),
    'historical image hydration',
    60_000,
  )
  console.log('historical image hydration: ok')
}

// Settings hot-reload: a dsh.home / dsh.bridgeFile change must reconnect
// without a window reload.
{
  const listeners = vscode.__state.configListeners
  if (listeners && listeners.size > 0) {
    const beforeReload = messages.length
    for (const listener of listeners) listener({ affectsConfiguration: (section) => String(section).startsWith('dsh.') })
    await waitFor(
      () => messages.slice(beforeReload).some((m) => m.type === 'state' && m.state.connection === 'connecting'),
      'reconnect after a settings change',
      10_000,
    )
    await waitFor(
      () =>
        messages
          .slice(beforeReload)
          .some((m) => m.type === 'state' && m.state.connection === 'connected' && m.state.models),
      'reconnected with the model catalog',
      30_000,
    )
    console.log('settings hot-reload: ok')
  }
}

console.log('HARNESS OK')
process.exit(0)
