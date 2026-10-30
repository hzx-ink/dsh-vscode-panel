// Drive the real webview inside VS Code over CDP: type a prompt, send it, and
// screenshot the reply. Requires a running VS Code with --remote-debugging-port
// and a reachable DSH host.
//
//   node scripts/drive-webview.mjs [--port 9333] [--text "只回复：UI 正常"]

import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const port = argOf('port', '9333')
const text = argOf('text', '只回复四个字：界面正常')
const out = join(root, argOf('out', 'preview/vscode-send.png'))

const playwrightPath = argOf('playwright', 'C:/Users/86136/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright')
const { chromium } = require(playwrightPath)

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('workbench'))
if (!page) throw new Error('no workbench page')

// The webview lives in a nested frame; find the one that owns the composer.
let composer
const deadline = Date.now() + 30_000
while (!composer && Date.now() < deadline) {
  for (const frame of page.frames()) {
    try {
      if (await frame.$('#input')) {
        composer = frame
        break
      }
    } catch {
      // Frame detached while enumerating.
    }
  }
  if (!composer) await new Promise((resolve) => setTimeout(resolve, 500))
}
if (!composer) throw new Error('webview composer not found')

console.log(`webview frame: ${composer.url().slice(0, 70)}`)
// Start from a clean chat so the bubble count is meaningful.
await composer.click('#btn-new')
await new Promise((resolve) => setTimeout(resolve, 600))
await composer.fill('#input', text)
await composer.press('#input', 'Enter')

const reply = await composer.waitForSelector('.msg.assistant .md', { timeout: 90_000 })
const replyText = (await reply.textContent())?.trim() ?? ''
console.log(`reply: ${JSON.stringify(replyText.slice(0, 120))}`)
if (replyText.length === 0) throw new Error('assistant reply is empty')

const userBubbles = await composer.$$eval('.msg.user', (nodes) => nodes.length)
console.log(`user bubbles: ${userBubbles}`)
if (userBubbles !== 1) throw new Error(`expected 1 user bubble, got ${userBubbles}`)

const title = await composer.textContent('#title').catch(() => '')
console.log(`header title: ${JSON.stringify(title?.trim())}`)

await page.screenshot({ path: out })
console.log(`screenshot -> ${out}`)
await browser.close()
