/**
 * dsh-comfyui-workspace — ComfyUI HTTP/WebSocket client.
 *
 * Everything here runs in the Host, never in the browser: the panel's own route
 * proxies these calls so a `localhost` ComfyUI, a LAN box, and a credentialed
 * remote server all behave the same, and no CORS or mixed-content rule decides
 * whether the panel works.
 *
 * Only platform globals are used (`fetch`, `FormData`, `Blob`, `WebSocket`),
 * so the plugin carries no dependency of its own.
 *
 * @module dsh-comfyui-workspace/comfy
 */

/** Default ComfyUI port, used when the address names none. */
const DEFAULT_PORT = '8188'

/** One failed ComfyUI call, with the machine-readable reason kept apart. */
export class ComfyError extends Error {
  /**
   * @param {string} code - one of `unreachable`, `timeout`, `unauthorized`,
   *   `http`, `invalid`, `not-json`.
   * @param {string} message - a sentence the panel can show as-is.
   * @param {{status?: number, body?: unknown}} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'ComfyError'
    this.code = code
    this.status = detail.status
    this.body = detail.body
  }
}

/**
 * Accept the ways a person types a ComfyUI address and produce the pieces the
 * client needs. A missing port becomes 8188 (ComfyUI's own default) only when
 * the address named none at all, so `https://box/proxy/comfy` is left alone.
 *
 * @param {string} input - `127.0.0.1`, `192.168.1.9:8188`, `https://gpu.lan/comfy/`.
 * @returns {{base: string, http: string, ws: string, host: string}}
 * @throws {ComfyError} when the address is empty or unparseable.
 */
export function normalizeServerUrl(input) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (text === '') throw new ComfyError('invalid', '服务器地址为空')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    throw new ComfyError('invalid', `服务器地址无法解析：${text}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ComfyError('invalid', `只支持 http/https，收到的是 ${url.protocol}`)
  }
  // `url.port` is empty both for "no port written" and for the scheme default,
  // and the second case must not silently become 8188. An https address is a
  // reverse proxy as often as not, where 443 is the port and 8188 is wrong.
  const wroteScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  const namedPort = /:\d{1,5}(\/|$)/.test(text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))
  if (url.port === '' && !namedPort && (wroteScheme === false || url.protocol === 'http:')) {
    url.port = DEFAULT_PORT
  }
  url.hash = ''
  url.search = ''
  const base = url.pathname.replace(/\/+$/, '')
  return {
    base: `${url.origin}${base}`,
    http: url.protocol === 'https:' ? 'https:' : 'http:',
    ws: url.protocol === 'https:' ? 'wss:' : 'ws:',
    host: `${url.host}${base}`,
  }
}

/** Basic-auth header for one username/password pair, or `undefined`. */
function authHeader(username, password) {
  if (typeof username !== 'string' || username === '') return undefined
  const raw = `${username}:${typeof password === 'string' ? password : ''}`
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
}

/** One abort signal that fires on either the caller's signal or the timeout. */
function combineSignals(signal, timeoutMs) {
  const signals = []
  if (signal !== undefined) signals.push(signal)
  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortSignal.timeout === 'function') {
    signals.push(AbortSignal.timeout(timeoutMs))
  }
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  return typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0]
}

/** Read a response body as JSON when it claims to be, else as text. */
async function readBody(response) {
  const text = await response.text()
  if (text === '') return null
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('json')) return text
  try {
    return JSON.parse(text)
  } catch {
    throw new ComfyError('not-json', '服务器返回的不是合法 JSON', { status: response.status, body: text.slice(0, 400) })
  }
}

/**
 * Build a ComfyUI client for one address.
 *
 * @param {object} options
 * @param {{url: string, username?: string, password?: string, headers?: object}} options.server
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs] - per request; `0` disables the deadline.
 * @param {() => string} [options.passwordFor] - read the current password per
 *   request, so a password saved in the panel reaches the next call without a
 *   plugin reload.
 */
export function createClient({ server, fetchImpl = globalThis.fetch, timeoutMs = 25000, passwordFor } = {}) {
  const address = normalizeServerUrl(server?.url ?? '')
  const extraHeaders = server?.headers !== null && typeof server?.headers === 'object' ? server.headers : {}
  const password = () => {
    if (typeof passwordFor === 'function') {
      try {
        return passwordFor()
      } catch {
        return server?.password ?? ''
      }
    }
    return server?.password ?? ''
  }

  /** Every header one request sends. */
  function headers(extra = {}) {
    const out = { accept: 'application/json', ...extraHeaders, ...extra }
    const auth = authHeader(server?.username ?? '', password())
    if (auth !== undefined) out.authorization = auth
    return out
  }

  /**
   * One request, with the error taxonomy the panel and the tools rely on.
   * @returns {Promise<unknown>} the parsed body.
   */
  async function request(path, { method = 'GET', body, signal, timeout = timeoutMs, raw = false } = {}) {
    const url = `${address.base}${path}`
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: combineSignals(signal, timeout),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        if (signal?.aborted === true) throw error
        throw new ComfyError('timeout', `请求超时（${url}）`)
      }
      throw new ComfyError('unreachable', `连不上 ComfyUI：${address.base}（${error?.message ?? error}）`)
    }
    if (raw === true) {
      if (!response.ok) {
        const detail = await readBody(response).catch(() => null)
        throw new ComfyError('http', `服务器返回 ${response.status}`, { status: response.status, body: detail })
      }
      return response
    }
    const payload = await readBody(response)
    if (response.status === 401 || response.status === 403) {
      throw new ComfyError('unauthorized', '服务器拒绝了凭据：请检查账号密码或请求头', { status: response.status, body: payload })
    }
    if (!response.ok) {
      throw new ComfyError('http', `服务器返回 ${response.status}`, { status: response.status, body: payload })
    }
    return payload
  }

  return {
    address,
    url: (path) => `${address.base}${path}`,
    /** `ws(s)://…/ws?clientId=` for the run monitor. */
    socketUrl: (clientId) => `${address.ws}//${address.host}/ws?clientId=${encodeURIComponent(clientId)}`,

    /** `/system_stats`: the reachability check the Settings dialog runs. */
    async systemStats(signal) {
      return request('/system_stats', { signal, timeout: 8000 })
    },

    /** `/object_info/<class>` for one class, or the whole map when omitted. */
    async objectInfo(className, signal) {
      const path = className === undefined ? '/object_info' : `/object_info/${encodeURIComponent(className)}`
      return request(path, { signal, timeout: 30000 })
    },

    /** `/object_info/<class>` for several classes, a few at a time. */
    async objectInfoMany(classes, { signal, concurrency = 4 } = {}) {
      const unique = [...new Set(classes.filter((name) => typeof name === 'string' && name !== ''))]
      const out = {}
      const queue = [...unique]
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
          const name = queue.shift()
          try {
            const payload = await request(`/object_info/${encodeURIComponent(name)}`, { signal, timeout: 30000 })
            if (payload !== null && typeof payload === 'object') {
              out[name] = payload[name] ?? payload
            }
          } catch (error) {
            if (error?.name === 'AbortError') return
            // A class the server does not have is a normal answer: it stays absent.
            if (error instanceof ComfyError && error.status === 404) continue
            throw error
          }
        }
      })
      await Promise.all(workers)
      return out
    },

    /** Model file names under one folder (`/models/<folder>`). */
    async models(folder, signal) {
      const payload = await request(`/models/${encodeURIComponent(folder)}`, { signal, timeout: 15000 })
      return Array.isArray(payload) ? payload : []
    },

    /** Queue the prompt; returns `{prompt_id, number, node_errors?}`. */
    async queuePrompt(prompt, clientId, signal) {
      return request('/prompt', { method: 'POST', body: { prompt, client_id: clientId }, signal, timeout: 60000 })
    },

    /** `/history/<promptId>`; `{}` while the run is still pending. */
    async history(promptId, signal) {
      const payload = await request(`/history/${encodeURIComponent(promptId)}`, { signal, timeout: 20000 })
      return payload !== null && typeof payload === 'object' ? payload : {}
    },

    /** Cancel whatever is executing. */
    async interrupt(signal) {
      return request('/interrupt', { method: 'POST', body: {}, signal, timeout: 15000 })
    },

    /**
     * Ask the server to give its VRAM back (`POST /free`).
     *
     * This is the endpoint ComfyUI's own "Free model and node cache" action
     * calls: `unload_models` drops the loaded checkpoints/diffusion models,
     * `free_memory` empties torch's caching allocator. Nothing on disk changes —
     * the next run simply loads the models again.
     *
     * @param {{unloadModels?: boolean, freeMemory?: boolean}} options
     */
    async free({ unloadModels = true, freeMemory = true } = {}, signal) {
      return request('/free', {
        method: 'POST',
        body: { unload_models: unloadModels === true, free_memory: freeMemory === true },
        signal,
        timeout: 30000,
      })
    },

    /** Cancel one pending prompt, by queue number. */
    async cancelQueued(queueNumber, signal) {
      return request('/queue', { method: 'POST', body: { delete: [queueNumber] }, signal, timeout: 15000 })
    },

    /** The pending and running queues. */
    async queue(signal) {
      return request('/queue', { signal, timeout: 10000 })
    },

    /**
     * Upload one file to the server's input directory.
     * @param {{filename: string, bytes: Uint8Array, mime?: string, type?: string}} file
     * @returns {Promise<{name: string, subfolder: string, type: string}>}
     */
    async upload(file, signal) {
      const name = String(file.filename ?? '').replace(/^.*[\\/]/, '')
      if (name === '') throw new ComfyError('invalid', '文件名是空的')
      const form = new FormData()
      form.append('image', new Blob([file.bytes], { type: file.mime ?? 'application/octet-stream' }), name)
      form.append('overwrite', 'true')
      form.append('type', file.type ?? 'input')
      let response
      try {
        response = await fetchImpl(`${address.base}/upload/image`, {
          method: 'POST',
          // No content-type: the browser/undici runtime sets the multipart boundary.
          headers: headers(),
          body: form,
          signal: combineSignals(signal, 60000),
        })
      } catch (error) {
        throw new ComfyError('unreachable', `上传失败：${error?.message ?? error}`)
      }
      const payload = await readBody(response)
      if (!response.ok) throw new ComfyError('http', `上传失败（${response.status}）`, { status: response.status, body: payload })
      return payload ?? {}
    },

    /** `/view` as a raw response, so the panel's route can stream it back. */
    async view({ filename, subfolder = '', type = 'output' }, signal) {
      const query = new URLSearchParams({ filename: String(filename), subfolder: String(subfolder), type: String(type) })
      return request(`/view?${query.toString()}`, { raw: true, signal, timeout: 60000 })
    },
  }
}

/**
 * Follow one ComfyUI execution over its WebSocket.
 *
 * The frame types this plugin needs: `executing` names the node running now
 * (and `null` when the queue moves on), `progress` carries the step counters,
 * `executed` names a node that produced output, `execution_error` and
 * `execution_success` end the run. Everything else is passed through.
 *
 * @param {object} options
 * @param {string} options.url - the `ws(s)://…/ws?clientId=` URL.
 * @param {(frame: object) => void} options.onFrame
 * @param {(reason: string) => void} [options.onClose]
 * @param {{warn?: Function}} [options.logger]
 * @returns {{close: () => void, readonly connected: boolean} | null} `null`
 *   when this Node build has no global WebSocket.
 */
export function createRunMonitor({ url, onFrame, onClose, logger } = {}) {
  const Socket = globalThis.WebSocket
  if (typeof Socket !== 'function') {
    logger?.warn?.('dsh-comfyui-workspace: 这个 Node 版本没有全局 WebSocket，改用轮询')
    return null
  }
  /** @type {WebSocket} */
  let socket
  try {
    socket = new Socket(url)
  } catch (error) {
    logger?.warn?.(`dsh-comfyui-workspace: WebSocket 打开失败（${error?.message ?? error}），改用轮询`)
    return null
  }
  let closed = false
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    let frame
    try {
      frame = JSON.parse(event.data)
    } catch {
      return
    }
    try {
      onFrame(frame)
    } catch (error) {
      logger?.warn?.(`dsh-comfyui-workspace: 处理运行事件失败（${error?.message ?? error}）`)
    }
  })
  socket.addEventListener('error', () => {
    // The `close` event follows; the caller learns about the loss there.
  })
  socket.addEventListener('close', (event) => {
    if (closed) return
    closed = true
    try {
      onClose?.(`连接关闭（code ${event.code}）`)
    } catch {
      /* a listener failure must not escape into the socket callback */
    }
  })
  return {
    get connected() {
      return !closed && socket.readyState === 1
    },
    close() {
      closed = true
      try {
        socket.close()
      } catch {
        /* already closed */
      }
    },
  }
}
