/**
 * 下班倒计时 — Host 半边。
 *
 * 界面（倒计时胶囊 + 烟花画布）在浏览器里，但有三件事必须由 Host 负责：
 *
 *  1. **设置持久化**：客户端 `localStorage` 会随 DSH 重启换端口而失效，所以设置
 *     写到 `$DSH_HOME/offwork-countdown/settings.json`，插件升级/重启都保留。
 *  2. **到点提示**：页面的 `setInterval` 在窗口后台会被 Chromium 节流，1 秒的看门狗
 *     可能延迟很久。这里在 Host 侧独立定时，到点直接闪烁任务栏——不依赖页面在不在
 *     前台、也不依赖页面计时器是否被挂起。
 *  3. **待播放标记**：Host 闪完任务栏后把「今天已到点、烟花还没放」记到
 *     `state.json`；页面回到前台（或重新加载）时来取，拿到了再播放，避免页面在后台
 *     时动画放掉没人看见。
 *
 * 没有任何 `@deepseek-ai/*` import：路由用普通的 `webServer.register` 契约。
 *
 * @module dsh-offwork-countdown
 */

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { flashTaskbar } from './lib/flash.js'

/** Plugin id. Also the Loader row id in `cordis.patch.yml`. */
export const name = 'dsh-offwork-countdown'

/** Keep in sync with `package.json`. */
export const VERSION = '0.2.2'

/** Route prefix the client appends to the document base. */
const ROUTE_BASE = '/api/offwork-countdown'

/** Settings document schema version. */
const SETTINGS_VERSION = 1

/** A settings POST is small; anything larger is a mistake, not a payload. */
const MAX_BODY_BYTES = 64 * 1024

/** Flash requests are cheap but a stuck client must not spawn a process storm. */
const FLASH_COOLDOWN_MS = 1500

/** A timer longer than this is clamped; the callback then reschedules. */
const MAX_TIMER_MS = 2_147_483_647

/** Same defaults the client uses, so a missing/broken file reads as "unset". */
export const DEFAULT_SETTINGS = Object.freeze({
  start: '09:00',
  end: '18:00',
  fireworks: Object.freeze({ enabled: true, scope: 'window', density: 'high', duration: 'long' }),
})

const FIREWORK_SCOPES = Object.freeze(['conversation', 'window'])
const FIREWORK_DENSITIES = Object.freeze(['low', 'normal', 'high', 'ultra'])
const FIREWORK_DURATIONS = Object.freeze(['short', 'normal', 'long', 'longer'])

/** @param {Record<string, string | undefined>} [env] @returns {string} */
export function resolveHomeDir(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured === '' ? path.join(homedir(), '.dsh') : configured
}

/** @param {Record<string, string | undefined>} [env] @returns {string} */
export function resolveSettingsPath(env = process.env) {
  return path.join(resolveHomeDir(env), 'offwork-countdown', 'settings.json')
}

/** @param {Record<string, string | undefined>} [env] @returns {string} */
export function resolveStatePath(env = process.env) {
  return path.join(resolveHomeDir(env), 'offwork-countdown', 'state.json')
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * Normalize one "HH:MM" value; anything unparseable falls back.
 *
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeHM(value, fallback) {
  if (typeof value !== 'string') return fallback
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return fallback
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback
  return `${pad2(hours)}:${pad2(minutes)}`
}

/** @param {unknown} raw @returns {{ enabled: boolean, scope: string, density: string, duration: string }} */
export function normalizeFireworks(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.fireworks.enabled,
    scope: FIREWORK_SCOPES.includes(source.scope) ? source.scope : DEFAULT_SETTINGS.fireworks.scope,
    density: FIREWORK_DENSITIES.includes(source.density) ? source.density : DEFAULT_SETTINGS.fireworks.density,
    duration: FIREWORK_DURATIONS.includes(source.duration) ? source.duration : DEFAULT_SETTINGS.fireworks.duration,
  }
}

/** @param {unknown} raw @returns {{ start: string, end: string, fireworks: ReturnType<typeof normalizeFireworks> }} */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    start: normalizeHM(source.start, DEFAULT_SETTINGS.start),
    end: normalizeHM(source.end, DEFAULT_SETTINGS.end),
    fireworks: normalizeFireworks(source.fireworks),
  }
}

/**
 * Read the persisted settings, or `null` when the file does not exist yet.
 *
 * @param {string} file
 * @returns {Promise<ReturnType<typeof normalizeSettings> | null>}
 */
export async function readStoredSettings(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    const document = JSON.parse(text)
    const settings = document !== null && typeof document === 'object' && 'settings' in document ? document.settings : document
    return normalizeSettings(settings)
  } catch {
    return null
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Persist settings atomically: temp file, then rename over the target.
 *
 * @param {string} file
 * @param {ReturnType<typeof normalizeSettings>} settings
 */
export async function writeStoredSettings(file, settings) {
  await writeJsonAtomic(file, { version: SETTINGS_VERSION, settings, savedAt: new Date().toISOString() })
}

/** @param {string} file @returns {Promise<{ pending: { dayKey: string, at: number } | null, lastFlashAt: number | null }>} */
export async function readState(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return { pending: null, lastFlashAt: null }
  }
  try {
    const document = JSON.parse(text)
    const pending = document !== null && typeof document === 'object' && document.pending !== null && typeof document.pending === 'object'
      ? { dayKey: String(document.pending.dayKey ?? ''), at: Number(document.pending.at) || 0 }
      : null
    return {
      pending: pending !== null && pending.dayKey !== '' ? pending : null,
      lastFlashAt: Number.isFinite(Number(document?.lastFlashAt)) ? Number(document.lastFlashAt) : null,
    }
  } catch {
    return { pending: null, lastFlashAt: null }
  }
}

/** @param {string} file @param {{ pending: { dayKey: string, at: number } | null, lastFlashAt: number | null }} state */
export async function writeState(file, state) {
  await writeJsonAtomic(file, { version: 1, pending: state.pending, lastFlashAt: state.lastFlashAt })
}

/** @param {Date} [date] @returns {string} local calendar day key (e.g. "Mon Nov 23 2026") */
export function dayKeyOf(date = new Date()) {
  return date.toDateString()
}

/**
 * The next weekday off-work moment strictly after `from`.
 *
 * Weekend end times are skipped: the client shows "weekend" and never crosses
 * work → off on Saturday/Sunday.
 *
 * @param {{ end: string }} settings
 * @param {Date} [from]
 * @returns {Date}
 */
export function nextOffWorkAt(settings, from = new Date()) {
  const parts = normalizeHM(settings.end, DEFAULT_SETTINGS.end).split(':')
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const candidate = new Date(from.getTime())
  candidate.setHours(hours, minutes, 0, 0)
  if (candidate.getTime() <= from.getTime()) candidate.setDate(candidate.getDate() + 1)
  while (candidate.getDay() === 0 || candidate.getDay() === 6) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

/** Only the app itself may call these routes: a foreign origin is refused. */
function loopbackOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

function sendMethodNotAllowed(response, allow) {
  response.writeHead(405, { allow, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
}

/**
 * Mount the Host half.
 *
 * @param {object} ctx - the Host context of this Loader row.
 * @param {unknown} [config] - row config (unused today; kept for forward compatibility).
 */
export function apply(ctx, config = undefined) {
  const settingsFile = resolveSettingsPath()
  const stateFile = resolveStatePath()
  const logFile = path.join(path.dirname(settingsFile), 'flash.log')
  let lastFlashAt = 0
  let scheduledAt = 0
  let timer = null

  const log = (level, message, details) => {
    try {
      const logger = ctx.logger
      if (typeof logger?.[level] === 'function') logger[level](`[offwork-countdown] ${message}`, details ?? '')
    } catch {
      /* logging must never break the plugin */
    }
  }
  const appendLog = (line) => {
    void appendFile(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => {})
  }

  const doFlash = (reason) => {
    const now = Date.now()
    if (now - lastFlashAt < FLASH_COOLDOWN_MS) return
    lastFlashAt = now
    appendLog(`flash (${reason})`)
    flashTaskbar({
      onResult: (result) => {
        appendLog(`flash result ${JSON.stringify(result)}`)
        log('debug', `taskbar flash ${JSON.stringify(result)}`)
      },
    })
  }

  /** Read settings and arm the next weekday end-of-work timer. */
  const reschedule = async () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const settings = await readStoredSettings(settingsFile)
    if (settings === null || settings.fireworks.enabled !== true) {
      scheduledAt = 0
      return
    }
    const at = nextOffWorkAt(settings)
    scheduledAt = at.getTime()
    const delay = Math.min(Math.max(1000, scheduledAt - Date.now()), MAX_TIMER_MS)
    timer = setTimeout(() => {
      timer = null
      void fireScheduled()
    }, delay)
    timer.unref?.()
    appendLog(`scheduled next flash at ${at.toISOString()} (${settings.end})`)
  }

  /** Timer body: flash the taskbar and leave a pending marker for the client. */
  const fireScheduled = async () => {
    try {
      const settings = await readStoredSettings(settingsFile)
      if (settings === null || settings.fireworks.enabled !== true) {
        await reschedule()
        return
      }
      const state = await readState(stateFile)
      const dayKey = dayKeyOf(new Date())
      await writeState(stateFile, { pending: { dayKey, at: Date.now() }, lastFlashAt: Date.now() })
      appendLog(`off-work reached: pending fireworks for ${dayKey}`)
      doFlash('scheduled end-of-work')
    } catch (error) {
      appendLog(`scheduled fire failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await reschedule().catch(() => {})
    }
  }

  ctx.effect(() => {
    void reschedule().catch((error) => log('warn', `schedule failed: ${error instanceof Error ? error.message : String(error)}`))
    return () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  }, 'offwork-countdown: off-work scheduler')

  try {
    if (typeof ctx.inject !== 'function') return
    ctx.inject(['webServer'], (webCtx) => {
      const server = webCtx.webServer
      if (server === undefined || server === null || typeof server.register !== 'function') return

      webCtx.effect(
        () =>
          server.register({
            kind: 'exact',
            path: `${ROUTE_BASE}/health`,
            handler: async (request, response) =>
              sendJson(response, 200, {
                ok: true,
                data: {
                  version: VERSION,
                  platform: process.platform,
                  settingsFile,
                  stateFile,
                  nextFlashAt: scheduledAt === 0 ? null : new Date(scheduledAt).toISOString(),
                  logFile,
                },
              }),
          }),
        'offwork-countdown: health route',
      )

      webCtx.effect(
        () =>
          server.register({
            kind: 'exact',
            path: `${ROUTE_BASE}/settings`,
            handler: async (request, response) => {
              if (!loopbackOrigin(request)) {
                sendJson(response, 403, { ok: false, error: 'forbidden' })
                return
              }
              if (request.method === 'GET') {
                const settings = await readStoredSettings(settingsFile)
                sendJson(response, 200, { ok: true, data: { settings } })
                return
              }
              if (request.method !== 'POST') {
                sendMethodNotAllowed(response, 'GET, POST')
                return
              }
              try {
                const body = await readJsonBody(request)
                const settings = normalizeSettings(body !== null && typeof body === 'object' ? body.settings : body)
                await writeStoredSettings(settingsFile, settings)
                await reschedule()
                sendJson(response, 200, { ok: true, data: { settings } })
              } catch (error) {
                sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            },
          }),
        'offwork-countdown: settings route',
      )

      // 客户端回到前台（或重新加载）时来取：有今天的 pending 就播放并清掉。
      webCtx.effect(
        () =>
          server.register({
            kind: 'exact',
            path: `${ROUTE_BASE}/pending`,
            handler: async (request, response) => {
              if (!loopbackOrigin(request)) {
                sendJson(response, 403, { ok: false, error: 'forbidden' })
                return
              }
              if (request.method !== 'GET') {
                sendMethodNotAllowed(response, 'GET')
                return
              }
              const state = await readState(stateFile)
              sendJson(response, 200, { ok: true, data: { pending: state.pending } })
            },
          }),
        'offwork-countdown: pending route',
      )

      webCtx.effect(
        () =>
          server.register({
            kind: 'exact',
            path: `${ROUTE_BASE}/played`,
            handler: async (request, response) => {
              if (!loopbackOrigin(request)) {
                sendJson(response, 403, { ok: false, error: 'forbidden' })
                return
              }
              if (request.method !== 'POST') {
                sendMethodNotAllowed(response, 'POST')
                return
              }
              try {
                const body = await readJsonBody(request)
                const state = await readState(stateFile)
                const dayKey = body !== null && typeof body === 'object' ? String(body.dayKey ?? '') : ''
                if (state.pending !== null && (dayKey === '' || state.pending.dayKey === dayKey)) {
                  await writeState(stateFile, { pending: null, lastFlashAt: state.lastFlashAt })
                }
                sendJson(response, 200, { ok: true, data: { cleared: dayKey === '' || state.pending?.dayKey === dayKey } })
              } catch (error) {
                sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            },
          }),
        'offwork-countdown: played route',
      )

      webCtx.effect(
        () =>
          server.register({
            kind: 'exact',
            path: `${ROUTE_BASE}/flash`,
            handler: (request, response) => {
              if (!loopbackOrigin(request)) {
                sendJson(response, 403, { ok: false, error: 'forbidden' })
                return
              }
              if (request.method !== 'POST') {
                sendMethodNotAllowed(response, 'POST')
                return
              }
              doFlash('client request')
              sendJson(response, 200, { ok: true, data: { flashed: process.platform === 'win32' } })
            },
          }),
        'offwork-countdown: flash route',
      )
    })
  } catch (error) {
    log('warn', `web routes unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export default { name, apply }
