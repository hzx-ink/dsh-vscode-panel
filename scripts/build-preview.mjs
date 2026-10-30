// Build a preview state for the webview UI from a captured Session fixture.
//
//   node scripts/build-preview.mjs

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const root = process.cwd()
const fixture = JSON.parse(readFileSync(join(root, 'fixtures', 'session.json'), 'utf8'))
const { SessionProjector } = require(join(root, '.tmp', 'projector.cjs'))

// Prefer the real desktop catalog when a check host is running, so the model
// popover is reviewed against the provider list the user actually has.
let models = fixture.models
try {
  const discovery = JSON.parse(readFileSync(join(root, '.desktop-check', 'vscode-panel', 'bridge.json'), 'utf8'))
  const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/models`, {
    headers: { 'x-dsh-bridge-token': discovery.token },
  })
  if (response.ok) models = await response.json()
} catch {
  // Keep the fixture catalog.
}

const projector = new SessionProjector()
if (fixture.snapshot) projector.hydrate(fixture.snapshot)
for (const event of fixture.events) projector.applyEvent(event)
for (const frame of fixture.assistantFrames) projector.applyAssistantFrame(frame)

const now = Date.now()
const workspace = 'D:\\dsh-vscode-panel'

const sessions = [
  {
    id: fixture.sessionId,
    title: fixture.row?.title || projector.title || '读取扩展清单名称字段',
    updatedAt: now - 60_000,
    running: false,
    blank: false,
    cwd: workspace,
    parentId: null,
    origin: null,
    agentAvailable: true,
    model: models.default,
    lastPromptAt: now - 60_000,
  },
  {
    id: 'session-demo-2',
    title: '给 controller 加一个 stop 按钮',
    updatedAt: now - 3 * 3_600_000,
    running: true,
    blank: false,
    cwd: workspace,
    parentId: null,
    origin: null,
    agentAvailable: true,
    model: { provider: 'magpie', model: 'workbuddy/glm-5.3' },
    lastPromptAt: now - 3 * 3_600_000,
  },
  {
    id: 'session-demo-3',
    title: '为什么 follow 流会断？',
    updatedAt: now - 26 * 3_600_000,
    running: false,
    blank: false,
    cwd: workspace,
    parentId: null,
    origin: null,
    agentAvailable: false,
    model: { provider: 'magpie', model: 'workbuddy/deepseek-v4.1-flash' },
    lastPromptAt: now - 26 * 3_600_000,
  },
  {
    id: 'session-demo-4',
    title: '重构 workspace 注册表',
    updatedAt: now - 4 * 86_400_000,
    running: false,
    blank: false,
    cwd: 'D:\\agent1',
    parentId: null,
    origin: null,
    agentAvailable: false,
    model: { provider: 'magpie', model: 'workbuddy/kimi-k3' },
    lastPromptAt: now - 4 * 86_400_000,
  },
]

const context = {
  id: 'ctx-1',
  path: join(workspace, 'extension', 'src', 'controller.ts'),
  relPath: 'extension/src/controller.ts',
  startLine: 12,
  endLine: 24,
  language: 'typescript',
  text: "import * as vscode from 'vscode'\nimport { existsSync } from 'node:fs'",
  truncated: false,
}

const state = {
  connection: 'connected',
  connectionDetail: '已连接 · desktop · pid 20556',
  sessionId: fixture.sessionId,
  sessionTitle: sessions[0].title,
  sessions,
  models,
  selection: models.default,
  items: projector.items,
  running: false,
  hasMore: true,
  contexts: [context],
  workspace,
  filterWorkspace: true,
  error: null,
}

mkdirSync(join(root, 'preview'), { recursive: true })
writeFileSync(join(root, 'preview', 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
console.log(`preview state: ${state.items.length} items -> preview/state.json`)

