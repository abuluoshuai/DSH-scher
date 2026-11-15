/**
 * dsh-system-monitor — GPU utilization and video-memory readings.
 *
 * There is no portable GPU counter, so this module tries the probes the host
 * platform actually offers and reports the first one that answers:
 *
 *   Windows / Linux   nvidia-smi   (NVIDIA)
 *   Linux             sysfs amdgpu (AMD)
 *   macOS             ioreg IOAccelerator  → utilization + memory in use
 *                     system_profiler     → model and VRAM only
 *
 * A probe that cannot run is not a failure to report repeatedly: a missing
 * command (`ENOENT`) is remembered for a while and the dock simply shows the
 * GPU cells as unavailable. Nothing here throws into the sampler.
 *
 * @module dsh-system-monitor/gpu
 */

import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import { runCommand } from './metrics.js'

/** How long a failed probe is remembered before it is retried. */
const FAILED_PROBE_RETRY_MS = 60_000

/** `"123"` / `"[N/A]"` / `"N/A"` / `""` → number or null. */
function toNumber(text) {
  const value = String(text ?? '').trim()
  if (value === '' || value === 'N/A' || value === '[N/A]' || value === '[Not Supported]') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** A 0..1 utilization from a percentage, or null. */
function toUnit(text) {
  const percent = toNumber(text)
  if (percent === null) return null
  return Math.min(1, Math.max(0, percent / 100))
}

/**
 * Parse the CSV that `nvidia-smi --query-gpu=... --format=csv,noheader,nounits`
 * prints.
 *
 * The name is the only field that may contain a comma, so it is everything
 * between the index and the last four columns.
 *
 * @param {string} text
 * @returns {Array<{ index: number, name: string, driver: string | null,
 *   utilization: number | null, memory: { used: number | null, total: number | null } | null }>}
 */
export function parseNvidiaSmiCsv(text) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.length < 6) continue
    const index = toNumber(parts[0])
    if (index === null) continue
    // Last four columns: driver_version, utilization.gpu, memory.used, memory.total.
    const tail = parts.slice(parts.length - 4)
    const name = parts.slice(1, parts.length - 4).join(', ')
    const used = toNumber(tail[2])
    const total = toNumber(tail[3])
    rows.push({
      index,
      name: name === '' ? `GPU ${index}` : name,
      driver: tail[0] === '' ? null : tail[0],
      utilization: toUnit(tail[1]),
      memory: total === null && used === null ? null : { used, total },
    })
  }
  return rows
}

/**
 * Parse the `PerformanceStatistics` dictionary out of an `ioreg -c
 * IOAccelerator` dump (macOS).
 *
 * @param {string} text
 * @param {number} totalMemory - unified memory on Apple silicon, where the GPU
 *   has no dedicated pool.
 * @returns {{ name: string | null, utilization: number | null,
 *   memory: { used: number | null, total: number | null } | null, source: string } | null}
 */
export function parseIoregAccelerator(text, totalMemory) {
  const source = String(text)
  const utilizationMatch = source.match(/"Device Utilization %"\s*=\s*(\d+)/)
  const usedMatch = source.match(/"In use system memory"\s*=\s*(\d+)/)
  if (utilizationMatch === null && usedMatch === null) return null
  const modelMatch = source.match(/"model"\s*=\s*"?([^"\n,]+)"?/)
  const utilization = utilizationMatch === null ? null : Math.min(1, Math.max(0, Number(utilizationMatch[1]) / 100))
  const used = usedMatch === null ? null : Number(usedMatch[1])
  const total = Number.isFinite(totalMemory) && totalMemory > 0 ? totalMemory : null
  return {
    name: modelMatch === null ? null : modelMatch[1].trim(),
    utilization,
    memory: used === null && total === null ? null : { used, total },
    source: 'ioreg',
  }
}

/**
 * Read the model and VRAM total that `system_profiler -json SPDisplaysDataType`
 * reports (macOS; the only probe left when `ioreg` has no accelerator node).
 *
 * @param {string} text - JSON output.
 * @returns {{ name: string | null, memoryTotal: number | null } | null}
 */
export function parseSystemProfilerDisplays(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const items = parsed?.SPDisplaysDataType
  if (!Array.isArray(items) || items.length === 0) return null
  const first = items[0] ?? {}
  const name = typeof first.sppci_model === 'string' && first.sppci_model !== ''
    ? first.sppci_model
    : typeof first._name === 'string' && first._name !== ''
      ? first._name
      : null
  // "8 GB" / "4096 MB" / "8 GB (unified)"
  let memoryTotal = null
  for (const key of ['spdisplays_vram', 'spdisplays_vram_shared', 'sppci_vram']) {
    const value = first[key]
    if (typeof value !== 'string') continue
    const match = value.match(/([\d.]+)\s*(GB|MB)/i)
    if (match === null) continue
    const size = Number(match[1])
    const unit = match[2].toUpperCase()
    if (!Number.isFinite(size)) continue
    memoryTotal = unit === 'GB' ? size * 1024 ** 3 : size * 1024 ** 2
    break
  }
  return { name, memoryTotal }
}

/** NVIDIA probe over `nvidia-smi`; null when the tool is absent or silent. */
async function probeNvidia(timeoutMs) {
  let text
  try {
    text = await runCommand('nvidia-smi', [
      '--query-gpu=index,name,driver_version,utilization.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits',
    ], { timeoutMs })
  } catch {
    return null
  }
  const rows = parseNvidiaSmiCsv(text)
  return rows.length === 0 ? null : rows
}

/** macOS probe over `ioreg`, then `system_profiler` for the model only. */
async function probeMac(timeoutMs) {
  try {
    const text = await runCommand('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeoutMs })
    const reading = parseIoregAccelerator(text, os.totalmem())
    if (reading !== null) {
      return {
        name: reading.name ?? 'Apple GPU',
        vendor: 'apple',
        driver: null,
        utilization: reading.utilization,
        memory: reading.memory,
        source: reading.source,
      }
    }
  } catch {
    /* fall through to system_profiler */
  }
  try {
    const text = await runCommand('/usr/sbin/system_profiler', ['-json', 'SPDisplaysDataType'], { timeoutMs: timeoutMs * 2 })
    const parsed = parseSystemProfilerDisplays(text)
    if (parsed === null) return null
    return {
      name: parsed.name,
      vendor: 'apple',
      driver: null,
      utilization: null,
      memory: parsed.memoryTotal === null ? null : { used: null, total: parsed.memoryTotal },
      source: 'system_profiler',
    }
  } catch {
    return null
  }
}

/** Linux AMD probe over the amdgpu sysfs counters. */
async function probeAmdSysfs() {
  let entries
  try {
    entries = await readdir('/sys/class/drm')
  } catch {
    return null
  }
  let best = null
  for (const entry of entries) {
    if (!/^card\d+$/.test(entry)) continue
    const base = `/sys/class/drm/${entry}/device`
    let busyText
    try {
      busyText = (await readFile(`${base}/gpu_busy_percent`, 'utf8')).trim()
    } catch {
      continue
    }
    const utilization = toUnit(busyText)
    const readNumber = async (name) => {
      try {
        const value = Number((await readFile(`${base}/${name}`, 'utf8')).trim())
        return Number.isFinite(value) ? value : null
      } catch {
        return null
      }
    }
    const used = await readNumber('mem_info_vram_used')
    const total = await readNumber('mem_info_vram_total')
    let name = null
    try {
      const value = (await readFile(`${base}/product_name`, 'utf8')).trim()
      if (value !== '') name = value
    } catch {
      /* product_name is optional */
    }
    const reading = {
      name,
      vendor: 'amd',
      driver: null,
      utilization,
      memory: used === null && total === null ? null : { used, total },
      source: 'sysfs',
    }
    if (best === null || (total ?? 0) > (best.memory?.total ?? 0)) best = reading
  }
  return best
}

/** Join several GPUs into the one reading the dock has room for. */
function aggregate(rows, gpuIndex) {
  const selected = gpuIndex === null ? rows : rows.filter((row) => row.index === gpuIndex)
  if (selected.length === 0) return null
  let utilization = null
  let used = null
  let total = null
  for (const row of selected) {
    if (row.utilization !== null) utilization = utilization === null ? row.utilization : Math.max(utilization, row.utilization)
    if (row.memory?.used !== null && row.memory?.used !== undefined) used = (used ?? 0) + row.memory.used
    if (row.memory?.total !== null && row.memory?.total !== undefined) total = (total ?? 0) + row.memory.total
  }
  // A driver that reports memory in MiB stays in MiB for the panel; nvidia-smi
  // prints MiB, so normalize to bytes here, once.
  if (used !== null) used *= 1024 ** 2
  if (total !== null) total *= 1024 ** 2
  const names = selected.map((row) => row.name)
  return {
    name: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0],
    vendor: 'nvidia',
    driver: selected[0].driver,
    utilization,
    memory: used === null && total === null ? null : { used, total },
    source: 'nvidia-smi',
    count: selected.length,
  }
}

/**
 * A cached GPU probe.
 *
 * A successful reading is reused for `cacheMs`; a missing one is remembered far
 * longer, so a machine without a sampled GPU does not spawn a doomed command on
 * every poll.
 *
 * @param {{ platform?: string, gpuIndex?: number | null, cacheMs?: number,
 *   timeoutMs?: number, logger?: { warn?: (message: string) => void } }} [options]
 */
export function createGpuProbe(options = {}) {
  const platform = options.platform ?? process.platform
  const gpuIndex = Number.isInteger(options.gpuIndex) ? options.gpuIndex : null
  const cacheMs = Number.isFinite(options.cacheMs) ? options.cacheMs : 1500
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 3000
  const logger = options.logger
  let cache = null
  let inflight = null
  let lastError = null

  /** One uncached probe. */
  async function probe() {
    if (platform === 'darwin') {
      const nvidia = await probeNvidia(timeoutMs)
      if (nvidia !== null) {
        const reading = aggregate(nvidia, gpuIndex)
        if (reading !== null) return reading
      }
      return probeMac(timeoutMs)
    }
    // nvidia-smi exists only on these platforms; anything else (a BSD, a
    // container, a test's fake platform) has no probe to offer here.
    if (platform !== 'win32' && platform !== 'linux') return null
    const nvidia = await probeNvidia(timeoutMs)
    if (nvidia !== null) {
      const reading = aggregate(nvidia, gpuIndex)
      if (reading !== null) return reading
    }
    if (platform === 'linux') return probeAmdSysfs()
    return null
  }

  return {
    /** The message from the last probe that ran but failed, if any. */
    lastError() {
      return lastError
    },

    /**
     * @returns {Promise<object | null>} one GPU reading, or null when this host
     * exposes none.
     */
    async sample() {
      const now = Date.now()
      if (cache !== null) {
        const ttl = cache.value === null ? Math.max(cacheMs, FAILED_PROBE_RETRY_MS) : cacheMs
        if (now - cache.at < ttl) return cache.value
      }
      if (inflight !== null) return inflight
      inflight = (async () => {
        try {
          const value = await probe()
          cache = { at: Date.now(), value }
          return value
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          logger?.warn?.(`dsh-system-monitor: GPU 采集失败：${lastError}`)
          cache = { at: Date.now(), value: null }
          return null
        } finally {
          inflight = null
        }
      })()
      return inflight
    },
  }
}
