/**
 * dsh-system-monitor — the Browser panel's HTTP API.
 *
 * One prefix route serves two read-only methods:
 *
 *   GET|POST /api/system-monitor/snapshot   one metrics snapshot
 *   GET|POST /api/system-monitor/ping       liveness and version
 *
 * `webServer.register()` applies no browser fence of its own, and this payload
 * names the machine and its load, so every request is checked against
 * Connection's own trust decision first (falling back to "direct loopback" when
 * Connection is absent from the profile).
 *
 * @module dsh-system-monitor/routes
 */

/** Route prefix, absolute (the Host matches absolute paths). */
export const ROUTE_BASE = '/api/system-monitor'

/** Loopback client addresses, in the forms Node reports them. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])

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

/** A success envelope. */
function writeOk(response, value) {
  writeJson(response, 200, { ok: true, value })
}

/** A failure envelope. */
function writeError(response, status, code, message) {
  writeJson(response, status, { ok: false, error: { code, message } })
}

/**
 * Whether this request came straight from a local process on this machine.
 *
 * A forwarded request is excluded, because "loopback" is then the proxy's
 * address, not the caller's.
 */
function directLoopback(request) {
  const address = String(request?.socket?.remoteAddress ?? '')
  if (!LOOPBACK.has(address)) return false
  const headers = request?.headers ?? {}
  return headers['x-forwarded-for'] === undefined && headers['x-real-ip'] === undefined
}

/**
 * Whether this is the page itself calling, on any host.
 *
 * `sec-fetch-site` is the browser's own statement about the caller page's
 * origin, and a fetch from the panel always reports `same-origin`. This is what
 * lets the dock work when the GUI is opened from another machine (the Host runs
 * on the remote server and the request does not come from loopback), while a
 * cross-site page is still refused. The payload is read-only utilization data.
 */
function sameOriginPage(request) {
  const headers = request?.headers ?? {}
  const site = String(headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site !== 'same-origin' && site !== 'none') return false
  const host = String(headers.host ?? '')
  if (host === '') return false
  const origin = headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  // A same-origin GET carries no Origin; `sec-fetch-site` already made the claim.
  return true
}

/**
 * Register the API route.
 *
 * @param {object} ctx - a context that has `webServer`.
 * @param {{ snapshot: () => Promise<object> }} sampler
 * @param {{ version: string }} info
 * @param {{ warn?: (message: string) => void }} [logger]
 * @returns {() => void} the disposer removing the route.
 */
export function registerRoutes(ctx, sampler, info, logger) {
  let fenceWarned = false

  /**
   * Connection's fence answers per request (the service can register after this
   * plugin), so it is read on every call rather than captured once.
   *
   * Order: Connection's verdict → a direct local connection → the page itself.
   * A plugin route is not part of Connection's authenticated `/api` handshake,
   * so a browser request usually arrives without a peer and has to be admitted
   * by one of the last two rules; the payload is read-only utilization data.
   */
  const admitted = (request) => {
    try {
      const connection = ctx.connection ?? ctx.get?.('connection')
      if (connection !== null && connection !== undefined && typeof connection.requestRejection === 'function') {
        const rejection = connection.requestRejection(request)
        if (rejection === undefined || rejection === null) return true
      }
    } catch (error) {
      // Once per mount: a fence that throws on every poll must not fill the log.
      if (!fenceWarned) {
        fenceWarned = true
        logger?.warn?.(`dsh-system-monitor: 连接围栏异常，按本机规则处理：${error?.message ?? error}`)
      }
    }
    if (directLoopback(request)) return true
    return sameOriginPage(request)
  }

  return ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: async (request, response) => {
      if (!admitted(request)) {
        writeError(response, 403, 'unauthorized', '这个入口只对已认证的会话开放')
        return
      }
      const method = request.method ?? 'GET'
      if (method !== 'GET' && method !== 'POST') {
        writeError(response, 405, 'method', '只接受 GET 或 POST')
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname
      const name = pathname.startsWith(`${ROUTE_BASE}/`) ? pathname.slice(ROUTE_BASE.length + 1) : ''

      try {
        if (name === 'snapshot') {
          writeOk(response, await sampler.snapshot())
          return
        }
        if (name === 'ping') {
          writeOk(response, { version: info.version, platform: process.platform })
          return
        }
        writeError(response, 404, 'not-found', `未知接口 ${name}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger?.warn?.(`dsh-system-monitor: ${name} 失败：${error?.stack ?? message}`)
        writeError(response, 500, 'internal', message)
      }
    },
  })
}
