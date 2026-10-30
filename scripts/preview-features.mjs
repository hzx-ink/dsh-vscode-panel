// Inject a synthetic state into the live webview to review the new rendering
// (usage, structured tools, image attachments, pinned/recent model groups).
//
//   node scripts/preview-features.mjs [--port 9333]

import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const playwrightPath = argOf('playwright', process.env.PLAYWRIGHT_MODULE || 'playwright')
const { chromium } = require(playwrightPath)

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makePng(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 3
      raw[at] = 40 + Math.floor((x / size) * 180)
      raw[at + 1] = 90 + Math.floor((y / size) * 120)
      raw[at + 2] = 200
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PNG = makePng(72).toString('base64')
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${argOf('port', '9333')}`)
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('workbench'))
if (!page) throw new Error('no workbench page')

let frame
const deadline = Date.now() + 30_000
while (!frame && Date.now() < deadline) {
  for (const candidate of page.frames()) {
    try {
      if (await candidate.$('#input')) {
        frame = candidate
        break
      }
    } catch {
      // detached
    }
  }
  if (!frame) await new Promise((resolve) => setTimeout(resolve, 400))
}
if (!frame) throw new Error('webview frame not found')

const now = Date.now()
const state = {
  connection: 'connected',
  connectionDetail: '已连接 · desktop · pid 4242',
  sessionId: 'session-preview',
  sessionTitle: '预览：新渲染能力',
  sessions: [
    {
      id: 'session-preview',
      title: '预览：新渲染能力',
      updatedAt: now,
      running: false,
      blank: false,
      cwd: 'D:\\dsh-vscode-panel',
      parentId: null,
      origin: null,
      agentAvailable: true,
      model: { provider: 'magpie', model: 'workbuddy-ai/deepseek-v4.1-flash' },
      lastPromptAt: now,
    },
  ],
  models: {
    default: { provider: 'magpie', model: 'workbuddy-ai/deepseek-v4.1-flash' },
    routableProviders: ['magpie'],
    groups: [
      {
        id: 'magpie',
        name: 'Magpie',
        models: [
          {
            id: 'workbuddy-ai/deepseek-v4.1-flash',
            name: 'DeepSeek-V4.1-Flash · WorkBuddy AI',
            reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' },
          },
          { id: 'workbuddy-ai/glm-5.3', name: 'GLM-5.3 · WorkBuddy AI' },
          { id: 'workbuddy-ai/kimi-k3', name: 'Kimi-K3 · WorkBuddy AI' },
        ],
      },
    ],
    failures: [],
  },
  selection: { provider: 'magpie', model: 'workbuddy-ai/deepseek-v4.1-flash', reasoningEffort: 'high' },
  recentModels: [
    { provider: 'magpie', model: 'workbuddy-ai/glm-5.3' },
    { provider: 'magpie', model: 'workbuddy-ai/deepseek-v4.1-flash', reasoningEffort: 'high' },
  ],
  pinnedModels: [{ provider: 'magpie', model: 'workbuddy-ai/kimi-k3' }],
  items: [
    {
      id: 'u:1',
      kind: 'user',
      time: now - 60_000,
      text: '看一下这张图，并解释 controller.ts 里的顺序问题。',
      contexts: [
        {
          id: 'c1',
          path: 'D:\\dsh-vscode-panel\\extension\\src\\controller.ts',
          relPath: 'extension/src/controller.ts',
          startLine: 120,
          endLine: 148,
          language: 'typescript',
          text: '',
          truncated: false,
        },
      ],
      images: [{ id: 'i1', name: 'screenshot.png', mediaType: 'image/png', data: PNG }],
    },
    {
      id: 't:call_1',
      kind: 'tool',
      time: now - 55_000,
      name: 'read',
      args: JSON.stringify({ file_path: 'D:\\dsh-vscode-panel\\extension\\src\\controller.ts', limit: 6 }),
      result:
        '<path>D:\\dsh-vscode-panel\\extension\\src\\controller.ts</path>\n<type>file</type>\n<content>\n1: import * as vscode from "vscode"\n2: import { BridgeClient } from "./bridge"\n3: \n4: const MAX = 400\n5: export class ChatController {\n6:   private view?: vscode.WebviewView\n</content>',
      status: 'ok',
    },
    {
      id: 't:call_2',
      kind: 'tool',
      time: now - 50_000,
      name: 'edit',
      args: JSON.stringify({
        file_path: 'D:\\dsh-vscode-panel\\extension\\src\\controller.ts',
        old_string: 'const MAX = 400',
        new_string: 'const MAX = 600',
      }),
      result: 'Edited controller.ts',
      status: 'ok',
    },
    {
      id: 'a:9',
      kind: 'assistant',
      time: now - 40_000,
      text: '顺序问题在这里：**先** 清空引用，**再** 打开面板，于是引用被丢掉。\n\n```ts\nthis.contexts = []\nawait vscode.commands.executeCommand("dsh.chat.focus")\n```\n\n改成先聚焦再清空，或者干脆不清空。',
      reasoning: '先确认 openSession 里是否清空了 contexts。',
      model: 'workbuddy-ai/deepseek-v4.1-flash',
      interrupted: false,
      usage: { input: 9395, output: 168, total: 24117, cacheRead: 14720 },
    },
  ],
  running: false,
  hasMore: true,
  contexts: [
    {
      id: 'ctx-1',
      path: 'D:\\dsh-vscode-panel\\extension\\src\\controller.ts',
      relPath: 'extension/src/controller.ts',
      startLine: 12,
      endLine: 24,
      language: 'typescript',
      text: '',
      truncated: false,
    },
  ],
  workspace: 'D:\\dsh-vscode-panel',
  filterWorkspace: true,
  error: null,
}

await frame.evaluate((payload) => window.postMessage({ type: 'state', state: payload }, '*'), state)
await new Promise((resolve) => setTimeout(resolve, 900))
// Expand both tool cards so the structured body and diff are visible.
await frame.evaluate(() => document.querySelectorAll('.tool-head').forEach((node) => node.click()))
await new Promise((resolve) => setTimeout(resolve, 300))

const checks = await frame.evaluate(() => ({
  images: document.querySelectorAll('.msg.user img.attach').length,
  usage: document.querySelector('.usage')?.textContent ?? '',
  tools: Array.from(document.querySelectorAll('.tool-brief')).map((node) => node.textContent),
  chips: Array.from(document.querySelectorAll('.ctx-chip')).map((node) => node.textContent),
}))
console.log(`dom: ${JSON.stringify(checks)}`)
if (checks.images !== 1) throw new Error('image attachment did not render')
if (!/↑/.test(checks.usage)) throw new Error('token usage did not render')

await page.screenshot({ path: join(root, 'preview', 'vscode-features.png') })
console.log('screenshot -> preview/vscode-features.png')

// Open the model picker via DOM click: VS Code toasts cover the corner.
await frame.evaluate(() => document.getElementById('model-btn').click())
await new Promise((resolve) => setTimeout(resolve, 500))
const groups = await frame.evaluate(() =>
  Array.from(document.querySelectorAll('#popover-list .group-label')).map((node) => node.textContent),
)
console.log(`model groups: ${JSON.stringify(groups)}`)
if (!groups.includes('置顶') || !groups.includes('最近使用')) throw new Error('pinned/recent groups missing')
await page.screenshot({ path: join(root, 'preview', 'vscode-models.png') })
console.log('screenshot -> preview/vscode-models.png')

await browser.close()
