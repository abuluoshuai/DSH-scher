/**
 * dsh-offwork-countdown — native taskbar attention helper.
 *
 * The Host process cannot touch the Electron window directly, but it is a
 * direct child of the Desktop application's main process, which owns the
 * window. One short PowerShell call therefore finds the top-level window of
 * `process.ppid` and asks Win32 `FlashWindowEx` for the standard taskbar
 * attention flash.
 *
 * The countdown asks for a flash at the scheduled off-work moment whether or
 * not the window is focused: the point is to tell the user "come back and look"
 * before the fireworks are played on the foreground.
 *
 * @module dsh-offwork-countdown/flash
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Absolute path of the helper; `-File` receives it as one argument. */
const SCRIPT_PATH = fileURLToPath(new URL('../scripts/flash-window.ps1', import.meta.url))

/**
 * Ask the desktop window to flash its taskbar button, once.
 *
 * Best-effort: never throws, never blocks the Host. Non-Windows hosts simply
 * do nothing.
 *
 * @param {{ parentPid?: number, processName?: string, onResult?: (result: object) => void }} [options]
 */
export function flashTaskbar(options = {}) {
  if (process.platform !== 'win32') {
    options.onResult?.({ ok: false, action: 'skip', reason: 'not-windows' })
    return
  }
  const parentPid = Number.isInteger(options.parentPid) ? options.parentPid : process.ppid
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    options.onResult?.({ ok: false, action: 'skip', reason: 'no-parent-pid' })
    return
  }
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    SCRIPT_PATH,
    '-ParentPid',
    String(parentPid),
    '-Count',
    '0',
    '-Force',
  ]

  let settled = false
  const settle = (result) => {
    if (settled) return
    settled = true
    options.onResult?.(result)
  }

  let child
  try {
    child = spawn(options.powerShellCommand ?? 'powershell.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    settle({ ok: false, action: 'spawn-error', error: String(error) })
    return
  }

  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    if (stdout.length < 8192) stdout += chunk
  })
  child.stderr?.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += chunk
  })
  child.on('error', (error) => settle({ ok: false, action: 'spawn-error', error: String(error) }))
  child.on('close', (code) => {
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
    let result
    try {
      result = JSON.parse(line)
    } catch {
      result = { ok: code === 0, action: 'unparsed', code, raw: line.slice(0, 200) }
    }
    if (code !== 0 && result.ok !== false) result.code = code
    if (stderr.trim() !== '') result.stderr = stderr.trim().slice(0, 500)
    settle(result)
  })
  child.unref?.()
}
