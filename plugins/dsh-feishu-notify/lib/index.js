/**
 * dsh-feishu-notify — Feishu completion push for DeepSeek Harness.
 *
 * One Host row. It watches every root Session on this machine and, when a turn
 * finishes, reads the durable log and pushes a Feishu message carrying:
 *
 *   - the session name (latest `session/title` event, or the first prompt),
 *   - the user prompt of the finished turn,
 *   - the assistant's final text for that turn, verbatim as markdown.
 *
 * The Feishu bot is the one configured in dsh-im: its app id comes from
 * `$DSH_HOME/integrations/<dsh-im channel>/config.json`, its app secret from the
 * Host credential store, and the default receiver is the bot owner's open id.
 * Nothing here writes into dsh-im; it only reuses that configuration.
 *
 * @module dsh-feishu-notify
 */

import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { buildCard, buildLegacyCard } from './feishu-format.js'

/** Row defaults; see cordis.patch.yml for the documented keys. */
export const DEFAULT_FEISHU_NOTIFY = Object.freeze({
  enabled: true,
  ignoreSubagents: true,
  botId: '',
  receiveIdType: 'open_id',
  receiveId: '',
  maxChars: 8000,
  log: true,
})

const TOKEN_TIMEOUT_MS = 15_000

/** Token cache shared by one Host process. */
let cachedToken = null

function readString(source, key) {
  const value = source[key]
  return typeof value === 'string' ? value.trim() : ''
}

function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const maxChars = Number(source.maxChars)
  return {
    enabled: source.enabled === undefined ? DEFAULT_FEISHU_NOTIFY.enabled : source.enabled !== false,
    ignoreSubagents:
      source.ignoreSubagents === undefined
        ? DEFAULT_FEISHU_NOTIFY.ignoreSubagents
        : source.ignoreSubagents !== false,
    botId: readString(source, 'botId'),
    receiveIdType: readString(source, 'receiveIdType') === 'chat_id' ? 'chat_id' : 'open_id',
    receiveId: readString(source, 'receiveId'),
    maxChars: Number.isFinite(maxChars) && maxChars >= 500 ? Math.min(30_000, Math.round(maxChars)) : DEFAULT_FEISHU_NOTIFY.maxChars,
    log: source.log === undefined ? DEFAULT_FEISHU_NOTIFY.log : source.log !== false,
  }
}

async function dshHome() {
  try {
    const module = await import('@deepseek-ai/dsh-home-paths')
    if (typeof module.resolveDshHome === 'function') {
      const resolved = await module.resolveDshHome()
      if (typeof resolved === 'string' && resolved !== '') return resolved
    }
  } catch {
    /* fall through */
  }
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') return process.env.DSH_HOME
  try {
    return join(homedir(), '.dsh')
  } catch {
    return undefined
  }
}

/** Find the Feishu (or Lark) bot record persisted by dsh-im. */
async function resolveFeishuBot(config) {
  const home = await dshHome()
  if (home === undefined) return null
  const root = join(home, 'integrations')
  let names
  try {
    names = await readdir(root)
  } catch {
    return null
  }
  for (const name of names) {
    if (!/feishu|lark/i.test(name)) continue
    let raw
    try {
      raw = JSON.parse(await readFile(join(root, name, 'config.json'), 'utf8'))
    } catch {
      continue
    }
    const bots = Array.isArray(raw?.bots) ? raw.bots : []
    for (const bot of bots) {
      if (bot === null || typeof bot !== 'object') continue
      if (typeof bot.appId !== 'string' || bot.appId === '') continue
      if (typeof bot.secretRef !== 'string' || bot.secretRef === '') continue
      if (config.botId !== '' && bot.id !== config.botId) continue
      return {
        id: typeof bot.id === 'string' ? bot.id : '',
        appId: bot.appId,
        secretRef: bot.secretRef,
        domain: bot.domain === 'lark' ? 'lark' : 'feishu',
        owners: Array.isArray(bot.ownerOpenIds) ? bot.ownerOpenIds.filter((value) => typeof value === 'string' && value !== '') : [],
      }
    }
  }
  return null
}

async function resolveSecret(ctx, ref) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  if (credentials === null || credentials === undefined || typeof credentials.resolve !== 'function') return undefined
  const resolved = await credentials.resolve(ref)
  if (typeof resolved === 'string') return resolved
  if (resolved !== null && resolved !== undefined && typeof resolved.value === 'string') return resolved.value
  return undefined
}

/** Read every event of one stored session, paging like dsh-im/ws-recency do. */
async function readSessionEvents(ctx, sessionId) {
  const persistence = typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined
  if (persistence === null || persistence === undefined || typeof persistence.open !== 'function') return []
  const handle = await persistence.open(sessionId, 'read')
  const all = []
  try {
    let offset = 0
    const page = 5000
    for (;;) {
      const slice = await handle.read(offset, page)
      const events = slice !== null && slice !== undefined && Array.isArray(slice.events) ? slice.events : []
      for (const event of events) all.push(event)
      if (events.length < page) break
      offset += events.length
      if (offset >= 400_000) break
    }
  } finally {
    try {
      if (typeof handle.close === 'function') await handle.close()
    } catch {
      /* closing is best effort */
    }
  }
  return all
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function messageTextOf(event) {
  const data = event?.data ?? {}
  const content = data.message !== null && data.message !== undefined ? data.message.content : data.content
  return contentText(content)
}

function sourceKindOf(event) {
  const source = event?.data?.source
  return source !== null && typeof source === 'object' && typeof source.kind === 'string' ? source.kind : ''
}

/** Pick the title, the finished turn's prompt and the final answer text. */
function digestSession(events) {
  let title = ''
  let lastTurnStart = -1
  let lastUserAnywhere = ''
  let lastAssistantAnywhere = ''
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'session/title') {
      const value = event.data?.title
      if (typeof value === 'string' && value.trim() !== '') title = value.trim()
      continue
    }
    if (event.type === 'turn/start') lastTurnStart = index
    if (event.type === 'user/message') {
      const text = messageTextOf(event)
      if (text !== '' && sourceKindOf(event) === 'user') lastUserAnywhere = text
    }
    if (event.type === 'assistant/message') {
      const text = messageTextOf(event)
      if (text !== '') lastAssistantAnywhere = text
    }
  }
  let userText = ''
  let assistantText = ''
  if (lastTurnStart >= 0) {
    for (let index = lastTurnStart; index < events.length; index += 1) {
      const event = events[index]
      if (event === null || typeof event !== 'object') continue
      if (event.type === 'user/message') {
        const text = messageTextOf(event)
        if (text !== '' && sourceKindOf(event) === 'user') userText = text
      }
      if (event.type === 'assistant/message') {
        const text = messageTextOf(event)
        if (text !== '') assistantText = text
      }
    }
  }
  if (userText === '') userText = lastUserAnywhere
  if (assistantText === '') assistantText = lastAssistantAnywhere
  if (title === '' && userText !== '') {
    const line = userText.split('\n').find((value) => value.trim() !== '') ?? ''
    title = line.trim().slice(0, 40)
  }
  return { title, userText, assistantText }
}

function buildMarkdown({ title, userText, assistantText, maxChars }) {
  const sections = []
  sections.push('**🚀 会话完成**')
  sections.push(`**会话名称：** ${title === '' ? '未命名会话' : title}`)
  if (userText !== '') sections.push(`**🙋 用户输入：**\n${userText}`)
  if (assistantText !== '') sections.push(`**📄 结果：**\n${assistantText}`)
  let body = sections.join('\n\n')
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n\n…（已截断）`
  return body
}

async function tenantAccessToken(bot, secret) {
  if (cachedToken !== null && cachedToken.appId === bot.appId && cachedToken.expireAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const base = bot.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  const response = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: bot.appId, app_secret: secret }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  const json = await response.json().catch(() => null)
  const token = json !== null && json !== undefined && typeof json.tenant_access_token === 'string' ? json.tenant_access_token : ''
  if (!response.ok || json?.code !== 0 || token === '') {
    throw new Error(`feishu token request failed (${response.status}): ${json?.msg ?? 'unknown error'}`)
  }
  const expire = Number(json.expire)
  cachedToken = {
    appId: bot.appId,
    token,
    expireAt: Date.now() + (Number.isFinite(expire) && expire > 0 ? expire * 1000 : 7_000_000),
  }
  return token
}

async function sendFeishuMessage(bot, secret, { receiveIdType, receiveId, markdown }) {
  const token = await tenantAccessToken(bot, secret)
  const base = bot.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  const response = await fetch(
    `${base}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(buildCard(markdown)),
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    },
  )
  const json = await response.json().catch(() => null)
  if (!response.ok || json?.code !== 0) {
    // Card JSON 2.0 needs a recent Feishu client/server; fall back to a 1.0
    // lark_md card with flattened markdown instead of dropping the push.
    const legacy = await fetch(
      `${base}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(buildLegacyCard(markdown)),
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      },
    )
    const legacyJson = await legacy.json().catch(() => null)
    if (!legacy.ok || legacyJson?.code !== 0) {
      throw new Error(`feishu send failed (${response.status}): ${json?.msg ?? 'unknown error'}`)
    }
    return legacyJson.data
  }
  return json.data
}

/**
 * Mount the completion push on the Host context.
 *
 * @param {object} ctx - Host context of the row.
 * @param {unknown} config - the row's `config`.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return
  const logger = ctx.logger
  const log = (message) => {
    if (resolved.log) logger?.info?.(`dsh-feishu-notify: ${message}`)
    else logger?.debug?.(`dsh-feishu-notify: ${message}`)
  }

  const lastStatus = new Map()
  let queue = Promise.resolve()

  const isSubagent = (agent) => {
    if (!resolved.ignoreSubagents) return false
    try {
      if (agent?.session?.header?.origin === 'subagent') return true
    } catch {
      /* header is optional */
    }
    const subagents = typeof ctx.get === 'function' ? ctx.get('subagents') : undefined
    if (subagents === null || subagents === undefined || typeof subagents.rootOf !== 'function') return false
    try {
      const root = subagents.rootOf(agent)
      return root !== null && root !== undefined && root.id !== agent.id
    } catch {
      return false
    }
  }

  const push = async (agent) => {
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || sessionId === '') return
    const bot = await resolveFeishuBot(resolved)
    if (bot === null) {
      log('skip: no Feishu bot configured in dsh-im')
      return
    }
    const secret = await resolveSecret(ctx, bot.secretRef)
    if (typeof secret !== 'string' || secret === '') {
      log('skip: Feishu bot secret is unavailable')
      return
    }
    const receiveId = resolved.receiveId !== '' ? resolved.receiveId : bot.owners[0] ?? ''
    if (receiveId === '') {
      log('skip: Feishu receiver is unknown (set config.receiveId)')
      return
    }
    const events = await readSessionEvents(ctx, sessionId)
    if (events.length === 0) {
      log(`skip: session ${sessionId} has no readable events`)
      return
    }
    const digest = digestSession(events)
    if (digest.assistantText === '' && digest.userText === '') {
      log(`skip: session ${sessionId} has no finished turn text`)
      return
    }
    const markdown = buildMarkdown({ ...digest, maxChars: resolved.maxChars })
    await sendFeishuMessage(bot, secret, {
      receiveIdType: resolved.receiveIdType,
      receiveId,
      markdown,
    })
    log(`pushed completion of ${sessionId} (${digest.title === '' ? 'untitled' : digest.title})`)
  }

  const enqueue = (agent) => {
    queue = queue.then(() => push(agent)).catch((error) => {
      logger?.warn?.(`dsh-feishu-notify: completion push failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const offStatus = ctx.on('agent/status', (payload) => {
    const agent = payload?.agent
    const status = payload?.status
    if (agent?.id === undefined || typeof status !== 'string') return
    const before = lastStatus.get(agent.id)
    lastStatus.set(agent.id, status)
    if (status !== 'idle' || before !== 'running') return
    if (isSubagent(agent)) return
    enqueue(agent)
  })
  const offDisposed = ctx.on('agent/disposed', (payload) => {
    const id = payload?.agent?.id
    if (id !== undefined) lastStatus.delete(id)
  })

  log('watching root Session completions')
  ctx.effect(() => () => {
    offStatus?.()
    offDisposed?.()
    lastStatus.clear()
  }, 'dsh-feishu-notify: listeners')
}

export const name = 'feishu-notify'