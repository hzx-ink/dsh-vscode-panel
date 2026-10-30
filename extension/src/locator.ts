import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** A located DeepSeek Harness desktop installation. */
export interface DshInstall {
  /** Installation root, e.g. `D:\dsh`. */
  root: string
  /** The bundled CLI entry point (`resources\runtime\cli\bin\dsh.cmd`). */
  cli: string
  /** The desktop executable. */
  exe: string
}

function probe(root: string): DshInstall | undefined {
  if (!root) return undefined
  const exe = join(root, 'DeepSeek Harness.exe')
  const cli = join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
  if (existsSync(cli)) return { root, cli, exe }
  return undefined
}

/**
 * Locate the desktop app without assuming an install path. Order:
 * explicit setting → common install directories → `where.exe`.
 */
export function findDshInstall(configuredPath?: string): DshInstall | undefined {
  const candidates: string[] = []
  const push = (value?: string) => {
    if (!value) return
    const normalized = value.toLowerCase().endsWith('.exe') ? dirname(value) : value
    if (!candidates.some((item) => item.toLowerCase() === normalized.toLowerCase())) candidates.push(normalized)
  }

  push(configuredPath)
  const env = process.env
  push('D:\\dsh')
  push('C:\\dsh')
  push(env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'))
  push(env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'DeepSeek Harness'))
  push(env.ProgramFiles && join(env.ProgramFiles, 'DeepSeek Harness'))
  push(env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'DeepSeek Harness'))
  push(env.ProgramW6432 && join(env.ProgramW6432, 'DeepSeek Harness'))

  for (const candidate of candidates) {
    const found = probe(candidate)
    if (found) return found
  }

  if (process.platform === 'win32') {
    try {
      const output = execFileSync('where.exe', ['DeepSeek Harness.exe'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      })
      for (const line of output.split(/\r?\n/)) {
        const value = line.trim()
        if (value.length === 0) continue
        const found = probe(dirname(value))
        if (found) return found
      }
    } catch {
      // Not on PATH: fall through to undefined.
    }
  }
  return undefined
}

/** The bridge tarball bundled inside the extension package. */
export function findBundledBridge(extensionPath: string): string | undefined {
  const directory = join(extensionPath, 'resources')
  try {
    const file = readdirSync(directory)
      .filter((name) => /^dsh-vscode-panel-bridge-.*\.tgz$/.test(name))
      .sort()
      .pop()
    return file ? join(directory, file) : undefined
  } catch {
    return undefined
  }
}
