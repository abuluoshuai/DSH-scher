/**
 * dsh-taskbar-flash — configuration.
 *
 * Config is written by hand in `cordis.patch.yml`, so every value is optional
 * and a bad value degrades to its default with one note instead of failing the
 * plugin. `config` is replaced wholesale by a profile override, so the notes
 * also make a typo visible in the Host log.
 *
 * @module dsh-taskbar-flash/config
 */

/** Defaults documented in README.md. */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  ignoreSubagents: true,
  onlyWhenUnfocused: true,
  flashCount: 0,
  cooldownMs: 1500,
  processName: 'DeepSeek Harness',
  powerShellCommand: 'powershell.exe',
  log: true,
})

/**
 * Resolve one raw row config into the normalized shape.
 *
 * @param {unknown} raw - the Loader row's `config`.
 * @returns {{ config: typeof DEFAULT_CONFIG, notes: string[] }}
 */
export function resolveConfig(raw) {
  const notes = []
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    notes.push('config is not an object; defaults are used')
  }
  const readBool = (key) => {
    const value = source[key]
    if (value === undefined) return DEFAULT_CONFIG[key]
    if (typeof value === 'boolean') return value
    notes.push(`${key} must be a boolean; using ${String(DEFAULT_CONFIG[key])}`)
    return DEFAULT_CONFIG[key]
  }
  const readNatural = (key, min, max) => {
    const value = source[key]
    if (value === undefined) return DEFAULT_CONFIG[key]
    const number = Number(value)
    if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
      notes.push(`${key} must be an integer in ${String(min)}..${String(max)}; using ${String(DEFAULT_CONFIG[key])}`)
      return DEFAULT_CONFIG[key]
    }
    return number
  }
  const readString = (key) => {
    const value = source[key]
    if (value === undefined) return DEFAULT_CONFIG[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    notes.push(`${key} must be a non-empty string; using ${JSON.stringify(DEFAULT_CONFIG[key])}`)
    return DEFAULT_CONFIG[key]
  }
  const config = {
    enabled: readBool('enabled'),
    ignoreSubagents: readBool('ignoreSubagents'),
    onlyWhenUnfocused: readBool('onlyWhenUnfocused'),
    flashCount: readNatural('flashCount', 0, 99),
    cooldownMs: readNatural('cooldownMs', 0, 60_000),
    processName: readString('processName'),
    powerShellCommand: readString('powerShellCommand'),
    log: readBool('log'),
  }
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) notes.push(`unknown config key "${key}" is ignored`)
  }
  return { config: Object.freeze(config), notes }
}
