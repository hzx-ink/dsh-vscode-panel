// Launch a real VS Code extension host with the extension under development and
// run test/vscode-suite/suite.cjs inside it.
//
//   node test/vscode-suite/run.mjs
//
// Requires the *bridge* to be reachable. By default it points DSH_HOME at the
// local `.desktop-check` host (start one with scripts/dev-host.ps1) so the test
// exercises the user's real model catalog without restarting the desktop app.

import { runTests } from '@vscode/test-electron'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// This shell may itself run under Electron-as-Node (the DSH desktop process
// exports ELECTRON_RUN_AS_NODE); the test host must launch a real VS Code.
delete process.env.ELECTRON_RUN_AS_NODE

const candidates = [
  process.env.VSCODE_EXE,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
  'C:\\Program Files\\Microsoft VS Code\\Code.exe',
].filter(Boolean)
const vscodeExecutablePath = candidates.find((path) => existsSync(path))
if (!vscodeExecutablePath) {
  console.error('找不到 VS Code 可执行文件，请设置 VSCODE_EXE')
  process.exit(1)
}

const dshHome = process.env.DSH_HOME ?? join(root, '.desktop-check')
if (!existsSync(join(dshHome, 'vscode-panel', 'bridge.json'))) {
  console.error(`没有找到 ${join(dshHome, 'vscode-panel', 'bridge.json')}：先启动一个 DSH host（scripts/dev-host.ps1）`)
  process.exit(1)
}
process.env.DSH_HOME = dshHome

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: join(root, 'extension'),
    extensionTestsPath: join(here, 'suite.cjs'),
    launchArgs: [
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  })
} catch (error) {
  console.error('VS Code 集成测试失败：', error)
  process.exit(1)
}
