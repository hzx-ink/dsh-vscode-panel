// Build the throwaway bundles used by the headless harness and the UI preview.
// Keeps `node_modules` at the repo root clean: esbuild is borrowed from the
// extension's dev dependencies.

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const esbuild = require(join(root, 'extension', 'node_modules', 'esbuild'))

mkdirSync(join(root, '.tmp'), { recursive: true })

await esbuild.build({
  entryPoints: [join(root, 'extension', 'src', 'projector.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(root, '.tmp', 'projector.cjs'),
  logLevel: 'warning',
})

await esbuild.build({
  entryPoints: [join(root, 'extension', 'src', 'extension.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(root, '.tmp', 'extension-harness.cjs'),
  alias: { vscode: join(root, 'test', 'vscode-stub.cjs') },
  logLevel: 'warning',
})

console.log('test bundles ready in .tmp/')
