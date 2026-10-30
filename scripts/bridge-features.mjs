// Feature checks against a live bridge: image prompt, rename, fork.
//
//   node scripts/bridge-features.mjs [--home .test-home]

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const home = argOf('home', process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const discovery = JSON.parse(readFileSync(join(home, 'vscode-panel', 'bridge.json'), 'utf8'))
const base = `http://127.0.0.1:${discovery.port}/v1`
const headers = { 'x-dsh-bridge-token': discovery.token, 'content-type': 'application/json' }

const call = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { headers, ...init })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${text}`)
  return text.length === 0 ? null : JSON.parse(text)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const created = await call('/sessions', { method: 'POST', body: JSON.stringify({ cwd: process.cwd() }) })
console.log(`session ${created.sessionId}`)

const accepted = await call('/prompt', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: created.sessionId,
    text: '这张图片里有什么？一句话回答。',
    requestId: 'feat-image-1',
    images: [{ name: 'dot.png', mediaType: 'image/png', data: PNG }],
  }),
})
if (!accepted?.accepted) fail('image prompt was not accepted')
console.log('image prompt accepted')

// Wait for the durable user message (with its image block) and for the turn to
// finish — fork only accepts a completed turn.
let imageBlock = false
let turnCompleted = false
const deadline = Date.now() + 120_000
while ((!imageBlock || !turnCompleted) && Date.now() < deadline) {
  const response = await fetch(`${base}/sessions/${created.sessionId}/events`, { headers })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let snapshot = null
  while (!snapshot) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (!block.startsWith('data: ')) continue
      const payload = JSON.parse(block.slice(6))
      if (payload.kind === 'snapshot') {
        snapshot = payload
        break
      }
    }
  }
  await reader.cancel()
  for (const record of snapshot?.records ?? []) {
    const event = record.event
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      if ((event.data.content ?? []).some((part) => part.type === 'image')) imageBlock = true
    }
    if (event?.type === 'turn/end' && event.data?.reason?.kind === 'completed') turnCompleted = true
  }
  if (!imageBlock || !turnCompleted) await sleep(1000)
}
if (!imageBlock) fail('durable user message has no image block')
if (!turnCompleted) fail('turn did not complete')
console.log('durable user message contains an image block; turn completed')

const renamed = await call('/rename', { method: 'POST', body: JSON.stringify({ sessionId: created.sessionId, title: '图片会话-已重命名' }) })
console.log(`renamed -> ${renamed?.title}`)
if (!renamed?.title?.includes('重命名')) fail('rename did not return the new title')

const forked = await call('/fork', { method: 'POST', body: JSON.stringify({ sessionId: created.sessionId }) })
console.log(`forked -> ${forked?.sessionId}`)
if (!forked?.sessionId || forked.sessionId === created.sessionId) fail('fork returned no new session')

const list = await call('/sessions')
const row = list.items.find((item) => item.id === created.sessionId)
if (row?.title !== '图片会话-已重命名') fail(`list title is ${row?.title}`)

console.log('BRIDGE FEATURES OK')
