// Inspect the live VS Code workbench over CDP (requires --remote-debugging-port).
//
//   node scripts/inspect-vscode.mjs [--port 9333] [--out preview/vscode-cdp.png]

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
const out = join(root, argOf('out', 'preview/vscode-cdp.png'))

const playwrightPath = argOf('playwright', process.env.PLAYWRIGHT_MODULE || 'playwright')
const { chromium } = require(playwrightPath)

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const pages = browser.contexts().flatMap((context) => context.pages())
console.log(`pages: ${pages.length}`)

for (const page of pages) {
  const title = await page.title().catch(() => '')
  console.log(`- ${JSON.stringify(title)} ${page.url().slice(0, 80)}`)
}

const workbench = pages.find((page) => page.url().includes('workbench')) ?? pages[0]
if (!workbench) throw new Error('no workbench page')

const info = await workbench.evaluate(() => {
  const rect = (element) => {
    if (!element) return null
    const box = element.getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.round(box.height), left: Math.round(box.left), display: getComputedStyle(element).display }
  }
  const labels = [...document.querySelectorAll('.activitybar .action-label, .composite-bar .action-label')]
    .map((element) => element.getAttribute('aria-label') || element.title || '')
    .filter(Boolean)
  const aux = document.querySelector('.part.auxiliarybar')
  const sidebar = document.querySelector('.part.sidebar')
  return {
    sidebar: rect(sidebar),
    auxiliary: rect(aux),
    auxiliaryText: aux ? aux.innerText.replace(/\s+/g, ' ').slice(0, 300) : '',
    activityLabels: labels,
    hasDshView: Boolean(document.querySelector('[id*="dshPanel"]')),
    ids: [...document.querySelectorAll('[id*="dshPanel"]')].map((element) => element.id),
  }
})

console.log(JSON.stringify(info, null, 2))
await workbench.screenshot({ path: out })
console.log(`screenshot -> ${out}`)
await browser.close()
