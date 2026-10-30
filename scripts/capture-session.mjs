// Capture a real Session transcript (snapshot records + live events) for
// projector/UI fixtures.
//
//   node scripts/capture-session.mjs --out fixtures/session.json --prompt "..."

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const home = argOf('home', process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const out = argOf('out', 'fixtures/session.json')
const prompt = argOf('prompt', '读取 extension/package.json 的 name 字段并只回复它的值。')
const cwd = argOf('cwd', process.cwd())
const waitMs = Number(argOf('wait', '120000'))

const discovery = JSON.parse(readFileSync(join(home, 'vscode-panel', 'bridge.json'), 'utf8'))
const base = `http://127.0.0.1:${discovery.port}/v1`
const headers = { 'x-dsh-bridge-token': discovery.token, 'content-type': 'application/json' }

const call = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { headers, ...init })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${text}`)
  return text.length === 0 ? null : JSON.parse(text)
}

const catalog = await call('/models')
const created = await call('/sessions', { method: 'POST', body: JSON.stringify({ cwd }) })
await call('/model', {
  method: 'POST',
  body: JSON.stringify({ sessionId: created.sessionId, ...catalog.default }),
})

const abort = new AbortController()
const stream = await fetch(`${base}/sessions/${created.sessionId}/events`, { headers, signal: abort.signal })

const fixture = { sessionId: created.sessionId, models: catalog, snapshot: null, events: [], assistantFrames: [] }
let finished = false

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
          if (payload.kind === 'snapshot') fixture.snapshot = payload
          else if (payload.kind === 'event') {
            fixture.events.push(payload.event)
            if (payload.event.type === 'turn/end') finished = true
          } else if (payload.kind === 'assistant') fixture.assistantFrames.push(payload.frame)
        }
      }
      if (finished) break
    }
  } catch (error) {
    if (error.name !== 'AbortError') throw error
  }
})()

await call('/prompt', { method: 'POST', body: JSON.stringify({ sessionId: created.sessionId, text: prompt }) })

const deadline = Date.now() + waitMs
while (!finished && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250))

abort.abort()
await pump.catch(() => {})

const sessions = await call('/sessions')
const row = sessions.items.find((item) => item.id === created.sessionId)
fixture.row = row ?? null

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`captured ${fixture.events.length} events, ${fixture.assistantFrames.length} assistant frames -> ${out}`)
console.log(`title: ${row?.title ?? ''}`)
