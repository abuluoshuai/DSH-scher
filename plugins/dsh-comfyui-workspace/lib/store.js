/**
 * dsh-comfyui-workspace — durable state.
 *
 * Three JSON files in one directory, each read and written as a whole with an
 * atomic replace, serialized per file so a panel click and an agent tool call
 * cannot interleave a read-modify-write:
 *
 *   settings.json   the ComfyUI address, request headers, panel preferences
 *   workflows.json  imported workflow JSON + this panel's per-node configuration
 *   archive.json    what each finished run actually sent, seed included
 *
 * The server password is NOT in these files when a credential store is
 * available: it is written through `ctx.credentials` and only its presence is
 * recorded here. `settings.json` keeps it as a fallback for a lean composition
 * that has no credential service, because a panel that cannot remember a
 * password cannot reach a protected server at all.
 *
 * @module dsh-comfyui-workspace/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Bound on one imported workflow file; a bigger file is a mistake, not a graph. */
export const MAX_WORKFLOW_BYTES = 24 * 1024 * 1024

/** How long one archived text value may be before it is truncated. */
const MAX_ARCHIVE_VALUE = 40000

/** Where the plugin keeps its files when the row names no directory. */
export function resolveHome(config, environment = process.env) {
  const configured = typeof config?.home === 'string' ? config.home.trim() : ''
  if (configured !== '') return path.resolve(configured)
  const dshHome = typeof environment.DSH_HOME === 'string' && environment.DSH_HOME.trim() !== ''
    ? environment.DSH_HOME
    : path.join(environment.USERPROFILE ?? environment.HOME ?? process.cwd(), '.dsh')
  return path.join(dshHome, 'comfyui-workspace')
}

/** A filename-safe id from the current time plus randomness. */
export function makeId(prefix, random = Math.random) {
  const stamp = Date.now().toString(36)
  const salt = Math.floor(random() * 0xffffff).toString(36).padStart(4, '0')
  return `${prefix}-${stamp}-${salt}`
}

/** Clip one archived string so a 40k prompt does not bloat the file. */
function clipValue(value) {
  if (typeof value === 'string' && value.length > MAX_ARCHIVE_VALUE) {
    return `${value.slice(0, MAX_ARCHIVE_VALUE)}\n…（已截断 ${value.length - MAX_ARCHIVE_VALUE} 字）`
  }
  return value
}

/** JSON-safe copy of an archived payload with oversized strings clipped. */
function clipPayload(value, depth = 0) {
  if (depth > 12) return null
  if (typeof value === 'string') return clipValue(value)
  if (Array.isArray(value)) return value.map((item) => clipPayload(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = clipPayload(item, depth + 1)
    return out
  }
  return value
}

/** Read and parse one JSON file, or `undefined` when absent or unreadable. */
async function readJson(file) {
  try {
    const text = await readFile(file, 'utf8')
    if (text.trim() === '') return undefined
    return JSON.parse(text)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

/** Write one JSON file through a sibling temp file, so a crash cannot truncate it. */
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/** Per-file write chain: one read-modify-write at a time, in call order. */
function serialQueue() {
  const chains = new Map()
  return function enqueue(key, operation) {
    const previous = chains.get(key) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    // Keep the chain alive after a rejection, but never leave an unhandled one.
    chains.set(key, run.then(() => undefined, () => undefined))
    return run
  }
}

/** The documented settings document, with every field present. */
export function emptySettings() {
  return {
    version: 2,
    /** `[{id, name, url, username, headers}]` — the panel edits this list. */
    servers: [],
    activeServerId: '',
    ui: {
      sound: true,
      hideDisabled: true,
      pollMs: 900,
      confirmStop: true,
    },
    /** Plaintext passwords, only for a composition with no credential service. */
    secrets: {},
    updatedAt: null,
  }
}

/** One workflow's summary (what a tab bar needs). */
function summarize(record) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodeCount: Array.isArray(record.raw?.nodes) ? record.raw.nodes.length : 0,
    sourceName: record.sourceName ?? '',
  }
}

/** Reject a workflow document that cannot be a ComfyUI UI graph. */
export function validateWorkflowJson(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return '文件内容不是 JSON 对象'
  }
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    return '文件里没有 nodes 数组——请导出 ComfyUI 的「工作流」JSON，而不是 API 格式'
  }
  const usable = raw.nodes.filter((node) => node !== null && typeof node === 'object' && typeof node.type === 'string')
  if (usable.length === 0) return 'nodes 里没有带 type 的节点'
  if (!Array.isArray(raw.links)) {
    // A UI workflow always carries links; without them nothing is connected and
    // the run would silently produce an empty graph.
    return '文件里没有 links 数组，这不是 ComfyUI 的界面工作流 JSON'
  }
  return null
}

/**
 * Open the plugin's state directory.
 *
 * @param {object} options
 * @param {string} options.dir - absolute directory for the three JSON files.
 * @param {number} [options.archiveLimit] - archived runs kept per workflow.
 * @param {{info?: Function, warn?: Function}} [options.logger]
 */
export function createStore({ dir, archiveLimit = 200, logger } = {}) {
  const root = path.resolve(dir)
  const files = {
    settings: path.join(root, 'settings.json'),
    workflows: path.join(root, 'workflows.json'),
    archive: path.join(root, 'archive.json'),
  }
  const enqueue = serialQueue()

  /** Current settings document; never throws for a missing file. */
  async function readSettings() {
    const stored = await readJson(files.settings)
    const base = emptySettings()
    if (stored === undefined || stored === null || typeof stored !== 'object') return base
    return {
      ...base,
      ...stored,
      servers: Array.isArray(stored.servers) ? stored.servers : [],
      ui: { ...base.ui, ...(stored.ui ?? {}) },
      secrets: stored.secrets !== null && typeof stored.secrets === 'object' ? stored.secrets : {},
    }
  }

  /**
   * Replace the whole settings document.
   *
   * The document is owned by the caller (`lib/app.js`), which is the only place
   * that knows how a server list and its passwords fit together; this file just
   * stores what it is handed, atomically.
   */
  async function saveSettings(document) {
    return enqueue('settings', async () => {
      const next = { ...document, version: 2, updatedAt: new Date().toISOString() }
      await writeJson(files.settings, next)
      return next
    })
  }

  async function readWorkflows() {
    const stored = await readJson(files.workflows)
    if (stored === null || typeof stored !== 'object' || !Array.isArray(stored.workflows)) {
      return { version: 1, workflows: [] }
    }
    return { version: 1, workflows: stored.workflows.filter((item) => item !== null && typeof item === 'object') }
  }

  async function listWorkflows() {
    const document = await readWorkflows()
    return document.workflows.map(summarize)
  }

  async function getWorkflow(id) {
    const document = await readWorkflows()
    return document.workflows.find((item) => item.id === id)
  }

  /** A stored workflow plus derived cards, built by the caller. */
  async function addWorkflow({ name, raw, sourceName = '', config = null }) {
    return enqueue('workflows', async () => {
      const document = await readWorkflows()
      const now = new Date().toISOString()
      const record = {
        id: makeId('wf'),
        name,
        sourceName,
        raw,
        config: config ?? { nodes: {}, save: null },
        createdAt: now,
        updatedAt: now,
      }
      document.workflows.push(record)
      await writeJson(files.workflows, document)
      return record
    })
  }

  async function updateWorkflow(id, patch) {
    return enqueue('workflows', async () => {
      const document = await readWorkflows()
      const index = document.workflows.findIndex((item) => item.id === id)
      if (index === -1) return undefined
      const current = document.workflows[index]
      const next = {
        ...current,
        ...('name' in patch && typeof patch.name === 'string' && patch.name.trim() !== '' ? { name: patch.name.trim() } : {}),
        ...('config' in patch && patch.config !== null && typeof patch.config === 'object' ? { config: patch.config } : {}),
        ...('raw' in patch && patch.raw !== null && typeof patch.raw === 'object' ? { raw: patch.raw } : {}),
        updatedAt: new Date().toISOString(),
      }
      document.workflows[index] = next
      await writeJson(files.workflows, document)
      return next
    })
  }

  async function deleteWorkflow(id) {
    return enqueue('workflows', async () => {
      const document = await readWorkflows()
      const before = document.workflows.length
      document.workflows = document.workflows.filter((item) => item.id !== id)
      if (document.workflows.length === before) return false
      await writeJson(files.workflows, document)
      return true
    })
  }

  async function readArchive() {
    const stored = await readJson(files.archive)
    if (stored === null || typeof stored !== 'object' || !Array.isArray(stored.entries)) {
      return { version: 1, entries: [] }
    }
    return { version: 1, entries: stored.entries.filter((item) => item !== null && typeof item === 'object') }
  }

  /** Newest first; the panel shows a page of these. */
  async function listArchive({ workflowId, limit = 50 } = {}) {
    const document = await readArchive()
    const filtered = workflowId === undefined || workflowId === ''
      ? document.entries
      : document.entries.filter((item) => item.workflowId === workflowId)
    return filtered.slice(0, Math.max(1, Math.min(limit, 500)))
  }

  async function getArchiveEntry(id) {
    const document = await readArchive()
    return document.entries.find((item) => item.id === id)
  }

  /** Append one finished run and keep at most `archiveLimit` per workflow. */
  async function addArchive(entry) {
    return enqueue('archive', async () => {
      const document = await readArchive()
      const record = {
        ...entry,
        params: clipPayload(entry.params),
        prompt: clipPayload(entry.prompt),
      }
      document.entries.unshift(record)
      const kept = []
      const seen = new Map()
      for (const item of document.entries) {
        const key = item.workflowId ?? ''
        const count = seen.get(key) ?? 0
        if (count >= archiveLimit) continue
        seen.set(key, count + 1)
        kept.push(item)
      }
      document.entries = kept.slice(0, Math.max(archiveLimit * 20, 200))
      await writeJson(files.archive, document)
      return record
    })
  }

  async function clearArchive({ workflowId } = {}) {
    return enqueue('archive', async () => {
      const document = await readArchive()
      const entries = workflowId === undefined || workflowId === ''
        ? []
        : document.entries.filter((item) => item.workflowId !== workflowId)
      await writeJson(files.archive, { version: 1, entries })
      return document.entries.length - entries.length
    })
  }

  /** Create the directory up front so the first write is not the first failure. */
  async function ensure() {
    await mkdir(root, { recursive: true })
    logger?.info?.(`dsh-comfyui-workspace: 状态目录 ${root}`)
    return root
  }

  return {
    dir: root,
    files,
    ensure,
    readSettings,
    saveSettings,
    listWorkflows,
    getWorkflow,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    listArchive,
    getArchiveEntry,
    addArchive,
    clearArchive,
  }
}
