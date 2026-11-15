/**
 * dsh-system-monitor — the Loader row's `config`, normalized.
 *
 * Every field is optional and every bad value degrades to its default with a
 * note, so a typo in the profile's `cordis.patch.yml` never keeps the dock entry
 * from appearing: a monitor that shows nothing is worse than one that shows
 * defaults.
 *
 * @module dsh-system-monitor/config
 */

/** Defaults, also documented in the README. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Browser poll interval. */
  intervalMs: 2000,
  /** How long one Host snapshot is reused across polls from several tabs. */
  cacheMs: 1000,
  /** How long one GPU probe result is reused (spawning nvidia-smi is not free). */
  gpuCacheMs: 1500,
  /** `null` aggregates every GPU; a number pins one by its nvidia-smi index. */
  gpuIndex: null,
  /** Upper bound for one probe command. */
  commandTimeoutMs: 3000,
})

/** Integer in `[min, max]`, or `fallback` with a note. */
function readInteger(source, key, fallback, min, max, notes) {
  const raw = source[key]
  if (raw === undefined || raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    notes.push(`${key} 不是数字，已改用默认值 ${fallback}`)
    return fallback
  }
  const rounded = Math.round(value)
  const clamped = Math.min(max, Math.max(min, rounded))
  if (clamped !== rounded) notes.push(`${key}=${rounded} 超出 ${min}..${max}，已取 ${clamped}`)
  return clamped
}

/**
 * Normalize the row config.
 *
 * @param {unknown} raw - the Loader row's `config`.
 * @returns {{ config: typeof DEFAULT_CONFIG, notes: string[] }}
 */
export function resolveConfig(raw) {
  const notes = []
  const source = raw !== null && typeof raw === 'object' ? raw : {}

  const intervalMs = readInteger(source, 'intervalMs', DEFAULT_CONFIG.intervalMs, 500, 60_000, notes)
  // A cache longer than the poll interval would hand the browser the same
  // reading every time; keep it strictly under the interval.
  const cacheCeiling = Math.max(0, intervalMs - 100)
  const cacheMs = Math.min(
    readInteger(source, 'cacheMs', DEFAULT_CONFIG.cacheMs, 0, 60_000, notes),
    cacheCeiling,
  )
  const gpuCacheMs = readInteger(source, 'gpuCacheMs', DEFAULT_CONFIG.gpuCacheMs, 0, 60_000, notes)
  const commandTimeoutMs = readInteger(source, 'commandTimeoutMs', DEFAULT_CONFIG.commandTimeoutMs, 200, 20_000, notes)

  let gpuIndex = DEFAULT_CONFIG.gpuIndex
  const rawIndex = source.gpuIndex
  if (rawIndex !== undefined && rawIndex !== null && rawIndex !== 'all' && rawIndex !== '') {
    const value = Number(rawIndex)
    if (Number.isInteger(value) && value >= 0) gpuIndex = value
    else notes.push(`gpuIndex=${String(rawIndex)} 不是非负整数，已改为汇总所有显卡`)
  }

  return {
    config: { intervalMs, cacheMs, gpuCacheMs, gpuIndex, commandTimeoutMs },
    notes,
  }
}
