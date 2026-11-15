/**
 * dsh-taskbar-flash — Host half.
 *
 * Requirements: "when a Session finishes, the DSH icon in the taskbar must
 * flash so the user notices — right now nothing tells them."
 *
 * The flash itself lives in the Desktop shell's window, which a Host plugin
 * cannot touch directly. The Host process is a direct child of the Electron
 * main process that owns that window, so this plugin watches the Agent status
 * feed for a `running → idle` transition of a root Session and asks a small
 * PowerShell helper to run Win32 `FlashWindowEx` on the parent's window. The
 * helper skips the flash while the window is focused, so a reply the user is
 * already looking at does not blink at them.
 *
 * Subagent sessions finish constantly inside one root turn; they are ignored
 * by default, and several completions inside the cooldown window collapse into
 * one flash.
 *
 * @module dsh-taskbar-flash
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveConfig } from './config.js'
import { flashTaskbar } from './flash.js'

/** Plugin id; equals the package name and the Loader row id. */
export const name = 'dsh-taskbar-flash'

/** Must equal `package.json`'s version. */
export const VERSION = '0.1.0'

/** Rotate the debugging log above this size instead of growing forever. */
const LOG_MAX_BYTES = 256 * 1024

/**
 * Resolve `$DSH_HOME/taskbar-flash/attention.log` without assuming an
 * environment variable exists. Imported lazily so a profile without the
 * home-paths package still loads this plugin.
 *
 * @returns {Promise<string | undefined>} the log file, when a home is known.
 */
async function resolveLogFile() {
  let home
  try {
    const homePaths = await import('@deepseek-ai/dsh-home-paths')
    if (typeof homePaths.resolveDshHome === 'function') home = await homePaths.resolveDshHome()
  } catch {
    /* fall through to the environment */
  }
  if (typeof home !== 'string' || home === '') {
    const fromEnv = process.env.DSH_HOME
    if (typeof fromEnv === 'string' && fromEnv !== '') home = fromEnv
  }
  if (typeof home !== 'string' || home === '') {
    try {
      home = join(homedir(), '.dsh')
    } catch {
      return undefined
    }
  }
  return join(home, 'taskbar-flash', 'attention.log')
}

/**
 * Mount the plugin.
 *
 * @param {object} ctx - the Host context of this Loader row.
 * @param {unknown} rawConfig - the row's `config`.
 */
export function apply(ctx, rawConfig) {
  const { config, notes } = resolveConfig(rawConfig)
  const logger = ctx.logger
  for (const note of notes) logger?.warn?.(`dsh-taskbar-flash: ${note}`)

  let logFilePromise
  const writeLog = (line) => {
    if (!config.log) return
    logFilePromise ??= resolveLogFile()
    void logFilePromise.then((file) => {
      if (file === undefined) return
      try {
        mkdirSync(dirname(file), { recursive: true })
        try {
          if (statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`)
        } catch {
          /* first write, or rotation raced */
        }
        appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
      } catch {
        /* logging must never fail the Host */
      }
    })
  }

  if (!config.enabled) {
    writeLog(`loaded v${VERSION}: disabled by config`)
    logger?.info?.('dsh-taskbar-flash: disabled by config')
    return
  }

  if (process.platform !== 'win32') {
    writeLog(`loaded v${VERSION}: unsupported platform ${process.platform}`)
    logger?.info?.(`dsh-taskbar-flash: taskbar flashing is Windows-only (platform=${process.platform})`)
    return
  }

  let disposed = false
  /** Last observed agent status, so only `running → idle` counts. */
  const lastStatus = new Map()
  /** Pending coalescing timer; `null` when no flash is scheduled. */
  let timer = null
  /** Completions collected inside the current cooldown window. */
  let pending = 0
  /** The Desktop shell's main process: the owner of the taskbar window. */
  const parentPid = process.ppid ?? 0

  const flashNow = () => {
    timer = null
    if (disposed) return
    const completed = pending
    pending = 0
    writeLog(`completion detected (${String(completed)} event(s), ppid=${String(parentPid)})`)
    flashTaskbar({
      config,
      parentPid,
      onResult: (result) => {
        writeLog(`flash ${String(result.action ?? 'unknown')}: ${JSON.stringify(result)}`)
      },
    })
  }

  const requestFlash = () => {
    if (disposed) return
    pending += 1
    if (timer !== null) return
    timer = setTimeout(flashNow, config.cooldownMs)
    timer.unref?.()
  }

  const isSubagent = (agent) => {
    if (!config.ignoreSubagents) return false
    const subagents = ctx.get('subagents')
    if (!subagents || typeof subagents.rootOf !== 'function') return false
    try {
      const root = subagents.rootOf(agent)
      return root !== null && root !== undefined && root.id !== agent.id
    } catch {
      return false
    }
  }

  ctx.effect(() => {
    const offStatus = ctx.on('agent/status', (payload) => {
      const agent = payload?.agent
      const status = payload?.status
      if (agent?.id === undefined || typeof status !== 'string') return
      const before = lastStatus.get(agent.id)
      lastStatus.set(agent.id, status)
      if (status !== 'idle' || before !== 'running') return
      if (isSubagent(agent)) {
        writeLog(`skip: subagent turn end (${String(agent.id)})`)
        return
      }
      requestFlash()
    })
    const offDisposed = ctx.on('agent/disposed', (payload) => {
      const id = payload?.agent?.id
      if (id !== undefined) lastStatus.delete(id)
    })
    writeLog(`loaded v${VERSION} (ppid=${String(parentPid)})`)
    logger?.info?.(`dsh-taskbar-flash v${VERSION}: flashing the taskbar on finished turns`)
    return () => {
      offStatus?.()
      offDisposed?.()
      disposed = true
      lastStatus.clear()
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  })
}

export default { name, apply }
