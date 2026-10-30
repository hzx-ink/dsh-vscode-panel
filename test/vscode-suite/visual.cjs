// Visual check suite: opens the panel and keeps the window alive so an external
// screen capture can confirm where the view actually docks.
//
//   node test/vscode-suite/visual-run.mjs

const vscode = require('vscode')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('dsh-panel.dsh-vscode-panel')
  if (!extension) throw new Error('extension dsh-panel.dsh-vscode-panel is not installed')
  await extension.activate()

  const commands = await vscode.commands.getCommands(true)
  console.log(`[visual] container command present: ${commands.includes('workbench.view.extension.dshPanel')}`)
  console.log(`[visual] auxiliary commands: ${commands.filter((id) => /auxiliary/i.test(id)).join(', ')}`)

  for (const id of ['workbench.action.focusAuxiliaryBar', 'workbench.view.extension.dshPanel', 'dsh.chat.focus']) {
    try {
      await vscode.commands.executeCommand(id)
      console.log(`[visual] ran ${id}`)
    } catch (error) {
      console.log(`[visual] ${id} failed: ${error && error.message}`)
    }
    await sleep(600)
  }

  // Give the host time to connect, then hold the window open for the capture.
  await sleep(90_000)
  console.log('[visual] done holding')
}
