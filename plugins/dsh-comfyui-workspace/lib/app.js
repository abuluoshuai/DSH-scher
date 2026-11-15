/**
 * dsh-comfyui-workspace — the plugin's own operations.
 *
 * The browser panel and the agent tools are two callers of this one object, so
 * "run the workflow" has a single implementation, a single set of validations,
 * and the same failure text in both places.
 *
 * @module dsh-comfyui-workspace/app
 */

import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

import { ComfyError, createClient, normalizeServerUrl } from './comfy.js'
import { createRunner } from './runner.js'
import {
  MAX_WORKFLOW_BYTES,
  validateWorkflowJson,
} from './store.js'
import {
  buildCards,
  buildPrompt,
  classify,
  defaultConfig,
  rollSeed,
} from './workflow.js'

/** The credential-record key of one server's password. */
export const secretKey = (serverId) => `comfyui-workspace:server:${serverId}`

/** The single-password key this plugin used before servers became a list. */
export const LEGACY_SECRET_KEY = 'comfyui-workspace:server-password'

/** The id a never-configured install starts with. */
export const DEFAULT_SERVER_ID = 'srv-default'

/** The settings document shape this version owns. */
export const SETTINGS_VERSION = 2

/** How long one class's `/object_info` answer stays warm. */
const OBJECT_INFO_TTL_MS = 60_000

/** Header maps accept strings only; everything else is dropped. */
export function normalizeHeaders(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof key !== 'string' || key === '') continue
    if (typeof item === 'string') out[key] = item
    else if (typeof item === 'number' || typeof item === 'boolean') out[key] = String(item)
  }
  return out
}

/** A fresh server id. */
export function makeServerId(random = Math.random) {
  return `srv-${Date.now().toString(36)}-${Math.floor(random() * 0xffff).toString(36).padStart(3, '0')}`
}

/** A parsed server address, or the reason it is not one. */
export function serverAddress(url) {
  try {
    return { base: normalizeServerUrl(url).base, error: null }
  } catch (error) {
    return { base: '', error: error?.message ?? String(error) }
  }
}

/**
 * Turn whatever `settings.json` holds into this version's document.
 *
 * Three shapes survive: a document with a `servers` array (current), one with a
 * single `server` object (the single-server releases), and no file at all (take
 * the deployment config's address).
 *
 * @param {unknown} stored
 * @param {object} config - the resolved deployment config.
 */
export function migrateSettings(stored, config) {
  const document = stored !== null && typeof stored === 'object' ? stored : {}
  const ui = {
    sound: true,
    hideDisabled: true,
    pollMs: 900,
    confirmStop: true,
    ...(document.ui !== null && typeof document.ui === 'object' ? document.ui : {}),
  }
  const servers = []
  for (const item of Array.isArray(document.servers) ? document.servers : []) {
    if (item === null || typeof item !== 'object') continue
    servers.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : makeServerId(),
      name: cleanName(item.name) || `服务器 ${servers.length + 1}`,
      url: typeof item.url === 'string' ? item.url.trim() : '',
      username: typeof item.username === 'string' ? item.username : '',
      headers: normalizeHeaders(item.headers),
    })
  }
  if (servers.length === 0) {
    const legacy = document.server !== null && typeof document.server === 'object' ? document.server : {}
    servers.push({
      id: DEFAULT_SERVER_ID,
      name: '默认服务器',
      url: typeof legacy.url === 'string' && legacy.url.trim() !== '' ? legacy.url.trim() : config.server.url,
      username: typeof legacy.username === 'string' ? legacy.username : config.server.username,
      headers: normalizeHeaders(legacy.headers ?? config.server.headers),
    })
  }
  const activeServerId = servers.some((server) => server.id === document.activeServerId)
    ? document.activeServerId
    : servers[0].id
  return {
    version: SETTINGS_VERSION,
    servers,
    activeServerId,
    ui,
    /** Plaintext passwords, only for a composition with no credential service. */
    secrets: document.secrets !== null && typeof document.secrets === 'object' ? document.secrets : {},
    updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : null,
  }
}

/** Media types the `/view` proxy is willing to name; anything else is octet-stream. */
const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
}

/** The content type of a filename, or a binary-safe fallback. */
function mimeOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename ?? ''))
  return MIME_BY_EXTENSION[match?.[1]?.toLowerCase()] ?? 'application/octet-stream'
}

/** Keep a user-typed name usable as a tab title. */
function cleanName(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? '' : text.slice(0, 120)
}

/** Unique node classes of one workflow, minus the editor-only ones. */
function classesOf(raw) {
  const out = new Set()
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (node === null || typeof node !== 'object') continue
    if (classify(node) === null) continue
    out.add(String(node.type))
  }
  return [...out]
}

/** A short preview of a text value, for the agent's eye. */
function preview(value, limit = 120) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * Open one directory in the desktop's file manager, detached from this process.
 *
 * `explorer.exe` reports a non-zero exit status even when it succeeded, so the
 * child's exit is deliberately ignored: the only signal worth trusting here is
 * that the platform accepted the launch at all.
 *
 * @param {string} dir - an absolute path.
 * @returns {Promise<{command: string, args: string[]}>}
 */
function defaultOpenPath(dir) {
  const platform = process.platform
  const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, [dir], { detached: true, stdio: 'ignore' })
    } catch (error) {
      reject(error)
      return
    }
    child.on('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve({ command, args: [dir] })
    })
  })
}

/**
 * @param {object} options
 * @param {ReturnType<import('./store.js').createStore>} options.store
 * @param {object} options.config - the resolved deployment config.
 * @param {{info?: Function, warn?: Function, error?: Function}} [options.logger]
 * @param {object|null} [options.credentials] - `ctx.credentials` when the profile has one.
 * @param {(dir: string) => Promise<unknown>} [options.openPath] - how to reveal a
 *   directory; replaced in tests so no file manager opens.
 */
export function createApp({ store, config, logger, credentials = null, openPath = defaultOpenPath }) {
  /** The settings document as last read or written. */
  let settings = null
  /** serverId → password, and where it came from. */
  let secrets = new Map()
  let secretSources = new Map()
  /** `{base, at, data}` for the cached `/object_info` answers. */
  let objectInfoCache = { base: '', at: 0, data: new Map() }
  let systemStatsCache = { base: '', at: 0, value: null }

  /** Every cached answer is per server; a settings change invalidates all of it. */
  function clearCaches() {
    objectInfoCache = { base: '', at: 0, data: new Map() }
    systemStatsCache = { base: '', at: 0, value: null }
  }

  /** Load the settings document and every server's password once. */
  async function init() {
    settings = migrateSettings(await store.readSettings(), config)
    await loadSecrets()
    return settings
  }

  /** Read each configured server's password from the credential store. */
  async function loadSecrets() {
    const next = new Map()
    const sources = new Map()
    for (const server of settings?.servers ?? []) {
      let value = ''
      let source = 'none'
      if (credentials !== null && typeof credentials.readRecord === 'function') {
        const keys = [secretKey(server.id)]
        if (server.id === DEFAULT_SERVER_ID) keys.push(LEGACY_SECRET_KEY)
        for (const key of keys) {
          try {
            const record = await credentials.readRecord(key)
            const found = record !== null && typeof record === 'object' ? record.key : undefined
            if (typeof found === 'string' && found !== '') {
              value = found
              source = 'credential'
              break
            }
          } catch (error) {
            logger?.warn?.(`dsh-comfyui-workspace: 读取凭据失败：${error?.message ?? error}`)
          }
        }
      }
      if (value === '' && typeof settings?.secrets?.[server.id] === 'string' && settings.secrets[server.id] !== '') {
        value = settings.secrets[server.id]
        source = 'file'
      }
      // A deployment that configured one password in `cordis.patch.yml` keeps
      // reaching its default server: the config value is a fallback, not truth.
      if (value === '' && server.id === DEFAULT_SERVER_ID && config.server.password !== '') {
        value = config.server.password
        source = 'config'
      }
      if (value !== '') {
        next.set(server.id, value)
        sources.set(server.id, source)
      }
    }
    secrets = next
    secretSources = sources
  }

  /** Write one server's password where it belongs, and remember it. */
  async function writeSecret(serverId, next) {
    const value = typeof next === 'string' ? next : ''
    if (credentials !== null && typeof credentials.modifyRecord === 'function') {
      if (value === '') {
        if (typeof credentials.deleteRecord === 'function') await credentials.deleteRecord(secretKey(serverId))
        secrets.delete(serverId)
        secretSources.delete(serverId)
        return
      }
      await credentials.modifyRecord(secretKey(serverId), async () => ({ kind: 'api-key', key: value }))
      secrets.set(serverId, value)
      secretSources.set(serverId, 'credential')
      return
    }
    if (value === '') {
      secrets.delete(serverId)
      secretSources.delete(serverId)
      return
    }
    secrets.set(serverId, value)
    secretSources.set(serverId, 'file')
  }

  /** The passwords a document has to carry itself (no credential service). */
  function fileSecrets() {
    const out = {}
    for (const [id, source] of secretSources) {
      if (source === 'file' && (secrets.get(id) ?? '') !== '') out[id] = secrets.get(id)
    }
    return out
  }

  /** One configured server by id, or the active one. */
  function serverById(serverId) {
    const servers = settings?.servers ?? []
    if (typeof serverId === 'string' && serverId !== '') {
      const found = servers.find((server) => server.id === serverId)
      if (found !== undefined) return found
    }
    return servers.find((server) => server.id === settings?.activeServerId) ?? servers[0] ?? null
  }

  /** The settings the panel may see: never a password. */
  function publicSettings() {
    const servers = (settings?.servers ?? []).map((server) => {
      const address = serverAddress(server.url)
      return {
        id: server.id,
        name: server.name,
        url: server.url,
        username: server.username,
        headers: server.headers,
        hasPassword: (secrets.get(server.id) ?? '') !== '',
        passwordSource: secretSources.get(server.id) ?? 'none',
        address: address.base,
        error: address.error,
      }
    })
    const active = servers.find((server) => server.id === settings?.activeServerId) ?? servers[0] ?? null
    return {
      servers,
      activeServerId: active?.id ?? '',
      ui: settings?.ui ?? {},
      address: active?.address ?? '',
      deployment: {
        home: store.dir,
        archiveLimit: config.archiveLimit,
        downloadOutputs: config.downloadOutputs,
        toolGroups: config.toolGroups,
      },
    }
  }

  /** Build a client for one server (or the active one). */
  function clientFor(serverId) {
    const server = serverById(serverId)
    if (server === null) throw new ComfyError('invalid', '还没有配置 ComfyUI 服务器')
    const id = server.id
    return createClient({
      server: { url: server.url, username: server.username, headers: server.headers },
      passwordFor: () => secrets.get(id) ?? '',
    })
  }

  /** Build a client from the active server. */
  function client() {
    return clientFor(settings?.activeServerId)
  }

  /** The `/object_info` map for the requested classes, from cache when warm. */
  async function objectInfoFor(classes, { refresh = false, signal, serverId } = {}) {
    const client_ = clientFor(serverId)
    const base = client_.address.base
    if (objectInfoCache.base !== base || Date.now() - objectInfoCache.at > OBJECT_INFO_TTL_MS) {
      objectInfoCache = { base, at: Date.now(), data: new Map() }
    }
    const missing = refresh ? classes : classes.filter((name) => !objectInfoCache.data.has(name))
    if (missing.length > 0) {
      const fetched = await client_.objectInfoMany(missing, { signal })
      for (const [name, spec] of Object.entries(fetched)) objectInfoCache.data.set(name, spec)
      objectInfoCache.at = Date.now()
    }
    const data = objectInfoCache.data
    const out = {}
    let found = 0
    for (const name of classes) {
      if (!data.has(name)) continue
      out[name] = data.get(name)
      found += 1
    }
    return found === 0 ? null : out
  }

  /** Server reachability plus what the server says about itself. */
  async function testServer(serverId) {
    const startedAt = Date.now()
    try {
      const conn = clientFor(serverId)
      const stats = await conn.systemStats()
      const latencyMs = Date.now() - startedAt
      systemStatsCache = { base: conn.address.base, at: Date.now(), value: stats }
      return {
        ok: true,
        latencyMs,
        address: conn.address.base,
        serverId: serverById(serverId)?.id ?? '',
        version: String(stats?.system?.comfyui_version ?? ''),
        python: String(stats?.system?.python_version ?? ''),
        os: String(stats?.system?.os ?? ''),
        ram: {
          total: Number(stats?.system?.ram_total ?? 0),
          free: Number(stats?.system?.ram_free ?? 0),
        },
        devices: (Array.isArray(stats?.devices) ? stats.devices : []).map((device) => ({
          name: String(device?.name ?? ''),
          type: String(device?.type ?? ''),
          vramTotal: Number(device?.vram_total ?? 0),
          vramFree: Number(device?.vram_free ?? 0),
        })),
      }
    } catch (error) {
      return {
        ok: false,
        code: error?.code ?? 'error',
        message: error?.message ?? String(error),
        serverId: serverById(serverId)?.id ?? '',
        address: (() => {
          try {
            return clientFor(serverId).address.base
          } catch {
            return ''
          }
        })(),
      }
    }
  }

  /** Cached `/system_stats` for the status line; never throws. */
  async function serverSummary() {
    const base = (() => {
      try {
        return client().address.base
      } catch {
        return ''
      }
    })()
    if (systemStatsCache.base === base && Date.now() - systemStatsCache.at < 30_000) {
      return systemStatsCache.value
    }
    const result = await testServer()
    return result.ok === true
      ? { comfyui_version: result.version, devices: result.devices, latencyMs: result.latencyMs }
      : { error: result.message }
  }

  /** How fresh the resource sample has to be before the next poll re-reads it. */
  const STATS_TTL_MS = 2000
  /** serverId → password lookup lives in `secrets`; this only holds the numbers. */
  let statsCache = { base: '', at: 0, atIso: null, value: null, error: null }
  let statsInFlight = null

  /** Reduce a `/system_stats` answer to the numbers the footer draws. */
  function toStats(payload) {
    return {
      version: String(payload?.system?.comfyui_version ?? ''),
      ram: {
        total: Number(payload?.system?.ram_total ?? 0),
        free: Number(payload?.system?.ram_free ?? 0),
      },
      devices: (Array.isArray(payload?.devices) ? payload.devices : []).map((device) => ({
        index: Number(device?.index ?? 0),
        name: String(device?.name ?? ''),
        type: String(device?.type ?? ''),
        vramTotal: Number(device?.vram_total ?? 0),
        vramFree: Number(device?.vram_free ?? 0),
      })),
    }
  }

  /**
   * Sample the active server's GPU and RAM usage.
   *
   * `/system_stats` does no GPU work, but it is still a network round trip to a
   * possibly remote machine: the panel polls this every couple of seconds while
   * it is open, and never when nobody is looking. Single-flight, so a burst of
   * polls cannot pile up requests.
   */
  async function refreshStats(serverId) {
    if (statsInFlight !== null) return statsInFlight
    const read = async () => {
      const startedAt = Date.now()
      const server = serverById(serverId)
      const base = server === null ? '' : serverAddress(server.url).base
      try {
        const payload = await clientFor(serverId).systemStats()
        statsCache = {
          base,
          serverId: server?.id ?? '',
          serverName: server?.name ?? '',
          at: startedAt,
          atIso: new Date().toISOString(),
          value: toStats(payload),
          error: null,
        }
      } catch (error) {
        statsCache = {
          base,
          serverId: server?.id ?? '',
          serverName: server?.name ?? '',
          at: startedAt,
          atIso: new Date().toISOString(),
          // Keep the last good numbers visible; the error rides along so the
          // footer can say the reading is stale rather than lie about it.
          value: statsCache.value,
          error: error?.message ?? String(error),
        }
      }
      systemStatsCache = { base, at: startedAt, value: statsCache.value }
      return statsCache
    }
    statsInFlight = read().finally(() => { statsInFlight = null })
    return statsInFlight
  }

  /** The cached sample, refreshing in the background when it has gone stale. */
  function statsView() {
    const server = serverById(settings?.activeServerId)
    const base = server === null ? '' : serverAddress(server.url).base
    if (statsInFlight === null && (statsCache.base !== base || Date.now() - statsCache.at >= STATS_TTL_MS)) {
      // Fire and forget: the panel asks for the state on a timer, so the next
      // poll picks the numbers up. Nothing here may block that poll.
      void refreshStats(server?.id).catch(() => undefined)
    }
    if (statsCache.value === null) {
      return statsCache.error === null
        ? null
        : { at: statsCache.atIso, serverId: server?.id ?? '', serverName: server?.name ?? '', error: statsCache.error }
    }
    return {
      at: statsCache.atIso,
      stale: Date.now() - statsCache.at > STATS_TTL_MS * 5,
      serverId: statsCache.serverId ?? server?.id ?? '',
      serverName: statsCache.serverName ?? server?.name ?? '',
      ...statsCache.value,
      error: statsCache.error,
    }
  }

  /** One awaited sample, for a caller that wants it now (the status tool). */
  async function stats(serverId, { force = false } = {}) {
    const server = serverById(serverId ?? settings?.activeServerId)
    const base = server === null ? '' : serverAddress(server.url).base
    if (force || statsCache.base !== base || Date.now() - statsCache.at >= STATS_TTL_MS) {
      await refreshStats(server?.id)
    }
    return statsView()
  }

  /** VRAM and RAM as plain numbers, for a before/after comparison. */
  function usageOf(sample) {
    if (sample === null || sample === undefined) return null
    const devices = Array.isArray(sample.devices) ? sample.devices : []
    const vramTotal = devices.reduce((sum, device) => sum + (Number(device.vramTotal) || 0), 0)
    const vramFree = devices.reduce((sum, device) => sum + (Number(device.vramFree) || 0), 0)
    const ramTotal = Number(sample.ram?.total) || 0
    const ramFree = Number(sample.ram?.free) || 0
    return {
      vramTotal,
      vramUsed: Math.max(0, vramTotal - vramFree),
      ramTotal,
      ramUsed: Math.max(0, ramTotal - ramFree),
    }
  }

  /**
   * Free the server's VRAM: unload its models and empty the allocator cache.
   *
   * `POST /free` is what ComfyUI's own "Free model and node cache" action calls,
   * so this is the supported way to hand memory back — no restart, nothing lost
   * on disk, and the next run just loads the models again.
   */
  async function freeMemory({ serverId, unloadModels = true, freeMemory: freeCache = true } = {}) {
    const server = serverById(serverId)
    if (server === null) throw new ComfyError('invalid', '还没有配置 ComfyUI 服务器')
    const before = usageOf(await stats(server.id, { force: true }))
    try {
      await clientFor(server.id).free({ unloadModels, freeMemory: freeCache })
    } catch (error) {
      if (error instanceof ComfyError && (error.status === 404 || error.status === 405)) {
        throw new ComfyError('invalid', '这台 ComfyUI 没有 /free 接口（版本太旧？），请重启 ComfyUI 来释放显存')
      }
      throw error
    }
    // Unloading is asynchronous inside ComfyUI; give it a moment so the "after"
    // reading is not just the "before" one again.
    await new Promise((resolve) => setTimeout(resolve, 900))
    statsCache = { ...statsCache, at: 0 }
    const after = usageOf(await stats(server.id, { force: true }))
    logger?.info?.(`dsh-comfyui-workspace: 已请求 ${server.name} 释放显存`)
    return {
      serverId: server.id,
      serverName: server.name,
      unloadModels: unloadModels === true,
      freeMemory: freeCache === true,
      before,
      after,
      freedVram: before === null || after === null ? 0 : Math.max(0, before.vramUsed - after.vramUsed),
      freedRam: before === null || after === null ? 0 : Math.max(0, before.ramUsed - after.ramUsed),
    }
  }

  /**
   * Replace the settings document.
   *
   * The panel edits the whole server list at once, so the patch is the list, the
   * active id, and the preferences. A server's `password` is written only when it
   * is a non-empty string (`clearPassword` removes one explicitly), which is what
   * makes "leave it blank to keep it" true.
   *
   * @param {{servers?: object[], activeServerId?: string, ui?: object}} patch
   */
  async function saveSettings(patch) {
    // A preference-only save (the panel's "hide disabled" toggle) carries no
    // server list; the configured one stays as it is.
    const incoming = Array.isArray(patch?.servers) ? patch.servers : (settings?.servers ?? [])
    const servers = []
    for (const [index, item] of incoming.entries()) {
      if (item === null || typeof item !== 'object') continue
      const id = typeof item.id === 'string' && item.id !== '' ? item.id : makeServerId()
      const server = {
        id,
        name: cleanName(item.name) || `服务器 ${index + 1}`,
        url: typeof item.url === 'string' ? item.url.trim() : '',
        username: typeof item.username === 'string' ? item.username : '',
        headers: normalizeHeaders(item.headers),
      }
      // A typo in the address is a settings problem, not a run-time surprise.
      const address = serverAddress(server.url)
      if (address.error !== null) throw new ComfyError('invalid', `${server.name}：${address.error}`)
      servers.push(server)
      if (typeof item.password === 'string' && item.password !== '') await writeSecret(id, item.password)
      else if (item.clearPassword === true) await writeSecret(id, '')
    }
    if (servers.length === 0) throw new ComfyError('invalid', '至少要留一个服务器')

    // Removing a server removes its credential record too.
    const removed = (settings?.servers ?? []).map((server) => server.id).filter((id) => !servers.some((server) => server.id === id))
    for (const id of removed) await writeSecret(id, '')

    const wanted = typeof patch.activeServerId === 'string' ? patch.activeServerId : ''
    const activeServerId = servers.some((server) => server.id === wanted)
      ? wanted
      : servers.some((server) => server.id === settings?.activeServerId)
        ? settings.activeServerId
        : servers[0].id
    const uiPatch = patch.ui !== null && typeof patch.ui === 'object' ? patch.ui : {}

    settings = await store.saveSettings({
      version: SETTINGS_VERSION,
      servers,
      activeServerId,
      ui: { ...(settings?.ui ?? {}), ...uiPatch },
      secrets: fileSecrets(),
      updatedAt: new Date().toISOString(),
    })
    await loadSecrets()
    clearCaches()
    return publicSettings()
  }

  /** Make one configured server the active one. */
  async function selectServer(serverId) {
    const target = (settings?.servers ?? []).find((server) => server.id === serverId)
    if (target === undefined) throw new ComfyError('invalid', '找不到这个服务器')
    settings = await store.saveSettings({
      ...settings,
      activeServerId: target.id,
      secrets: fileSecrets(),
      updatedAt: new Date().toISOString(),
    })
    clearCaches()
    return publicSettings()
  }

  /** The tab list. */
  async function listWorkflows() {
    return store.listWorkflows()
  }

  /**
   * One workflow with its cards built for the panel.
   *
   * @param {string} id
   * @param {{refresh?: boolean, withObjectInfo?: boolean}} [options]
   */
  async function workflowDetail(id, options = {}) {
    const record = await store.getWorkflow(id)
    if (record === undefined) throw new ComfyError('invalid', '找不到这个工作流')
    const classes = classesOf(record.raw)
    let objectInfo = null
    let modelsError = null
    if (options.withObjectInfo !== false) {
      try {
        objectInfo = await objectInfoFor(classes, { refresh: options.refresh === true })
        if (objectInfo === null) modelsError = '服务器没有返回这些节点类型的信息'
      } catch (error) {
        modelsError = error?.message ?? String(error)
      }
    }
    const config_ = record.config ?? defaultConfig(record.raw)
    const cards = buildCards(record.raw, objectInfo, config_)
    return {
      id: record.id,
      name: record.name,
      sourceName: record.sourceName ?? '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      cards,
      config: config_,
      classes,
      missingClasses: objectInfo === null ? [] : classes.filter((name) => objectInfo[name] === undefined),
      modelsError,
      server: publicSettings().address,
    }
  }

  /** Store one imported workflow JSON. */
  async function importWorkflow({ raw, name, sourceName }) {
    const problem = validateWorkflowJson(raw)
    if (problem !== null) throw new ComfyError('invalid', problem)
    const encoded = Buffer.byteLength(JSON.stringify(raw), 'utf8')
    if (encoded > MAX_WORKFLOW_BYTES) {
      throw new ComfyError('invalid', `工作流文件太大（${(encoded / 1024 / 1024).toFixed(1)} MB）`)
    }
    const title = cleanName(name) || cleanName(sourceName)?.replace(/\.json$/i, '') || `工作流 ${new Date().toLocaleString('zh-CN')}`
    const record = await store.addWorkflow({
      name: title,
      raw,
      sourceName: cleanName(sourceName),
      config: defaultConfig(raw),
    })
    logger?.info?.(`dsh-comfyui-workspace: 导入工作流「${record.name}」（${record.id}）`)
    return { id: record.id, name: record.name, nodeCount: Array.isArray(raw.nodes) ? raw.nodes.length : 0 }
  }

  /** Rename a workflow, replace its graph, or save the panel's configuration. */
  async function updateWorkflow(id, patch) {
    const next = {}
    if (typeof patch?.name === 'string') {
      const name = cleanName(patch.name)
      if (name === '') throw new ComfyError('invalid', '名字不能是空的')
      next.name = name
    }
    if (patch?.raw !== undefined) {
      const problem = validateWorkflowJson(patch.raw)
      if (problem !== null) throw new ComfyError('invalid', problem)
      next.raw = patch.raw
    }
    if (patch?.config !== undefined) {
      if (patch.config === null || typeof patch.config !== 'object') throw new ComfyError('invalid', 'config 必须是对象')
      next.config = patch.config
    }
    const record = await store.updateWorkflow(id, next)
    if (record === undefined) throw new ComfyError('invalid', '找不到这个工作流')
    return { id: record.id, name: record.name, updatedAt: record.updatedAt }
  }

  async function deleteWorkflow(id) {
    const removed = await store.deleteWorkflow(id)
    if (!removed) throw new ComfyError('invalid', '找不到这个工作流')
    return { deleted: true }
  }

  const runner = createRunner({
    store,
    getClient: (serverId) => clientFor(serverId),
    getSettings: () => settings,
    getConfig: () => config,
    logger,
  })

  /**
   * Queue one workflow. `config` overrides what the panel saved; `serverId`
   * pins this run to one configured server, so switching servers mid-render
   * cannot mix two machines' files into one archive entry.
   */
  async function run(id, runConfig, options = {}) {
    const record = await store.getWorkflow(id)
    if (record === undefined) throw new ComfyError('invalid', '找不到这个工作流')
    const config_ = runConfig !== undefined && runConfig !== null ? runConfig : record.config
    const server = serverById(options.serverId)
    if (server === null) throw new ComfyError('invalid', '还没有配置 ComfyUI 服务器')
    const classes = classesOf(record.raw)
    let objectInfo = null
    try {
      objectInfo = await objectInfoFor(classes, { serverId: server.id })
    } catch (error) {
      throw new ComfyError('unreachable', `取不到服务器节点信息：${error?.message ?? error}`)
    }
    const result = await runner.start({
      workflow: { ...record, config: config_ },
      objectInfo,
      config: config_,
      serverId: server.id,
      serverName: server.name,
    })
    return {
      runId: result.runId,
      promptId: result.promptId,
      promptNumber: result.promptNumber,
      seeds: result.seeds,
      warnings: result.warnings,
      nodeCount: Object.keys(result.prompt).length,
      workflowId: record.id,
      workflowName: record.name,
      serverId: server.id,
      serverName: server.name,
    }
  }

  async function stop() {
    return runner.stop()
  }

  function state() {
    // The run state is in-memory; the resource sample rides along so the panel's
    // single poll keeps the footer fresh without a second request of its own.
    return { ...runner.state(), stats: statsView() }
  }

  function waitFor(runId, timeoutMs) {
    return runner.waitFor(runId, timeoutMs)
  }

  /** Upload bytes to the server's input directory. */
  async function upload({ filename, bytes, mime }) {
    if (bytes === undefined || bytes === null || bytes.length === 0) {
      throw new ComfyError('invalid', '没有收到文件内容')
    }
    const result = await client().upload({ filename, bytes, mime })
    const name = typeof result?.name === 'string' ? result.name : ''
    if (name === '') throw new ComfyError('invalid', '服务器没有返回文件名')
    const subfolder = typeof result?.subfolder === 'string' ? result.subfolder : ''
    return {
      name,
      subfolder,
      type: typeof result?.type === 'string' ? result.type : 'input',
      /** What the node's file widget must hold. */
      value: subfolder === '' ? name : `${subfolder}/${name}`,
    }
  }

  /** Proxy one output/input file back to the browser. */
  async function view({ filename, subfolder, type }) {
    if (typeof filename !== 'string' || filename === '') throw new ComfyError('invalid', '缺少 filename')
    const response = await client().view({ filename, subfolder: subfolder ?? '', type: type ?? 'output' })
    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      status: 200,
      headers: {
        'content-type': response.headers.get('content-type') ?? mimeOf(filename),
        'content-length': String(bytes.length),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
      body: bytes,
    }
  }

  /** Model file names under one server folder (`/models/<folder>`). */
  async function models(folder, serverId) {
    const list = await clientFor(serverId).models(folder)
    return list.map((item) => String(item))
  }

  /**
   * Reveal one local directory in the desktop's file manager.
   *
   * The panel cannot do this itself — a page cannot open Explorer — so the Host
   * does it, after checking the path is a directory it can see. A destination the
   * user has typed but never run yet is created first: the button says "open",
   * and an error about a folder that is about to exist helps nobody.
   *
   * @param {unknown} wanted - the directory the panel shows.
   */
  async function openLocalDirectory(wanted) {
    const text = typeof wanted === 'string' ? wanted.trim() : ''
    if (text === '') throw new ComfyError('invalid', '本地目录还是空的，先填一个')
    const absolute = path.resolve(text)
    let created = false
    let info = null
    try {
      info = await stat(absolute)
    } catch {
      info = null
    }
    if (info === null) {
      try {
        await mkdir(absolute, { recursive: true })
        created = true
      } catch (error) {
        throw new ComfyError('invalid', `这个目录不存在，也建不出来：${absolute}（${error?.message ?? error}）`)
      }
    } else if (!info.isDirectory()) {
      throw new ComfyError('invalid', `这不是一个目录：${absolute}`)
    }
    try {
      await openPath(absolute)
    } catch (error) {
      throw new ComfyError('invalid', `打不开文件管理器：${error?.message ?? error}`)
    }
    logger?.info?.(`dsh-comfyui-workspace: 打开目录 ${absolute}`)
    return { opened: true, created, path: absolute }
  }
  /** The archive list, newest first, without the stored prompts. */
  async function listArchive({ workflowId, limit = 50 } = {}) {
    const entries = await store.listArchive({ workflowId, limit })
    return entries.map((entry) => ({
      id: entry.id,
      workflowId: entry.workflowId,
      workflowName: entry.workflowName,
      status: entry.status,
      error: entry.error,
      at: entry.at,
      durationMs: entry.durationMs,
      seed: entry.seed,
      fileCount: Array.isArray(entry.files) ? entry.files.length : 0,
      files: Array.isArray(entry.files) ? entry.files.slice(0, 8) : [],
      params: entry.params ?? {},
      save: entry.save ?? null,
    }))
  }

  async function getArchive(id) {
    const entry = await store.getArchiveEntry(id)
    if (entry === undefined) throw new ComfyError('invalid', '找不到这条归档')
    return entry
  }

  /** Re-queue one archived prompt, optionally with a fresh seed. */
  async function rerunArchive(id, { freshSeed = true } = {}) {
    const entry = await store.getArchiveEntry(id)
    if (entry === undefined) throw new ComfyError('invalid', '找不到这条归档')
    const prompt = structuredClone(entry.prompt ?? {})
    const rolled = {}
    if (freshSeed === true) {
      for (const [nodeId, field] of Object.entries(entry.seedFields ?? {})) {
        const node = prompt[nodeId]
        if (node === undefined || node.inputs === undefined) continue
        const value = rollSeed()
        node.inputs[field] = value
        rolled[nodeId] = value
      }
    }
    const client_ = client()
    const clientId = `dsh-comfyui-rerun-${Date.now().toString(36)}`
    const queued = await client_.queuePrompt(prompt, clientId)
    const promptId = typeof queued?.prompt_id === 'string' ? queued.prompt_id : ''
    if (promptId === '') throw new ComfyError('invalid', '服务器没有接受这次重跑')
    return { promptId, seeds: rolled, workflowId: entry.workflowId, workflowName: entry.workflowName }
  }

  async function clearArchive({ workflowId } = {}) {
    const removed = await store.clearArchive({ workflowId })
    return { removed }
  }

  /** Everything the status line and a settings page need. */
  async function overview() {
    return {
      settings: publicSettings(),
      state: state(),
      server: await serverSummary(),
      workflows: await listWorkflows(),
    }
  }

  /**
   * Append one line the browser reported to `debug.client.log`.
   *
   * The panel's failures happen on the other side of an HTTP boundary, where its
   * console is invisible to whoever is debugging the plugin; this file is the
   * channel that survives that gap. Capped, so it can never grow without bound.
   *
   * @param {unknown} event - the event name the client sent.
   * @param {unknown} detail - any JSON-serializable context.
   */
  async function clientLog(event, detail) {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      event: typeof event === 'string' ? event.slice(0, 120) : String(event).slice(0, 120),
      detail: detail ?? null,
    })
    try {
      const file = path.join(store.dir, 'debug.client.log')
      await mkdir(store.dir, { recursive: true })
      await appendFile(file, `${line}\n`, 'utf8')
      const info = await stat(file)
      if (info.size > 96 * 1024) {
        // Keep the newest half; a diagnostic file that fills a disk is a bug of
        // its own.
        const text = await readFile(file, 'utf8')
        await writeFile(file, text.slice(Math.floor(text.length / 2)), 'utf8')
      }
    } catch (error) {
      logger?.warn?.(`dsh-comfyui-workspace: 浏览器日志写入失败：${error?.message ?? error}`)
    }
    return { logged: true }
  }

  /** A prompt built without queueing it — what the panel shows before a run. */
  async function previewPrompt(id, runConfig) {
    const record = await store.getWorkflow(id)
    if (record === undefined) throw new ComfyError('invalid', '找不到这个工作流')
    const classes = classesOf(record.raw)
    let objectInfo = null
    try {
      objectInfo = await objectInfoFor(classes)
    } catch (error) {
      return { ok: false, message: `取不到服务器节点信息：${error?.message ?? error}`, prompt: null, warnings: [], errors: [] }
    }
    const built = buildPrompt({ raw: record.raw, config: runConfig ?? record.config }, objectInfo)
    return {
      ok: built.errors.length === 0,
      prompt: built.prompt,
      seeds: built.seeds,
      warnings: built.warnings,
      errors: built.errors,
      nodeCount: Object.keys(built.prompt).length,
      summary: Object.entries(built.values).map(([nodeId, info]) => ({
        nodeId,
        type: info.type,
        title: info.title,
        values: Object.fromEntries(Object.entries(info.values).map(([key, value]) => [key, preview(value)])),
      })),
    }
  }

  return {
    init,
    publicSettings,
    saveSettings,
    selectServer,
    stats,
    freeMemory,
    testServer,
    serverSummary,
    overview,
    listWorkflows,
    workflowDetail,
    importWorkflow,
    updateWorkflow,
    deleteWorkflow,
    run,
    stop,
    state,
    waitFor,
    upload,
    view,
    models,
    openLocalDirectory,
    listArchive,
    getArchive,
    rerunArchive,
    clearArchive,
    previewPrompt,
    clientLog,
    get active() {
      return runner.active
    },
  }
}
