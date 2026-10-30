// Launch a real VS Code window with the extension and keep it open for visual
// inspection (paired with scripts/capture-window.ps1).

import { runTests } from '@vscode/test-electron'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

delete process.env.ELECTRON_RUN_AS_NODE

const candidates = [
  process.env.VSCODE_EXE,
  'C:\\Users\\86136\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
  'C:\\Program Files\\Microsoft VS Code\\Code.exe',
].filter(Boolean)
const vscodeExecutablePath = candidates.find((path) => existsSync(path))
if (!vscodeExecutablePath) {
  console.error('找不到 VS Code 可执行文件，请设置 VSCODE_EXE')
  process.exit(1)
}

process.env.DSH_HOME = process.env.DSH_HOME ?? join(root, '.test-home')

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: join(root, 'extension'),
    extensionTestsPath: join(here, 'visual.cjs'),
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--remote-debugging-port=9333'],
  })
} catch (error) {
  console.error('visual run failed:', error)
  process.exit(1)
}
