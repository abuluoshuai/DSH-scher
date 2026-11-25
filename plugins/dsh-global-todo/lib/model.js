/**
 * The todo entity: one plain, serializable record.
 *
 * Records are intentionally boring JSON — no class instances, no Dates — so the
 * list file stays readable, hand-editable and diffable, and so a corrupt or
 * hand-mangled entry can be tolerated on load instead of taking the list down.
 *
 * Everything here mutates a record in place and is driven by the service layer,
 * which owns persistence and the write lock.
 *
 * @module dsh-global-todo/model
 */

import { randomUUID } from 'node:crypto'

import { TodoError } from './errors.js'
import { LINK_KINDS, linkKey, normalizeLink } from './links.js'

/**
 * Bumped whenever the stored shape changes in a way that needs migration.
 *
 * 2 added the tombstone list: a removal has to leave a mark, or the next copy from a
 * machine that still had the record puts it back (see lib/replica.js). A version-1
 * document still loads — it simply has no deletions to replay yet.
 */
export const SCHEMA_VERSION = 2

/** Lifecycle states. `doing` is the explicit "an agent (or I) am on it" state. */
export const STATUSES = Object.freeze(['open', 'doing', 'done', 'cancelled', 'archived'])

/**
 * Subtask lifecycle. A child is never archived: only its parent is a list
 * record, so "archive" is a property of the whole todo, not of its parts.
 */
export const CHILD_STATUSES = Object.freeze(['open', 'doing', 'done'])

/** Priorities are deliberately coarse: three levels people actually use. */
/**
 * Levels, most urgent first: P0 紧急 / P1 高 / P2 常规 / P3 低.
 *
 * `urgent` was added in front of the original three, which is why the older
 * names stay valid: a record written before levels existed still loads without a
 * migration, and `normal` remains the default.
 */
export const PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low'])

/** Human labels for the levels, in the same order. */
export const PRIORITY_LABELS = Object.freeze({
  urgent: 'P0 紧急',
  high: 'P1 高',
  normal: 'P2 常规',
  low: 'P3 低',
})

/**
 * The labels are also accepted on the way in.
 *
 * The panel and the tools show `P0`–`P3` everywhere, so a person (or a model reading the
 * schema description) will eventually send `"P0"`; rejecting it with `invalid-priority`
 * while the UI prints exactly that string is a trap, not a validation.
 */
export const PRIORITY_ALIASES = Object.freeze({ p0: 'urgent', p1: 'high', p2: 'normal', p3: 'low' })

/** @param {unknown} value @returns {string} a canonical priority, or '' when unusable */
function canonicalPriority(value) {
  if (typeof value !== 'string') return ''
  const key = value.trim().toLowerCase()
  if (PRIORITIES.includes(key)) return key
  return PRIORITY_ALIASES[key] ?? ''
}

/** Who performed a write. Recorded on every entry of the activity trail. */
export const ACTORS = Object.freeze(['human', 'agent'])

/**
 * Where a record came from, so "which door is the loud one" can be answered later.
 *
 * `human` is the panel's own add form; the other three are all an agent writing on the person's
 * behalf, and they are the paths that need a gate. Before 0.22.0 this was not recorded at all,
 * which is why "auto-collect is too noisy" had to be argued from titles instead of counted.
 */
export const CAPTURE_SOURCES = Object.freeze(['human', 'tool', 'capture', 'ingest'])

/**
 * A priority derived from the deadline instead of from the model's mood.
 *
 * The data that forced this: 40 of the 86 open records were marked 高 and 34 of those had no
 * deadline at all. A level that anything can claim is a level that says nothing, so a record's
 * level is now a **function of its deadline** unless a person set it by hand:
 *
 * | deadline | level |
 * |---|---|
 * | none | P3 低 |
 * | more than 7 days away | P3 低 |
 * | within 7 days | P2 常规 |
 * | within 48 hours | P1 高 |
 * | overdue | P0 紧急 |
 *
 * The model's own choice is kept as `suggestedPriority` — visible in the detail and in the
 * activity trail — but it does not decide the order of the list. A person's edit wins and locks
 * the record (`prioritySource: 'human'`).
 *
 * @param {number | null} dueAt - epoch milliseconds, or null
 * @param {{ now?: number }} [options]
 * @returns {'urgent' | 'high' | 'normal' | 'low'}
 */
export function priorityForDue(dueAt, options = {}) {
  const now = options.now ?? Date.now()
  // The record stores the deadline as an ISO string (what a person typed and can read back);
  // an epoch number is accepted too, because the panel and the tests speak both.
  const at =
    typeof dueAt === 'number' ? dueAt : typeof dueAt === 'string' && dueAt.trim() !== '' ? Date.parse(dueAt) : Number.NaN
  if (!Number.isFinite(at)) return 'low'
  const remaining = at - now
  if (remaining <= 0) return 'urgent'
  if (remaining <= 48 * 60 * 60 * 1000) return 'high'
  if (remaining <= 7 * 24 * 60 * 60 * 1000) return 'normal'
  return 'low'
}

/** Field limits. Exported so the tools' JSON Schemas and the tests agree. */
export const LIMITS = Object.freeze({
  title: 200,
  description: 10000,
  tags: 20,
  tag: 32,
  activity: 50,
  note: 2000,
  notes: 50,
  // A todo is a unit of work, not a project plan: a list longer than this is a sign the
  // item should be split, and a cap keeps the dispatch prompt from becoming a document.
  steps: 20,
  step: 200,
  // Subtasks are the order an agent should work in. A parent with more than this
  // is a project, not a todo; the cap keeps the dispatch prompt readable.
  children: 50,
  child: 200,
  // The sentence the item came from. A captured todo without its source reads as an
  // opinion later; with it, the person can check whether it was heard correctly.
  evidence: 300,
})

/**
 * Short, human-quotable id. `t-` + 8 hex characters; collision-checked against
 * the ids already in the list.
 *
 * @param {Iterable<string>} [used]
 * @returns {string}
 */
export function newId(used = []) {
  const taken = new Set(used)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `t-${randomUUID().replace(/-/g, '').slice(0, 8)}`
    if (!taken.has(candidate)) return candidate
  }
  throw new TodoError('internal', '无法生成不重复的待办 id')
}

/**
 * Give every record its human-facing number.
 *
 * Existing numbers are kept so "把 #42 交给 Agent" stays true after other records are
 * deleted; records without one are numbered in creation order, and the next write
 * persists them. A file that never gets written again keeps deriving the same numbers.
 *
 * The function is deliberately a pure function of the *set* of records — not of the order
 * they were written in, and not of which machine wrote them. Two machines that each
 * created a todo while the other was offline both pick the same next number; the fold in
 * lib/replica.js runs this afterwards, and because the input set is the same, both sides
 * renumber the loser to the same value without coordinating. That is why the tie-break is
 * `createdAt` then `id`: both are facts carried by the record.
 *
 * @param {object[]} todos
 * @returns {object[]} the same array, numbered in place
 */
export function assignSequence(todos) {
  let max = 0
  for (const todo of todos) if (Number.isInteger(todo.seq) && todo.seq > max) max = todo.seq
  const missing = todos.filter((todo) => !Number.isInteger(todo.seq) || todo.seq <= 0)
  const byCreation = (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  missing.sort(byCreation)
  for (const todo of missing) todo.seq = ++max
  // Two machines numbering offline both hand out "next". The earlier record keeps the
  // number — it is the one a person would have seen first — and the later one moves.
  const taken = new Map()
  for (const todo of [...todos].sort(byCreation)) {
    if (!taken.has(todo.seq)) {
      taken.set(todo.seq, todo)
      continue
    }
    todo.seq = ++max
  }
  return todos
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function normalizeText(value, field, max, code) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new TodoError(code, `${field} 必须是字符串`)
  const text = value.trim()
  if (text.length > max) throw new TodoError(code, `${field} 最多 ${max} 个字符`)
  return text
}

/**
 * @param {unknown} value
 * @returns {string | null} canonical ISO-8601 (UTC) or null
 */
/**
 * The shapes a deadline may take: a date, or a date with time, optionally zoned.
 *
 * The old implementation was a bare `Date.parse`, which accepts `"2026"` (January 1st,
 * invented), `"October 2026"` (implementation-defined, timezone-dependent) and anything
 * else the engine happens to recognise. A deadline that silently becomes New Year's Day
 * is worse than a rejected one.
 */
const DUE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/

/**
 * @param {unknown} value
 * @returns {{ ok: true, iso: string } | { ok: false, reason: string }}
 */
export function parseDueText(value) {
  if (typeof value !== 'string') return { ok: false, reason: '不是字符串' }
  const text = value.trim()
  const match = DUE_SHAPE.exec(text)
  if (match === null) return { ok: false, reason: '只接受 2026-10-20 / 2026-10-20T10:00 / 带时区三种写法' }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return { ok: false, reason: '月份不合法' }
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return { ok: false, reason: '日期不合法' }
  if (match[4] !== undefined && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59)) {
    return { ok: false, reason: '时间不合法' }
  }
  // A date without a time means "that day, as the person reading the list experiences it", so
  // it is anchored at **local** midnight. `Date.parse('2026-11-01')` is UTC midnight per the
  // specification — on +08 that is 08:00 local, which made `before:2026-11-01` swallow the
  // first eight hours of the bound day (issue #6). Date-times keep their usual meaning: no
  // offset means local, an offset means that offset.
  let parsed
  if (match[4] === undefined) {
    parsed = new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
  } else {
    parsed = Date.parse(text)
  }
  if (Number.isNaN(parsed)) return { ok: false, reason: '无法解析' }
  return { ok: true, iso: new Date(parsed).toISOString() }
}

/**
 * @param {unknown} value
 * @returns {boolean} whether this value would be accepted as a deadline
 */
export function isValidDue(value) {
  return typeof value === 'string' && value.trim() !== '' && parseDueText(value).ok === true
}

/**
 * @param {unknown} value
 * @returns {string | null} canonical ISO-8601 (UTC) or null
 */
export function normalizeDue(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new TodoError('invalid-due', '截止时间必须是 ISO-8601 字符串')
  if (value.trim() === '') return null
  const verdict = parseDueText(value)
  if (verdict.ok !== true) {
    throw new TodoError('invalid-due', `无法解析截止时间：${value}（${verdict.reason}；例如 2026-10-20 或 2026-10-20T10:00）`)
  }
  return verdict.iso
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeTags(value) {
  if (value === undefined || value === null || value === '') return []
  const list = typeof value === 'string' ? value.split(',') : value
  if (!Array.isArray(list)) throw new TodoError('invalid-tags', '标签必须是字符串数组或逗号分隔的字符串')
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (typeof raw !== 'string') throw new TodoError('invalid-tags', '标签必须是字符串')
    const tag = raw.trim().replace(/^#/, '')
    if (tag === '') continue
    if (tag.length > LIMITS.tag) throw new TodoError('invalid-tags', `单个标签最多 ${LIMITS.tag} 个字符`)
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length > LIMITS.tags) throw new TodoError('invalid-tags', `标签最多 ${LIMITS.tags} 个`)
  }
  return out
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} code
 * @param {string} field
 * @param {string} fallback
 * @returns {string}
 */
/**
 * Priority accepts the canonical names and the P0–P3 labels the panel prints.
 *
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizePriorityField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const canonical = canonicalPriority(value)
  if (canonical === '') {
    throw new TodoError('invalid-priority', `优先级只能是 ${PRIORITIES.join(' / ')}（或 P0–P3 标签），收到 ${String(value)}`)
  }
  return canonical
}
function normalizeEnum(value, allowed, code, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') throw new TodoError(code, `${field} 必须是字符串`)
  const text = value.trim().toLowerCase()
  if (!allowed.includes(text)) {
    throw new TodoError(code, `${field}只能是 ${allowed.join(' / ')}，收到 ${value}`)
  }
  return text
}

/**
 * @param {unknown} value
 * @returns {'human' | 'agent'}
 */
export function normalizeActor(value) {
  return value === 'agent' ? 'agent' : 'human'
}

/**
 * Append one entry to the audit trail, trimming the oldest beyond the limit.
 *
 * @param {object} todo
 * @param {{ kind: string, by?: string, summary?: string, at?: number }} entry
 * @param {number} limit
 */
export function pushActivity(todo, entry, limit = LIMITS.activity) {
  if (!Array.isArray(todo.activity)) todo.activity = []
  todo.activity.push({
    at: entry.at ?? Date.now(),
    by: normalizeActor(entry.by),
    kind: entry.kind,
    ...(entry.summary === undefined || entry.summary === '' ? {} : { summary: entry.summary }),
  })
  while (todo.activity.length > limit) todo.activity.shift()
}

/**
 * Build a fresh record.
 *
 * @param {object} input
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {'human' | 'agent'} [options.by]
 * @param {Iterable<string>} [options.usedIds]
 * @param {number} [options.activityLimit]
 * @param {(path: string) => boolean} [options.exists]
 * @param {boolean} [options.requireExistingFiles]
 * @param {{ dir?: string, sessionId?: string }} [options.origin] - where this todo came from
 * @returns {object}
 */
export function createTodo(input, options = {}) {
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  const raw = input !== null && typeof input === 'object' ? input : {}

  const title = normalizeText(raw.title, '标题', LIMITS.title, 'invalid-title')
  if (title === '') throw new TodoError('invalid-title', '标题不能为空')

  const links = normalizeLinks(raw.links, options)

  // The deadline is read before the record is built: the level is derived from it below.
  const dueAt = normalizeDue(raw.dueAt ?? raw.due)
  const byHand = options.prioritySource === 'human'
  // A person's own entry keeps the level they typed (default 常规); an agent's entry gets the
  // level its deadline implies, and its own choice is kept as a suggestion.
  const suggestion = normalizePriorityField(raw.priority, '')
  const priority = byHand ? normalizePriorityField(raw.priority, 'normal') : priorityForDue(dueAt, { now })

  const todo = {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : newId(options.usedIds ?? []),
    title,
    description: normalizeText(raw.description, '描述', LIMITS.description, 'invalid-description'),
    status: normalizeEnum(raw.status, STATUSES, 'invalid-status', '状态', 'open'),
    priority,
    /**
     * 'human' means a person set this level and nothing recomputes it; 'rule' means it is a
     * function of the deadline (see `priorityForDue`) and moves when the deadline moves.
     */
    prioritySource: byHand ? 'human' : 'rule',
    /** What an agent asked for, kept so the request is not lost — it just does not decide. */
    suggestedPriority: suggestion,
    /** Which door wrote this record: human / tool / capture / ingest. */
    captureSource: CAPTURE_SOURCES.includes(options.captureSource) ? options.captureSource : '',
    /** Why it is waiting in the inbox: 'no-due', 'quota', or '' when it went straight in. */
    inboxReason: '',
    dueAt,
    tags: normalizeTags(raw.tags),
    links,
    // An optional plan inside the todo: the steps a person or an agent broke it into.
    // Shipped to the agent as a numbered list, so hand-off stops being one paragraph.
    steps: normalizeSteps(raw.steps),
    // A subtask is a full todo with a parent pointer; the parent's status is
    // derived from its direct children (see recomputeParentStatuses).
    parentId: typeof raw.parentId === 'string' ? raw.parentId.trim() : '',
    // Position among siblings; lower comes first. The array is not stored — the
    // order is a field so a reorder is one small write and survives merges.
    order: Number.isInteger(raw.order) && raw.order >= 0 ? raw.order : 0,
    // Where it came from, in the author's own words: empty means "typed here".
    evidence: normalizeText(raw.evidence, '原话', LIMITS.evidence, 'invalid-evidence'),
    createdAt: now,
    updatedAt: now,
    createdBy: by,
    updatedBy: by,
    doneAt: null,
    sessionId: '',
    // Where the todo was written from. A hand-off into a *new* session starts in
    // this directory, which is what makes "hand it over" land somewhere useful
    // instead of in a session with no working directory at all.
    originDir: typeof options.origin?.dir === 'string' ? options.origin.dir : '',
    originSessionId: typeof options.origin?.sessionId === 'string' ? options.origin.sessionId : '',
    lastDispatch: null,
    // How it finished: a summary and the artifacts the work produced. Kept
    // beside the status rather than inside it, because "done" alone says
    // nothing about what was done.
    completion: null,
    // Set when an agent finishes something: the person who owns the list confirms it or
    // sends it back. An agent's "done" is a claim, not a decision.
    review: null,
    // An append-only trail of what happened while the todo was open. Unlike the
    // description (the user's own text) this is where an agent reports progress or
    // says it is blocked, so reporting never has to rewrite someone's words.
    notes: [],
    activity: [],
  }
  pushActivity(todo, { kind: 'created', by, at: now, summary: title }, options.activityLimit ?? LIMITS.activity)
  return todo
}

/**
 * @param {unknown} value
 * @param {object} [options] - same options as {@link normalizeLink}
 * @returns {Array<{ kind: 'url' | 'file', value: string, title: string }>}
 */
export function normalizeLinks(value, options = {}) {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value)) throw new TodoError('invalid-link', 'links 必须是数组')
  const out = []
  const seen = new Set()
  for (const item of value) {
    const link = normalizeLink(item, options)
    const key = linkKey(link)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(link)
  }
  return out
}

/**
 * Tolerant load of one stored record. Returns `null` for entries that cannot be
 * salvaged, so a single mangled row never takes the whole list down.
 *
 * @param {unknown} raw
 * @param {object} [options]
 * @param {number} [options.activityLimit]
 * @returns {object | null}
 */
export function normalizeStored(raw, options = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (id === '' || title === '') return null

  const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now()
  const links = []
  if (Array.isArray(raw.links)) {
    for (const item of raw.links) {
      try {
        // Stored links were validated on write; re-validating without the
        // existence probe keeps a since-deleted document attached and visible.
        links.push(normalizeLink(item === null || typeof item !== 'object' ? item : { ...item }))
      } catch {
        /* drop unreadable attachments, keep the todo */
      }
    }
  }

  const todo = {
    id,
    // Human-facing number ("把 #42 交给 Agent"). Assigned by the store from creation
    // order; 0 means "not assigned yet" and is filled in on the next read.
    seq: Number.isInteger(raw.seq) && raw.seq > 0 ? raw.seq : 0,
    title,
    description: typeof raw.description === 'string' ? raw.description : '',
    status: STATUSES.includes(raw.status) ? raw.status : 'open',
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'normal',
    /**
     * A document from before 0.22.0 has no `prioritySource`. The guess is conservative: a record
     * somebody edited by hand is presumed deliberate (its level is kept and locked), everything
     * else is marked 'rule' so the one-time migration can derive its level from the deadline.
     */
    prioritySource:
      raw.prioritySource === 'human' || raw.prioritySource === 'rule'
        ? raw.prioritySource
        : normalizeActor(raw.updatedBy) === 'human'
          ? 'human'
          : 'rule',
    suggestedPriority: PRIORITIES.includes(raw.suggestedPriority) ? raw.suggestedPriority : '',
    captureSource: CAPTURE_SOURCES.includes(raw.captureSource) ? raw.captureSource : '',
    inboxReason: typeof raw.inboxReason === 'string' ? raw.inboxReason.slice(0, 24) : '',
    dueAt: (() => {
      try {
        return normalizeDue(raw.dueAt)
      } catch {
        return null
      }
    })(),
    tags: (() => {
      try {
        // Stored data is repaired rather than rejected: keep the readable tags
        // and drop whatever else got in there.
        return normalizeTags(Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string') : raw.tags)
      } catch {
        return []
      }
    })(),
    links,
    evidence: typeof raw.evidence === 'string' ? raw.evidence.slice(0, LIMITS.evidence) : '',
    steps: (() => {
      try {
        return normalizeSteps(raw.steps)
      } catch {
        return []
      }
    })(),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : '',
    order: Number.isInteger(raw.order) && raw.order >= 0 ? raw.order : 0,
    createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : createdAt,
    createdBy: normalizeActor(raw.createdBy),
    updatedBy: normalizeActor(raw.updatedBy),
    doneAt: Number.isFinite(raw.doneAt) ? Number(raw.doneAt) : null,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
    originDir: typeof raw.originDir === 'string' ? raw.originDir : '',
    originSessionId: typeof raw.originSessionId === 'string' ? raw.originSessionId : '',
    lastDispatch: raw.lastDispatch !== null && typeof raw.lastDispatch === 'object' ? raw.lastDispatch : null,
    completion: normalizeCompletion(raw.completion),
    review: normalizeReview(raw.review),
    notes: normalizeNotes(raw.notes),
    activity: Array.isArray(raw.activity)
      ? raw.activity
          .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.kind === 'string')
          .slice(-(options.activityLimit ?? LIMITS.activity))
          .map((entry) => ({
            at: Number.isFinite(entry.at) ? Number(entry.at) : createdAt,
            by: normalizeActor(entry.by),
            kind: entry.kind,
            ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
          }))
      : [],
  }
  return todo
}

/**
 * A stored review mark, repaired rather than rejected.
 *
 * Only one shape exists today — an agent finished this and the owner has not answered —
 * so anything else is dropped instead of guessed at.
 *
 * @param {unknown} raw
 * @returns {{ pending: true, at: number, by: string } | null}
 */
function normalizeReview(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.pending !== true) return null
  return {
    pending: true,
    at: Number.isFinite(raw.at) ? Number(raw.at) : Date.now(),
    by: normalizeActor(raw.by),
  }
}

/**
 * Answer the question an agent left behind.
 *
 * Confirm keeps the todo finished and drops the mark; reject puts it back on the list,
 * because "not actually done" is the only honest reading of a rejected claim.
 *
 * @param {object} todo
 * @param {'confirm' | 'reject'} decision
 * @param {{ now?: number, by?: 'human' | 'agent', reason?: string }} [options]
 * @returns {boolean} whether the record changed
 */
export function reviewTodo(todo, decision, options = {}) {
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by ?? 'human')
  const next = normalizeEnum(decision, ['confirm', 'reject'], 'invalid-decision', '决定', 'confirm')
  if (todo.review === null || todo.review === undefined) return false
  todo.review = null
  todo.updatedAt = now
  todo.updatedBy = by
  const reason = typeof options.reason === 'string' ? options.reason.trim().slice(0, 120) : ''
  if (next === 'reject') {
    todo.status = 'open'
    todo.doneAt = null
    todo.completion = null
    pushActivity(
      todo,
      { kind: 'reopened', by, at: now, summary: reason === '' ? '确认未完成，退回清单' : reason },
      options.activityLimit ?? LIMITS.activity,
    )
    return true
  }
  pushActivity(
    todo,
    { kind: 'reviewed', by, at: now, summary: reason === '' ? '确认完成' : reason },
    options.activityLimit ?? LIMITS.activity,
  )
  return true
}

/**
 * A stored completion record, repaired rather than rejected.
 *
 * @param {unknown} raw
 * @returns {object | null}
 */
function normalizeCompletion(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const artifacts = []
  if (Array.isArray(raw.artifacts)) {
    for (const item of raw.artifacts) {
      try {
        artifacts.push(normalizeLink(item))
      } catch {
        /* drop an unreadable artifact, keep the completion */
      }
    }
  }
  return {
    at: Number.isFinite(raw.at) ? Number(raw.at) : Date.now(),
    by: normalizeActor(raw.by),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
    artifacts,
  }
}

/**
 * A stored note trail, repaired rather than rejected.
 *
 * @param {unknown} raw
 * @returns {{ at: number, by: string, text: string }[]}
 */
function normalizeNotes(raw) {
  if (!Array.isArray(raw)) return []
  const notes = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    if (typeof item.text !== 'string' || item.text.trim() === '') continue
    notes.push({
      at: Number.isFinite(item.at) ? Number(item.at) : Date.now(),
      by: normalizeActor(item.by),
      text: item.text.slice(0, LIMITS.note),
    })
  }
  return notes.slice(-LIMITS.notes)
}

/**
 * Append a note.
 *
 * The trail is capped rather than unbounded: a hand-off loop that reports every
 * few minutes must not turn one record into a log file.
 *
 * @param {object} todo
 * @param {string} text
 * @param {{ by?: 'human' | 'agent', now?: number, activityLimit?: number }} [options]
 * @returns {{ at: number, by: string, text: string }}
 */
export function addNote(todo, text, options = {}) {
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  const note = {
    at: now,
    by,
    text: normalizeText(text, '进展内容', LIMITS.note, 'invalid-description'),
  }
  const existing = Array.isArray(todo.notes) ? todo.notes : []
  todo.notes = [...existing, note].slice(-LIMITS.notes)
  todo.updatedAt = now
  todo.updatedBy = by
  pushActivity(
    todo,
    { kind: 'noted', by, at: now, summary: note.text.slice(0, 120) },
    options.activityLimit ?? LIMITS.activity,
  )
  return note
}

/**
 * Mark a todo finished, with evidence.
 *
 * @param {object} todo
 * @param {{ summary?: string, artifacts?: unknown[], sessionId?: string }} evidence
 * @param {object} [options]
 * @returns {boolean} whether the record changed
 */
export function completeTodo(todo, evidence = {}, options = {}) {
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by ?? 'agent')
  const summary = normalizeText(evidence.summary, '完成说明', LIMITS.description, 'invalid-description')
  // An artifact is a claim about what the work produced, not an attachment the
  // user is adding: a file that has since moved, or one outside the store's
  // reach, must not cost the record its completion.
  const artifacts = normalizeLinks(evidence.artifacts, { ...options, requireExistingFiles: false })
  const alreadyDone = todo.status === 'done'
  todo.status = 'done'
  todo.doneAt = now
  todo.updatedAt = now
  todo.updatedBy = by
  todo.review = by === 'agent' ? { pending: true, at: now, by } : null
  todo.completion = {
    at: now,
    by,
    summary,
    sessionId: typeof evidence.sessionId === 'string' ? evidence.sessionId : '',
    artifacts,
  }
  pushActivity(
    todo,
    {
      kind: 'completed',
      by,
      at: now,
      summary: summary === '' ? (artifacts.length > 0 ? `${artifacts.length} 个产出` : '已完成') : summary.slice(0, 120),
    },
    options.activityLimit ?? LIMITS.activity,
  )
  return !alreadyDone
}

/**
 * Apply a partial update. Unknown keys are ignored; `undefined` means "leave it".
 *
 * @param {object} todo
 * @param {object} patch
 * @param {object} [options]
 * @returns {string[]} names of the fields that actually changed
 */
export function applyPatch(todo, patch, options = {}) {
  if (patch === null || typeof patch !== 'object') {
    throw new TodoError('invalid-body', 'patch 必须是对象')
  }
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  const changed = []

  if (patch.title !== undefined) {
    const title = normalizeText(patch.title, '标题', LIMITS.title, 'invalid-title')
    if (title === '') throw new TodoError('invalid-title', '标题不能为空')
    if (title !== todo.title) {
      todo.title = title
      changed.push('title')
    }
  }
  if (patch.description !== undefined) {
    const description = normalizeText(patch.description, '描述', LIMITS.description, 'invalid-description')
    if (description !== todo.description) {
      todo.description = description
      changed.push('description')
    }
  }
  if (patch.priority !== undefined) {
    const priority = normalizePriorityField(patch.priority, todo.priority)
    if (by === 'human') {
      // Only an actual change locks the record. The panel sends the whole draft on every save, so
      // "a person edited the title" would otherwise pin the level too — and a level the user never
      // touched should keep following the deadline.
      if (priority !== todo.priority) {
        todo.priority = priority
        todo.prioritySource = 'human'
        changed.push('priority')
      }
    } else {
      // An agent's edit is a suggestion: kept and shown, but it does not outrank the deadline.
      if (priority !== todo.suggestedPriority) {
        todo.suggestedPriority = priority
        changed.push('suggestedPriority')
      }
    }
  }
  if (patch.dueAt !== undefined || patch.due !== undefined) {
    const dueAt = normalizeDue(patch.dueAt ?? patch.due)
    if (dueAt !== todo.dueAt) {
      todo.dueAt = dueAt
      changed.push('dueAt')
      // The level is a function of the deadline again — unless a person pinned it.
      if (todo.prioritySource !== 'human') {
        const ruled = priorityForDue(dueAt, { now })
        if (ruled !== todo.priority) {
          todo.priority = ruled
          changed.push('priority')
        }
      }
    }
  }
  if (patch.tags !== undefined) {
    const tags = normalizeTags(patch.tags)
    if (tags.join('\u0000') !== todo.tags.join('\u0000')) {
      todo.tags = tags
      changed.push('tags')
      // Leaving the inbox is the confirmation: the reason stops applying, and a rule-governed
      // level is derived now that the record is on the list.
      if (!tags.some((tag) => tag.toLowerCase() === 'inbox') && todo.inboxReason !== '') {
        todo.inboxReason = ''
        if (todo.prioritySource !== 'human') {
          const ruled = priorityForDue(todo.dueAt, { now })
          if (ruled !== todo.priority) {
            todo.priority = ruled
            changed.push('priority')
          }
        }
      }
    }
  }
  if (patch.evidence !== undefined) {
    const evidence = normalizeText(patch.evidence, '原话', LIMITS.evidence, 'invalid-evidence')
    if (evidence !== todo.evidence) {
      todo.evidence = evidence
      changed.push('evidence')
    }
  }
  if (patch.steps !== undefined) {
    const steps = normalizeSteps(patch.steps)
    const same =
      steps.length === todo.steps.length && steps.every((step, index) => step.text === todo.steps[index].text && step.done === todo.steps[index].done)
    if (!same) {
      todo.steps = steps
      changed.push('steps')
    }
  }
  if (patch.status !== undefined) {
    const status = normalizeEnum(patch.status, STATUSES, 'invalid-status', '状态', todo.status)
    if (status !== todo.status) {
      todo.status = status
      todo.doneAt = status === 'done' ? now : null
      // Reaching done through a patch carries the same review rule as the dedicated
      // status path: an agent's "done" is a claim, a person's is a decision.
      todo.review = status === 'done' && by === 'agent' ? { pending: true, at: now, by } : null
      if (status !== 'done') todo.completion = null
      changed.push('status')
    }
  }
  if (patch.links !== undefined) {
    const links = normalizeLinks(patch.links, options)
    if (links.length !== todo.links.length || links.some((link, index) => linkKey(link) !== linkKey(todo.links[index]))) {
      todo.links = links
      changed.push('links')
    }
  }

  if (changed.length > 0) {
    todo.updatedAt = now
    todo.updatedBy = by
    pushActivity(
      todo,
      { kind: 'updated', by, at: now, summary: changed.join(', ') },
      options.activityLimit ?? LIMITS.activity,
    )
  }
  return changed
}

/**
 * @param {object} todo
 * @param {string} status
 * @param {object} [options]
 * @param {string} [options.reason] - why the status changed. When given it becomes the
 *   activity entry's summary, so the trail says more than "it was set to open".
 * @returns {boolean} whether anything changed
 */
export function setStatus(todo, status, options = {}) {
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  const next = normalizeEnum(status, STATUSES, 'invalid-status', '状态', todo.status)
  if (next === todo.status) return false
  todo.status = next
  todo.doneAt = next === 'done' ? now : null
  // A completion record describes a finished job, so reopening clears it: a
  // record that still claims the work is done is worse than no record.
  if (next !== 'done') todo.completion = null
  // Who finished it decides whether a person still has to agree: an agent's "done" is a
  // claim, the owner's is a decision. Leaving done drops the mark with the record.
  todo.review = next === 'done' && by === 'agent' ? { pending: true, at: now, by } : null
  todo.updatedAt = now
  todo.updatedBy = by
  const kind = next === 'done' ? 'done' : next === 'open' ? 'reopened' : 'status'
  // The status already lives in the entry's `kind`; a stated reason is the part a
  // person reading the trail afterwards cannot reconstruct.
  const reason = typeof options.reason === 'string' ? options.reason.trim().slice(0, 120) : ''
  pushActivity(
    todo,
    { kind, by, at: now, summary: reason === '' ? next : next + '：' + reason },
    options.activityLimit ?? LIMITS.activity,
  )
  return true
}

/**
 * Recompute every parent's status from its direct children, recursively.
 *
 * Children are ordinary todos with a `parentId`; ordering is the `order` field
 * (then creation time as a tie-break). A parent is open only when every direct
 * child is effectively open, done only when every direct child is effectively
 * done, and doing otherwise. An archived parent stays archived.
 *
 * @param {object[]} todos - mutated in place
 * @param {{ now?: number, by?: 'human' | 'agent', silent?: boolean, activityLimit?: number }} [options]
 * @returns {string[]} ids whose stored status changed
 */
export function recomputeParentStatuses(todos, options = {}) {
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  const byId = new Map(todos.map((todo) => [todo.id, todo]))
  const childrenOf = new Map()
  for (const todo of todos) {
    if (typeof todo.parentId !== 'string' || todo.parentId === '' || !byId.has(todo.parentId)) continue
    const bucket = childrenOf.get(todo.parentId)
    if (bucket === undefined) childrenOf.set(todo.parentId, [todo])
    else bucket.push(todo)
  }
  for (const bucket of childrenOf.values()) {
    bucket.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.createdAt - right.createdAt || (left.seq ?? 0) - (right.seq ?? 0))
  }
  const changed = []
  const visiting = new Set()
  const effective = (todo) => {
    if (visiting.has(todo.id)) return todo.status
    const children = childrenOf.get(todo.id) ?? []
    if (children.length === 0) return todo.status
    visiting.add(todo.id)
    const statuses = children.map((child) => effective(child))
    visiting.delete(todo.id)
    let next = 'doing'
    if (statuses.every((status) => status === 'open')) next = 'open'
    else if (statuses.every((status) => status === 'done')) next = 'done'
    if (todo.status === 'archived') return 'archived'
    if (todo.status !== next) {
      todo.status = next
      todo.doneAt = next === 'done' ? now : null
      todo.completion = null
      todo.review = null
      changed.push(todo.id)
      if (options.silent !== true) {
        todo.updatedAt = now
        todo.updatedBy = by
        pushActivity(
          todo,
          { kind: 'status', by, at: now, summary: `子事项自动：${next}` },
          options.activityLimit ?? LIMITS.activity,
        )
      }
    } else if (next === 'done' && todo.doneAt === null) {
      todo.doneAt = now
    }
    return todo.status
  }
  for (const todo of todos) effective(todo)
  return changed
}

/**
 * An optional plan inside a todo.
 *
 * A step is text plus a tick, and the order is the plan. Strings are accepted for the
 * common case (create, or an agent rewriting the plan) so a caller never has to spell out
 * `{ done: false }` for every line.
 *
 * @param {unknown} value
 * @returns {Array<{ text: string, done: boolean }>}
 */
export function normalizeSteps(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new TodoError('invalid-steps', '步骤必须是数组')
  if (value.length > LIMITS.steps) {
    throw new TodoError('invalid-steps', `步骤最多 ${LIMITS.steps} 条，收到 ${value.length} 条`)
  }
  const out = []
  for (const item of value) {
    if (typeof item === 'string') {
      const text = item.trim()
      // Over-long text used to be truncated silently while an over-long list was rejected;
      // two limits, two behaviours, and the quiet one loses words. Both refuse now.
      if (text.length > LIMITS.step) {
        throw new TodoError('invalid-steps', `每一步最多 ${LIMITS.step} 字，收到 ${text.length} 字`)
      }
      // A blank step used to be dropped on the floor while the caller believed it was
      // stored — and it earned the capture weight bonus for "already broken into steps".
      // The panel already filters empty lines, so this only catches a caller that meant it.
      if (text === '') throw new TodoError('invalid-steps', '步骤不能为空')
      out.push({ text, done: false })
      continue
    }
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TodoError('invalid-steps', '步骤必须是字符串或 { text, done }')
    }
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text.length > LIMITS.step) {
      throw new TodoError('invalid-steps', `每一步最多 ${LIMITS.step} 字，收到 ${text.length} 字`)
    }
    if (text === '') throw new TodoError('invalid-steps', '步骤不能为空')
    out.push({ text, done: item.done === true })
  }
  return out
}

/**
 * A subtask. Stored inline on the parent so the order is the array order — the
 * order a person sees and the order an agent is told to work in.
 *
 * @param {unknown} value
 * @returns {{ id: string, title: string, status: 'open' | 'doing' | 'done', createdAt: number, updatedAt: number, lastDispatch: object | null } | null}
 */
function normalizeChild(value) {
  if (typeof value === 'string') {
    const title = value.trim()
    return title === '' ? null : { id: '', title, status: 'open', createdAt: 0, updatedAt: 0, lastDispatch: null }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const title = typeof value.title === 'string' ? value.title.trim() : typeof value.text === 'string' ? value.text.trim() : ''
  if (title === '') return null
  return {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : '',
    title: title.slice(0, LIMITS.child),
    status: CHILD_STATUSES.includes(value.status) ? value.status : 'open',
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : 0,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
    lastDispatch: value.lastDispatch !== null && typeof value.lastDispatch === 'object' ? { ...value.lastDispatch } : null,
  }
}

/**
 * @param {unknown} value
 * @returns {Array<object>} tolerant normalization; malformed entries are dropped
 */
export function normalizeChildren(value) {
  if (value === null || value === undefined || value === '') return []
  if (!Array.isArray(value)) throw new TodoError('invalid-children', '子事项必须是数组')
  if (value.length > LIMITS.children) {
    throw new TodoError('invalid-children', `子事项最多 ${LIMITS.children} 条，收到 ${value.length} 条`)
  }
  const out = []
  const now = Date.now()
  for (const item of value) {
    const child = normalizeChild(item)
    if (child === null) continue
    out.push({
      id: child.id === '' ? newChildId(out) : child.id,
      title: child.title,
      status: child.status,
      createdAt: child.createdAt > 0 ? child.createdAt : now,
      updatedAt: child.updatedAt > 0 ? child.updatedAt : child.createdAt > 0 ? child.createdAt : now,
      lastDispatch: child.lastDispatch,
    })
  }
  return out
}

/**
 * @param {Array<object>} children
 * @returns {'open' | 'doing' | 'done' | null} derived parent status, or null when there are no children
 */
export function deriveChildrenStatus(children) {
  if (!Array.isArray(children) || children.length === 0) return null
  if (children.every((child) => child.status === 'open')) return 'open'
  if (children.every((child) => child.status === 'done')) return 'done'
  return 'doing'
}

/**
 * Force the parent status to follow its children.
 *
 * - all open -> open
 * - all done -> done
 * - any doing / some done -> doing
 *
 * An archived parent stays archived: archiving is a decision about the list
 * record, not about the work inside it.
 *
 * @param {object} todo
 * @param {{ now?: number, by?: 'human' | 'agent', silent?: boolean, activityLimit?: number }} [options]
 * @returns {boolean} whether the stored status changed
 */
export function applyChildrenStatus(todo, options = {}) {
  const next = deriveChildrenStatus(todo.children)
  if (next === null) return false
  if (todo.status === 'archived') return false
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  if (todo.status === next) {
    if (next === 'done' && todo.doneAt === null) todo.doneAt = now
    return false
  }
  todo.status = next
  todo.doneAt = next === 'done' ? now : null
  // A derived completion is not an agent's claim; clear both the old evidence
  // record and any pending review when the grouped status moves.
  todo.completion = null
  todo.review = null
  if (options.silent !== true) {
    todo.updatedAt = now
    todo.updatedBy = by
    pushActivity(
      todo,
      {
        kind: 'status',
        by,
        at: now,
        summary: `子事项自动：${next}`,
      },
      options.activityLimit ?? LIMITS.activity,
    )
  }
  return true
}

/** @param {object} todo @param {object} [options] @returns {boolean} */
export function syncChildrenStatus(todo, options = {}) {
  return applyChildrenStatus(todo, options)
}

/** @param {Array<object>} children @returns {string} */
export function newChildId(children = []) {
  const taken = new Set(children.map((child) => child.id))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `c-${randomUUID().replace(/-/g, '').slice(0, 8)}`
    if (!taken.has(candidate)) return candidate
  }
  throw new TodoError('internal', '无法生成不重复的子事项 id')
}

/** @param {object} todo @param {string} childId @returns {object | undefined} */
export function findChild(todo, childId) {
  return (todo.children ?? []).find((child) => child.id === childId)
}

/** Mark a child mutation on the parent record. */
function touchChildren(todo, now, by) {
  todo.updatedAt = now
  todo.updatedBy = normalizeActor(by)
}

/**
 * @param {object} todo
 * @param {string} title
 * @param {{ now?: number, by?: 'human' | 'agent', status?: string, activityLimit?: number }} [options]
 * @returns {object} the added child
 */
export function addChildTo(todo, title, options = {}) {
  const text = String(title ?? '').trim()
  if (text === '') throw new TodoError('invalid-children', '子事项不能为空')
  if (text.length > LIMITS.child) throw new TodoError('invalid-children', `每个子事项最多 ${LIMITS.child} 字，收到 ${text.length} 字`)
  if ((todo.children ?? []).length >= LIMITS.children) {
    throw new TodoError('invalid-children', `子事项最多 ${LIMITS.children} 条`)
  }
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  const child = {
    id: newChildId(todo.children ?? []),
    title: text,
    status: CHILD_STATUSES.includes(options.status) ? options.status : 'open',
    createdAt: now,
    updatedAt: now,
    lastDispatch: null,
  }
  todo.children = [...(todo.children ?? []), child]
  touchChildren(todo, now, by)
  pushActivity(
    todo,
    { kind: 'child-added', by, at: now, summary: text.slice(0, 120) },
    options.activityLimit ?? LIMITS.activity,
  )
  applyChildrenStatus(todo, { now, by, activityLimit: options.activityLimit })
  return child
}

/**
 * @param {object} todo
 * @param {string} childId
 * @param {{ title?: string, status?: string }} patch
 * @param {{ now?: number, by?: 'human' | 'agent', activityLimit?: number }} [options]
 * @returns {object} the updated child
 */
export function updateChildIn(todo, childId, patch = {}, options = {}) {
  const child = findChild(todo, childId)
  if (child === undefined) throw new TodoError('invalid-children', `找不到子事项 ${childId}`)
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  const changes = []
  if (patch.title !== undefined) {
    const text = String(patch.title ?? '').trim()
    if (text === '') throw new TodoError('invalid-children', '子事项不能为空')
    if (text.length > LIMITS.child) throw new TodoError('invalid-children', `每个子事项最多 ${LIMITS.child} 字，收到 ${text.length} 字`)
    if (text !== child.title) {
      child.title = text
      changes.push('文本')
    }
  }
  if (patch.status !== undefined) {
    if (!CHILD_STATUSES.includes(patch.status)) {
      throw new TodoError('invalid-children', `子事项状态只能是 ${CHILD_STATUSES.join(' / ')}`)
    }
    if (patch.status !== child.status) {
      child.status = patch.status
      changes.push(`状态→${patch.status}`)
    }
  }
  if (changes.length === 0) return child
  child.updatedAt = now
  touchChildren(todo, now, by)
  pushActivity(
    todo,
    { kind: 'child-updated', by, at: now, summary: `${child.title}：${changes.join('、')}`.slice(0, 120) },
    options.activityLimit ?? LIMITS.activity,
  )
  applyChildrenStatus(todo, { now, by, activityLimit: options.activityLimit })
  return child
}

/**
 * @param {object} todo
 * @param {string} childId
 * @param {{ now?: number, by?: 'human' | 'agent', activityLimit?: number }} [options]
 * @returns {object} the removed child
 */
export function removeChildFrom(todo, childId, options = {}) {
  const child = findChild(todo, childId)
  if (child === undefined) throw new TodoError('invalid-children', `找不到子事项 ${childId}`)
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  todo.children = (todo.children ?? []).filter((item) => item.id !== childId)
  touchChildren(todo, now, by)
  pushActivity(
    todo,
    { kind: 'child-removed', by, at: now, summary: child.title.slice(0, 120) },
    options.activityLimit ?? LIMITS.activity,
  )
  applyChildrenStatus(todo, { now, by, activityLimit: options.activityLimit })
  return child
}

/**
 * Reorder children by id list. The caller must name every current child exactly once.
 *
 * @param {object} todo
 * @param {string[]} order
 * @param {{ now?: number, by?: 'human' | 'agent', activityLimit?: number }} [options]
 * @returns {boolean} whether the order changed
 */
export function reorderChildrenOf(todo, order, options = {}) {
  const children = todo.children ?? []
  if (!Array.isArray(order) || order.length !== children.length) {
    throw new TodoError('invalid-children', '排序需要给出全部子事项的 id')
  }
  const byId = new Map(children.map((child) => [child.id, child]))
  const seen = new Set()
  const next = []
  for (const id of order) {
    const child = byId.get(id)
    if (child === undefined || seen.has(id)) throw new TodoError('invalid-children', '排序里的子事项 id 不合法')
    seen.add(id)
    next.push(child)
  }
  const same = next.every((child, index) => child.id === children[index].id)
  if (same) return false
  const now = options.now ?? Date.now()
  const by = normalizeActor(options.by)
  todo.children = next
  touchChildren(todo, now, by)
  pushActivity(
    todo,
    { kind: 'children-reordered', by, at: now, summary: '调整了子事项顺序' },
    options.activityLimit ?? LIMITS.activity,
  )
  return true
}

/**
 * Remember a hand-off of one child; the parent keeps its own lastDispatch.
 *
 * @param {object} todo
 * @param {string} childId
 * @param {{ mode: string, sessionId?: string, ok: boolean, error?: string, dir?: string }} info
 * @param {{ now?: number, by?: 'human' | 'agent', activityLimit?: number }} [options]
 * @returns {object} the child
 */
export function recordChildDispatchOn(todo, childId, info, options = {}) {
  const child = findChild(todo, childId)
  if (child === undefined) throw new TodoError('invalid-children', `找不到子事项 ${childId}`)
  const now = options.now ?? Date.now()
  const sessionId = typeof info.sessionId === 'string' ? info.sessionId : ''
  child.lastDispatch = {
    at: now,
    mode: info.mode,
    ok: info.ok === true,
    ...(sessionId === '' ? {} : { sessionId }),
    ...(typeof info.dir === 'string' && info.dir !== '' ? { dir: info.dir } : {}),
    ...(typeof info.error === 'string' && info.error !== '' ? { error: info.error } : {}),
  }
  child.updatedAt = now
  touchChildren(todo, now, options.by)
  const verb = info.ok === true ? '已派发' : '派发失败'
  pushActivity(
    todo,
    {
      kind: info.ok === true ? 'child-dispatched' : 'child-dispatch-failed',
      by: options.by ?? 'human',
      at: now,
      summary: `${verb}：${child.title.slice(0, 80)}${info.ok === true && sessionId !== '' ? ` → ${sessionId}` : ''}`,
    },
    options.activityLimit ?? LIMITS.activity,
  )
  return child
}

/**
 * @param {object} todo
 * @param {unknown} link
 * @param {object} [options]
 * @returns {{ added: boolean, link: object }}
 */
export function addLink(todo, link, options = {}) {
  const normalized = normalizeLink(link, options)
  const key = linkKey(normalized)
  if (todo.links.some((existing) => linkKey(existing) === key)) {
    return { added: false, link: normalized }
  }
  todo.links.push(normalized)
  const now = options.now ?? Date.now()
  todo.updatedAt = now
  todo.updatedBy = normalizeActor(options.by)
  pushActivity(
    todo,
    {
      kind: 'linked',
      by: options.by,
      at: now,
      summary: `${normalized.kind === 'url' ? '地址' : '文档'} ${normalized.title}`,
    },
    options.activityLimit ?? LIMITS.activity,
  )
  return { added: true, link: normalized }
}

/**
 * Remove by identity (`key`) or by 0-based index.
 *
 * @param {object} todo
 * @param {{ key?: string, index?: number }} ref
 * @param {object} [options]
 * @returns {object | null} the removed link, or null when nothing matched
 */
export function removeLink(todo, ref, options = {}) {
  let index = -1
  if (Number.isInteger(ref?.index)) {
    index = ref.index >= 0 && ref.index < todo.links.length ? ref.index : -1
  } else if (typeof ref?.key === 'string' && ref.key !== '') {
    index = todo.links.findIndex((link) => linkKey(link) === ref.key)
  }
  if (index < 0) return null
  const [removed] = todo.links.splice(index, 1)
  const now = options.now ?? Date.now()
  todo.updatedAt = now
  todo.updatedBy = normalizeActor(options.by)
  pushActivity(
    todo,
    { kind: 'unlinked', by: options.by, at: now, summary: removed.title },
    options.activityLimit ?? LIMITS.activity,
  )
  return removed
}

/**
 * Remember which session this todo is handed to, and how that went.
 *
 * @param {object} todo
 * @param {{ mode: string, sessionId?: string, ok: boolean, error?: string }} info
 * @param {object} [options]
 */
export function recordDispatch(todo, info, options = {}) {
  const now = options.now ?? Date.now()
  const sessionId = typeof info.sessionId === 'string' ? info.sessionId : ''
  todo.lastDispatch = {
    at: now,
    mode: info.mode,
    ok: info.ok === true,
    ...(sessionId === '' ? {} : { sessionId }),
    ...(typeof info.dir === 'string' && info.dir !== '' ? { dir: info.dir } : {}),
    ...(typeof info.error === 'string' && info.error !== '' ? { error: info.error } : {}),
  }
  if (info.ok === true && sessionId !== '') todo.sessionId = sessionId
  todo.updatedAt = now
  todo.updatedBy = normalizeActor(options.by ?? 'human')
  pushActivity(
    todo,
    {
      kind: info.ok === true ? 'dispatched' : 'dispatch-failed',
      by: options.by ?? 'human',
      at: now,
      summary: info.ok === true ? `${info.mode} → ${sessionId}` : `${info.mode}：${info.error ?? '未知原因'}`,
    },
    options.activityLimit ?? LIMITS.activity,
  )
}

/**
 * @param {object} todo
 * @param {number} [now]
 * @returns {boolean}
 */
export function isOverdue(todo, now = Date.now()) {
  if (todo.dueAt === null || todo.status === 'done' || todo.status === 'cancelled' || todo.status === 'archived') return false
  const due = Date.parse(todo.dueAt)
  return Number.isFinite(due) && due < now
}

/**
 * @param {object[]} todos
 * @returns {{ total: number, open: number, doing: number, done: number, cancelled: number, archived: number, overdue: number }}
 */
/**
 * How long an unfinished record may sit untouched before it is called stale.
 *
 * Three weeks is where the data pointed: the 2026-10-30 audit found 36% of the open list in the
 * 8–14 day bucket, and nothing that old was ever picked up again by the conversation that wrote
 * it. "Stale" is a question — *is this still a thing?* — never a verdict, so this feeds a filter
 * and a bulk archive, not a completion.
 */
export const STALE_DAYS = 21

/**
 * Is this record unfinished and untouched for `days`?
 *
 * Measured from `updatedAt` rather than `createdAt`: a record somebody reopened and worked on
 * yesterday is not stale just because it was created a month ago.
 *
 * @param {object} todo
 * @param {number} [now]
 * @param {number} [days]
 * @returns {boolean}
 */
export function isStale(todo, now = Date.now(), days = STALE_DAYS) {
  if (todo.status !== 'open' && todo.status !== 'doing') return false
  if (isInbox(todo)) return false
  const touched = Number(todo.updatedAt ?? todo.createdAt ?? 0)
  if (!Number.isFinite(touched) || touched <= 0) return false
  return now - touched >= days * 24 * 60 * 60 * 1000
}

/**
 * The tag that keeps a record out of the board without answering anything about it.
 *
 * `someday` is to **attention** what `inbox` is to **admission**: the inbox asks "should this
 * even be on the list?", someday says "not this week". Neither one decides whether the work is
 * done, which is the only question this plugin refuses to guess.
 *
 * Measured before it existed: 98 unfinished records, 3 of them closed on a typical day, 4 due
 * within 24 hours. A list that takes a month to clear is a list nobody reads, and the fix could
 * not be "age" — not one record was older than 14 days untouched; they were all being written
 * that same week. So the board needed a way to say "later" that costs one click and deletes
 * nothing.
 */
export const SOMEDAY_TAG = 'someday'

/** Is this record parked for later (and therefore off the board)? */
export function isSomeday(todo) {
  return (todo.tags ?? []).some((tag) => String(tag).toLowerCase() === SOMEDAY_TAG)
}

/** Is this record waiting in the inbox (and therefore not on the list)? */
export function isInbox(todo) {
  return (todo.tags ?? []).some((tag) => String(tag).toLowerCase() === 'inbox')
}

export function counts(todos, now = Date.now()) {
  const out = {
    // Counted over the *list*, not over the file: an inbox row is a question for a person, so
    // it must not inflate "全部" or "未完成" while the list it belongs to does not show it.
    total: 0,
    open: 0,
    doing: 0,
    done: 0,
    cancelled: 0,
    archived: 0,
    overdue: 0,
    inbox: 0,
    // Parked for later: off the board, still unfinished, nothing was decided about it.
    someday: 0,
    // Unfinished and untouched for STALE_DAYS. A question, not a verdict — see isStale.
    stale: 0,
    // Finished by an agent and not yet confirmed by a person. Counted separately from
    // done because "the agent says so" is not the same fact as "a person agreed".
    review: 0,
  }
  for (const todo of todos) {
    // Subtasks are part of their parent's work, not separate board entries.
    if (todo.parentId !== '') continue
    // Waiting for a person counts only while it is still active; an archived inbox item is
    // history, not a pending decision.
    const waiting = isInbox(todo) && (todo.status === 'open' || todo.status === 'doing')
    if (waiting) {
      out.inbox += 1
      continue
    }
    // Parked records are outside the board's numbers for the same reason the inbox is: the
    // count has to describe what the person is looking at, and they are not looking at these.
    if (isSomeday(todo) && (todo.status === 'open' || todo.status === 'doing')) {
      out.someday += 1
      continue
    }
    out.total += 1
    if (todo.status in out) out[todo.status] += 1
    if (isOverdue(todo, now)) out.overdue += 1
    if (isStale(todo, now)) out.stale += 1
    if (todo.status === 'done' && todo.review?.pending === true) out.review += 1
  }
  return out
}

export { LINK_KINDS }
