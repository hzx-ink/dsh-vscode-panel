// End-to-end smoke test for the bridge, run against a live DSH host.
//
//   node scripts/bridge-smoke.mjs [--home <dshHome>] [--prompt "..." ] [--timeout 60000]
//
// Verifies discovery, models, session creation, SSE snapshot + live events and
// prompt admission. Exits non-zero on the first failure.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const home = argOf('home', process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const prompt = argOf('prompt', '请只回复四个字：桥接成功。')
const timeout = Number(argOf('timeout', '90000'))
const cwd = argOf('cwd', process.cwd())

const discovery = JSON.parse(readFileSync(join(home, 'vscode-panel', 'bridge.json'), 'utf8'))
const base = `http://127.0.0.1:${discovery.port}/v1`
const headers = { 'x-dsh-bridge-token': discovery.token, 'content-type': 'application/json' }

const call = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { headers, ...init })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${text}`)
  return text.length === 0 ? null : JSON.parse(text)
}

const fail = (message) => {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

const health = await call('/health')
console.log(`health: pid=${health.pid} profile=${health.profile}`)

const catalog = await call('/models')
console.log(`models: ${catalog.groups.map((g) => `${g.id}(${g.models.length})`).join(', ') || 'none'}`)
if (catalog.groups.length === 0) fail('no routable model in this host')

const created = await call('/sessions', { method: 'POST', body: JSON.stringify({ cwd }) })
console.log(`session: ${created.sessionId}`)
if (!created.sessionId) fail('session create returned no id')

const selection = catalog.default
await call('/model', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: created.sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  }),
})
console.log(`model: ${selection.provider}/${selection.model}`)

const abort = new AbortController()
const timer = setTimeout(() => {
  console.log('timeout reached, closing stream')
  abort.abort()
}, timeout)

const stream = await fetch(`${base}/sessions/${created.sessionId}/events`, { headers, signal: abort.signal })
if (!stream.ok) fail(`events stream -> ${stream.status}`)

let sawSnapshot = false
let sawAssistant = false
let sawLiveText = false
let text = ''
let live = ''

const pump = (async () => {
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for await (const chunk of stream.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = JSON.parse(line.slice(6))
          if (payload.kind === 'snapshot') {
            sawSnapshot = true
            console.log(`snapshot: ${payload.records.length} records, cursor=${payload.cursor}`)
          } else if (payload.kind === 'event') {
            const event = payload.event
            if (event.type === 'assistant/message') {
              sawAssistant = true
              const content = event.data.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
              text += content
              console.log(`assistant/message (seq ${event.seq}): ${content.slice(0, 120)}`)
            } else if (event.type === 'tool/call') {
              console.log(`tool/call: ${event.data.name}`)
            } else if (event.type === 'turn/end') {
              console.log(`turn/end: ${event.data.reason}`)
            }
          } else if (payload.kind === 'assistant') {
            const frame = payload.frame
            if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') {
              sawLiveText = true
              live += frame.chunk.text
            }
            if (frame.type === 'end') console.log(`live end: ${frame.outcome.kind}`)
          } else if (payload.kind === 'error') {
            console.error(`stream error: ${payload.code} ${payload.message}`)
          }
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') throw error
  }
})()

await call('/prompt', { method: 'POST', body: JSON.stringify({ sessionId: created.sessionId, text: prompt }) })
console.log('prompt accepted')

await pump
clearTimeout(timer)
abort.abort()

const list = await call('/sessions')
const row = list.items.find((item) => item.id === created.sessionId)
console.log(`list row: title="${row?.title ?? ''}" running=${row?.running} model=${row?.model?.model ?? ''}`)
console.log(`live text: ${live.length} chars, durable text: ${text.length} chars`)

if (!sawSnapshot) fail('no snapshot frame')
if (!sawAssistant) fail('no durable assistant message')
if (text.trim().length === 0) fail('assistant message was empty')

console.log('OK')
