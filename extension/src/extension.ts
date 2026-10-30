import * as vscode from 'vscode'
import { ChatController } from './controller'

let controller: ChatController | undefined

/** Read-only surface other extensions (and the integration test) may use. */
export interface DshPanelApi {
  readonly version: string
  isConnected(): boolean
  getSnapshot(): ReturnType<ChatController['diagnostics']> | undefined
  focus(): Thenable<unknown>
}

export function activate(context: vscode.ExtensionContext): DshPanelApi {
  controller = new ChatController(context)
  context.subscriptions.push(controller)

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView: (view) => {
      controller?.attach(view)
    },
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dsh.chat', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  const command = (id: string, run: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, run))
  }

  command('dsh.focusChat', () => vscode.commands.executeCommand('dsh.chat.focus'))
  command('dsh.addSelectionToChat', () => controller?.addSelectionFromEditor())
  command('dsh.addFileToChat', () => controller?.addWholeFile())
  command('dsh.showLog', () => controller?.showLog())
  command('dsh.showKeybindings', () =>
    vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'dsh.addSelectionToChat'),
  )
  command('dsh.newChat', async () => {
    await vscode.commands.executeCommand('dsh.chat.focus')
    await controller?.newSession()
  })
  command('dsh.showSessions', async () => {
    await vscode.commands.executeCommand('dsh.chat.focus')
    controller?.showSessions()
  })
  command('dsh.pickModel', () => controller?.pickModel())
  command('dsh.refresh', () => controller?.connect(true))
  command('dsh.launchDesktop', () => controller?.launchDesktopFromCommand())
  command('dsh.installBridge', () => controller?.installBridge())
  command('dsh.movePanel', () => movePanel())

  return {
    version: String(context.extension.packageJSON.version ?? '0.0.0'),
    isConnected: () => controller?.diagnostics().connection === 'connected',
    getSnapshot: () => controller?.diagnostics(),
    focus: () => vscode.commands.executeCommand('dsh.chat.focus'),
  }
}

export function deactivate(): void {
  controller?.dispose()
  controller = undefined
}

/**
 * The panel is contributed to the secondary (right) side bar. VS Code has no
 * public API to re-dock a view, so this just opens the built-in move picker for
 * users who want it somewhere else.
 */
async function movePanel(): Promise<void> {
  await vscode.commands.executeCommand('dsh.chat.focus')
  const available = await vscode.commands.getCommands(true)
  for (const id of ['workbench.action.moveFocusedView', 'workbench.action.moveView']) {
    if (!available.includes(id)) continue
    try {
      await vscode.commands.executeCommand(id)
      void vscode.window.showInformationMessage('选择目标位置即可移动 DeepSeek Harness 面板。')
      return
    } catch {
      // Try the next candidate id.
    }
  }
  void vscode.window.showInformationMessage('请右键视图标题，选择「移动视图」（Move View）。')
}
