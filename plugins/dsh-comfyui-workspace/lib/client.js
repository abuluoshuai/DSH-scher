/**
 * dsh-comfyui-workspace — client half (browser bundle).
 *
 * A panel that stands where a browser tab used to: one workflow per tab, one card
 * per node, and a run button. The data channel is the Host half's own HTTP routes,
 * called with a **document-relative** path (`api/comfyui-workspace/...`) so a GUI
 * served under a reverse-proxy prefix still reaches them.
 *
 * Constraints this file obeys on purpose:
 *
 *  - only platform modules are required (`react`); no Harness client package is
 *    imported, so no `dsh.client.inject` wiring is needed and no private API can
 *    break the panel;
 *  - colors come from `--dsw-alias-*` theme tokens only, so both themes work;
 *  - UI is contributed through slots, never by writing outside its own tree;
 *  - the factory body has no side effects; everything is registered in `apply`
 *    and disposed through `ctx.effect`.
 *
 * @module dsh-comfyui-workspace/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-comfyui-workspace',

  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    /** Sidebar entry id and main-panel key must be the same value. */
    const SLOT_ID = 'comfyui-workspace'
    const LOCALE_NS = 'comfyui-workspace'
    /** Route prefix, relative to the document base. */
    const API = 'api/comfyui-workspace'
    /** Where the panel remembers the last tab it showed (per browser, not per profile). */
    const LAST_TAB_KEY = 'dsh-comfyui-workspace:last-tab'
    /** How long an edit waits before it is written to the Host. */
    const SAVE_DEBOUNCE_MS = 700
    /**
     * Build tag of this browser half. It rides along with the diagnostics the
     * panel reports, so "which client am I looking at" has an answer that the
     * running page carries itself.
     */
    const CLIENT_REV = 'c12'

    /** The settings skeleton the dialog falls back to before the Host answers. */
    const EMPTY_SETTINGS = { servers: [], activeServerId: '', ui: {} }

    // ── 文案 ──────────────────────────────────────────────────────────────

    const zh = {
      'entry.label': 'ComfyUI',
      'panel.title': 'ComfyUI 工作台',
      'panel.subtitle': '导入工作流，调好参数，直接开跑',
      'action.import': '导入工作流',
      'action.settings': '设置',
      'action.archive': '归档',
      'action.run': '运行',
      'action.stop': '停止',
      'action.refresh': '刷新',
      'action.retry': '重试',
      'action.close': '关闭',
      'action.save': '保存',
      'action.test': '测试连接',
      'action.browse': '浏览',
      'action.openDir': '打开',
      'action.openDirHint': '在文件管理器里打开这个目录',
      'action.pickFile': '选择文件',
      'action.changeFile': '换一个',
      'action.rename': '重命名',
      'action.delete': '删除',
      'action.apply': '套用参数',
      'action.rerun': '重跑',
      'action.download': '下载',
      'action.randomize': '随机',
      'action.expand': '看大图',
      'action.hideDisabled': '隐藏未启用',
      'action.showAll': '显示全部',
      'action.showUnused': '只看常用',
      'action.refreshCards': '重新读取服务器的节点信息（模型列表可能变过）',
      'action.freeVram': '释放显存',
      'action.freeVramHint': '让服务器卸载模型并清空缓存，把显存还给系统（不删任何文件，下次运行重新加载）',
      'action.freeVramBusy': '释放中…',
      'action.hideCard': '隐藏这张卡片（节点照样运行）',
      'action.showCard': '显示这张卡片',
      'state.hiddenCard': '已隐藏',
      'state.allHidden': '当前视图把所有卡片都藏起来了，点右上「显示全部」看看',
      'error.refresh': '重新读取失败：{message}',
      'state.loading': '加载中…',
      'state.empty.title': '还没有工作流',
      'state.empty.body': '点「导入工作流」，选一个 ComfyUI 导出的工作流 JSON（不是 API 格式）。',
      'state.empty.hint': '仓库里的 workflow/ 目录有两个 Qwen-Image 2.1 的示例。',
      'state.noServer': '未连接服务器',
      'state.connected': '已连接',
      'state.connecting': '正在连接…',
      'state.offline': '连不上',
      'state.saved': '已保存',
      'state.saving': '保存中…',
      'state.running': '运行中',
      'state.node': '节点',
      'state.progress': '进度',
      'state.queued': '排队',
      'state.idle': '空闲',
      'state.elapsed': '已用',
      'state.lastOk': '上次成功',
      'state.lastFail': '上次失败',
      'state.canceled': '已停止',
      'state.vram': '显存',
      'state.ram': '内存',
      'state.bypass': '旁路',
      'state.bypassHint': '这个节点不执行，它的输出由同类型的输入直通下游（和 ComfyUI 的 Bypass 一样）',
      'state.muted': '静音',
      'state.mutedHint': '这个节点在 ComfyUI 里是静音（Ctrl+M）：不执行，也没有输出可直通',
      'state.offCard': '未启用',
      'state.lockedBy': '由节点 #{id} 提供',
      'state.unsupported': '服务器没有这个值',
      'state.unsupportedHint': '服务器上确实有的话，点标签栏右边的 ⟳ 重新读取节点信息',
      'state.seedFixed': '固定种子',
      'state.seedRandom': '每次随机',
      'state.fileEmpty': '还没有选文件',
      'state.fileUnavailable': '服务器上读不到这个文件',
      'state.outputEmpty': '跑一次就有结果',
      'state.noOptions': '服务器没给可选列表，直接填',
      'state.notSaved': '未保存',
      'settings.title': '服务器设置',
      'settings.subtitle': '这些值只存在你本机的 DSH 目录里；可以配多台，切换后运行与模型列表都走那一台',
      'settings.active': '使用中',
      'settings.addServer': '+ 添加服务器',
      'settings.noServer': '还没有服务器，点「添加服务器」填一个地址',
      'settings.headersShow': '请求头',
      'settings.headersHide': '收起请求头',
      'settings.clearPassword': '清除密码',
      'settings.url': '服务器地址',
      'settings.urlHint': '例如 127.0.0.1:8188，或 https://gpu.example.com/comfy',
      'settings.username': '用户名',
      'settings.usernameHint': 'Basic 认证用；服务器没开认证就留空',
      'settings.password': '密码 / 令牌',
      'settings.passwordHint': '留空表示不修改；已保存时显示为「已保存」',
      'settings.passwordSaved': '已保存',
      'settings.headers': '额外请求头',
      'settings.headersHint': '一行一个，形如 Name: Value（反向代理或 API Token 用）',
      'settings.sound': '运行结束提示音',
      'settings.soundHint': '成功和失败用不同的音调；不弹窗',
      'settings.hideDisabled': '默认隐藏未启用的卡片',
      'settings.testOk': '连上了：ComfyUI {version} · {latency}ms',
      'settings.testFail': '连不上：{message}',
      'settings.saved': '设置已保存',
      'archive.title': '运行归档',
      'archive.empty': '还没有归档。每次运行结束都会记下参数和种子。',
      'archive.params': '参数',
      'archive.files': '产出',
      'archive.seed': '种子',
      'archive.duration': '耗时',
      'archive.clear': '清空归档',
      'archive.applied': '参数已套用到当前标签页',
      'error.import': '导入失败：{message}',
      'error.notJson': '这不是一个 JSON 文件',
      'error.run': '运行失败：{message}',
      'error.save': '保存失败：{message}',
      'warn.models': '没取到服务器的节点信息：{message}',
      'warn.missing': '服务器缺少节点类型：{list}',
      'warn.hideAll': '所有卡片都停用了，跑不出东西',
      'run.done': '{name} 跑完了',
      'run.failed': '{name} 失败了',
      'run.stopped': '{name} 已停止',
      'run.confirmStop': '确定要停止当前运行吗？',
      'run.confirmDelete': '删除标签页「{name}」？工作流文件和归档不会被删。',
      'card.prompt': '提示词',
      'card.file': '文件输入',
      'card.model': '主模型',
      'card.submodel': '小模型',
      'card.output': '输出',
      'card.general': '一般',
      'card.save': '保存位置',
    }

    const en = {
      'entry.label': 'ComfyUI',
      'panel.title': 'ComfyUI workspace',
      'panel.subtitle': 'Import a workflow, tune it, run it',
      'action.import': 'Import workflow',
      'action.settings': 'Settings',
      'action.archive': 'Archive',
      'action.run': 'Run',
      'action.stop': 'Stop',
      'action.refresh': 'Refresh',
      'action.retry': 'Retry',
      'action.close': 'Close',
      'action.save': 'Save',
      'action.test': 'Test connection',
      'action.browse': 'Browse',
      'action.openDir': 'Open',
      'action.openDirHint': 'Open this directory in the file manager',
      'action.pickFile': 'Choose file',
      'action.changeFile': 'Replace',
      'action.rename': 'Rename',
      'action.delete': 'Delete',
      'action.apply': 'Apply parameters',
      'action.rerun': 'Run again',
      'action.download': 'Download',
      'action.randomize': 'Randomize',
      'action.expand': 'Open',
      'action.hideDisabled': 'Hide disabled',
      'action.showAll': 'Show all',
      'action.showUnused': 'Only the usual',
      'action.refreshCards': 'Re-read the server’s node information (its model list may have changed)',
      'action.freeVram': 'Free VRAM',
      'action.freeVramHint': 'Unload the server’s models and empty its cache, handing VRAM back to the system (nothing is deleted; the next run reloads them)',
      'action.freeVramBusy': 'Freeing…',
      'action.hideCard': 'Hide this card (the node still runs)',
      'action.showCard': 'Show this card',
      'state.hiddenCard': 'Hidden',
      'state.allHidden': 'This view hides every card — choose “Show all” to see them',
      'error.refresh': 'Re-read failed: {message}',
      'state.loading': 'Loading…',
      'state.empty.title': 'No workflow yet',
      'state.empty.body': 'Choose “Import workflow” and pick a workflow JSON exported by ComfyUI (not the API format).',
      'state.empty.hint': 'The repository’s workflow/ directory has two Qwen-Image 2.1 examples.',
      'state.noServer': 'No server',
      'state.connected': 'Connected',
      'state.connecting': 'Connecting…',
      'state.offline': 'Unreachable',
      'state.saved': 'Saved',
      'state.saving': 'Saving…',
      'state.running': 'Running',
      'state.node': 'Node',
      'state.progress': 'Progress',
      'state.queued': 'Queued',
      'state.idle': 'Idle',
      'state.elapsed': 'Elapsed',
      'state.lastOk': 'Last run ok',
      'state.lastFail': 'Last run failed',
      'state.canceled': 'Stopped',
      'state.vram': 'VRAM',
      'state.ram': 'RAM',
      'state.bypass': 'Bypassed',
      'state.bypassHint': 'Not executed: its same-typed input is handed straight to whatever consumed its output (ComfyUI’s Bypass)',
      'state.muted': 'Muted',
      'state.mutedHint': 'Muted in ComfyUI (Ctrl+M): not executed, and it has no output to pass through',
      'state.offCard': 'Disabled',
      'state.lockedBy': 'Supplied by node #{id}',
      'state.unsupported': 'The server does not have this value',
      'state.unsupportedHint': 'If it does have it, choose ⟳ at the right of the tab row to re-read the node information',
      'state.seedFixed': 'Fixed seed',
      'state.seedRandom': 'Random each run',
      'state.fileEmpty': 'No file yet',
      'state.fileUnavailable': 'The server cannot read this file',
      'state.outputEmpty': 'Run once to see output',
      'state.noOptions': 'No option list from the server — type it',
      'state.notSaved': 'Unsaved',
      'settings.title': 'Server settings',
      'settings.subtitle': 'These values stay in this machine’s DSH directory. Several servers can be configured; switching sends runs and model lists to that one.',
      'settings.active': 'In use',
      'settings.addServer': '+ Add server',
      'settings.noServer': 'No server yet — choose “Add server” and fill in an address',
      'settings.headersShow': 'Headers',
      'settings.headersHide': 'Hide headers',
      'settings.clearPassword': 'Clear password',
      'settings.url': 'Server address',
      'settings.urlHint': 'e.g. 127.0.0.1:8188, or https://gpu.example.com/comfy',
      'settings.username': 'User name',
      'settings.usernameHint': 'For Basic auth; leave empty when the server has none',
      'settings.password': 'Password / token',
      'settings.passwordHint': 'Leave empty to keep it; a saved one shows as “Saved”',
      'settings.passwordSaved': 'Saved',
      'settings.headers': 'Extra request headers',
      'settings.headersHint': 'One per line as Name: Value (reverse proxy or API token)',
      'settings.sound': 'Sound when a run ends',
      'settings.soundHint': 'A different tone for success and failure; never a dialog',
      'settings.hideDisabled': 'Hide disabled cards by default',
      'settings.testOk': 'Reached it: ComfyUI {version} · {latency}ms',
      'settings.testFail': 'Cannot reach it: {message}',
      'settings.saved': 'Settings saved',
      'archive.title': 'Run archive',
      'archive.empty': 'Nothing archived yet. Every finished run records its parameters and seed.',
      'archive.params': 'Parameters',
      'archive.files': 'Outputs',
      'archive.seed': 'Seed',
      'archive.duration': 'Took',
      'archive.clear': 'Clear archive',
      'archive.applied': 'Parameters applied to the current tab',
      'error.import': 'Import failed: {message}',
      'error.notJson': 'That is not a JSON file',
      'error.run': 'Run failed: {message}',
      'error.save': 'Save failed: {message}',
      'warn.models': 'No node information from the server: {message}',
      'warn.missing': 'The server lacks these node types: {list}',
      'warn.hideAll': 'Every card is disabled, so nothing would run',
      'run.done': '{name} finished',
      'run.failed': '{name} failed',
      'run.stopped': '{name} was stopped',
      'run.confirmStop': 'Stop the current run?',
      'run.confirmDelete': 'Delete the tab “{name}”? The workflow file and its archive stay.',
      'card.prompt': 'Prompt',
      'card.file': 'File input',
      'card.model': 'Model',
      'card.submodel': 'Sub-model',
      'card.output': 'Output',
      'card.general': 'General',
      'card.save': 'Save location',
    }

    const DICTS = { zh, en }
    /** Last language resolved for the shell; module-level so a failure can be worded. */
    let activeLang = 'zh'

    /** One translated string, with `{name}` placeholders. */
    function translate(lang, key, params) {
      let out = DICTS[lang]?.[key] ?? DICTS.zh[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) {
        out = out.split(`{${name}}`).join(String(value))
      }
      return out
    }

    /** `t(key, params)` for the language in force. */
    const t = (key, params) => translate(activeLang, key, params)

    /** The shell's active language, as `zh` or `en`. */
    function resolveLang(ctx) {
      try {
        const snapshot = ctx.locale?.getLocale?.() ?? ctx.locale?.getSnapshot?.()
        const raw = snapshot?.active ?? snapshot?.locale ?? snapshot?.id ?? snapshot?.language ?? snapshot?.current ?? ''
        const text = typeof raw === 'string' ? raw.toLowerCase() : ''
        if (text.startsWith('zh')) return 'zh'
        if (text.startsWith('en')) return 'en'
      } catch {
        /* fall through to the browser */
      }
      return typeof navigator !== 'undefined' && /^zh/i.test(navigator.language ?? '') ? 'zh' : 'en'
    }

    // ── 数据通道 ──────────────────────────────────────────────────────────

    /**
     * One call on the Host half's route. Rejects with the Host's own message so
     * the panel can show it rather than "something went wrong".
     */
    async function api(method, payload = {}) {
      let response
      try {
        response = await fetch(`${API}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        })
      } catch (error) {
        throw new Error(`接口不可用：${error?.message ?? error}`)
      }
      let body = null
      try {
        body = await response.json()
      } catch {
        throw new Error(`接口返回的不是 JSON（HTTP ${response.status}）`)
      }
      if (body?.ok === true) return body.value
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
    }

    /** A media URL on the Host's proxy route. */
    function mediaUrl(file) {
      const query = new URLSearchParams({
        filename: String(file?.filename ?? ''),
        subfolder: String(file?.subfolder ?? ''),
        type: String(file?.type ?? 'output'),
      })
      return `${API}/view?${query.toString()}`
    }

    /**
     * Report one browser-side event to the Host's log.
     *
     * A panel that renders nothing tells its developer nothing either: the page's
     * console is on the other side of the screen. These lines land in
     * `$DSH_HOME/comfyui-workspace/debug.client.log`, which is the only channel
     * that survives that gap. Never throws into the caller.
     */
    function report(event, detail) {
      try {
        void fetch(`${API}/debug.log`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, detail: { ...detail, rev: CLIENT_REV, lang: activeLang } }),
        }).catch(() => undefined)
      } catch {
        /* full disk, blocked route, whatever: diagnostics must never break the UI */
      }
    }

    /** Split a ComfyUI widget value (`sub/dir/a.png`) into its two parts. */
    function splitFileValue(value) {
      const text = String(value ?? '').replace(/\\/g, '/')
      const index = text.lastIndexOf('/')
      if (index === -1) return { filename: text, subfolder: '' }
      return { filename: text.slice(index + 1), subfolder: text.slice(0, index) }
    }

    /** `12.3s` / `1m05s` / `—`. */
    function humanDuration(ms) {
      const value = Number(ms)
      if (!Number.isFinite(value) || value < 0) return '—'
      if (value < 1000) return `${Math.round(value)}ms`
      if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
      const minutes = Math.floor(value / 60_000)
      const seconds = Math.round((value % 60_000) / 1000)
      return `${minutes}m${String(seconds).padStart(2, '0')}s`
    }

    /** `1.2 GB` / `640 MB`. */
    function humanBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return '0'
      if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`
      if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`
      return `${Math.round(value / 1024)} KB`
    }

    /** A time of day for a status line. */
    function clockOf(iso) {
      const date = new Date(String(iso ?? ''))
      if (Number.isNaN(date.getTime())) return ''
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    }

    /** A stable pseudo-random bar height in `[0.25, 1]` from a string. */
    function barHeight(seed, index) {
      let hash = 2166136261
      const text = `${seed}:${index}`
      for (let index_ = 0; index_ < text.length; index_ += 1) {
        hash ^= text.charCodeAt(index_)
        hash = Math.imul(hash, 16777619)
      }
      const unit = ((hash >>> 8) % 1000) / 1000
      return 0.25 + unit * 0.75
    }

    // ── 提示音 ────────────────────────────────────────────────────────────

    /** One shared audio context, created on the first user gesture. */
    let audioContext = null

    /** Create or resume the audio context; browsers require a gesture first. */
    function ensureAudio() {
      try {
        const Ctx = window.AudioContext ?? window.webkitAudioContext
        if (typeof Ctx !== 'function') return null
        audioContext ??= new Ctx()
        if (audioContext.state === 'suspended') void audioContext.resume()
        return audioContext
      } catch {
        return null
      }
    }

    /**
     * Play the end-of-run tone. Two notes up for success, two down for a
     * failure, quiet enough to sit under whatever else is playing.
     */
    function playChime(kind) {
      const context = ensureAudio()
      if (context === null) return
      const notes = kind === 'success' ? [659.25, 987.77] : [392.0, 261.63]
      const now = context.currentTime + 0.02
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const start = now + index * 0.16
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + 0.24)
      })
    }

    // ── 样式 ──────────────────────────────────────────────────────────────

    const CSS = `
.cw-root{display:flex;flex-direction:column;height:100%;min-height:0;position:relative;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.cw-head{display:flex;align-items:center;gap:10px;padding:12px 16px 8px;flex-wrap:wrap;position:relative;z-index:2}
.cw-head h1{margin:0;font-size:15px;font-weight:600;letter-spacing:.2px}
.cw-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.cw-grow{flex:1 1 auto;min-width:0}
.cw-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.cw-server-pick{width:auto;max-width:168px;flex:0 0 auto;padding:4px 6px;font-size:11.5px}
.cw-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}
.cw-dot.ok{background:var(--dsw-alias-state-success-primary)}
.cw-dot.bad{background:var(--dsw-alias-state-error-primary)}
.cw-dot.busy{background:var(--dsw-alias-state-warn-primary);animation:cw-pulse 1.1s ease-in-out infinite}
@keyframes cw-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.cw-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit}
.cw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.cw-btn:disabled{opacity:.45;cursor:not-allowed}
.cw-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.cw-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.cw-btn.ghost{border-color:transparent;background:transparent}
.cw-btn.danger{color:var(--dsw-alias-state-error-primary)}
.cw-tabs{display:flex;align-items:center;gap:6px;padding:0 16px 8px;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.cw-tab{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 10px;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit;max-width:220px}
.cw-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cw-tab.active{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);border-bottom-color:transparent;color:var(--dsw-alias-label-primary);font-weight:600}
.cw-tab .cw-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-tab input{width:120px;font:inherit;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:1px 4px}
.cw-tab .cw-x{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0 2px;font-size:13px;line-height:1;font-family:inherit}
.cw-tab .cw-x:hover{color:var(--dsw-alias-state-error-primary)}
.cw-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px 16px 20px}
.cw-stack{display:flex;flex-direction:column;gap:10px;max-width:920px;margin:0 auto}
.cw-card{--cw-cat:transparent;--cw-tint:transparent;border:2px solid var(--dsw-alias-border-l1);border-radius:12px;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(var(--cw-tint),var(--cw-tint));padding:10px 12px;position:relative;transition:border-color .18s ease,opacity .18s ease}
/* Category = a translucent wash over the theme surface plus a left stripe. The
   BORDER stays reserved for status (running green, unsupported red). A
   translucent wash adapts by itself: pale in light mode, deep in dark mode, with
   the theme's own text contrast untouched. */
.cw-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:12px 0 0 12px;background:var(--cw-cat)}
.cw-card.cat-prompt{--cw-cat:#186a4f;--cw-tint:rgba(24,106,79,.26)}
.cw-card.cat-file{--cw-cat:#2563eb;--cw-tint:rgba(37,99,235,.22)}
.cw-card.cat-model{--cw-cat:#e2761b;--cw-tint:rgba(226,118,27,.24)}
.cw-card.cat-submodel{--cw-cat:#7c3aed;--cw-tint:rgba(124,58,237,.24)}
.cw-card.cat-output{--cw-cat:#0ea5e9;--cw-tint:rgba(14,165,233,.24)}
.cw-card.cat-general{--cw-cat:#c8a24a;--cw-tint:rgba(200,162,74,.26)}
.cw-card.cat-save{--cw-cat:#8b8f98;--cw-tint:rgba(139,143,152,.16)}
.cw-card.running{border-color:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-success-primary) inset}
.cw-card.cached{border-color:var(--dsw-alias-state-success-tertiary)}
.cw-card.invalid{border-color:var(--dsw-alias-state-error-primary)}
.cw-card.off{opacity:.5;filter:saturate(.35)}
.cw-card-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.cw-card-title{font-weight:600;font-size:12.5px}
.cw-card-type{color:var(--dsw-alias-label-tertiary);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.cw-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:0 0 auto}
.cw-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cw-icon-btn.on{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-border-l1)}
.cw-badge{font-size:10px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.cw-switch{position:relative;width:34px;height:18px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);cursor:pointer;padding:0;flex:0 0 auto}
.cw-switch span.line{position:absolute;left:0;right:0;top:50%;height:1px;background:var(--dsw-alias-border-l2)}
.cw-switch span.knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:3px;background:var(--dsw-alias-state-idle-primary);transition:left .16s ease,background .16s ease}
.cw-switch[aria-pressed="true"]{border-color:var(--dsw-alias-state-success-primary)}
.cw-switch[aria-pressed="true"] span.knob{left:18px;background:var(--dsw-alias-state-success-primary)}
.cw-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px 12px}
.cw-fields-save{grid-template-columns:1fr}
.cw-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.cw-field.wide{grid-column:1/-1}
.cw-label{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:5px;min-width:0;flex-wrap:nowrap}
/* A squeezed grid column must truncate its label, never stack one character per
   line: "服务器目录" broken per-glyph is unreadable. */
.cw-label>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.cw-label .cw-hint{color:var(--dsw-alias-label-dimmed);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-input,.cw-select,.cw-textarea{width:100%;box-sizing:border-box;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:5px 7px;font-family:inherit}
.cw-select{cursor:pointer}
.cw-textarea{resize:vertical;min-height:64px;line-height:1.55}
.cw-input:disabled,.cw-select:disabled,.cw-textarea:disabled{opacity:.6;cursor:not-allowed}
.cw-input.bad,.cw-select.bad{border-color:var(--dsw-alias-state-error-primary)}
.cw-row{display:flex;align-items:center;gap:6px;min-width:0}
.cw-row .cw-input{flex:1 1 auto}
.cw-note{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.cw-note.bad{color:var(--dsw-alias-state-error-primary)}
.cw-filebox{display:flex;align-items:center;gap:10px}
.cw-thumb{width:64px;height:64px;border-radius:9px;background:var(--dsw-alias-bg-base);border:1px dashed var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;color:var(--dsw-alias-label-tertiary);position:relative}
.cw-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.cw-thumb .cw-wave{display:flex;align-items:flex-end;gap:1.5px;height:26px}
.cw-thumb .cw-wave i{width:2px;background:var(--dsw-alias-state-business-primary);border-radius:1px;display:block}
.cw-fileinfo{min-width:0;flex:1 1 auto}
.cw-fileinfo .cw-filename{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-media{width:100%;border-radius:9px;display:block;background:var(--dsw-alias-bg-base);max-height:420px;object-fit:contain}
.cw-media.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;border:0;background:transparent}
.cw-media.grid img{width:100%;border-radius:9px;display:block;cursor:zoom-in;background:var(--dsw-alias-bg-base)}
.cw-audio{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;background:var(--dsw-alias-bg-base)}
.cw-audio .cw-play{width:28px;height:28px;border-radius:50%;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;padding:0}
.cw-audio .cw-wave{display:flex;align-items:center;gap:1.5px;height:30px;flex:1 1 auto;position:relative;cursor:pointer;overflow:hidden}
.cw-audio .cw-wave i{width:2.5px;border-radius:1px;background:var(--dsw-alias-border-l2);flex:0 0 auto;transition:background .12s ease}
.cw-audio .cw-wave i.done{background:var(--dsw-alias-state-business-primary)}
.cw-audio .cw-time{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:0 0 auto}
.cw-lightbox{position:absolute;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:90;cursor:zoom-out;padding:24px}
.cw-lightbox img,.cw-lightbox video{max-width:92vw;max-height:88vh;border-radius:10px}
.cw-foot{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap;position:relative;z-index:2}
.cw-status{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-res{display:flex;align-items:center;gap:14px;flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.cw-res-item{display:inline-flex;align-items:center;gap:6px}
.cw-res-label{color:var(--dsw-alias-label-tertiary)}
.cw-meter{position:relative;display:inline-block;width:84px;height:10px;border-radius:5px;background:var(--dsw-alias-border-l2);overflow:hidden;flex:0 0 auto}
.cw-meter i{display:block;height:100%;border-radius:5px;background:var(--dsw-alias-state-success-primary);transition:width .35s ease}
.cw-res-item.hot .cw-meter i{background:var(--dsw-alias-state-warn-primary)}
.cw-res-num{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.cw-res-pct,.cw-res-peak{font-variant-numeric:tabular-nums}
.cw-res-pct{color:var(--dsw-alias-label-secondary)}
.cw-res-peak{color:var(--dsw-alias-label-dimmed)}
.cw-progress{width:160px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;flex:0 0 auto}
.cw-progress i{display:block;height:100%;background:var(--dsw-alias-state-success-primary);transition:width .25s ease}
.cw-banner{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:7px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);max-width:920px;margin:0 auto 10px}
.cw-banner.bad{border-left-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary)}
.cw-empty{max-width:520px;margin:8vh auto 0;text-align:center;color:var(--dsw-alias-label-secondary)}
.cw-empty h2{font-size:15px;margin:0 0 6px;color:var(--dsw-alias-label-primary)}
.cw-empty p{margin:4px 0;font-size:12px}
/* Overlays are ABSOLUTE inside the panel, not fixed to the viewport: the shell
   puts the main panel inside containers that establish their own containing
   block (transform/contain), where a fixed overlay no longer means "the
   viewport" and the sheet can land outside the visible area. Absolute keeps the
   dialog inside the panel's own box wherever the shell has put it. */
.cw-modal{position:absolute;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.42);display:flex;align-items:flex-start;justify-content:center;z-index:80;padding:6vh 16px;overflow:auto}
.cw-sheet{width:min(560px,100%);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.32);padding:16px 18px 14px}
.cw-sheet h2{margin:0 0 2px;font-size:15px}
.cw-sheet .cw-sheet-sub{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-bottom:12px}
.cw-server-list{display:flex;flex-direction:column;gap:8px;max-height:44vh;overflow:auto;margin-top:8px}
.cw-server{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}
.cw-server.active{border-color:var(--dsw-alias-brand-primary)}
.cw-radio{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:0 0 auto}
.cw-radio input{margin:0}
.cw-sheet-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
.cw-drawer{position:absolute;top:0;right:0;bottom:0;width:min(460px,92vw);background:var(--dsw-alias-bg-overlay);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:-12px 0 40px rgba(0,0,0,.26);z-index:80;display:flex;flex-direction:column}
.cw-drawer-head{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.cw-drawer-body{flex:1 1 auto;overflow-y:auto;padding:12px 16px 20px;display:flex;flex-direction:column;gap:10px}
.cw-entry{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 11px;background:var(--dsw-alias-bg-layer-1)}
.cw-entry-head{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600}
.cw-entry-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap}
.cw-entry pre{margin:7px 0 0;font-size:11px;line-height:1.45;max-height:180px;overflow:auto;background:var(--dsw-alias-bg-base);border-radius:7px;padding:7px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
.cw-entry-actions{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
.cw-thumbs{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
.cw-thumbs img{width:52px;height:52px;object-fit:cover;border-radius:6px;display:block;background:var(--dsw-alias-bg-base)}
@media (max-width:640px){
  .cw-body{padding:10px}
  .cw-fields{grid-template-columns:1fr}
  .cw-head{padding:10px 10px 6px}
  .cw-tabs{padding:0 10px 6px}
  .cw-foot{padding:8px 10px}
  .cw-progress{width:80px}
  .cw-meter{width:52px;height:7px}
  .cw-res-peak{display:none}
}
`

    // ── 小控件 ────────────────────────────────────────────────────────────

    /** The “日” shaped enable toggle: a landscape pill split by a line. */
    function Toggle(props) {
      return h('button', {
        type: 'button',
        className: 'cw-switch',
        role: 'switch',
        'aria-pressed': props.checked === true ? 'true' : 'false',
        'aria-label': props.label,
        title: props.label,
        onClick: props.onChange,
      }, h('span', { className: 'line' }), h('span', { className: 'knob' }))
    }

    /** A labelled field wrapper. A div, not a label: several controls inside it
     *  are buttons, and a label would forward their clicks to the first input. */
    function Field(props) {
      return h('div', { className: `cw-field${props.wide === true ? ' wide' : ''}` },
        h('span', { className: 'cw-label' },
          h('span', null, props.label),
          props.hint === undefined ? null : h('span', { className: 'cw-hint', title: props.hint }, props.hint),
        ),
        props.children,
      )
    }

    /** A plain text/number input bound to one field. */
    function TextInput(props) {
      const { field, value, onChange, disabled } = props
      const numeric = field.kind === 'int' || field.kind === 'float'
      return h('input', {
        className: `cw-input${field.supported === false ? ' bad' : ''}`,
        type: numeric ? 'number' : 'text',
        value: value === null || value === undefined ? '' : String(value),
        step: field.kind === 'int' ? (field.step ?? 1) : (field.step ?? 'any'),
        min: field.min,
        max: field.max,
        disabled: disabled === true,
        spellCheck: false,
        onChange: (event) => onChange(numeric ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value),
      })
    }

    /** A combo field: the server's option list when there is one. */
    function ComboInput(props) {
      const { field, value, onChange, disabled } = props
      const options = Array.isArray(field.options) ? field.options : []
      if (options.length === 0) {
        return h('input', {
          className: 'cw-input',
          type: 'text',
          value: value === null || value === undefined ? '' : String(value),
          disabled: disabled === true,
          spellCheck: false,
          placeholder: t('state.noOptions'),
          onChange: (event) => onChange(event.target.value),
        })
      }
      const known = options.includes(value)
      return h('select', {
        className: `cw-select${known ? '' : ' bad'}`,
        value: String(value ?? ''),
        disabled: disabled === true,
        onChange: (event) => onChange(event.target.value),
      }, [
        known ? null : h('option', { key: '__unknown', value: String(value ?? '') }, `${String(value ?? '')}（${t('state.unsupported')}）`),
        ...options.map((option) => h('option', { key: String(option), value: String(option) }, String(option))),
      ])
    }

    /** A multi-line text field that grows with its content. */
    function TextArea(props) {
      const { value, onChange, rows = 3, disabled, placeholder } = props
      return h('textarea', {
        className: 'cw-textarea',
        rows,
        value: value === null || value === undefined ? '' : String(value),
        disabled: disabled === true,
        placeholder,
        spellCheck: false,
        onChange: (event) => onChange(event.target.value),
      })
    }

    /** One field of one card, chosen by its kind. */
    function FieldControl(props) {
      const { field, value, onChange, disabled } = props
      if (field.locked === true) {
        const shown = typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}…` : String(value ?? '')
        return h('div', null,
          h('input', { className: 'cw-input', type: 'text', value: shown, disabled: true, readOnly: true }),
          h('div', { className: 'cw-note' }, t('state.lockedBy', { id: field.lockedBy ?? '?' })),
        )
      }
      if (field.kind === 'text') {
        return h(TextArea, { value, onChange, rows: props.rows ?? 3, disabled })
      }
      if (field.kind === 'bool') {
        return h('div', { className: 'cw-row' },
          h(Toggle, { checked: value === true, label: field.label, onChange: () => onChange(value !== true) }),
          h('span', { className: 'cw-note' }, value === true ? 'true' : 'false'),
        )
      }
      if (field.kind === 'path') {
        return h('div', { className: 'cw-row' },
          h('input', {
            className: 'cw-input',
            type: 'text',
            value: value ?? '',
            disabled,
            spellCheck: false,
            onChange: (event) => onChange(event.target.value),
          }),
          props.onBrowse === undefined ? null : h('button', {
            type: 'button',
            className: 'cw-btn ghost',
            onClick: props.onBrowse,
            disabled,
          }, t('action.browse')),
          props.onOpen === undefined ? null : h('button', {
            type: 'button',
            className: 'cw-btn ghost',
            title: t('action.openDirHint'),
            onClick: props.onOpen,
            disabled: disabled === true || value === undefined || value === null || value === '',
          }, t('action.openDir')),
        )
      }
      if (field.kind === 'combo') return h(ComboInput, { field, value, onChange, disabled })
      return h(TextInput, { field, value, onChange, disabled })
    }

    /** The seed field with its dice and its “random each run” switch. */
    function SeedRow(props) {
      const { field, value, onChange, random, onRandom, disabled } = props
      return h('div', null,
        h('div', { className: 'cw-row' },
          h(TextInput, { field: { ...field, kind: 'int' }, value, onChange, disabled: disabled === true }),
          h('button', {
            type: 'button',
            className: 'cw-btn',
            disabled: disabled === true,
            title: t('action.randomize'),
            onClick: () => onRandom(),
          }, '🎲'),
        ),
        h('div', { className: 'cw-row' },
          h(Toggle, {
            checked: random === true,
            label: t('state.seedRandom'),
            onChange: () => onRandom({ toggleOnly: true }),
          }),
          h('span', { className: 'cw-note' }, random === true ? t('state.seedRandom') : t('state.seedFixed')),
        ),
      )
    }

    // ── 媒体 ──────────────────────────────────────────────────────────────

    /** A pseudo-waveform of fixed bars, with the played part filled in. */
    function Waveform(props) {
      const { seed, count = 48, progress = 0, onSeek } = props
      const bars = useMemo(() => Array.from({ length: count }, (_, index) => barHeight(seed, index)), [seed, count])
      return h('div', {
        className: 'cw-wave',
        role: 'presentation',
        onClick: (event) => {
          if (onSeek === undefined) return
          const rect = event.currentTarget.getBoundingClientRect()
          if (rect.width <= 0) return
          onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)))
        },
      }, bars.map((height, index) => h('i', {
        key: index,
        className: index / count <= progress ? 'done' : '',
        style: { height: `${Math.round(height * 100)}%` },
      })))
    }

    /** One audio file with a play button, a waveform and a time line. */
    function AudioPlayer(props) {
      const { src, name } = props
      const ref = useRef(null)
      const [playing, setPlaying] = useState(false)
      const [progress, setProgress] = useState(0)
      const [time, setTime] = useState({ at: 0, total: 0 })

      useEffect(() => {
        const element = ref.current
        if (element === null) return undefined
        const onTime = () => {
          const total = Number.isFinite(element.duration) ? element.duration : 0
          setTime({ at: element.currentTime, total })
          setProgress(total > 0 ? Math.min(1, element.currentTime / total) : 0)
        }
        const onEnd = () => { setPlaying(false); setProgress(0); setTime({ at: 0, total: time.total }) }
        element.addEventListener('timeupdate', onTime)
        element.addEventListener('ended', onEnd)
        element.addEventListener('loadedmetadata', onTime)
        return () => {
          element.removeEventListener('timeupdate', onTime)
          element.removeEventListener('ended', onEnd)
          element.removeEventListener('loadedmetadata', onTime)
        }
      }, [time.total])

      const format = (seconds) => {
        const value = Math.max(0, Math.round(Number(seconds) || 0))
        return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
      }

      return h('div', { className: 'cw-audio' },
        h('button', {
          type: 'button',
          className: 'cw-play',
          'aria-label': playing ? 'pause' : 'play',
          onClick: () => {
            const element = ref.current
            if (element === null) return
            if (element.paused) {
              void element.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
            } else {
              element.pause()
              setPlaying(false)
            }
          },
        }, playing
          ? h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
              h('rect', { x: 2, y: 1, width: 3, height: 10, fill: 'currentColor' }),
              h('rect', { x: 7, y: 1, width: 3, height: 10, fill: 'currentColor' }))
          : h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
              h('path', { d: 'M2 1l9 5-9 5z', fill: 'currentColor' }))),
        h(Waveform, {
          seed: name,
          count: 56,
          progress,
          onSeek: (ratio) => {
            const element = ref.current
            if (element === null || !Number.isFinite(element.duration)) return
            element.currentTime = ratio * element.duration
          },
        }),
        h('span', { className: 'cw-time' }, `${format(time.at)} / ${format(time.total)}`),
        h('audio', { ref, src, preload: 'metadata', style: { display: 'none' } }),
      )
    }

    /** One output file: image, video or audio. */
    function MediaFile(props) {
      const { file, onExpand } = props
      const src = mediaUrl(file)
      const name = file.filename ?? ''
      if (file.kind === 'audio') return h(AudioPlayer, { src, name })
      if (file.kind === 'video') {
        return h('video', { className: 'cw-media', src, controls: true, preload: 'metadata' })
      }
      return h('img', {
        className: 'cw-media',
        src,
        alt: name,
        loading: 'lazy',
        onClick: () => onExpand?.({ src, name }),
      })
    }

    /** `20.7` for 22.2 GB — the footer shows one decimal, unit on the total. */
    function gbNumber(bytes) {
      const value = Number(bytes)
      return Number.isFinite(value) && value > 0 ? (value / 1024 ** 3).toFixed(1) : '—'
    }

    /** `6.2 GB` for a human sentence in a notice. */
    function gbText(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return '0 GB'
      return `${(value / 1024 ** 3).toFixed(value >= 1024 ** 3 ? 1 : 2)} GB`
    }

    /**
     * One `显存 [████░░] 13.2/15.9G 83%` meter.
     *
     * The bar is the level; the peak comes from the samples kept for the run, so
     * "it was at 92% a minute ago" survives the moment it drops back down.
     */
    function ResourceMeter(props) {
      const { label, total, free, history, title, hot } = props
      const size = Number(total)
      const used = Math.max(0, size - Number(free))
      const ratio = size > 0 ? Math.min(1, used / size) : 0
      const peak = Array.isArray(history) && history.length > 0 ? Math.max(...history) : 0
      const percent = Math.round(ratio * 100)
      return h('span', { className: `cw-res-item${hot === true ? ' hot' : ''}`, title },
        h('span', { className: 'cw-res-label' }, label),
        h('span', {
          className: 'cw-meter',
          role: 'img',
          'aria-label': `${label} ${percent}%`,
        }, h('i', { style: { width: `${percent}%` } })),
        h('span', { className: 'cw-res-num' }, `${gbNumber(used)}/${gbNumber(size)}G`),
        h('span', { className: 'cw-res-pct' }, `${percent}%`),
        // Only worth showing while the peak is actually above the current level.
        peak > ratio + 0.02
          ? h('span', { className: 'cw-res-peak', title: `${label}峰值` }, `峰 ${Math.round(peak * 100)}%`)
          : null,
      )
    }

    // ── 卡片 ──────────────────────────────────────────────────────────────

    /** An eye, crossed out when the card is hidden. */
    function EyeIcon(props) {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M1.4 8s2.4-4.3 6.6-4.3S14.6 8 14.6 8 12.2 12.3 8 12.3 1.4 8 1.4 8z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 8, cy: 8, r: 1.9, stroke: 'currentColor', strokeWidth: 1.2 }),
        props.off === true
          ? h('path', { d: 'M2.6 13.4 L13.4 2.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })
          : null,
      )
    }

    /** The frame every card shares: border state, title, enable toggle. */
    function CardFrame(props) {
      const { card, running, cached, invalid, children } = props
      const classes = ['cw-card', `cat-${card.category}`]
      if (card.enabled !== true) classes.push('off')
      else if (running === true) classes.push('running')
      else if (cached === true) classes.push('cached')
      else if (invalid === true) classes.push('invalid')
      return h('section', { className: classes.join(' '), 'data-node': card.id },
        h('div', { className: 'cw-card-head' },
          h('span', { className: 'cw-card-title' }, card.title),
          h('span', { className: 'cw-card-type' }, `#${card.id}`),
          h('span', { className: 'cw-badge' }, t(`card.${card.category}`)),
          card.enabled === true
            ? null
            : h('span', {
                className: 'cw-badge',
                title: card.bypass === false ? t('state.mutedHint') : t('state.bypassHint'),
              }, card.bypass === false ? t('state.muted') : t('state.bypass')),
          card.hidden === true ? h('span', { className: 'cw-badge' }, t('state.hiddenCard')) : null,
          h('span', { className: 'cw-grow' }),
          // Hiding is not disabling: the node keeps running with its saved values,
          // the card just stops taking up room in the stack.
          card.category === 'save'
            ? null
            : h('button', {
                type: 'button',
                className: `cw-icon-btn${card.hidden === true ? ' on' : ''}`,
                title: card.hidden === true ? t('action.showCard') : t('action.hideCard'),
                'aria-label': card.hidden === true ? t('action.showCard') : t('action.hideCard'),
                'aria-pressed': card.hidden === true ? 'true' : 'false',
                onClick: () => props.onHide(card.hidden !== true),
              }, h(EyeIcon, { off: card.hidden === true })),
          card.category === 'save'
            ? null
            : h(Toggle, {
                checked: card.enabled === true,
                label: card.title,
                onChange: () => props.onToggle(),
              }),
        ),
        children,
      )
    }

    /** One card, by category. */
    function Card(props) {
      const { card, nodeConfig, onToggle, onHide, onField, onRandomSeed, onUpload, onBrowse, onOpenLocal, outputs, running, cached, invalid, preview, onExpand } = props
      const disabled = card.enabled !== true
      const valueOf = (name) => {
        const values = nodeConfig?.values
        if (values !== null && typeof values === 'object' && Object.hasOwn(values, name)) return values[name]
        const field = (card.fields ?? []).find((item) => item.name === name)
        return field?.value
      }
      const setField = (name, value) => onField(card.id, name, value)

      return h(CardFrame, {
        card, running, cached, invalid,
        onToggle: () => onToggle(card.id),
        onHide: (hidden) => onHide(card.id, hidden),
      },
        card.category === 'file' ? h(FileBody, {
          card, disabled, onUpload, preview,
          value: valueOf(card.file?.widget ?? 'image'),
        }) : null,

        card.category === 'prompt' ? h('div', { className: 'cw-fields' },
          (card.fields ?? []).map((field) => h(Field, { key: field.name, wide: true, label: field.label },
            h(FieldControl, {
              field,
              value: valueOf(field.name),
              disabled,
              rows: 9,
              onChange: (value) => setField(field.name, value),
            }),
          )),
        ) : null,

        card.category === 'output' ? h('div', null,
          (card.fields ?? []).length === 0 ? null : h('div', { className: 'cw-fields' },
            (card.fields ?? []).map((field) => h(Field, { key: field.name, label: field.label },
              h(FieldControl, {
                field,
                value: valueOf(field.name),
                disabled,
                onChange: (value) => setField(field.name, value),
              }),
            )),
          ),
          h(OutputBody, { outputs, onExpand }),
        ) : null,

        // Every save row is a full-width line: the labels ("服务器目录",
        // "#508 保存图像") are short but their hints are not, and a two-column
        // grid squeezed them into one character per line.
        card.category === 'save' ? h('div', { className: 'cw-fields cw-fields-save' },
          (card.fields ?? []).map((field) => h(Field, {
            key: field.name,
            label: field.label,
            hint: field.hint,
            wide: true,
          }, h(FieldControl, {
            field,
            value: valueOf(field.name),
            disabled: false,
            onBrowse: field.kind === 'path' ? () => onBrowse(field.name) : undefined,
            onOpen: field.kind === 'path' ? () => onOpenLocal(field.name) : undefined,
            onChange: (value) => onField('__save__', field.name, value),
          }))),
        ) : null,

        card.category === 'general' || card.category === 'model' || card.category === 'submodel' ? h('div', { className: 'cw-fields' },
          (card.fields ?? []).map((field) => {
            // A seed supplied by a link is shown read-only: the node that owns it
            // is the one with the dice.
            const isSeed = field.locked !== true && /(^seed$|_seed$|^noise_seed$)/.test(field.name)
            const wide = field.kind === 'text'
            if (isSeed) {
              return h(Field, { key: field.name, label: field.label },
                h(SeedRow, {
                  field,
                  value: valueOf(field.name),
                  disabled,
                  random: nodeConfig?.randomSeed === true,
                  onChange: (value) => setField(field.name, value),
                  onRandom: (options) => onRandomSeed(card.id, field.name, options ?? {}),
                }),
              )
            }
            return h(Field, { key: field.name, label: field.label, wide },
              h(FieldControl, {
                field,
                value: valueOf(field.name),
                disabled,
                onChange: (value) => setField(field.name, value),
              }),
              field.supported === false
                ? h('div', { className: 'cw-note bad' }, `${t('state.unsupported')}：${String(field.value ?? '')}`)
                : null,
              field.supported === false
                ? h('div', { className: 'cw-note' }, t('state.unsupportedHint'))
                : null,
            )
          }),
        ) : null,
      )
    }

    /** The body of a file-input card. */
    function FileBody(props) {
      const { card, disabled, value, onUpload, preview } = props
      const name = value === null || value === undefined ? '' : String(value)
      const parts = splitFileValue(name)
      const [broken, setBroken] = useState(false)
      const kindHint = card.file?.widget === 'video' || card.file?.widget === 'video_name'
        ? 'video'
        : card.file?.widget === 'audio' || card.file?.widget === 'audio_name'
          ? 'audio'
          : 'image'
      const remoteSrc = name === '' ? '' : mediaUrl({ ...parts, type: 'input' })
      return h('div', { className: 'cw-filebox' },
        h('div', { className: 'cw-thumb' },
          preview !== undefined && preview !== ''
            ? (kindHint === 'image' ? h('img', { src: preview, alt: name }) : h('div', { className: 'cw-note' }, kindHint))
            : broken || name === ''
              ? h('span', { className: 'cw-note' }, name === '' ? t('state.fileEmpty') : '⚠')
              : kindHint === 'image'
                ? h('img', { src: remoteSrc, alt: name, loading: 'lazy', onError: () => setBroken(true) })
                : h(kindHint === 'audio'
                  ? h('div', { className: 'cw-wave' }, Array.from({ length: 12 }, (_, index) => h('i', {
                      key: index,
                      style: { height: `${Math.round(barHeight(name, index) * 100)}%` },
                    })))
                  : h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                      h('rect', { x: 2, y: 5, width: 14, height: 14, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
                      h('path', { d: 'M16 11l6-3.5v9L16 13z', fill: 'currentColor' }))),
        ),
        h('div', { className: 'cw-fileinfo' },
          h('div', { className: 'cw-filename', title: name }, name === '' ? t('state.fileEmpty') : name),
          h('div', { className: 'cw-note' },
            broken ? t('state.fileUnavailable') : (card.file?.widget ?? 'file'),
          ),
        ),
        h(FilePicker, { disabled, onUpload, label: name === '' ? t('action.pickFile') : t('action.changeFile') }),
      )
    }

    /** The hidden `<input type="file">` behind a styled button. */
    function FilePicker(props) {
      const { disabled, onUpload, label } = props
      const ref = useRef(null)
      return h('span', null,
        h('button', {
          type: 'button',
          className: 'cw-btn',
          disabled: disabled === true,
          onClick: () => ref.current?.click(),
        }, label),
        h('input', {
          ref,
          type: 'file',
          accept: 'image/*,video/*,audio/*',
          style: { display: 'none' },
          onChange: (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined && file !== null) onUpload(file)
          },
        }),
      )
    }

    /** The output area of an output card. */
    function OutputBody(props) {
      const { outputs, onExpand } = props
      const files = Array.isArray(outputs) ? outputs : []
      if (files.length === 0) return h('div', { className: 'cw-note', style: { marginTop: 8 } }, t('state.outputEmpty'))
      return h('div', { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 } },
        files.map((file, index) => h(MediaFile, { key: `${file.filename}:${index}`, file, onExpand })),
        files.some((file) => file.localPath !== undefined)
          ? h('div', { className: 'cw-note' }, `已存到：${files.find((file) => file.localPath !== undefined)?.localPath}`)
          : null,
      )
    }

    // ── 设置面板 ──────────────────────────────────────────────────────────

    /** `Name: Value` lines ↔ a header object. */
    function headersToText(headers) {
      return Object.entries(headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n')
    }

    /** Parse the header textarea; an unreadable line is reported, not guessed. */
    function textToHeaders(value) {
      const out = {}
      const problems = []
      for (const line of String(value ?? '').split(/\r?\n/)) {
        const text = line.trim()
        if (text === '') continue
        const index = text.indexOf(':')
        if (index <= 0) {
          problems.push(text)
          continue
        }
        const key = text.slice(0, index).trim()
        const rest = text.slice(index + 1).trim()
        if (key === '') problems.push(text)
        else out[key] = rest
      }
      return { headers: out, problems }
    }

    /** One server's editable draft inside the settings sheet. */
    function draftOf(server, index) {
      return {
        key: typeof server?.id === 'string' && server.id !== '' ? server.id : `draft-${index}-${Math.random().toString(36).slice(2, 8)}`,
        id: typeof server?.id === 'string' ? server.id : '',
        name: typeof server?.name === 'string' ? server.name : `服务器 ${index + 1}`,
        url: typeof server?.url === 'string' ? server.url : '',
        username: typeof server?.username === 'string' ? server.username : '',
        password: '',
        hasPassword: server?.hasPassword === true,
        clearPassword: false,
        headersText: headersToText(server?.headers),
        status: null,
      }
    }

    /** One editable server row: name, address, credentials, headers, test, remove. */
    function ServerRow(props) {
      const { draft, active, onPatch, onActivate, onRemove, onTest, canRemove } = props
      const [open, setOpen] = useState(false)
      const patch = (part) => onPatch({ ...draft, ...part })
      return h('div', { className: `cw-server${active ? ' active' : ''}` },
        h('div', { className: 'cw-row' },
          h('input', {
            className: 'cw-input',
            style: { maxWidth: 110 },
            value: draft.name,
            spellCheck: false,
            placeholder: '名字',
            onChange: (event) => patch({ name: event.target.value }),
          }),
          h('input', {
            className: 'cw-input',
            value: draft.url,
            spellCheck: false,
            placeholder: '127.0.0.1:8188',
            onChange: (event) => patch({ url: event.target.value }),
          }),
          h('label', { className: 'cw-radio', title: t('settings.active') },
            h('input', {
              type: 'radio',
              name: 'cw-active-server',
              checked: active === true,
              onChange: () => onActivate(draft.key),
            }),
            t('settings.active'),
          ),
        ),
        h('div', { className: 'cw-row', style: { marginTop: 6 } },
          h('input', {
            className: 'cw-input',
            style: { maxWidth: 130 },
            value: draft.username,
            spellCheck: false,
            placeholder: t('settings.username'),
            onChange: (event) => patch({ username: event.target.value }),
          }),
          h('input', {
            className: 'cw-input',
            type: 'password',
            value: draft.password,
            autoComplete: 'new-password',
            placeholder: draft.hasPassword === true ? t('settings.passwordSaved') : t('settings.password'),
            onChange: (event) => patch({ password: event.target.value, clearPassword: false }),
          }),
        ),
        h('div', { className: 'cw-row', style: { marginTop: 6 } },
          h('button', {
            type: 'button',
            className: 'cw-btn ghost',
            onClick: () => setOpen(!open),
          }, open ? t('settings.headersHide') : t('settings.headersShow')),
          draft.hasPassword === true
            ? h('button', {
                type: 'button',
                className: 'cw-btn ghost danger',
                onClick: () => patch({ password: '', clearPassword: true, hasPassword: false }),
              }, t('settings.clearPassword'))
            : null,
          h('span', { className: 'cw-grow' }),
          h('button', {
            type: 'button',
            className: 'cw-btn ghost',
            onClick: () => void onTest(draft),
          }, draft.status === 'testing' ? t('state.loading') : t('action.test')),
          canRemove === true
            ? h('button', { type: 'button', className: 'cw-btn ghost danger', onClick: () => onRemove(draft.key) }, t('action.delete'))
            : null,
        ),
        open ? h('textarea', {
          className: 'cw-textarea',
          rows: 2,
          style: { marginTop: 6 },
          value: draft.headersText,
          spellCheck: false,
          placeholder: 'X-Api-Key: xxx',
          onChange: (event) => patch({ headersText: event.target.value }),
        }) : null,
        draft.result === undefined || draft.result === null
          ? null
          : h('div', { className: `cw-note${draft.result.ok === true ? '' : ' bad'}`, style: { marginTop: 6 } },
            draft.result.ok === true
              ? t('settings.testOk', { version: draft.result.version || '?', latency: draft.result.latencyMs })
                + (Array.isArray(draft.result.devices) && draft.result.devices.length > 0
                  ? ` · ${draft.result.devices.map((device) => `${device.name} ${humanBytes(device.vramFree)}/${humanBytes(device.vramTotal)}`).join('；')}`
                  : '')
              : t('settings.testFail', { message: draft.result.message ?? '' })),
      )
    }

    /** The Settings dialog: a list of ComfyUI servers plus the panel preferences. */
    function SettingsDialog(props) {
      const { settings, onClose, onSaved } = props
      const [drafts, setDrafts] = useState(() => (settings.servers ?? []).map(draftOf))
      const [activeKey, setActiveKey] = useState(() => {
        const servers = settings.servers ?? []
        const active = servers.find((server) => server.id === settings.activeServerId)
        return active?.id ?? servers[0]?.id ?? ''
      })
      const [sound, setSound] = useState(settings.ui?.sound !== false)
      const [hideDisabled, setHideDisabled] = useState(settings.ui?.hideDisabled !== false)
      const [error, setError] = useState(null)
      const [problems, setProblems] = useState([])
      const [busy, setBusy] = useState(false)

      const patchDraft = (key, next) => {
        setDrafts((prev) => prev.map((item) => (item.key === key ? next : item)))
      }

      const testOne = async (draft) => {
        patchDraft(draft.key, { ...draft, status: 'testing', result: null })
        const parsed = textToHeaders(draft.headersText)
        try {
          const value = await api('server.test', {
            // Test what is typed, not what was saved: an unsaved address and a
            // freshly typed password are exactly the ones worth trying.
            draft: {
              id: draft.id,
              url: draft.url,
              username: draft.username,
              headers: parsed.headers,
              password: draft.password,
            },
          })
          patchDraft(draft.key, { ...draft, status: null, result: value })
        } catch (problem) {
          patchDraft(draft.key, { ...draft, status: null, result: { ok: false, message: problem.message } })
        }
      }

      const save = async () => {
        setError(null)
        const unparsed = []
        const servers = drafts.map((draft, index) => {
          const parsed = textToHeaders(draft.headersText)
          if (parsed.problems.length > 0) unparsed.push(`${draft.name || `服务器 ${index + 1}`}：${parsed.problems.join(' / ')}`)
          const payload = {
            id: draft.id === '' ? undefined : draft.id,
            name: draft.name,
            url: draft.url,
            username: draft.username,
            headers: parsed.headers,
          }
          if (draft.password !== '') payload.password = draft.password
          else if (draft.clearPassword === true) payload.clearPassword = true
          return payload
        })
        setProblems(unparsed)
        if (unparsed.length > 0) return
        setBusy(true)
        try {
          const activeDraft = drafts.find((draft) => draft.key === activeKey)
          const next = await api('settings.save', {
            servers,
            activeServerId: activeDraft?.id === '' || activeDraft === undefined ? undefined : activeDraft.id,
            ui: { sound, hideDisabled },
          })
          onSaved(next)
        } catch (problem) {
          setError(problem.message)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'cw-modal', onClick: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'cw-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title') },
          h('h2', null, t('settings.title')),
          h('div', { className: 'cw-sheet-sub' }, t('settings.subtitle')),

          h('div', { className: 'cw-server-list' },
            drafts.length === 0
              ? h('div', { className: 'cw-note' }, t('settings.noServer'))
              : drafts.map((draft) => h(ServerRow, {
                  key: draft.key,
                  draft,
                  active: draft.key === activeKey,
                  canRemove: drafts.length > 1,
                  onPatch: (next) => patchDraft(draft.key, { ...draft, ...next }),
                  onActivate: (key) => setActiveKey(key),
                  onRemove: (key) => {
                    setDrafts((prev) => {
                      const next = prev.filter((item) => item.key !== key)
                      if (activeKey === key) setActiveKey(next[0]?.key ?? '')
                      return next
                    })
                  },
                  onTest: testOne,
                })),
          ),

          h('div', { className: 'cw-row', style: { marginTop: 8 } },
            h('button', {
              type: 'button',
              className: 'cw-btn',
              onClick: () => {
                const draft = draftOf({}, drafts.length)
                setDrafts((prev) => [...prev, draft])
                if (drafts.length === 0) setActiveKey(draft.key)
              },
            }, t('settings.addServer')),
          ),

          problems.length > 0
            ? h('div', { className: 'cw-note bad', style: { marginTop: 6 } }, `这几行没有解析：${problems.join(' / ')}`)
            : null,

          h('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { className: 'cw-row' },
              h(Toggle, { checked: sound, label: t('settings.sound'), onChange: () => setSound(!sound) }),
              h('span', null, t('settings.sound')),
              h('span', { className: 'cw-note' }, t('settings.soundHint')),
            ),
            h('div', { className: 'cw-row' },
              h(Toggle, { checked: hideDisabled, label: t('settings.hideDisabled'), onChange: () => setHideDisabled(!hideDisabled) }),
              h('span', null, t('settings.hideDisabled')),
            ),
          ),

          error === null ? null : h('div', { className: 'cw-banner bad', style: { margin: '12px 0 0', maxWidth: 'none' } }, error),

          h('div', { className: 'cw-sheet-foot' },
            h('span', { className: 'cw-note' }, settings.deployment?.home ?? ''),
            h('span', { className: 'cw-grow' }),
            h('button', { type: 'button', className: 'cw-btn ghost', onClick: onClose }, t('action.close')),
            h('button', { type: 'button', className: 'cw-btn primary', onClick: save, disabled: busy === true }, t('action.save')),
          ),
        ),
      )
    }

    // ── 归档 ──────────────────────────────────────────────────────────────

    /** One archived run. */
    function ArchiveEntry(props) {
      const { entry, onApply, onRerun, onExpand } = props
      const [open, setOpen] = useState(false)
      const statusClass = entry.status === 'success' ? 'ok' : entry.status === 'error' ? 'bad' : 'busy'
      const images = (entry.files ?? []).filter((file) => file.kind === 'image').slice(0, 4)
      return h('div', { className: 'cw-entry' },
        h('div', { className: 'cw-entry-head' },
          h('span', { className: `cw-dot ${statusClass}` }),
          h('span', { className: 'cw-grow', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, entry.workflowName),
          h('span', { className: 'cw-note' }, clockOf(entry.at)),
        ),
        h('div', { className: 'cw-entry-meta' },
          h('span', null, `${t('archive.seed')} ${entry.seed ?? '—'}`),
          h('span', null, `${t('archive.duration')} ${humanDuration(entry.durationMs)}`),
          h('span', null, `${t('archive.files')} ${entry.fileCount ?? (entry.files ?? []).length}`),
        ),
        entry.error ? h('div', { className: 'cw-note bad', style: { marginTop: 4 } }, entry.error) : null,
        images.length > 0 ? h('div', { className: 'cw-thumbs' },
          images.map((file, index) => h('img', {
            key: index,
            src: mediaUrl(file),
            alt: file.filename,
            loading: 'lazy',
            onClick: () => onExpand?.({ src: mediaUrl(file), name: file.filename }),
          })),
        ) : null,
        open ? h('pre', null, JSON.stringify(entry.params ?? {}, null, 1)) : null,
        h('div', { className: 'cw-entry-actions' },
          h('button', { type: 'button', className: 'cw-btn ghost', onClick: () => setOpen(!open) }, t('archive.params')),
          h('button', { type: 'button', className: 'cw-btn ghost', onClick: () => onApply(entry) }, t('action.apply')),
          h('button', { type: 'button', className: 'cw-btn ghost', onClick: () => onRerun(entry) }, t('action.rerun')),
        ),
      )
    }

    /** The archive drawer. */
    function ArchiveDrawer(props) {
      const { entries, loading, onClose, onRefresh, onApply, onRerun, onClear, onExpand } = props
      return h('div', { className: 'cw-drawer', role: 'dialog', 'aria-label': t('archive.title') },
        h('div', { className: 'cw-drawer-head' },
          h('strong', { className: 'cw-grow' }, t('archive.title')),
          h('button', { type: 'button', className: 'cw-btn ghost', onClick: onRefresh, disabled: loading === true }, t('action.refresh')),
          h('button', { type: 'button', className: 'cw-btn ghost danger', onClick: onClear }, t('archive.clear')),
          h('button', { type: 'button', className: 'cw-btn ghost', onClick: onClose, 'aria-label': t('action.close') }, '✕'),
        ),
        h('div', { className: 'cw-drawer-body' },
          loading === true ? h('div', { className: 'cw-note' }, t('state.loading')) : null,
          entries.length === 0 && loading !== true ? h('div', { className: 'cw-note' }, t('archive.empty')) : null,
          entries.map((entry) => h(ArchiveEntry, {
            key: entry.id,
            entry,
            onApply,
            onRerun,
            onExpand,
          })),
        ),
      )
    }

    // ── 面板 ──────────────────────────────────────────────────────────────

    /** How many resource samples the footer sparkline keeps. */
    const SPARK_POINTS = 44

    /** Merge the saved per-node configuration into the server-built cards. */
    function applyConfig(cards, config) {
      const nodes = config?.nodes ?? {}
      return cards.map((card) => {
        if (card.category === 'save') {
          const save = config?.save ?? {}
          return {
            ...card,
            fields: card.fields.map((field) => ({
              ...field,
              value: Object.hasOwn(save, field.name) ? save[field.name] : field.value,
            })),
          }
        }
        const node = nodes[card.id] ?? {}
        const values = node.values ?? {}
        return {
          ...card,
          enabled: typeof node.enabled === 'boolean' ? node.enabled : card.enabled,
          hidden: node.hidden === true,
          fields: card.fields.map((field) => (
            Object.hasOwn(values, field.name) ? { ...field, value: values[field.name] } : field
          )),
        }
      })
    }

    /** The panel itself. */
    function Panel(props) {
      const [boot, setBoot] = useState({ loading: true, error: null })
      const [settings, setSettings] = useState(null)
      const [workflows, setWorkflows] = useState([])
      const [server, setServer] = useState(null)
      const [activeId, setActiveId] = useState(null)
      const [detail, setDetail] = useState(null)
      const [config, setConfig] = useState(null)
      const [runState, setRunState] = useState({ running: false, run: null, last: null })
      /** Rolling resource history per server: `{key, at, vram: [0..1], ram: [0..1]}`. */
      const [spark, setSpark] = useState({ key: '', at: '', vram: [], ram: [] })
      const [archive, setArchive] = useState({ entries: [], loading: false, open: false })
      const [showSettings, setShowSettings] = useState(false)
      /** This view's "show everything" switch; never persisted. */
      const [showAll, setShowAll] = useState(false)
      const [refreshing, setRefreshing] = useState(false)
      const [freeing, setFreeing] = useState(false)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [saving, setSaving] = useState(false)
      const [lightbox, setLightbox] = useState(null)
      const [previews, setPreviews] = useState({})
      const [renaming, setRenaming] = useState(null)

      const saveTimer = useRef(null)
      const settledRef = useRef(null)
      const detailIdRef = useRef(null)
      const importRef = useRef(null)
      const configRef = useRef(null)
      configRef.current = config

      const say = useCallback((message, bad = false) => {
        setNotice({ message, bad, at: Date.now() })
      }, [])

      // A notice clears itself; a failure stays a little longer.
      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), notice.bad === true ? 8000 : 4000)
        return () => clearTimeout(timer)
      }, [notice])

      /** Load a workflow into the editor. */
      const openWorkflow = useCallback(async (id) => {
        if (id === null || id === '') {
          setDetail(null)
          setConfig(null)
          return
        }
        try {
          const value = await api('workflows.get', { id })
          detailIdRef.current = value.id
          setDetail(value)
          setConfig(structuredClone(value.config ?? { nodes: {}, save: { subfolder: '', localDir: '' } }))
          setActiveId(value.id)
          try {
            window.localStorage.setItem(LAST_TAB_KEY, value.id)
          } catch {
            /* a locked-down browser has no localStorage; the tab is not worth failing over */
          }
        } catch (error) {
          say(t('error.run', { message: error.message }), true)
          setDetail(null)
        }
      }, [say])

      const refreshWorkflows = useCallback(async ({ keepTab = true } = {}) => {
        const list = await api('workflows.list')
        setWorkflows(list)
        if (!keepTab) return list
        const remembered = (() => {
          try {
            return window.localStorage.getItem(LAST_TAB_KEY)
          } catch {
            return null
          }
        })()
        const wanted = activeId ?? remembered
        const next = list.find((item) => item.id === wanted) ?? list[0] ?? null
        if (next === null) {
          setDetail(null)
          setConfig(null)
          setActiveId(null)
        } else if (next.id !== detailIdRef.current) {
          void openWorkflow(next.id)
        }
        return list
      }, [activeId, openWorkflow])

      const refreshArchive = useCallback(async (workflowId) => {
        setArchive((prev) => ({ ...prev, loading: true }))
        try {
          const entries = await api('archive.list', { workflowId, limit: 40 })
          setArchive((prev) => ({ ...prev, entries, loading: false }))
        } catch {
          setArchive((prev) => ({ ...prev, loading: false }))
        }
      }, [])

      // Boot: settings, tab list, then the remembered tab.
      useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const overview = await api('overview')
            if (cancelled) return
            setSettings(overview.settings)
            setWorkflows(overview.workflows ?? [])
            setServer(overview.server ?? null)
            setRunState(overview.state ?? { running: false, run: null, last: null })
            if (overview.state?.last != null) settledRef.current = overview.state.last.runId
            setBoot({ loading: false, error: null })
            report('boot', {
              ok: true,
              workflows: (overview.workflows ?? []).length,
              hasSettings: overview.settings !== null && overview.settings !== undefined,
              viewport: [window.innerWidth, window.innerHeight],
            })
            const remembered = (() => {
              try {
                return window.localStorage.getItem(LAST_TAB_KEY)
              } catch {
                return null
              }
            })()
            const list = overview.workflows ?? []
            const first = list.find((item) => item.id === remembered) ?? list[0] ?? null
            if (first !== null) await openWorkflow(first.id)
          } catch (error) {
            if (!cancelled) setBoot({ loading: false, error: error.message })
            report('boot', { ok: false, error: error.message })
          }
        })()
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // Poll the run state; the Host holds the truth and this only reads it.
      useEffect(() => {
        let stopped = false
        let timer = null
        const tick = async () => {
          try {
            const state = await api('run.state')
            if (stopped) return
            setRunState(state)
            // Resource history: one point per fresh sample, keyed by server so a
            // switch starts a clean line instead of joining two machines.
            const stats = state?.stats ?? null
            if (stats !== null && typeof stats.at === 'string' && Array.isArray(stats.devices)) {
              const vramPeak = stats.devices.reduce((sum, device) => sum + Math.max(0, Number(device.vramTotal) || 0), 0)
              const vramFree = stats.devices.reduce((sum, device) => sum + Math.max(0, Number(device.vramFree) || 0), 0)
              const ramTotal = Number(stats.ram?.total) || 0
              const ramFree = Number(stats.ram?.free) || 0
              const vramRatio = vramPeak > 0 ? Math.min(1, Math.max(0, (vramPeak - vramFree) / vramPeak)) : 0
              const ramRatio = ramTotal > 0 ? Math.min(1, Math.max(0, (ramTotal - ramFree) / ramTotal)) : 0
              setSpark((prev) => {
                const key = String(stats.serverId ?? '')
                if (prev.key !== key) return { key, at: stats.at, vram: [vramRatio], ram: [ramRatio] }
                if (prev.at === stats.at) return prev
                return {
                  key,
                  at: stats.at,
                  vram: [...prev.vram, vramRatio].slice(-SPARK_POINTS),
                  ram: [...prev.ram, ramRatio].slice(-SPARK_POINTS),
                }
              })
            }
            const finished = state?.last
            if (finished !== null && finished !== undefined && finished.runId !== settledRef.current) {
              settledRef.current = finished.runId
              if (settings?.ui?.sound !== false) playChime(finished.status === 'success' ? 'success' : 'error')
              if (finished.status === 'success') say(t('run.done', { name: finished.workflowName ?? '' }))
              else if (finished.status === 'canceled') say(t('run.stopped', { name: finished.workflowName ?? '' }))
              else say(t('run.failed', { name: finished.workflowName ?? '' }), true)
              if (archive.open === true) void refreshArchive(detail?.id)
            }
          } catch {
            /* the Host restarts with the profile; the next tick retries */
          }
          if (!stopped) timer = setTimeout(tick, 900)
        }
        void tick()
        return () => {
          stopped = true
          if (timer !== null) clearTimeout(timer)
        }
        // `archive.open` and `detail.id` are read inside, but re-arming the poll on
        // every one of them would restart the loop; the next tick sees the latest.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [settings?.ui?.sound])

      // Write edits back, debounced, so a burst of typing is one write.
      const scheduleSave = useCallback(() => {
        if (saveTimer.current !== null) clearTimeout(saveTimer.current)
        setSaving(true)
        saveTimer.current = setTimeout(() => {
          const next = configRef.current
          const id = detailIdRef.current
          if (id === null || next === null) {
            setSaving(false)
            return
          }
          void api('workflows.update', { id, config: next })
            .then(() => setSaving(false))
            .catch((error) => {
              setSaving(false)
              say(t('error.save', { message: error.message }), true)
            })
        }, SAVE_DEBOUNCE_MS)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [say])

      // Flush a pending edit when the panel unmounts.
      useEffect(() => () => {
        if (saveTimer.current === null) return
        clearTimeout(saveTimer.current)
        const next = configRef.current
        const id = detailIdRef.current
        if (id !== null && next !== null) void api('workflows.update', { id, config: next }).catch(() => undefined)
      }, [])

      const patchNode = useCallback((cardId, patch) => {
        setConfig((prev) => {
          const base = prev ?? { nodes: {}, save: { subfolder: '', localDir: '' } }
          const nodes = { ...(base.nodes ?? {}) }
          nodes[cardId] = { ...(nodes[cardId] ?? {}), ...patch }
          return { ...base, nodes }
        })
        scheduleSave()
      }, [scheduleSave])

      const onField = useCallback((cardId, name, value) => {
        if (cardId === '__save__') {
          setConfig((prev) => {
            const base = prev ?? { nodes: {}, save: {} }
            const save = { ...(base.save ?? {}) }
            // `prefix:<nodeId>` is one save node's own destination; the other
            // fields are the run-wide subdirectory and the local download dir.
            if (name.startsWith('prefix:')) {
              save.prefixes = { ...(save.prefixes ?? {}), [name.slice('prefix:'.length)]: value }
            } else {
              save[name] = value
            }
            return { ...base, save }
          })
          scheduleSave()
          return
        }
        setConfig((prev) => {
          const base = prev ?? { nodes: {}, save: {} }
          const nodes = { ...(base.nodes ?? {}) }
          const node = { ...(nodes[cardId] ?? {}) }
          node.values = { ...(node.values ?? {}), [name]: value }
          nodes[cardId] = node
          return { ...base, nodes }
        })
        scheduleSave()
      }, [scheduleSave])

      const onToggle = useCallback((cardId) => {
        setConfig((prev) => {
          const base = prev ?? { nodes: {}, save: {} }
          const nodes = { ...(base.nodes ?? {}) }
          const node = { ...(nodes[cardId] ?? {}) }
          const current = typeof node.enabled === 'boolean'
            ? node.enabled
            : ((detail?.cards ?? []).find((card) => card.id === cardId)?.enabled ?? true)
          node.enabled = !current
          nodes[cardId] = node
          return { ...base, nodes }
        })
        scheduleSave()
      }, [detail, scheduleSave])

      /**
       * Hide a card without touching whether it runs.
       *
       * `hidden` is pure view state: the node keeps its values and stays enabled,
       * so a long-lived node whose parameters never change can move out of the
       * stack; "显示全部" brings the card back.
       */
      const onHide = useCallback((cardId, hidden) => {
        setConfig((prev) => {
          const base = prev ?? { nodes: {}, save: {} }
          const nodes = { ...(base.nodes ?? {}) }
          nodes[cardId] = { ...(nodes[cardId] ?? {}), hidden: hidden === true }
          return { ...base, nodes }
        })
        scheduleSave()
      }, [scheduleSave])

      /**
       * Re-read the server's node information for the open workflow.
       *
       * Cards live in component state, so a model added to the server after the
       * tab was opened stays "unsupported" until this runs. The panel drops the
       * Host cache too (`refresh`), so a new file shows up immediately.
       */
      const refreshCards = useCallback(async () => {
        const id = detailIdRef.current
        if (id === null || id === undefined) return
        setRefreshing(true)
        try {
          const fresh = await api('workflows.get', { id, refresh: true })
          setDetail(fresh)
          say(`已重新读取服务器节点信息（${(fresh.cards ?? []).length} 张卡片）`)
        } catch (error) {
          say(t('error.refresh', { message: error.message }), true)
        } finally {
          setRefreshing(false)
        }
      }, [say])

      const onRandomSeed = useCallback((cardId, fieldName, options) => {
        setConfig((prev) => {
          const base = prev ?? { nodes: {}, save: {} }
          const nodes = { ...(base.nodes ?? {}) }
          const node = { ...(nodes[cardId] ?? {}) }
          if (options.toggleOnly === true) {
            node.randomSeed = node.randomSeed !== true
          } else {
            node.values = { ...(node.values ?? {}), [fieldName]: Math.floor(Math.random() * 2 ** 48) }
            node.randomSeed = false
          }
          nodes[cardId] = node
          return { ...base, nodes }
        })
        scheduleSave()
      }, [scheduleSave])

      const onUpload = useCallback(async (cardId, file) => {
        try {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          let binary = ''
          const chunk = 0x8000
          for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
          }
          const value = await api('upload', { filename: file.name, mime: file.type || 'application/octet-stream', data: btoa(binary) })
          onField(cardId, detectFileWidget(detail, cardId), value.value)
          const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
          setPreviews((prev) => {
            const next = { ...prev }
            if (next[cardId] !== undefined && next[cardId].startsWith('blob:')) URL.revokeObjectURL(next[cardId])
            next[cardId] = preview
            return next
          })
          say(`已上传 ${value.value}`)
        } catch (error) {
          say(`上传失败：${error.message}`, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [detail, onField, say])

      const onBrowse = useCallback(async (fieldName) => {
        try {
          // `get` rather than a property read: the service is optional in a lean
          // composition, and a missing one must not throw out of this handler.
          const service = props.ctx?.get?.('uiWorkspace')
          if (service === null || service === undefined || typeof service.pickDirectory !== 'function') {
            say('这个宿主没有目录选择器，直接填路径', true)
            return
          }
          const picked = await service.pickDirectory()
          if (typeof picked === 'string' && picked !== '') onField('__save__', fieldName, picked)
        } catch (error) {
          say(`选目录失败：${error.message}`, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [onField, say])

      /** Reveal the save directory in Explorer / Finder / the desktop's file manager. */
      const onOpenLocal = useCallback(async (fieldName) => {
        try {
          const dir = configRef.current?.save?.[fieldName]
          const result = await api('local.open', { dir: typeof dir === 'string' ? dir : '' })
          say(result.created === true ? `已创建并打开 ${result.path}` : `已打开 ${result.path}`)
        } catch (error) {
          say(`打开失败：${error.message}`, true)
        }
      }, [say])

      const startRun = useCallback(async () => {
        if (detail === null || config === null) return
        ensureAudio()
        setBusy(true)
        try {
          const started = await api('run.start', { id: detail.id, config })
          say(`${detail.name} → prompt ${started.promptId.slice(0, 8)}（${started.nodeCount} 个节点）`)
        } catch (error) {
          say(t('error.run', { message: error.message }), true)
        } finally {
          setBusy(false)
        }
      }, [detail, config, say])

      const stopRun = useCallback(async () => {
        if (settings?.ui?.confirmStop !== false && typeof window.confirm === 'function' && !window.confirm(t('run.confirmStop'))) return
        setBusy(true)
        try {
          await api('run.stop')
        } catch (error) {
          say(`停止失败：${error.message}`, true)
        } finally {
          setBusy(false)
        }
      }, [settings, say])

      /**
       * Ask the server to give its VRAM back.
       *
       * `POST /free` is what ComfyUI's own "Free model and node cache" action
       * calls: models unload, the allocator cache empties, nothing on disk moves
       * and the next run simply loads them again. Refused during a run because
       * unloading models under an executing prompt is a way to break it.
       */
      const freeVram = useCallback(async () => {
        if (runState?.running === true || freeing === true) return
        setFreeing(true)
        try {
          const result = await api('server.free', {})
          say(result.freedVram > 0
            ? `已释放 ${gbText(result.freedVram)} 显存（现在 ${gbNumber(result.after?.vramUsed)}/${gbNumber(result.after?.vramTotal)}G）`
            : `已让服务器卸载模型、清空缓存（显存 ${gbNumber(result.after?.vramUsed)}/${gbNumber(result.after?.vramTotal)}G）`)
          setRunState((prev) => ({ ...prev }))
        } catch (error) {
          say(`释放显存失败：${error.message}`, true)
        } finally {
          setFreeing(false)
        }
      }, [runState?.running, freeing, say])

      const doImport = useCallback(async (file) => {
        try {
          const text = await file.text()
          let raw
          try {
            raw = JSON.parse(text)
          } catch {
            say(t('error.notJson'), true)
            return
          }
          const created = await api('workflows.import', { raw, sourceName: file.name })
          await refreshWorkflows({ keepTab: false })
          await openWorkflow(created.id)
          say(`已导入「${created.name}」（${created.nodeCount} 个节点）`)
        } catch (error) {
          say(t('error.import', { message: error.message }), true)
        }
      }, [openWorkflow, refreshWorkflows, say])

      const rename = useCallback(async (id, name) => {
        try {
          await api('workflows.update', { id, name })
          setRenaming(null)
          await refreshWorkflows()
        } catch (error) {
          say(t('error.save', { message: error.message }), true)
        }
      }, [refreshWorkflows, say])

      const removeWorkflow = useCallback(async (id, name) => {
        if (typeof window.confirm === 'function' && !window.confirm(t('run.confirmDelete', { name }))) return
        try {
          await api('workflows.delete', { id })
          detailIdRef.current = null
          setDetail(null)
          setConfig(null)
          await refreshWorkflows()
        } catch (error) {
          say(t('error.save', { message: error.message }), true)
        }
      }, [refreshWorkflows, say])

      /**
       * Make another configured server the active one.
       *
       * Every card's option list comes from the server's own `/object_info`, so
       * the open workflow is reloaded: showing model names from the machine we
       * just left would be a quiet lie.
       */
      const switchServer = useCallback(async (id) => {
        if (id === '' || id === settings?.activeServerId) return
        try {
          const next = await api('settings.select', { id })
          setSettings(next)
          setServer(null)
          void api('overview').then((value) => setServer(value.server ?? null)).catch(() => undefined)
          if (detailIdRef.current !== null && detailIdRef.current !== undefined) {
            await openWorkflow(detailIdRef.current)
          }
        } catch (error) {
          say(`切换服务器失败：${error.message}`, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [settings?.activeServerId, openWorkflow, say])

      const applyArchived = useCallback((entry) => {
        setConfig((prev) => {
          const base = prev ?? { nodes: {}, save: { subfolder: '', localDir: '' } }
          const nodes = { ...(base.nodes ?? {}) }
          for (const [nodeId, info] of Object.entries(entry.params ?? {})) {
            nodes[nodeId] = { ...(nodes[nodeId] ?? {}), values: { ...(nodes[nodeId]?.values ?? {}), ...(info.values ?? {}) } }
          }
          return { ...base, nodes, save: { ...(base.save ?? {}), ...(entry.save ?? {}) } }
        })
        scheduleSave()
        say(t('archive.applied'))
      }, [scheduleSave, say])

      const rerunArchived = useCallback(async (entry) => {
        ensureAudio()
        try {
          const value = await api('archive.rerun', { id: entry.id, freshSeed: true })
          say(`已重跑「${value.workflowName}」`)
        } catch (error) {
          say(t('error.run', { message: error.message }), true)
        }
      }, [say])

      const cards = useMemo(
        () => (detail === null || config === null ? [] : applyConfig(detail.cards ?? [], config)),
        [detail, config],
      )

      // Two different things stay different: `hideDisabled` is a persisted
      // preference about cards switched off, `showAll` is this view's switch —
      // and a card the user hid is only a view preference too (it still runs).
      const hideOff = settings?.ui?.hideDisabled !== false
      const omitted = useMemo(
        () => (showAll
          ? 0
          : cards.filter((card) => card.category !== 'save'
            && (card.hidden === true || (hideOff && card.enabled !== true))).length),
        [cards, showAll, hideOff],
      )
      const visibleCards = useMemo(() => {
        if (showAll) return cards
        return cards.filter((card) => {
          if (card.category === 'save') return true
          if (card.hidden === true) return false
          if (hideOff && card.enabled !== true) return false
          return true
        })
      }, [cards, showAll, hideOff])

      const runningCardId = runState?.running === true ? runState.run?.currentNodeId ?? null : null
      const cachedNodes = runState?.running === true ? (runState.run?.cachedNodes ?? []) : []
      // Outputs belong to the workflow that produced them: node ids repeat across
      // workflows, and showing another tab's frames under this tab's cards is the
      // one mistake this panel could make that looks like a successful run.
      const last = runState?.last ?? null
      const lastOutputs = last !== null && last.workflowId === detail?.id ? (last.files ?? []) : []
      const progress = runState?.running === true ? runState.run?.progress : null
      const progressRatio = progress !== null && progress !== undefined && progress.max > 0
        ? Math.min(1, progress.value / progress.max)
        : 0
      const serverText = server?.error !== undefined
        ? t('state.offline')
        : server?.comfyui_version !== undefined
          ? `ComfyUI ${server.comfyui_version}`
          : t('state.connecting')

      // Resource usage of the active server, from the same poll that reads the
      // run state. `null` until the first sample lands, so the footer does not
      // flash a zeroed meter on boot.
      const statsNow = runState?.stats ?? null
      const deviceTotals = (Array.isArray(statsNow?.devices) ? statsNow.devices : []).reduce((acc, device) => ({
        total: acc.total + (Number(device?.vramTotal) || 0),
        free: acc.free + (Number(device?.vramFree) || 0),
      }), { total: 0, free: 0 })
      const ramNow = {
        total: Number(statsNow?.ram?.total) || 0,
        free: Number(statsNow?.ram?.free) || 0,
      }
      const usedRatio = (total, free) => (total > 0 ? Math.min(1, Math.max(0, (total - free) / total)) : 0)
      const meterTitle = (label, total, free) => `${label}：已用 ${gbNumber(total - free)} GB / 共 ${gbNumber(total)} GB（${Math.round(usedRatio(total, free) * 100)}%）`
        + (typeof statsNow?.serverName === 'string' && statsNow.serverName !== '' ? ` · ${statsNow.serverName}` : '')
        + (statsNow?.error ? ` · 上次读取失败：${statsNow.error}` : '')
      const resourceMeters = statsNow === null
        ? null
        : h('div', { className: 'cw-res' },
            deviceTotals.total > 0
              ? h(ResourceMeter, {
                  label: t('state.vram'),
                  total: deviceTotals.total,
                  free: deviceTotals.free,
                  history: spark.vram,
                  hot: usedRatio(deviceTotals.total, deviceTotals.free) >= 0.9,
                  title: meterTitle(t('state.vram'), deviceTotals.total, deviceTotals.free),
                })
              : null,
            ramNow.total > 0
              ? h(ResourceMeter, {
                  label: t('state.ram'),
                  total: ramNow.total,
                  free: ramNow.free,
                  history: spark.ram,
                  hot: usedRatio(ramNow.total, ramNow.free) >= 0.92,
                  title: meterTitle(t('state.ram'), ramNow.total, ramNow.free),
                })
              : null,
            statsNow.error !== null && statsNow.error !== undefined
              ? h('span', { className: 'cw-note bad', title: `读取占用失败：${statsNow.error}` }, '⚠')
              : null,
          )

      return h('div', { className: 'cw-root' },
        h('style', null, CSS),

        h('div', { className: 'cw-head' },
          h('h1', null, t('panel.title')),
          h('span', { className: 'cw-sub' }, t('panel.subtitle')),
          h('span', { className: 'cw-grow' }),
          (settings?.servers ?? []).length === 0 ? null : h('select', {
            className: 'cw-select cw-server-pick',
            value: settings.activeServerId ?? '',
            title: `${t('settings.active')}：${settings?.address ?? ''}`,
            onChange: (event) => void switchServer(event.target.value),
          }, (settings.servers ?? []).map((server) => h('option', { key: server.id, value: server.id }, server.name))),
          h('span', { className: 'cw-chip', title: settings?.address ?? '' },
            h('span', {
              className: `cw-dot ${server?.error !== undefined ? 'bad' : server?.comfyui_version !== undefined ? 'ok' : ''}`,
            }),
            serverText,
          ),
          h('button', {
            type: 'button',
            className: 'cw-btn',
            onClick: () => importRef.current?.click(),
          }, t('action.import')),
          h('input', {
            ref: importRef,
            type: 'file',
            accept: 'application/json,.json',
            style: { display: 'none' },
            onChange: (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file !== undefined && file !== null) void doImport(file)
            },
          }),
          h('button', {
            type: 'button',
            className: 'cw-btn',
            onClick: () => {
              setArchive((prev) => ({ ...prev, open: true }))
              void refreshArchive(detail?.id)
            },
          }, t('action.archive')),
          h('button', {
            type: 'button',
            className: 'cw-btn',
            onClick: () => {
              setShowSettings(true)
              report('click', { target: 'settings', hasSettings: settings !== null })
            },
          }, t('action.settings')),
        ),

        workflows.length === 0 ? null : h('div', { className: 'cw-tabs' },
          workflows.map((item) => {
            const active = item.id === detail?.id
            if (renaming === item.id) {
              return h('span', { className: 'cw-tab active', key: item.id },
                h('input', {
                  autoFocus: true,
                  defaultValue: item.name,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') void rename(item.id, event.currentTarget.value)
                    if (event.key === 'Escape') setRenaming(null)
                  },
                  onBlur: (event) => void rename(item.id, event.currentTarget.value),
                }),
              )
            }
            return h('button', {
              key: item.id,
              type: 'button',
              className: `cw-tab${active ? ' active' : ''}`,
              title: `${item.name} · ${item.nodeCount} 个节点`,
              onClick: () => void openWorkflow(item.id),
              onDoubleClick: () => setRenaming(item.id),
            },
              h('span', { className: 'cw-name' }, item.name),
              active
                ? h('span', {
                    className: 'cw-x',
                    role: 'button',
                    title: t('action.delete'),
                    onClick: (event) => {
                      event.stopPropagation()
                      void removeWorkflow(item.id, item.name)
                    },
                  }, '✕')
                : null,
            )
          }),
          h('button', {
            type: 'button',
            className: 'cw-tab',
            title: t('action.import'),
            onClick: () => importRef.current?.click(),
          }, '+'),
          h('span', { className: 'cw-grow' }),
          h('button', {
            type: 'button',
            className: 'cw-btn ghost',
            title: showAll ? t('action.showUnused') : t('action.showAll'),
            'aria-pressed': showAll === true ? 'true' : 'false',
            onClick: () => setShowAll(!showAll),
          }, showAll
            ? t('action.showUnused')
            : `${t('action.showAll')}${omitted > 0 ? ` (${omitted})` : ''}`),
          h('button', {
            type: 'button',
            className: 'cw-btn ghost',
            title: t('action.refreshCards'),
            disabled: detail === null || refreshing === true,
            onClick: () => void refreshCards(),
          }, refreshing === true ? t('state.loading') : '⟳'),
          saving === true ? h('span', { className: 'cw-note' }, t('state.saving')) : null,
        ),

        h('div', { className: 'cw-body' },
          boot.loading === true
            ? h('div', { className: 'cw-empty' }, h('p', null, t('state.loading')))
            : boot.error !== null
              ? h('div', { className: 'cw-empty' },
                  h('h2', null, '接口打不开'),
                  h('p', null, boot.error),
                  h('button', { type: 'button', className: 'cw-btn', onClick: () => window.location.reload() }, t('action.retry')),
                )
              : detail === null
                ? h('div', { className: 'cw-empty' },
                    h('h2', null, t('state.empty.title')),
                    h('p', null, t('state.empty.body')),
                    h('p', { className: 'cw-note' }, t('state.empty.hint')),
                    h('button', {
                      type: 'button',
                      className: 'cw-btn primary',
                      style: { marginTop: 10 },
                      onClick: () => importRef.current?.click(),
                    }, t('action.import')),
                  )
                : h('div', null,
                    detail.modelsError ? h('div', { className: 'cw-banner' }, t('warn.models', { message: detail.modelsError })) : null,
                    (detail.missingClasses ?? []).length > 0
                      ? h('div', { className: 'cw-banner bad' }, t('warn.missing', { list: detail.missingClasses.join('、') }))
                      : null,
                    cards.every((card) => card.category === 'save' || card.enabled !== true) && cards.length > 0
                      ? h('div', { className: 'cw-banner bad' }, t('warn.hideAll'))
                      : null,
                    cards.length > 0 && visibleCards.length === 0
                      ? h('div', { className: 'cw-banner' }, t('state.allHidden'))
                      : null,
                    notice === null ? null : h('div', { className: `cw-banner${notice.bad === true ? ' bad' : ''}` }, notice.message),
                    h('div', { className: 'cw-stack' },
                      visibleCards.map((card) => {
                        const cardOutputs = lastOutputs.filter((file) => String(file.nodeId) === card.id)
                        const invalid = (card.fields ?? []).some((field) => field.supported === false)
                        return h(Card, {
                          key: card.id,
                          card,
                          nodeConfig: config?.nodes?.[card.id] ?? null,
                          outputs: cardOutputs,
                          running: runningCardId !== null && String(runningCardId) === card.id,
                          cached: cachedNodes.map(String).includes(card.id),
                          invalid,
                          preview: previews[card.id],
                          onToggle,
                          onHide,
                          onField,
                          onRandomSeed,
                          onUpload: (file) => void onUpload(card.id, file),
                          onBrowse,
                          onOpenLocal,
                          onExpand: setLightbox,
                        })
                      }),
                    ),
                  ),
        ),

        h('div', { className: 'cw-foot' },
          h('button', {
            type: 'button',
            className: 'cw-btn primary',
            disabled: busy === true || runState?.running === true || detail === null,
            onClick: () => void startRun(),
          }, runState?.running === true ? t('state.running') : t('action.run')),
          h('button', {
            type: 'button',
            className: 'cw-btn danger',
            disabled: runState?.running !== true || busy === true,
            onClick: () => void stopRun(),
          }, t('action.stop')),
          progressRatio > 0 ? h('span', { className: 'cw-progress' }, h('i', { style: { width: `${Math.round(progressRatio * 100)}%` } })) : null,
          h('span', { className: 'cw-status' },
            runState?.running === true
              ? `${t('state.running')} · ${t('state.node')} #${runState.run?.currentNodeId ?? '—'}`
                + ` · ${t('state.elapsed')} ${humanDuration(runState.run?.elapsedMs ?? 0)}`
                + (progressRatio > 0 ? ` · ${Math.round(progressRatio * 100)}%` : '')
                + ` · ${t('state.queued')} ${runState.run?.queueRemaining ?? '?'}`
              : runState?.last !== null && runState?.last !== undefined
                ? `${runState.last.status === 'success' ? t('state.lastOk') : runState.last.status === 'canceled' ? t('state.canceled') : t('state.lastFail')}`
                  + ` · ${clockOf(runState.last.at)} · ${humanDuration(runState.last.durationMs)}`
                  + (runState.last.seed !== null && runState.last.seed !== undefined ? ` · ${t('archive.seed')} ${runState.last.seed}` : '')
                : t('state.idle'),
          ),
          // Hand the GPU back when the panel is done with it: the server's own
          // "free model and node cache", one click away.
          h('button', {
            type: 'button',
            className: 'cw-btn ghost',
            title: runState?.running === true ? t('action.freeVramBusy') : t('action.freeVramHint'),
            disabled: runState?.running === true || freeing === true || settings === null,
            onClick: () => void freeVram(),
          }, freeing === true ? t('action.freeVramBusy') : t('action.freeVram')),
          // Resource usage of the active server: one sample every couple of
          // seconds, drawn as a bar so a spike during a render is visible without
          // opening anything.
          resourceMeters,
        ),

        // The sheet opens even before the settings document has arrived: an
        // unloaded document is a reason to show defaults, never a reason for a
        // click to do nothing.
        showSettings === true ? h(SettingsDialog, {
          settings: settings ?? EMPTY_SETTINGS,
          onClose: () => setShowSettings(false),
          onSaved: (next) => {
            setSettings(next)
            setShowSettings(false)
            say(t('settings.saved'))
            void api('overview').then((value) => setServer(value.server ?? null)).catch(() => undefined)
          },
        }) : null,

        archive.open === true ? h(ArchiveDrawer, {
          entries: archive.entries,
          loading: archive.loading,
          onClose: () => setArchive((prev) => ({ ...prev, open: false })),
          onRefresh: () => void refreshArchive(detail?.id),
          onApply: applyArchived,
          onRerun: (entry) => void rerunArchived(entry),
          onClear: async () => {
            try {
              await api('archive.clear', { workflowId: detail?.id })
              await refreshArchive(detail?.id)
            } catch (error) {
              say(`清空失败：${error.message}`, true)
            }
          },
          onExpand: setLightbox,
        }) : null,

        lightbox === null ? null : h('div', {
          className: 'cw-lightbox',
          onClick: () => setLightbox(null),
        }, lightbox.name !== undefined && /\.(mp4|webm|mkv|mov)$/i.test(lightbox.name)
          ? h('video', { src: lightbox.src, controls: true, autoPlay: true })
          : h('img', { src: lightbox.src, alt: lightbox.name ?? '' })),
      )
    }

    /** The widget name a file-input card writes into. */
    function detectFileWidget(detail, cardId) {
      const card = (detail?.cards ?? []).find((item) => item.id === cardId)
      return card?.file?.widget ?? 'image'
    }

    /** Bind the panel to the shell's language so a switch repaints it. */
    function withLocale(ctx, Component) {
      return function LocaleBound(props) {
        activeLang = resolveLang(ctx)
        const [, bump] = useState(0)
        useEffect(() => {
          const locale = ctx.locale
          if (locale === null || locale === undefined || typeof locale.subscribe !== 'function') return undefined
          let previous = resolveLang(ctx)
          try {
            return locale.subscribe(() => {
              const next = resolveLang(ctx)
              if (next !== previous) {
                previous = next
                bump((value) => value + 1)
              }
            })
          } catch {
            return undefined
          }
        }, [])
        return h(Component, { ...props, lang: activeLang })
      }
    }

    /** The sidebar glyph: stacked workflow cards with a run triangle. */
    function Glyph(props) {
      const size = props?.size ?? 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 64 64',
        'aria-hidden': 'true',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 5,
        strokeLinejoin: 'round',
      },
        h('rect', { x: 5, y: 6, width: 54, height: 16, rx: 5 }),
        h('rect', { x: 5, y: 27, width: 36, height: 16, rx: 5 }),
        h('rect', { x: 5, y: 48, width: 36, height: 11, rx: 5 }),
        h('path', { d: 'M48 31.5 L60 38.5 L48 45.5 Z', fill: 'currentColor', stroke: 'none' }),
      )
    }

    /** A panel that survives a render failure instead of blanking its slot. */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
        this.retry = this.retry.bind(this)
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      retry() {
        this.setState({ error: null })
      }

      render() {
        const { error } = this.state
        if (error !== null) {
          return h('div', { className: 'cw-root' },
            h('style', null, CSS),
            h('div', { className: 'cw-empty' },
              h('h2', null, '面板出错了'),
              h('p', null, String(error?.message ?? error)),
              h('button', { type: 'button', className: 'cw-btn', onClick: this.retry }, t('action.retry')),
            ),
          )
        }
        return h(this.props.component, this.props.componentProps)
      }
    }

    /** Bind the context and the error boundary around the panel. */
    function bindPanel(ctx) {
      const Bound = withLocale(ctx, Panel)
      return function PanelEntry(props) {
        return h(Boundary, { component: Bound, componentProps: { ...props, ctx } })
      }
    }

    return {
      inject: ['slots', 'locale'],

      apply(ctx) {
        ctx.effect(() => {
          try {
            return ctx.locale.register(LOCALE_NS, DICTS)
          } catch {
            return () => {}
          }
        }, `${LOCALE_NS}: dictionaries`)

        // The sidebar entry id must equal the main panel key: that is how the
        // shell connects a click on the icon to the central panel.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: SLOT_ID,
            order: 88,
            label: () => (resolveLang(ctx) === 'zh' ? zh['entry.label'] : en['entry.label']),
            locale: LOCALE_NS,
          },
          Glyph,
        ))

        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: SLOT_ID, locale: LOCALE_NS },
          bindPanel(ctx),
        ))
      },
    }
  },
})
