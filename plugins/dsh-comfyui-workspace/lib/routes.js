/**
 * dsh-comfyui-workspace — the panel's HTTP API.
 *
 * One POST route dispatches by method name (`api/comfyui-workspace/<method>`)
 * plus one GET route that streams a file back. The client calls both with a
 * **document-relative** path, so a GUI served under a reverse-proxy prefix still
 * reaches them.
 *
 * Every request passes Connection's own trust and authentication check first:
 * these routes carry the user's ComfyUI credentials and must not answer an
 * unauthenticated caller.
 *
 * @module dsh-comfyui-workspace/routes
 */

import { ComfyError } from './comfy.js'

/** Route prefix, absolute (the Host matches absolute paths). */
export const ROUTE_BASE = '/api/comfyui-workspace'

/** Largest request body this API accepts, in bytes. */
const MAX_BODY_BYTES = 40 * 1024 * 1024

/** Write one JSON response. */
function writeJson(response, status, body) {
  if (response.headersSent === true) {
    response.destroy?.()
    return
  }
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

/** Write the success envelope. */
function writeOk(response, value) {
  writeJson(response, 200, { ok: true, value })
}

/** Write the failure envelope; an unexpected throw is a 500 with its message. */
function writeError(response, error) {
  if (error instanceof ComfyError) {
    const status = error.code === 'invalid' ? 400 : error.code === 'unauthorized' ? 401 : 400
    writeJson(response, status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(response, 500, { ok: false, error: { code: 'internal', message } })
}

/** Read and parse a bounded JSON body. */
async function readJsonBody(request, limit = MAX_BODY_BYTES) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > limit) throw new ComfyError('invalid', `请求体超过 ${Math.round(limit / 1024 / 1024)} MB 上限`)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ComfyError('invalid', '请求体不是合法 JSON')
  }
}

/** The request's pathname, relative to a placeholder origin. */
function pathnameOf(request) {
  return new URL(request.url ?? '/', 'http://dsh.internal').pathname
}

/** One required string field. */
function requireString(payload, key) {
  const value = payload?.[key]
  if (typeof value !== 'string' || value === '') throw new ComfyError('invalid', `缺少参数 ${key}`)
  return value
}

/**
 * The dispatch table: one entry per method the panel may call.
 * @param {ReturnType<import('./app.js').createApp>} app
 */
export function createApi(app) {
  return {
    async overview() {
      return app.overview()
    },

    async 'settings.get'() {
      return app.publicSettings()
    },

    async 'settings.save'(payload) {
      return app.saveSettings({
        servers: payload?.servers,
        activeServerId: payload?.activeServerId,
        ui: payload?.ui,
      })
    },

    async 'settings.select'(payload) {
      return app.selectServer(requireString(payload, 'id'))
    },

    async 'server.test'(payload) {
      return app.testServer(typeof payload?.serverId === 'string' ? payload.serverId : undefined)
    },

    /** Hand the server's VRAM back: unload models, empty the allocator cache. */
    async 'server.free'(payload) {
      if (app.state().running === true) {
        throw new ComfyError('invalid', '有任务正在跑，先停止再释放显存')
      }
      return app.freeMemory({
        serverId: typeof payload?.serverId === 'string' ? payload.serverId : undefined,
        unloadModels: payload?.unloadModels !== false,
        freeMemory: payload?.freeMemory !== false,
      })
    },

    async 'workflows.list'() {
      return app.listWorkflows()
    },

    async 'workflows.get'(payload) {
      return app.workflowDetail(requireString(payload, 'id'), { refresh: payload?.refresh === true })
    },

    async 'workflows.import'(payload) {
      const raw = payload?.raw
      if (raw === null || typeof raw !== 'object') throw new ComfyError('invalid', '缺少工作流内容')
      return app.importWorkflow({
        raw,
        name: typeof payload?.name === 'string' ? payload.name : '',
        sourceName: typeof payload?.sourceName === 'string' ? payload.sourceName : '',
      })
    },

    async 'workflows.update'(payload) {
      return app.updateWorkflow(requireString(payload, 'id'), {
        name: payload?.name,
        config: payload?.config,
        raw: payload?.raw,
      })
    },

    async 'workflows.delete'(payload) {
      return app.deleteWorkflow(requireString(payload, 'id'))
    },

    async 'workflows.preview'(payload) {
      return app.previewPrompt(requireString(payload, 'id'), payload?.config)
    },

    async 'run.start'(payload) {
      return app.run(requireString(payload, 'id'), payload?.config)
    },

    async 'run.stop'() {
      return app.stop()
    },

    async 'run.state'() {
      return app.state()
    },

    async 'run.wait'(payload) {
      return app.waitFor(payload?.runId, Number(payload?.timeoutMs ?? 0) || undefined)
    },

    async upload(payload) {
      const filename = requireString(payload, 'filename')
      const data = requireString(payload, 'data')
      const bytes = Buffer.from(data, 'base64')
      return app.upload({ filename, bytes, mime: typeof payload?.mime === 'string' ? payload.mime : undefined })
    },

    /** Reveal a local directory in the desktop's file manager. */
    async 'local.open'(payload) {
      return app.openLocalDirectory(payload?.dir)
    },

    async 'archive.list'(payload) {
      return app.listArchive({
        workflowId: typeof payload?.workflowId === 'string' ? payload.workflowId : undefined,
        limit: Number(payload?.limit ?? 50) || 50,
      })
    },

    async 'archive.get'(payload) {
      return app.getArchive(requireString(payload, 'id'))
    },

    async 'archive.rerun'(payload) {
      return app.rerunArchive(requireString(payload, 'id'), { freshSeed: payload?.freshSeed !== false })
    },

    async 'archive.clear'(payload) {
      return app.clearArchive({ workflowId: typeof payload?.workflowId === 'string' ? payload.workflowId : undefined })
    },

    /**
     * Browser-side diagnostics. The panel's own failures happen across an HTTP
     * boundary, where its console is invisible; these lines land in
     * `$DSH_HOME/comfyui-workspace/debug.client.log`.
     */
    async 'debug.log'(payload) {
      return app.clientLog(payload?.event, payload?.detail)
    },
  }
}

/** Loopback client addresses, in the three forms Node reports them. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])

/**
 * Whether this request came straight from a local process on this machine.
 *
 * The Host's own connection fence authenticates *browsers*, and it answers
 * `requestRejection` per request against the browser's live peer. A direct local
 * connection does not need that: a process that can already open a socket on
 * loopback can read this profile's files. A forwarded request is excluded,
 * because "loopback" is then the proxy's address, not the caller's.
 */
function directLoopback(request) {
  const address = String(request?.socket?.remoteAddress ?? '')
  if (!LOOPBACK.has(address)) return false
  const headers = request?.headers ?? {}
  return headers['x-forwarded-for'] === undefined && headers['x-real-ip'] === undefined
}

/**
 * Register the routes on a web-server context.
 *
 * @param {object} ctx - the plugin's Host context.
 * @param {ReturnType<import('./app.js').createApp>} app
 * @param {{info?: Function, warn?: Function}} [logger]
 * @returns {() => void} the disposer removing both routes.
 */
export function registerRoutes(ctx, app, logger) {
  const api = createApi(app)

  /**
   * Accept when the Host fence approves, or when the request is a direct local
   * connection. Both are checked per request: the connection service can register
   * after this plugin, so a captured value would be stale.
   */
  const fence = (request) => {
    let rejection
    let fenced = false
    try {
      const connection = ctx.connection ?? ctx.get?.('connection')
      if (connection !== null && connection !== undefined && typeof connection.requestRejection === 'function') {
        fenced = true
        rejection = connection.requestRejection(request)
      }
    } catch (error) {
      logger?.warn?.(`dsh-comfyui-workspace: 连接围栏异常，按本机规则放行：${error?.message ?? error}`)
      fenced = false
    }
    const approved = fenced ? rejection === undefined || rejection === null : true
    if (approved) return true
    if (directLoopback(request)) return true
    logger?.warn?.(`dsh-comfyui-workspace: 拒绝非本机请求（fence=${String(rejection)}）`)
    return false
  }

  const disposers = []

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: async (request, response) => {
      if (!fence(request)) {
        writeError(response, new ComfyError('unauthorized', '这个入口只对已认证的本机会话开放'))
        return
      }
      const pathname = pathnameOf(request)
      const method = pathname.startsWith(`${ROUTE_BASE}/`) ? pathname.slice(ROUTE_BASE.length + 1) : ''

      if (method === 'view') {
        if (request.method !== 'GET') {
          writeError(response, new ComfyError('invalid', 'view 只接受 GET'))
          return
        }
        try {
          const params = new URL(request.url ?? '/', 'http://dsh.internal').searchParams
          const file = await app.view({
            filename: params.get('filename') ?? '',
            subfolder: params.get('subfolder') ?? '',
            type: params.get('type') ?? 'output',
          })
          response.writeHead(file.status, file.headers)
          response.end(file.body)
        } catch (error) {
          writeError(response, error)
        }
        return
      }

      if (request.method !== 'POST') {
        writeError(response, new ComfyError('invalid', '这个入口只接受 POST'))
        return
      }
      if (method === '' || method.includes('/')) {
        writeError(response, new ComfyError('invalid', '未知接口'))
        return
      }
      const handler = Object.hasOwn(api, method) ? api[method] : undefined
      if (typeof handler !== 'function') {
        writeError(response, new ComfyError('invalid', `未知接口 ${method}`))
        return
      }
      try {
        const payload = await readJsonBody(request)
        const value = await handler(payload)
        writeOk(response, value ?? null)
      } catch (error) {
        if (!(error instanceof ComfyError)) {
          logger?.warn?.(`dsh-comfyui-workspace: ${method} 失败：${error?.stack ?? error}`)
        }
        writeError(response, error)
      }
    },
  }))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        /* unloading must not throw */
      }
    }
  }
}
