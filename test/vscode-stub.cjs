// Minimal `vscode` module stub for driving the extension host code in plain
// Node. State lives on `globalThis` so a bundled copy of this module and the
// harness's own `require` observe the same registry.

const path = require('node:path')

const shared = (globalThis.__VSCODE_STUB__ = globalThis.__VSCODE_STUB__ || {
  defaults: {
    'dsh.bridgeFile': '',
    'dsh.home': '',
    'dsh.desktopPath': '',
    'dsh.showAllWorkspaces': false,
    'dsh.maxContextLines': 400,
    'dsh.contextFormat': 'fenced',
  },
  posted: [],
  commands: new Map(),
  providers: new Map(),
  workspaceFolders: [],
  activeEditor: undefined,
})

class Position {
  constructor(line, character) {
    this.line = line
    this.character = character
  }
}

class Range {
  constructor(start, end) {
    this.start = start
    this.end = end
  }
}

class Selection extends Range {
  constructor(anchor, active) {
    super(anchor, active)
    this.anchor = anchor
    this.active = active
  }
  get isEmpty() {
    return this.start.line === this.end.line && this.start.character === this.end.character
  }
}

class Uri {
  constructor(fsPath, scheme = 'file') {
    this.fsPath = fsPath
    this.scheme = scheme
    this.path = String(fsPath).replace(/\\/g, '/')
  }
  static file(fsPath) {
    return new Uri(fsPath)
  }
  static parse(value) {
    return new Uri(value, 'https')
  }
  static joinPath(base, ...parts) {
    return new Uri(path.join(base.fsPath, ...parts))
  }
  toString() {
    return this.fsPath
  }
}

class Disposable {
  constructor(fn) {
    this.dispose = fn
  }
}

const workspace = {
  get workspaceFolders() {
    return shared.workspaceFolders
  },
  getConfiguration(section) {
    return {
      get(key) {
        return shared.defaults[`${section}.${key}`]
      },
    }
  },
  asRelativePath(uri) {
    const root = shared.workspaceFolders[0]
    if (!root) return uri.fsPath
    return path.relative(root.uri.fsPath, uri.fsPath).replace(/\\/g, '/')
  },
  async openTextDocument() {
    throw new Error('openTextDocument is not stubbed')
  },
  onDidChangeConfiguration: (listener) => {
    shared.configListeners = shared.configListeners || new Set()
    shared.configListeners.add(listener)
    return new Disposable(() => shared.configListeners.delete(listener))
  },
}

const window = {
  get activeTextEditor() {
    return shared.activeEditor
  },
  registerWebviewViewProvider(id, provider) {
    shared.providers.set(id, provider)
    return new Disposable(() => shared.providers.delete(id))
  },
  createOutputChannel(name) {
    const lines = []
    shared.outputChannels = shared.outputChannels || new Map()
    shared.outputChannels.set(name, lines)
    return {
      name,
      append: (value) => lines.push(String(value)),
      appendLine: (value) => lines.push(String(value)),
      show: () => undefined,
      dispose: () => undefined,
    }
  },
  createStatusBarItem() {
    return {
      text: '',
      tooltip: '',
      command: undefined,
      name: '',
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    }
  },
  onDidChangeActiveTextEditor: (listener) => {
    shared.editorListeners = shared.editorListeners || new Set()
    shared.editorListeners.add(listener)
    return new Disposable(() => shared.editorListeners.delete(listener))
  },
  showQuickPick: async () => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showTextDocument: async () => undefined,
}

const StatusBarAlignment = { Left: 1, Right: 2 }

const commands = {
  registerCommand(id, run) {
    shared.commands.set(id, run)
    return new Disposable(() => shared.commands.delete(id))
  },
  async executeCommand(id, ...args) {
    const run = shared.commands.get(id)
    if (run) return run(...args)
    return undefined
  },
  async getCommands() {
    return []
  },
}

const env = {
  clipboard: { writeText: async () => undefined },
  openExternal: async () => true,
}

class EventEmitter {
  constructor() {
    this.listeners = new Set()
    this.event = (listener) => {
      this.listeners.add(listener)
      return new Disposable(() => this.listeners.delete(listener))
    }
  }
  fire(value) {
    for (const listener of this.listeners) listener(value)
  }
  dispose() {
    this.listeners.clear()
  }
}

module.exports = {
  Position,
  Range,
  Selection,
  Uri,
  Disposable,
  EventEmitter,
  StatusBarAlignment,
  workspace,
  window,
  commands,
  env,
  __state: shared,
  __setWorkspaceFolder(folder) {
    shared.workspaceFolders = folder ? [{ uri: Uri.file(folder), name: path.basename(folder) }] : []
  },
  __setActiveEditor(editor) {
    shared.activeEditor = editor
  },
}
