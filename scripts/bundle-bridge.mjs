// Pack the bridge plugin and place it inside the extension package so a
// published VSIX is self-contained.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bridge = join(root, 'bridge')
const output = join(root, 'extension', 'resources')

mkdirSync(output, { recursive: true })
const packed = execFileSync('npm', ['pack', '--silent'], {
  cwd: bridge,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  windowsHide: true,
})
const name = packed
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.endsWith('.tgz'))
  .pop()
if (!name) throw new Error(`npm pack produced no tarball:\n${packed}`)

copyFileSync(join(bridge, name), join(output, name))
for (const file of readdirSync(output)) {
  if (file !== name && file.endsWith('.tgz')) rmSync(join(output, file), { force: true })
}
console.log(`bundled ${name} -> extension/resources`)
