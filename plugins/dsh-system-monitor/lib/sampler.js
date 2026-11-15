/**
 * dsh-system-monitor — one snapshot of the machine the session lives on.
 *
 * The sampler is the only place that knows how fresh a reading may be: several
 * browser tabs poll the same route, and each GPU probe costs a process spawn.
 * A snapshot is therefore cached for `cacheMs` and concurrent callers share one
 * in-flight collection.
 *
 * @module dsh-system-monitor/sampler
 */

import os from 'node:os'
import { createGpuProbe } from './gpu.js'
import { createCpuMeter, fallbackMemory, readMemory } from './metrics.js'

/** Load averages, which Windows does not provide. */
function loadAverage(platform) {
  if (platform === 'win32') return null
  const values = os.loadavg()
  if (!Array.isArray(values) || values.length === 0) return null
  return values.map((value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null))
}

/**
 * Build the sampler for one plugin instance.
 *
 * @param {{ config: { intervalMs: number, cacheMs: number, gpuCacheMs: number,
 *   gpuIndex: number | null, commandTimeoutMs: number },
 *   platform?: string, logger?: { warn?: (message: string) => void } }} options
 */
export function createSampler(options) {
  const { config, logger } = options
  const platform = options.platform ?? process.platform
  const cpu = createCpuMeter()
  const gpu = createGpuProbe({
    platform,
    gpuIndex: config.gpuIndex,
    cacheMs: config.gpuCacheMs,
    timeoutMs: config.commandTimeoutMs,
    logger,
  })
  let cache = null
  let inflight = null

  /** Sample everything once; a single failing metric must not fail the rest. */
  async function collect() {
    const [usage, memory, gpuReading] = await Promise.all([
      cpu.sample().catch(() => null),
      readMemory(platform).catch(() => fallbackMemory()),
      gpu.sample(),
    ])
    const cpus = os.cpus()
    const cpuModel = typeof cpus[0]?.model === 'string' ? cpus[0].model.trim() : null
    return {
      at: Date.now(),
      intervalMs: config.intervalMs,
      platform,
      host: {
        name: os.hostname(),
        arch: process.arch,
        cores: cpus.length,
        cpuModel,
        uptimeMs: Math.round(os.uptime() * 1000),
      },
      cpu: { usage, load: loadAverage(platform) },
      memory,
      gpu: gpuReading,
      gpuError: gpuReading === null ? gpu.lastError() : null,
    }
  }

  return {
    /**
     * @returns {Promise<object>} the cached or freshly collected snapshot.
     */
    async snapshot() {
      if (cache !== null && Date.now() - cache.at < config.cacheMs) return cache.value
      if (inflight !== null) return inflight
      inflight = (async () => {
        try {
          const value = await collect()
          cache = { at: value.at, value }
          return value
        } finally {
          inflight = null
        }
      })()
      return inflight
    },
  }
}
