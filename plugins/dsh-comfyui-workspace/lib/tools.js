/**
 * dsh-comfyui-workspace — the agent's half of the same operations.
 *
 * Every tool below calls `app`, the object the panel's routes call: one
 * implementation, one set of validations, and the same wording for a failure in
 * both places.
 *
 * @module dsh-comfyui-workspace/tools
 */

import { ComfyError } from './comfy.js'
import { TOOL_GROUPS } from './config.js'

/** One text content block. */
const text = (value) => [{ type: 'text', text: value }]

/** Line-oriented result schema shared by most tools. */
const RESULT_SHAPE = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok'],
}

/**
 * Drop `undefined` fields from a tool result.
 *
 * The Harness compares a tool's return value against its own JSON round-trip, so
 * an `undefined` field (a key that JSON would drop) is rejected as lossy. Building
 * results with optional holes is convenient; sending one is not.
 */
function compact(value) {
  const out = {}
  for (const [key, item] of Object.entries(value ?? {})) {
    if (item !== undefined) out[key] = item
  }
  return out
}

/** Bytes as a human string. */
function humanBytes(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '0'
  if (number >= 1024 ** 3) return `${(number / 1024 ** 3).toFixed(1)} GB`
  if (number >= 1024 ** 2) return `${(number / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(number / 1024)} KB`
}

/** `1.2s` / `3m04s`. */
function humanDuration(ms) {
  const number = Number(ms)
  if (!Number.isFinite(number) || number < 0) return '—'
  if (number < 1000) return `${Math.round(number)}ms`
  if (number < 60_000) return `${(number / 1000).toFixed(1)}s`
  const minutes = Math.floor(number / 60_000)
  const seconds = Math.round((number % 60_000) / 1000)
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/** One workflow line. */
function workflowLine(entry) {
  return `· ${entry.name} — id ${entry.id}，${entry.nodeCount} 个节点`
}

/** A run summary the model can read. */
function runSummary(last) {
  const status = last.status === 'success' ? '成功' : last.status === 'error' ? '失败' : '已取消'
  const lines = [`运行${status}（${humanDuration(last.durationMs)}）`]
  if (last.seed !== null && last.seed !== undefined) lines.push(`种子：${last.seed}`)
  const files = Array.isArray(last.files) ? last.files : []
  if (files.length > 0) {
    lines.push(`产出 ${files.length} 个文件：`)
    for (const file of files.slice(0, 8)) {
      const where = file.localPath ?? `${file.subfolder === '' ? '' : `${file.subfolder}/`}${file.filename}`
      lines.push(`  - ${file.kind}：${where}`)
    }
  } else {
    lines.push('没有产出文件')
  }
  if (typeof last.error === 'string' && last.error !== '') lines.push(`错误：${last.error}`)
  return lines.join('\n')
}

/** Resolve a workflow argument: an id, or a name (exact, then case-insensitive). */
async function resolveWorkflow(app, wanted) {
  const list = await app.listWorkflows()
  const byId = list.find((item) => item.id === wanted)
  if (byId !== undefined) return byId
  const exact = list.find((item) => item.name === wanted)
  if (exact !== undefined) return exact
  const loose = list.find((item) => item.name.toLowerCase() === String(wanted).toLowerCase())
  if (loose !== undefined) return loose
  const partial = list.filter((item) => item.name.includes(wanted))
  if (partial.length === 1) return partial[0]
  const names = list.map((item) => `${item.name}（${item.id}）`).join('、')
  throw new ComfyError('invalid', partial.length > 1
    ? `「${wanted}」匹配到多个工作流：${partial.map((item) => item.name).join('、')}`
    : `找不到工作流「${wanted}」。现有：${names === '' ? '一个都没有，先在面板里导入' : names}`)
}

/** The prompt card of one workflow detail. */
function promptCards(detail) {
  return (detail.cards ?? []).filter((card) => card.category === 'prompt')
}

/** The seed nodes of one workflow detail. */
function seedCards(detail) {
  return (detail.cards ?? [])
    .filter((card) => Array.isArray(card.fields) && card.fields.some((field) => /(^seed$|_seed$|^noise_seed$)/.test(field.name)))
    .map((card) => {
      const field = card.fields.find((item) => /(^seed$|_seed$|^noise_seed$)/.test(item.name))
      return { card, field }
    })
}

/**
 * Build this deployment's tool definitions.
 *
 * @param {ReturnType<import('./app.js').createApp>} app
 */
export function createTools(app) {
  const definitions = [
    {
      name: 'comfy_workspace_workflows',
      description: '列出「ComfyUI 工作台」里已导入的工作流：名字、id、节点数。'
        + '要跑某个工作流之前先用它确认名字或 id。面板里导入的工作流都在这里。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      timeoutMs: 15000,
      isConcurrencySafe: () => true,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            count: { type: 'number' },
            workflows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  nodeCount: { type: 'number' },
                },
                required: ['id', 'name'],
              },
            },
          },
          required: ['ok'],
        },
        render: (_args, value) => {
          if (value.ok !== true) return text(value.error ?? '读取失败')
          if (value.count === 0) return text('还没有导入任何工作流：让用户在 ComfyUI 工作台面板里点「导入工作流」。')
          return text(`共 ${value.count} 个工作流：\n${(value.workflows ?? []).map(workflowLine).join('\n')}`)
        },
      },
      async execute() {
        try {
          const workflows = await app.listWorkflows()
          return {
            ok: true,
            count: workflows.length,
            workflows: workflows.map((item) => ({ id: item.id, name: item.name, nodeCount: item.nodeCount })),
          }
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error) }
        }
      },
    },

    {
      name: 'comfy_workspace_workflow',
      description: '看一个工作流的全部卡片和参数：每张卡片的节点 id、类别（提示词/文件/模型/输出/一般）、'
        + '各字段当前值与可选值，以及哪些模型服务器上不支持。改参数前用它确认字段名。',
      parameters: {
        type: 'object',
        properties: {
          workflow: { type: 'string', description: '工作流的名字或 id' },
        },
        required: ['workflow'],
        additionalProperties: false,
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      output: {
        schema: RESULT_SHAPE,
        render: (_args, value) => text(value.ok === true ? value.summary : (value.error ?? '读取失败')),
      },
      async execute(args) {
        try {
          const record = await resolveWorkflow(app, String(args?.workflow ?? ''))
          const detail = await app.workflowDetail(record.id)
          const lines = [`${detail.name}（id ${detail.id}）：${detail.cards.length} 张卡片`]
          if (detail.modelsError) lines.push(`※ 没取到服务器节点信息：${detail.modelsError}`)
          if ((detail.missingClasses ?? []).length > 0) {
            lines.push(`※ 服务器缺少这些节点类型：${detail.missingClasses.join('、')}`)
          }
          for (const card of detail.cards) {
            if (card.category === 'save') {
              lines.push(`\n[保存位置] ${(card.fields ?? []).map((field) => `${field.name}=${JSON.stringify(field.value)}`).join('，')}`)
              continue
            }
            const flag = card.enabled === true ? '' : '（停用）'
            const hiddenFlag = card.hidden === true ? '（面板里已隐藏，仍然参与运行）' : ''
            lines.push(`\n[${card.category}] #${card.id} ${card.title}${flag}${hiddenFlag}`)
            for (const field of card.fields ?? []) {
              const options = Array.isArray(field.options) && field.options.length > 0
                ? ` 可选：${field.options.slice(0, 12).join('|')}${field.options.length > 12 ? ` …共 ${field.options.length} 项` : ''}`
                : ''
              const bad = field.supported === false ? '  ⚠ 服务器不支持这个值' : ''
              const locked = field.locked === true ? '（由连线提供）' : ''
              const shown = typeof field.value === 'string' && field.value.length > 160
                ? `${field.value.slice(0, 160)}…`
                : JSON.stringify(field.value)
              lines.push(`  ${field.name}=${shown}${locked}${bad}${options}`)
            }
          }
          return { ok: true, summary: lines.join('\n') }
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error) }
        }
      },
    },

    {
      name: 'comfy_workspace_run',
      description: '用「ComfyUI 工作台」里已配置好的参数跑一个工作流（服务端是用户在面板里设置的本地或远程 ComfyUI）。'
        + '可以只覆盖这一次运行要改的字段：prompt 覆盖提示词，seed 固定种子，randomSeed 每次重新随机，'
        + 'params 按节点 id 覆盖任意字段。默认等运行结束再返回结果（含产出文件与归档 id）；'
        + '超时则返回「仍在运行」，之后用 comfy_workspace_status 查。',
      parameters: {
        type: 'object',
        properties: {
          workflow: { type: 'string', description: '工作流的名字或 id（先 comfy_workspace_workflows 查）' },
          prompt: { type: 'string', description: '这次要用的正向提示词，覆盖提示词卡片的值' },
          seed: { type: 'number', description: '固定随机种子；不给则按面板的「每次随机」设置' },
          randomSeed: { type: 'boolean', description: 'true = 这次重新随机一个种子（覆盖面板里的固定值）' },
          params: {
            type: 'object',
            description: '按节点覆盖字段，形如 {"515": {"steps": 20}}；键是节点 id（卡片标题里的 #515）',
            additionalProperties: { type: 'object', additionalProperties: true },
          },
          saveSubfolder: { type: 'string', description: '写到服务器 output/ 下的子目录' },
          localDir: { type: 'string', description: '运行结束后把结果下载到这个本地绝对路径' },
          server: { type: 'string', description: '在哪台服务器上跑（名字或 id）；省略 = 当前活动服务器' },
          disableNodes: {
            type: 'array',
            items: { type: 'string' },
            description: '这次要旁路的节点（id 或卡片标题）。旁路 = 不执行，输出由同类型输入直通下游，和 ComfyUI 的 Bypass 一样',
          },
          enableNodes: {
            type: 'array',
            items: { type: 'string' },
            description: '这次要启用的节点（id 或卡片标题）',
          },
          wait: { type: 'boolean', description: '是否等运行结束（默认 true）' },
          timeoutMs: { type: 'number', description: '等待上限，默认 600000（10 分钟）' },
        },
        required: ['workflow'],
        additionalProperties: false,
      },
      timeoutMs: 900000,
      isConcurrencySafe: () => false,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            summary: { type: 'string' },
            error: { type: 'string' },
            runId: { type: 'string' },
            status: { type: 'string' },
            seed: { type: 'number' },
            files: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
          required: ['ok'],
        },
        render: (_args, value) => text(value.ok === true ? value.summary : (value.error ?? '运行失败')),
      },
      async execute(args) {
        try {
          const record = await resolveWorkflow(app, String(args?.workflow ?? ''))
          const detail = await app.workflowDetail(record.id)
          const config = structuredClone(detail.config ?? { nodes: {}, save: {} })
          config.nodes = config.nodes ?? {}
          config.save = config.save ?? { subfolder: '', localDir: '' }

          const nodeConfig = (id) => {
            const current = config.nodes[id] ?? {}
            const next = { ...current, values: { ...(current.values ?? {}) } }
            config.nodes[id] = next
            return next
          }

          if (typeof args?.prompt === 'string' && args.prompt !== '') {
            const cards = promptCards(detail)
            if (cards.length === 0) throw new ComfyError('invalid', `${detail.name} 里没有提示词卡片，用 params 指定字段`)
            for (const card of cards) {
              const field = (card.fields ?? []).find((item) => item.kind === 'text' || item.kind === 'string')
              if (field === undefined) continue
              nodeConfig(card.id).values[field.name] = args.prompt
            }
          }

          const params = args?.params !== null && typeof args?.params === 'object' ? args.params : {}
          for (const [nodeId, values] of Object.entries(params)) {
            if (values === null || typeof values !== 'object') continue
            const card = detail.cards.find((item) => item.id === nodeId)
              ?? detail.cards.find((item) => item.id === String(nodeId))
              ?? detail.cards.find((item) => item.title === nodeId)
            if (card === undefined) throw new ComfyError('invalid', `没有 id 或标题是「${nodeId}」的卡片`)
            for (const [key, value] of Object.entries(values)) {
              if (card.category === 'save') {
                config.save[key] = value
                continue
              }
              const field = (card.fields ?? []).find((item) => item.name === key)
              if (field === undefined) {
                const names = (card.fields ?? []).map((item) => item.name).join('、')
                throw new ComfyError('invalid', `卡片 #${card.id} 没有字段「${key}」，可选：${names}`)
              }
              nodeConfig(card.id).values[key] = value
            }
          }

          /** Resolve a node id or card title to one card, or report what exists. */
          const cardOf = (wanted) => {
            // The panel prints nodes as `#663`, so an agent that copies one here
            // must not be told the node does not exist.
            const text = String(wanted ?? '').trim().replace(/^#/, '')
            const card = detail.cards.find((item) => item.id === text)
              ?? detail.cards.find((item) => item.title === text)
              ?? detail.cards.find((item) => item.title.toLowerCase() === text.toLowerCase())
            if (card === undefined) {
              const names = detail.cards.map((item) => `${item.title}(#${item.id})`).join('、')
              throw new ComfyError('invalid', `找不到节点「${text}」。现有：${names}`)
            }
            return card
          }
          for (const wanted of Array.isArray(args?.disableNodes) ? args.disableNodes : []) {
            const card = cardOf(wanted)
            if (card.category === 'save') continue
            nodeConfig(card.id).enabled = false
          }
          for (const wanted of Array.isArray(args?.enableNodes) ? args.enableNodes : []) {
            const card = cardOf(wanted)
            if (card.category === 'save') continue
            nodeConfig(card.id).enabled = true
          }

          const seeds = seedCards(detail)
          if (typeof args?.seed === 'number' && Number.isFinite(args.seed)) {
            if (seeds.length === 0) throw new ComfyError('invalid', `${detail.name} 里没有可设置的种子字段`)
            for (const { card, field } of seeds) {
              nodeConfig(card.id).values[field.name] = args.seed
              nodeConfig(card.id).randomSeed = false
            }
          } else if (args?.randomSeed === true) {
            for (const { card } of seeds) nodeConfig(card.id).randomSeed = true
          }
          if (typeof args?.saveSubfolder === 'string') config.save.subfolder = args.saveSubfolder
          if (typeof args?.localDir === 'string' && args.localDir !== '') config.save.localDir = args.localDir

          // Which server this run goes to: the named one, or the active one.
          let serverId
          if (typeof args?.server === 'string' && args.server.trim() !== '') {
            const settings = app.publicSettings()
            const wanted = args.server.trim()
            const target = settings.servers.find((server) => server.id === wanted || server.name === wanted)
              ?? settings.servers.find((server) => server.name.toLowerCase() === wanted.toLowerCase())
            if (target === undefined) {
              const names = settings.servers.map((server) => server.name).join('、')
              throw new ComfyError('invalid', `找不到服务器「${wanted}」。已配置：${names || '无'}`)
            }
            serverId = target.id
          }

          const started = await app.run(record.id, config, { serverId })
          const wanted = args?.wait !== false
          const timeoutMs = Number(args?.timeoutMs) > 0 ? Number(args.timeoutMs) : 600_000
          if (!wanted) {
            return {
              ok: true,
              runId: started.runId,
              status: 'running',
              summary: `已提交「${started.workflowName}」（${started.nodeCount} 个节点，run ${started.runId}）。\n`
                + `种子：${Object.values(started.seeds ?? {}).join('、') || '无'}\n`
                + '它在后台跑，用 comfy_workspace_status 看进度。',
            }
          }
          const settled = await app.waitFor(started.runId, timeoutMs)
          if (settled?.pending === true) {
            return compact({
              ok: true,
              runId: started.runId,
              status: 'running',
              summary: `「${started.workflowName}」还在跑（已经 ${humanDuration(settled.elapsedMs ?? 0)}），`
                + '没有等到结束。用 comfy_workspace_status 继续看，或用 comfy_workspace_stop 停止。',
            })
          }
          const summary = runSummary(settled)
          const warningText = Array.isArray(started.warnings) && started.warnings.length > 0
            ? `\n注意：${started.warnings.slice(0, 5).join('；')}`
            : ''
          const success = settled.status === 'success'
          return compact({
            ok: success,
            status: settled.status,
            runId: started.runId,
            seed: typeof settled.seed === 'number' ? settled.seed : undefined,
            files: settled.files ?? [],
            summary: `「${started.workflowName}」${summary}${warningText}`,
            error: success ? undefined : (settled.error ?? '运行没有成功'),
          })
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error) }
        }
      },
    },

    {
      name: 'comfy_workspace_status',
      description: '看 ComfyUI 工作台现在的状态：有没有任务在跑、跑到哪个节点、进度、队列长度、上一次运行的结论，'
        + '以及服务器是否有响应（版本、显存与内存占用）。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      timeoutMs: 20000,
      isConcurrencySafe: () => true,
      output: {
        schema: RESULT_SHAPE,
        render: (_args, value) => text(value.ok === true ? value.summary : (value.error ?? '读取失败')),
      },
      async execute() {
        try {
          const state = app.state()
          const stats = await app.stats()
          const lines = []
          if (state.running === true) {
            const run = state.run
            const percent = run?.progress?.max > 0
              ? ` ${Math.round((run.progress.value / run.progress.max) * 100)}%`
              : ''
            lines.push(`正在运行「${run.workflowName}」：${humanDuration(run.elapsedMs)}，`
              + `当前节点 #${run.currentNodeId ?? '—'}${percent}，队列剩 ${run.queueRemaining ?? '?'}`)
          } else {
            lines.push('当前没有任务在跑。')
          }
          if (state.last !== null) lines.push(`\n上一次：${runSummary(state.last)}`)
          if (stats === null) {
            lines.push(`\n服务器：读不到状态（${state.server?.base ?? ''}）`)
          } else if (stats.error !== null && stats.error !== undefined && state.running !== true) {
            lines.push(`\n服务器：读状态失败（${stats.error}）`)
          } else {
            const devices = (stats.devices ?? []).map((device) => `${device.name} 显存 ${humanBytes(device.vramTotal - device.vramFree)}/${humanBytes(device.vramTotal)}`)
            const ram = stats.ram?.total > 0 ? `内存 ${humanBytes(stats.ram.total - stats.ram.free)}/${humanBytes(stats.ram.total)}` : ''
            lines.push(`\n服务器：ComfyUI ${stats.version || '?'}（${state.server?.base ?? ''}）`
              + `${devices.length > 0 ? `\n  ${devices.join('\n  ')}` : ''}`
              + `${ram === '' ? '' : `\n  ${ram}`}`)
            if (stats.error !== null && stats.error !== undefined) lines.push(`  ※ 上一次读取失败：${stats.error}`)
          }
          return { ok: true, summary: lines.join('\n') }
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error) }
        }
      },
    },

    {
      name: 'comfy_workspace_stop',
      description: '停止正在跑的 ComfyUI 任务：中断当前执行、把它移出队列，并把已有的半成品归档。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      timeoutMs: 30000,
      isConcurrencySafe: () => false,
      output: {
        schema: RESULT_SHAPE,
        render: (_args, value) => text(value.ok === true ? value.summary : (value.error ?? '停止失败')),
      },
      async execute() {
        try {
          const result = await app.stop()
          if (result.stopped !== true) return { ok: true, summary: '现在没有任务在跑，不需要停止。' }
          const problems = Array.isArray(result.problems) && result.problems.length > 0
            ? `\n注意：${result.problems.join('；')}`
            : ''
          return { ok: true, summary: `已停止并归档。${problems}` }
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error) }
        }
      },
    },

    {
      name: 'comfy_workspace_archive',
      description: '查 ComfyUI 工作台的运行归档：每次运行实际用的参数、随机种子、产出文件、耗时和成败。'
        + 'action=list（默认）列出最近若干条；action=get 取一条的完整参数；action=rerun 用同一条的参数再跑一次（默认换新种子）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'rerun'], description: '默认 list' },
          id: { type: 'string', description: 'get / rerun 时的归档 id' },
          workflow: { type: 'string', description: 'list 时只看这个工作流' },
          limit: { type: 'number', description: 'list 返回条数，默认 10' },
          freshSeed: { type: 'boolean', description: 'rerun 时换新种子，默认 true' },
        },
        additionalProperties: false,
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      output: {
        schema: RESULT_SHAPE,
        render: (_args, value) => text(value.ok === true ? value.summary : (value.error ?? '读取失败')),
      },
      async execute(args) {
        try {
          const action = typeof args?.action === 'string' ? args.action : 'list'
          if (action === 'get') {
            const entry = await app.getArchive(String(args?.id ?? ''))
            const lines = [
              `归档 ${entry.id}：${entry.workflowName} · ${entry.status} · ${humanDuration(entry.durationMs)} · ${entry.at}`,
              `种子：${entry.seed ?? '无'}`,
            ]
            for (const [nodeId, info] of Object.entries(entry.params ?? {})) {
              const values = Object.entries(info.values ?? {})
                .map(([key, value]) => `${key}=${typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}…` : JSON.stringify(value)}`)
                .join('，')
              lines.push(`· #${nodeId} ${info.title ?? info.type ?? ''}：${values}`)
            }
            for (const file of entry.files ?? []) {
              lines.push(`产出 ${file.kind}：${file.localPath ?? `${file.subfolder}/${file.filename}`}`)
            }
            return { ok: true, summary: lines.join('\n') }
          }
          if (action === 'rerun') {
            const result = await app.rerunArchive(String(args?.id ?? ''), { freshSeed: args?.freshSeed !== false })
            return {
              ok: true,
              summary: `已按归档重跑「${result.workflowName}」（prompt ${result.promptId}）。`
                + `新种子：${Object.values(result.seeds ?? {}).join('、') || '沿用原值'}。用 comfy_workspace_status 看结果。`,
            }
          }
          const workflowId = typeof args?.workflow === 'string' && args.workflow !== ''
            ? (await resolveWorkflow(app, args.workflow)).id
            : undefined
          const entries = await app.listArchive({ workflowId, limit: Number(args?.limit ?? 10) || 10 })
          if (entries.length === 0) return { ok: true, summary: '还没有任何归档：跑一次工作流就有了。' }
          const lines = [`最近 ${entries.length} 次运行：`]
          for (const entry of entries) {
            lines.push(`· ${entry.at} ${entry.workflowName} ${entry.status} ${humanDuration(entry.durationMs)}`
              + ` 种子 ${entry.seed ?? '—'} 文件 ${entry.fileCount} 个 — id ${entry.id}`)
          }
          return { ok: true, summary: lines.join('\n') }
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error) }
        }
      },
    },

    {
      name: 'comfy_workspace_server',
      description: '管理 ComfyUI 服务器：list 列出配置好的服务器与当前活动的那台；select 切换到指定服务器；'
        + 'test 检查连通性（版本、显卡显存）；models 列出某台服务器上某一类模型文件名'
        + '（checkpoints / loras / vae / diffusion_models / text_encoders / upscale_models …）；'
        + 'free 让服务器卸载模型并清空缓存，把显存还给系统（不影响磁盘上的任何东西，下次运行会重新加载）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'select', 'test', 'models', 'free'], description: '默认 test' },
          server: { type: 'string', description: '服务器名字或 id；select 必填，其余省略表示当前活动服务器' },
          folder: { type: 'string', description: 'action=models 时的目录名，例如 loras' },
        },
        additionalProperties: false,
      },
      timeoutMs: 40000,
      isConcurrencySafe: () => true,
      output: {
        schema: RESULT_SHAPE,
        render: (_args, value) => text(value.ok === true ? value.summary : (value.error ?? '检查失败')),
      },
      async execute(args) {
        try {
          const action = typeof args?.action === 'string' ? args.action : 'test'

          /** Resolve `server` to one configured server, or undefined for the active one. */
          const pick = () => {
            const settings = app.publicSettings()
            const wanted = typeof args?.server === 'string' ? args.server.trim() : ''
            if (wanted === '') {
              return settings.servers.find((server) => server.id === settings.activeServerId) ?? null
            }
            return settings.servers.find((server) => server.id === wanted || server.name === wanted)
              ?? settings.servers.find((server) => server.name.toLowerCase() === wanted.toLowerCase())
              ?? null
          }

          if (action === 'list') {
            const settings = app.publicSettings()
            const lines = settings.servers.map((server) => {
              const mark = server.id === settings.activeServerId ? '●' : '○'
              return `${mark} ${server.name} — ${server.address || server.url || '（未填地址）'}`
                + `${server.error === null ? '' : `  ⚠ ${server.error}`}`
                + `${server.hasPassword ? ' · 带密码' : ''}（id ${server.id}）`
            })
            return { ok: true, summary: lines.length === 0 ? '还没有配置服务器。' : `共 ${lines.length} 台服务器：\n${lines.join('\n')}` }
          }

          if (action === 'select') {
            const target = pick()
            if (target === null) {
              const names = app.publicSettings().servers.map((server) => server.name).join('、')
              return { ok: false, error: `找不到服务器「${args?.server ?? ''}」。已配置：${names || '无'}` }
            }
            const next = await app.selectServer(target.id)
            const active = next.servers.find((server) => server.id === next.activeServerId)
            return { ok: true, summary: `已切换到「${active?.name ?? target.name}」（${active?.address ?? ''}）。之后的运行都走这台。` }
          }

          if (action === 'models') {
            const folder = typeof args?.folder === 'string' && args.folder !== '' ? args.folder : 'loras'
            const names = await app.models(folder, pick()?.id)
            return { ok: true, summary: `${folder} 下 ${names.length} 个文件：\n${names.join('\n')}` }
          }

          if (action === 'free') {
            if (app.state().running === true) {
              return { ok: false, error: '有任务正在跑，先 comfy_workspace_stop 停止再释放显存' }
            }
            const result = await app.freeMemory({ serverId: pick()?.id })
            return {
              ok: true,
              summary: `已让「${result.serverName}」释放显存：${humanBytes(result.freedVram)}`
                + `（显存 ${humanBytes(result.before?.vramUsed ?? 0)} → ${humanBytes(result.after?.vramUsed ?? 0)}`
                + ` / 共 ${humanBytes(result.after?.vramTotal ?? 0)}）`
                + (result.freedRam > 0 ? `，内存释放 ${humanBytes(result.freedRam)}` : '')
                + '\n模型已卸载、缓存已清空；下次运行会重新加载（会慢一点，不丢任何东西）。',
            }
          }

          const target = pick()
          const result = await app.testServer(target?.id)
          if (result.ok !== true) {
            return { ok: false, error: `连不上 ${target?.name ?? ''}（${result.address}）：${result.message}` }
          }
          const devices = (result.devices ?? []).map((device) => `  - ${device.name} 显存 ${humanBytes(device.vramFree)}/${humanBytes(device.vramTotal)}`)
          return {
            ok: true,
            summary: `连得上 ${result.address}（${result.latencyMs}ms）\nComfyUI ${result.version}`
              + `\nPython ${result.python} · ${result.os}`
              + `\n内存 ${humanBytes(result.ram.free)}/${humanBytes(result.ram.total)}`
              + (devices.length > 0 ? `\n显卡：\n${devices.join('\n')}` : ''),
          }
        } catch (error) {
          return { ok: false, error: error?.message ?? String(error) }
        }
      },
    },
  ]
  return definitions
}

/** The definitions this deployment's `toolGroups` asks for. */
export function selectTools(definitions, mode) {
  if (mode === 'none') return []
  if (mode === 'core') return definitions.filter((definition) => TOOL_GROUPS.core.includes(definition.name))
  return definitions
}

/**
 * The guidance section.
 *
 * Short on purpose: it is injected on every turn, so it says when to reach for
 * these tools and — more importantly — when not to.
 */
export const GUIDANCE = [
  '「ComfyUI 工作台」（comfy_workspace_*）是用户自己维护的图像/视频工作流面板：用户在面板里导入工作流、配好参数，',
  '你要出图时用 comfy_workspace_run 跑它，而不是自己拼 ComfyUI 的 API 请求。',
  '- 先 comfy_workspace_workflows 看有哪些工作流，再 comfy_workspace_workflow 看字段名，然后 run。',
  '- 只想换提示词就传 prompt；要复现某次的图就传 seed；不要每次都改一堆参数。',
  '- 用户没让你出图、或只是问面板怎么用，就不要跑。跑之前确认工作流名字对，跑完把产出文件和种子说清楚。',
  '- 运行会自动归档参数和种子；用户问「上次那组参数」时用 comfy_workspace_archive 查，不要猜。',
].join('\n')
