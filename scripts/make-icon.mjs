// Render the extension icon (128x128 PNG) without external image libraries.
// Rounded gradient tile + chat bubble with three dots, 3x supersampled.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const SIZE = 128
const SS = 3

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const insideRounded = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

const insideCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

// Triangle tail under the bubble, pointing down-left.
const insideTail = (x, y) => {
  const ax = 44
  const ay = 84
  const bx = 68
  const by = 84
  const cx = 46
  const cy = 104
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

function shade(x, y) {
  // Background: vertical gradient from #1e3a8a to #0b1220.
  if (!insideRounded(x, y, 6, 6, SIZE - 6, SIZE - 6, 26)) return null
  const t = Math.min(1, Math.max(0, (y - 6) / (SIZE - 12)))
  let rgb = [
    Math.round(30 + (11 - 30) * t),
    Math.round(58 + (18 - 58) * t),
    Math.round(138 + (32 - 138) * t),
  ]
  // Bubble.
  if (insideRounded(x, y, 30, 32, 98, 84, 16) || insideTail(x, y)) {
    rgb = [235, 240, 250]
  }
  // Dots.
  if (insideCircle(x, y, 48, 58, 6) || insideCircle(x, y, 64, 58, 6) || insideCircle(x, y, 80, 58, 6)) {
    rgb = [30, 64, 175]
  }
  return rgb
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y += 1) {
  const row = y * (SIZE * 4 + 1)
  raw[row] = 0
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0
    let g = 0
    let b = 0
    let hits = 0
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const sample = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
        if (!sample) continue
        r += sample[0]
        g += sample[1]
        b += sample[2]
        hits += 1
      }
    }
    const at = row + 1 + x * 4
    const coverage = hits / (SS * SS)
    if (hits > 0) {
      raw[at] = Math.round(r / hits)
      raw[at + 1] = Math.round(g / hits)
      raw[at + 2] = Math.round(b / hits)
      raw[at + 3] = Math.round(255 * coverage)
    } else {
      raw[at + 3] = 0
    }
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'media', 'icon.png')
writeFileSync(target, png)
console.log(`icon -> ${target} (${png.length} bytes)`)
