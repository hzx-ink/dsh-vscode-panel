// Integration suite executed *inside* a real VS Code extension host.
// `@vscode/test-electron` only requires `run()`; no mocha.

const vscode = require('vscode')

const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for ${label}`)
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('dsh-panel.dsh-vscode-panel')
  if (!extension) throw new Error('extension dsh-panel.dsh-vscode-panel is not installed in the test host')

  const api = await extension.activate()
  console.log(`[suite] activated v${api?.version}`)

  const available = await vscode.commands.getCommands(true)
  const expected = [
    'dsh.focusChat',
    'dsh.addSelectionToChat',
    'dsh.addFileToChat',
    'dsh.newChat',
    'dsh.showSessions',
    'dsh.pickModel',
    'dsh.refresh',
    'dsh.movePanel',
    'dsh.launchDesktop',
    'dsh.showLog',
  ]
  for (const id of expected) {
    if (!available.includes(id)) throw new Error(`missing command ${id}`)
  }

  // ── the reported flow: select code while the panel is still closed ────────
  const document = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content: 'const a = 1\nconst b = 2\nconst c = a + b\n',
  })
  const editor = await vscode.window.showTextDocument(document, { preview: false })
  editor.selection = new vscode.Selection(0, 0, 1, 12)

  await vscode.commands.executeCommand('dsh.addSelectionToChat')
  await waitFor(() => (api.getSnapshot()?.contexts ?? 0) === 1, 8_000, 'queued code context after the command')

  // Opening the panel (the command focuses it) must not drop that context.
  await vscode.commands.executeCommand('workbench.view.extension.dshPanel')
  await vscode.commands.executeCommand('dsh.chat.focus')
  await waitFor(
    () => api.isConnected() && (api.getSnapshot()?.models ?? 0) > 0,
    45_000,
    'bridge connection with a model catalog',
  )

  const snapshot = api.getSnapshot()
  console.log(`[suite] snapshot ${JSON.stringify(snapshot)}`)
  if (snapshot.models === 0) throw new Error('desktop model catalog is empty')
  if (snapshot.contexts !== 1) throw new Error('queued code context was dropped when the panel opened')

  // A second reference appends instead of replacing.
  await vscode.commands.executeCommand('dsh.addFileToChat')
  await waitFor(() => api.getSnapshot().contexts === 2, 8_000, 'second code context')

  await vscode.commands.executeCommand('dsh.newChat')
  if (api.getSnapshot().contexts !== 2) throw new Error('new chat discarded queued references')

  await vscode.commands.executeCommand('dsh.showSessions')

  console.log('[suite] VSCODE SUITE OK')
}
