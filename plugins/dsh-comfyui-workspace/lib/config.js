/**
 * dsh-comfyui-workspace — deployment configuration.
 *
 * The Loader row's `config` block reaches `apply()` as a plain object. Nothing
 * here validates it with a schema on purpose: this plugin imports no
 * `@deepseek-ai/*` package, so a schema change in the host cannot break the
 * panel. `resolveConfig()` fills every gap, and an unusable value falls back to
 * its default with one reported reason instead of failing the mount.
 *
 * @module dsh-comfyui-workspace/config
 */

/** Plugin id. Also the Loader row id and the locale namespace. */
export const PLUGIN_ID = 'comfyui-workspace'

/** Values the panel and the tools fall back to when the row says nothing. */
export const DEFAULTS = Object.freeze({
  /** Empty = `$DSH_HOME/comfyui-workspace`. */
  home: '',
  server: Object.freeze({
    url: 'http://127.0.0.1:8188',
    username: '',
    password: '',
    headers: Object.freeze({}),
  }),
  /** Archived runs kept per workflow; the oldest is dropped past this. */
  archiveLimit: 200,
  /** Copy finished outputs into the run's local directory. */
  downloadOutputs: true,
  /** `all` | `core` | `none` */
  toolGroups: 'all',
  /** Inject the usage guidance into every turn. */
  guidance: true,
})

/** Tool name sets, resolved from `toolGroups`. */
export const TOOL_GROUPS = Object.freeze({
  core: Object.freeze([
    'comfy_workspace_workflows',
    'comfy_workspace_run',
    'comfy_workspace_status',
    'comfy_workspace_stop',
  ]),
  all: Object.freeze([
    'comfy_workspace_workflows',
    'comfy_workspace_workflow',
    'comfy_workspace_run',
    'comfy_workspace_status',
    'comfy_workspace_stop',
    'comfy_workspace_archive',
    'comfy_workspace_server',
  ]),
})

/** The tool set a `toolGroups` value names; an unknown value is reported as `all`. */
export function normalizeToolGroups(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === 'none') return 'none'
  if (text === 'core') return 'core'
  return 'all'
}

/** One non-fatal complaint about the row's config. */
function note(notes, message) {
  notes.push(message)
}

/** A string field, trimmed; anything else keeps the default. */
function stringField(value, fallback, name, notes) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string') return value.trim()
  note(notes, `${name} 不是字符串，已用默认值 ${JSON.stringify(fallback)}`)
  return fallback
}

/** A request-header map: string keys and string values only. */
function headerField(value, name, notes) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    note(notes, `${name} 不是对象，已忽略`)
    return {}
  }
  const out = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string' || key === '') continue
    if (typeof raw === 'string') out[key] = raw
    else if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = String(raw)
    else note(notes, `${name}.${key} 不是字符串，已忽略`)
  }
  return out
}

/**
 * Turn the Loader row's `config` into the object the rest of the plugin reads.
 *
 * @param {unknown} config - the row's `config` (may be undefined).
 * @param {{ home?: string }} [environment] - process fallbacks.
 * @returns {{config: object, notes: string[]}} the resolved config and what was wrong.
 */
export function resolveConfig(config, environment = {}) {
  const notes = []
  const input = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {}
  if (config !== undefined && config !== null && input !== config) {
    note(notes, 'config 不是对象，已全部使用默认值')
  }

  const rawServer = input.server !== null && typeof input.server === 'object' && !Array.isArray(input.server)
    ? input.server
    : {}

  const server = {
    url: stringField(rawServer.url, DEFAULTS.server.url, 'server.url', notes) || DEFAULTS.server.url,
    username: stringField(rawServer.username, DEFAULTS.server.username, 'server.username', notes),
    password: stringField(rawServer.password, DEFAULTS.server.password, 'server.password', notes),
    headers: headerField(rawServer.headers, 'server.headers', notes),
  }

  const archiveLimit = Number(input.archiveLimit)
  const downloadOutputs = input.downloadOutputs
  const guidance = input.guidance

  return {
    notes,
    config: {
      home: stringField(input.home, environment.home ?? DEFAULTS.home, 'home', notes),
      server,
      archiveLimit: Number.isFinite(archiveLimit) && archiveLimit > 0
        ? Math.min(Math.floor(archiveLimit), 5000)
        : DEFAULTS.archiveLimit,
      downloadOutputs: typeof downloadOutputs === 'boolean' ? downloadOutputs : DEFAULTS.downloadOutputs,
      toolGroups: normalizeToolGroups(input.toolGroups),
      guidance: typeof guidance === 'boolean' ? guidance : DEFAULTS.guidance,
    },
  }
}
