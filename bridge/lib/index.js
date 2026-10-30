// dsh-vscode-panel-bridge — host half.
//
// This plugin lives *inside* the DeepSeek Harness Desktop process. It exposes a
// small, purpose-built HTTP + Server-Sent-Events API on loopback so that the
// VS Code extension (dsh-vscode-panel) can drive the very same sessions the
// desktop app shows: same session store, same model catalog, same agent.
//
// Nothing is re-implemented here: every endpoint is a thin projection over
// `ctx.sessionController`, the service that already backs the desktop UI.
//
// Zero runtime dependencies on purpose. The package is installed into a DSH
// profile whose module resolution is owned by the harness, so it must not
// import anything beyond Node builtins.

import { startBridge } from './server.js'

/** Cordis plugin identity; must match the package name used by the patch row. */
export const name = 'dsh-vscode-panel-bridge'

/**
 * Wait for the Session Controller service before mounting. The service owns
 * session listing, cold history reads, prompt admission and the live follow
 * stream; without it every endpoint would be a 503.
 */
export const inject = ['sessionController']

/**
 * Mount the loopback bridge.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {{ port?: number, host?: string, discoveryFile?: string }} [config] - optional overrides.
 * @returns {Promise<void>} settles once the listener is bound (or failed).
 */
export async function apply(ctx, config = {}) {
  const logger = (message, error) => {
    const detail = error === undefined ? '' : `: ${error?.stack ?? String(error)}`
    // The Desktop shell forwards host stderr to its log; keep one stable prefix.
    console.error(`[vscode-panel-bridge] ${message}${detail}`)
  }

  const bridge = startBridge(ctx, {
    host: config.host,
    port: config.port,
    discoveryFile: config.discoveryFile,
    logger,
  })

  // Cordis disposal: close the listener and remove the discovery file.
  ctx.effect(() => () => bridge.dispose())

  // Never let a bridge failure take the application down with it: a port
  // conflict or a denied socket must degrade to "panel shows 未连接".
  try {
    await bridge.ready
    logger(`listening on http://127.0.0.1:${bridge.port}`)
  } catch (error) {
    logger('failed to bind the local bridge; the VS Code panel will report 未连接', error)
  }
}
