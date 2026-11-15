/**
 * dsh-system-monitor — CPU and memory readings.
 *
 * Both are taken inside the Host process, which is the machine the session
 * lives on: a locally launched DSH and a DSH running on a remote server report
 * their own host, not the browser's.
 *
 * CPU comes from the `os.cpus()` cumulative tick counters, so a percentage
 * needs two readings and the elapsed wall time between them. Memory is read
 * from the platform's own accounting where one exists, because
 * `os.freemem()` counts reclaimable cache differently on each system:
 *
 *   Linux   /proc/meminfo  MemTotal − MemAvailable
 *   macOS   vm_stat        active + wired + compressed pages
 *   other   os.totalmem() − os.freemem()
 *
 * @module dsh-system-monitor/metrics
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'

/** The smallest CPU window worth dividing by; shorter gaps are pure noise. */
const MIN_CPU_WINDOW_MS = 180

/**
 * Run one command without a shell and resolve its stdout.
 *
 * @param {string} command - executable name or absolute path.
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
export function runCommand(command, args, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 3000
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 512 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve(String(stdout ?? ''))
      },
    )
  })
}

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Clamp to `[0, 1]`. */
function unit(value) {
  if (!Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

/**
 * Sum every CPU's cumulative tick counters.
 *
 * Fields are summed rather than averaged so heterogeneous cores still produce
 * one machine-wide ratio.
 *
 * @returns {{ idle: number, total: number, at: number }}
 */
export function readCpuTotals() {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    const times = cpu?.times ?? {}
    const values = ['user', 'nice', 'sys', 'idle', 'irq'].map((name) => {
      const value = times[name]
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    })
    for (const value of values) total += value
    idle += values[3]
  }
  return { idle, total, at: Date.now() }
}

/**
 * A stateful CPU meter: usage is the busy share over the window between two
 * calls.
 *
 * @param {{ minWindowMs?: number, sleep?: (ms: number) => Promise<unknown> }} [options]
 */
export function createCpuMeter(options = {}) {
  const minWindowMs = Number.isFinite(options.minWindowMs) ? options.minWindowMs : MIN_CPU_WINDOW_MS
  const wait = typeof options.sleep === 'function' ? options.sleep : sleep
  let previous = null
  let last = null

  return {
    /**
     * @returns {Promise<number | null>} busy share in `[0, 1]`, or null before
     * the first usable window exists.
     */
    async sample() {
      let current = readCpuTotals()
      if (previous === null) {
        // A brand-new meter has no baseline; one short window is enough to give
        // the first poll a real number instead of a dash that looks like a bug.
        previous = current
        await wait(Math.max(minWindowMs, 120))
        current = readCpuTotals()
      }
      const gap = current.at - previous.at
      if (gap < minWindowMs) {
        // Polled again almost immediately (a second tab, a re-render): keep the
        // last reading and the older baseline, so the window stays meaningful.
        return last
      }
      const totalDelta = current.total - previous.total
      const idleDelta = current.idle - previous.idle
      previous = current
      if (totalDelta <= 0) return last
      last = unit(1 - idleDelta / totalDelta)
      return last
    },
  }
}

/**
 * Parse `/proc/meminfo`.
 *
 * @param {string} text
 * @returns {{ used: number, total: number, available: number, source: string } | null}
 */
export function parseMeminfo(text) {
  /** One `kB` field as bytes. */
  const field = (name) => {
    const match = text.match(new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, 'm'))
    return match === null ? null : Number(match[1]) * 1024
  }
  const total = field('MemTotal')
  if (total === null || total <= 0) return null
  const available = field('MemAvailable') ?? field('MemFree') ?? 0
  const used = Math.min(total, Math.max(0, total - available))
  return { used, total, available, source: 'procfs' }
}

/**
 * Parse `vm_stat` (macOS).
 *
 * "Memory used" follows Activity Monitor's reading: active + wired +
 * compressed pages. Inactive and free pages are reclaimable, so counting them
 * as used would paint a healthy Mac as full.
 *
 * @param {string} text - `vm_stat` output.
 * @param {number} totalBytes - `os.totalmem()`, which `vm_stat` does not print.
 * @returns {{ used: number, total: number, source: string } | null}
 */
export function parseVmStat(text, totalBytes) {
  const sizeMatch = text.match(/page size of (\d+) bytes/)
  const pageSize = sizeMatch === null ? 4096 : Number(sizeMatch[1])
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null
  /** One page-count field. */
  const pages = (name) => {
    const match = text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))
    return match === null ? 0 : Number(match[1])
  }
  const active = pages('Pages active')
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor')
  const used = (active + wired + compressed) * pageSize
  const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : used
  if (total <= 0) return null
  return { used: Math.min(total, Math.max(0, used)), total, source: 'vm_stat' }
}

/** Machine-wide memory from `os`, the fallback for every platform. */
export function fallbackMemory() {
  const total = os.totalmem()
  const used = Math.max(0, total - os.freemem())
  return { used: Math.min(total, used), total, source: 'os' }
}

/**
 * Read machine-wide memory for one platform.
 *
 * @param {string} [platform] - defaults to `process.platform`.
 * @returns {Promise<{ used: number, total: number, source: string }>}
 */
export async function readMemory(platform = process.platform) {
  if (platform === 'linux') {
    try {
      const parsed = parseMeminfo(await readFile('/proc/meminfo', 'utf8'))
      if (parsed !== null) return parsed
    } catch {
      /* containers without procfs fall through */
    }
    return fallbackMemory()
  }
  if (platform === 'darwin') {
    try {
      const parsed = parseVmStat(await runCommand('/usr/bin/vm_stat', [], { timeoutMs: 3000 }), os.totalmem())
      if (parsed !== null) return parsed
    } catch {
      /* a hardened Mac may refuse the spawn */
    }
    return fallbackMemory()
  }
  return fallbackMemory()
}
