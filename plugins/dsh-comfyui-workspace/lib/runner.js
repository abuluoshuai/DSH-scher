/**
 * dsh-comfyui-workspace — one run, from queue to archive.
 *
 * The panel and the agent tools drive the same object, so "run it" means one
 * thing whichever caller asked: build the prompt from the saved cards, queue it,
 * follow the execution, copy the outputs it was told to keep, and archive what
 * was actually sent — seed included.
 *
 * Exactly one run is active at a time. That is a deliberate limit: the panel has
 * one output area and one set of card borders, and two concurrent runs would have
 * to explain which node id they are each lighting up.
 *
 * @module dsh-comfyui-workspace/runner
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ComfyError, createRunMonitor } from './comfy.js'
import { buildPrompt, collectOutputs, describePromptError } from './workflow.js'

/** How often the history is checked while a run is active. */
const POLL_MS = 1200

/** Consecutive polls with no queue entry and no history entry before giving up. */
const VANISH_LIMIT = 5

/** A filename that cannot escape the directory it is joined to. */
function safeSegment(value, fallback) {
  const text = String(value ?? '').trim().replace(/\\/g, '/')
  const parts = text
    .split('/')
    .map((part) => part.replace(/[\u0000-\u001f<>:"|?*]/g, '_'))
    .filter((part) => part !== '' && part !== '.' && part !== '..')
  if (parts.length === 0) return fallback
  return parts.join('/')
}

/** Join under a root and refuse a result that left it. */
function safeJoin(root, relative, fallback) {
  const base = path.resolve(root)
  const target = path.resolve(base, safeSegment(relative, fallback))
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return undefined
  return target
}

/** One fresh client id per run; ComfyUI uses it to address one subscriber. */
function newClientId() {
  const random = Math.floor(Math.random() * 0xffffffff).toString(16)
  return `dsh-comfyui-${Date.now().toString(36)}-${random}`
}

/**
 * @param {object} options
 * @param {ReturnType<import('./store.js').createStore>} options.store
 * @param {() => object} options.getClient - builds a client from the live settings.
 * @param {() => object} options.getSettings - the live settings document.
 * @param {() => object} options.getConfig - the deployment config.
 * @param {{info?: Function, warn?: Function, error?: Function}} [options.logger]
 * @param {(settled: object) => void} [options.onSettled] - called once per run.
 */
export function createRunner({ store, getClient, getSettings, getConfig, logger, onSettled }) {
  let active = null
  let last = null
  let revision = 0

  /** Everything the panel reads on every poll. */
  function state() {
    return {
      revision,
      running: active !== null,
      run: active === null ? null : {
        runId: active.runId,
        workflowId: active.workflowId,
        workflowName: active.workflowName,
        promptId: active.promptId,
        promptNumber: active.promptNumber,
        serverId: active.serverId,
        serverName: active.serverName,
        startedAt: active.startedAt,
        elapsedMs: Date.now() - active.startedAtMs,
        currentNodeId: active.currentNodeId,
        cachedNodes: [...active.cachedNodes],
        progress: active.progress,
        queueRemaining: active.queueRemaining,
        socket: active.monitor?.connected === true,
      },
      last,
      server: (() => {
        try {
          const address = getClient(active?.serverId ?? undefined).address
          return { base: address.base, serverId: active?.serverId ?? '', serverName: active?.serverName ?? '' }
        } catch (error) {
          return { base: '', error: error?.message ?? String(error) }
        }
      })(),
    }
  }

  /** Stop following the current run. Waiters are settled by `settle()`. */
  function detach() {
    if (active === null) return null
    if (active.timer !== null) clearInterval(active.timer)
    if (active.monitor !== null) active.monitor.close()
    const settled = active
    active = null
    revision += 1
    return settled
  }

  /**
   * Copy every output the run produced into its local directory.
   * A failed copy is reported per file and never fails the run itself.
   */
  async function download(files, localDir, serverId) {
    if (typeof localDir !== 'string' || localDir.trim() === '') return files
    const root = path.resolve(localDir.trim())
    await mkdir(root, { recursive: true }).catch(() => undefined)
    const client = getClient(serverId)
    for (const file of files) {
      if (file.localPath !== undefined) continue
      const relative = file.subfolder === '' ? file.filename : `${file.subfolder}/${file.filename}`
      const target = safeJoin(root, relative, file.filename)
      if (target === undefined) {
        file.downloadError = '目标路径越出了所选目录'
        continue
      }
      try {
        const response = await client.view(file)
        const bytes = new Uint8Array(await response.arrayBuffer())
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, bytes)
        file.localPath = target
      } catch (error) {
        file.downloadError = error?.message ?? String(error)
      }
    }
    return files
  }

  /** Flatten a collected `{nodeId: [file]}` map into one list. */
  function filesOf(collected) {
    const files = []
    for (const [nodeId, list] of Object.entries(collected ?? {})) {
      if (!Array.isArray(list)) continue
      for (const item of list) files.push({ ...item, nodeId })
    }
    return files
  }

  /**
   * Finish the active run.
   * @param {'success'|'error'|'canceled'} status
   * @param {{error?: string|null, outputs?: object}} detail
   */
  async function settle(status, detail) {
    const current = detach()
    if (current === null) return null
    const finishedAt = new Date().toISOString()
    // `detail.outputs` is the raw `/history` bucket map; `collectOutputs` turns it
    // into files with a media kind, which is what the panel and the archive read.
    const collected = collectOutputs({ outputs: detail.outputs ?? {} })
    let files = filesOf(collected)
    try {
      files = await download(files, current.save?.localDir, current.serverId)
    } catch (error) {
      // A failed copy must not cost us the run's record: the archive still lands,
      // each file just says why it was not downloaded.
      logger?.warn?.(`dsh-comfyui-workspace: 产出下载失败：${error?.message ?? error}`)
      files = filesOf(collected).map((file) => ({ ...file, downloadError: error?.message ?? String(error) }))
    }
    const firstSeed = Object.values(current.seeds ?? {})[0]
    const entry = {
      id: current.runId,
      workflowId: current.workflowId,
      workflowName: current.workflowName,
      serverId: current.serverId ?? '',
      serverName: current.serverName ?? '',
      status,
      error: detail.error ?? null,
      promptId: current.promptId,
      promptNumber: current.promptNumber,
      at: finishedAt,
      startedAt: new Date(current.startedAtMs).toISOString(),
      durationMs: Date.now() - current.startedAtMs,
      seed: typeof firstSeed === 'number' ? firstSeed : null,
      seeds: current.seeds ?? {},
      seedFields: current.seedFields ?? {},
      params: current.values ?? {},
      save: current.save ?? null,
      files,
      prompt: current.prompt ?? {},
    }
    last = {
      runId: entry.id,
      workflowId: entry.workflowId,
      workflowName: entry.workflowName,
      serverId: entry.serverId,
      serverName: entry.serverName,
      status,
      error: entry.error,
      at: entry.at,
      durationMs: entry.durationMs,
      seed: entry.seed,
      fileCount: files.length,
      outputs: collected,
      files,
    }
    revision += 1
    // The archive lands before any waiter is released: a caller that waited for
    // the run and then lists the archive must not see it missing.
    try {
      await store.addArchive(entry)
    } catch (error) {
      logger?.warn?.(`dsh-comfyui-workspace: 归档写入失败：${error?.message ?? error}`)
    }
    current.result = last
    for (const resolve of current.waiters) {
      try {
        resolve(last)
      } catch {
        /* a waiter must not block the others */
      }
    }
    try {
      onSettled?.(last)
    } catch (error) {
      logger?.warn?.(`dsh-comfyui-workspace: 运行结束回调失败：${error?.message ?? error}`)
    }
    logger?.info?.(`dsh-comfyui-workspace: 运行结束 ${status}（${entry.durationMs}ms，${files.length} 个文件）`)
    return last
  }

  /** One history poll: settle when the entry is there, give up when it vanished. */
  async function poll() {
    if (active === null) return
    const current = active
    try {
      const history = await getClient(current.serverId).history(current.promptId)
      if (active !== current) return
      const entry = history?.[current.promptId]
      if (entry !== undefined && entry !== null) {
        const failed = entry.status?.status_str === 'error'
        await settle(failed ? 'error' : 'success', {
          error: failed ? (current.error ?? '执行失败，服务器没有给出原因') : null,
          outputs: entry.outputs ?? {},
        })
        return
      }
      const queue = await getClient(current.serverId).queue()
      if (active !== current) return
      const numbers = [
        ...(Array.isArray(queue?.queue_running) ? queue.queue_running : []),
        ...(Array.isArray(queue?.queue_pending) ? queue.queue_pending : []),
      ].map((item) => (Array.isArray(item) ? item[1] : undefined))
      current.queueRemaining = numbers.length
      if (numbers.includes(current.promptId)) {
        current.misses = 0
        return
      }
      current.misses += 1
      if (current.misses >= VANISH_LIMIT && current.sawExecution !== true) {
        await settle('canceled', { error: '任务从队列里消失了：可能被取消，或服务器重启了' })
      }
    } catch (error) {
      if (active !== current) return
      current.misses += 1
      current.lastError = error?.message ?? String(error)
      if (current.misses >= VANISH_LIMIT * 3) {
        // Settling itself must not be able to leave the run dangling: a poll that
        // keeps throwing while `active` stays set would pin the panel to
        // "running" with no way out.
        try {
          await settle('error', { error: `跟丢了这个任务：${current.lastError}` })
        } catch (fatal) {
          logger?.warn?.(`dsh-comfyui-workspace: 收尾失败：${fatal?.message ?? fatal}`)
          detach()
        }
      }
    }
  }

  /** Apply one WebSocket frame to the live state. */
  function onFrame(frame) {
    if (active === null) return
    const current = active
    const data = frame?.data ?? {}
    switch (frame?.type) {
      case 'execution_start':
        current.sawExecution = true
        break
      case 'execution_cached':
        current.sawExecution = true
        for (const nodeId of Array.isArray(data.nodes) ? data.nodes : []) current.cachedNodes.add(String(nodeId))
        break
      case 'executing':
        current.sawExecution = true
        current.currentNodeId = data.node === null || data.node === undefined ? null : String(data.node)
        current.progress = null
        break
      case 'progress':
        current.sawExecution = true
        if (typeof data.node === 'string' || typeof data.node === 'number') current.currentNodeId = String(data.node)
        current.progress = {
          value: Number(data.value ?? 0),
          max: Number(data.max ?? 0),
          nodeId: data.node === undefined ? null : String(data.node),
        }
        break
      case 'executed':
        current.sawExecution = true
        if (typeof data.node === 'string' || typeof data.node === 'number') {
          current.cachedNodes.add(String(data.node))
        }
        break
      case 'execution_error':
        current.sawExecution = true
        current.error = String(data.exception_message ?? data.exception_type ?? '执行失败')
        current.errorNode = data.node_id === undefined ? null : String(data.node_id)
        logger?.warn?.(`dsh-comfyui-workspace: 执行错误 ${current.error}`)
        void settle('error', { error: current.errorNode === null ? current.error : `节点 #${current.errorNode}：${current.error}`, outputs: {} })
        break
      case 'execution_success':
        current.sawExecution = true
        // Completion is read from /history: it is the only place that lists the
        // files this run actually saved.
        void poll()
        break
      case 'status':
        current.queueRemaining = Number(data?.status?.exec_info?.queue_remaining ?? current.queueRemaining ?? 0)
        break
      default:
        break
    }
  }

  /**
   * Queue one workflow and start following it.
   *
   * @param {object} request
   * @param {object} request.workflow - the stored workflow record.
   * @param {object|null} request.objectInfo - cached `/object_info` for its classes.
   * @param {object|null} [request.config] - overrides for this run.
   * @returns {Promise<{runId: string, promptId: string, promptNumber: number, seeds: object, warnings: string[], prompt: object}>}
   */
  async function start({ workflow, objectInfo, config, serverId, serverName }) {
    if (active !== null) {
      throw new ComfyError('invalid', `已经有一个任务在跑了（${active.workflowName}），先停止或等它结束`)
    }
    const client = getClient(serverId)
    const effectiveConfig = config ?? workflow.config ?? null
    const built = buildPrompt({ raw: workflow.raw, config: effectiveConfig }, objectInfo)
    if (built.errors.length > 0) {
      throw new ComfyError('invalid', built.errors.join('\n'))
    }
    const clientId = newClientId()
    let queued
    try {
      queued = await client.queuePrompt(built.prompt, clientId)
    } catch (error) {
      if (error instanceof ComfyError && error.status === 400) {
        throw new ComfyError('invalid', describePromptError(error.body), { status: 400, body: error.body })
      }
      throw error
    }
    const promptId = typeof queued?.prompt_id === 'string' ? queued.prompt_id : ''
    if (promptId === '') {
      throw new ComfyError('invalid', describePromptError(queued), { body: queued })
    }
    const run = {
      runId: `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      serverId: typeof serverId === 'string' ? serverId : '',
      serverName: typeof serverName === 'string' ? serverName : '',
      promptId,
      promptNumber: Number(queued?.number ?? 0),
      clientId,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      currentNodeId: null,
      cachedNodes: new Set(),
      progress: null,
      queueRemaining: 1,
      sawExecution: false,
      misses: 0,
      error: null,
      errorNode: null,
      lastError: null,
      seeds: built.seeds,
      seedFields: built.seedFields ?? {},
      values: built.values,
      save: effectiveConfig?.save ?? null,
      prompt: built.prompt,
      waiters: [],
      result: null,
      timer: null,
      monitor: null,
    }
    active = run
    revision += 1
    run.timer = setInterval(() => {
      void poll().catch((error) => {
        logger?.warn?.(`dsh-comfyui-workspace: 轮询异常：${error?.message ?? error}`)
      })
    }, POLL_MS)
    run.monitor = createRunMonitor({
      url: client.socketUrl(clientId),
      logger,
      onFrame,
      onClose: (reason) => {
        if (active === null) return
        logger?.info?.(`dsh-comfyui-workspace: 运行事件通道关闭（${reason}），继续用轮询`)
      },
    })
    logger?.info?.(`dsh-comfyui-workspace: 已提交 ${workflow.name}（prompt ${promptId}）`)
    return {
      runId: run.runId,
      promptId,
      promptNumber: run.promptNumber,
      seeds: built.seeds,
      warnings: built.warnings,
      prompt: built.prompt,
    }
  }

  /** Cancel the active run: interrupt, drop it from the queue, archive it. */
  async function stop() {
    if (active === null) return { stopped: false }
    const current = active
    const client = getClient(current.serverId)
    const problems = []
    try {
      await client.interrupt()
    } catch (error) {
      problems.push(`中断失败：${error?.message ?? error}`)
    }
    try {
      await client.cancelQueued(current.promptNumber)
    } catch (error) {
      problems.push(`移出队列失败：${error?.message ?? error}`)
    }
    // Give the server a moment to publish whatever it had already written, so
    // the archive keeps the partial outputs instead of an empty list.
    await new Promise((resolve) => setTimeout(resolve, 350))
    let outputs = {}
    try {
      const history = await client.history(current.promptId)
      outputs = history?.[current.promptId]?.outputs ?? {}
    } catch {
      /* the run is canceled either way */
    }
    await settle('canceled', { error: problems.length === 0 ? '已手动停止' : problems.join('；'), outputs })
    return { stopped: true, problems }
  }

  /** Wait for the active (or the next settled) run, for the agent tool. */
  function waitFor(runId, timeoutMs) {
    if (last !== null && (runId === undefined || last.runId === runId)) {
      if (active === null) return Promise.resolve(last)
    }
    if (active === null) return Promise.resolve(last)
    if (runId !== undefined && active.runId !== runId) return Promise.resolve(last)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = active?.waiters.indexOf(done)
        if (active !== null && index !== undefined && index >= 0) active.waiters.splice(index, 1)
        resolve({ ...(active === null ? last ?? {} : state().run ?? {}), pending: true })
      }, Math.max(1000, Math.min(timeoutMs ?? 600000, 3600000)))
      function done(result) {
        clearTimeout(timer)
        resolve(result)
      }
      active.waiters.push(done)
    })
  }

  return { state, start, stop, waitFor, get active() { return active !== null }, get last() { return last } }
}
