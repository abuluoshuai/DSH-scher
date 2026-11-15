/**
 * 系统监控 — Client 半边。
 *
 * 在输入框下方的 ambient dock（conversation.composer.dock）注册一条读数：
 *
 *   CPU ▬▬▬ MEM ▬▬ GPU ▬▬▬ VRAM ▬▬
 *
 * 四根细进度条分别是会话所在主机的 CPU 利用率、内存占用、显卡利用率、显存
 * 占用。数字默认收起（dock 一行要挤下宿主的几枚胶囊），点一下展开并记住选择；
 * 悬停的 title 里始终有精确读数与主机信息。
 *
 * 数据来自 Host 半边挂在 `api/system-monitor/snapshot` 的只读接口：采集发生在
 * DSH Host 进程里，所以无论 Harness 跑在本机还是远程服务器，显示的都是会话
 * 真正所在的那台机器，而不是放着浏览器窗口的这台。
 *
 * 颜色全部走宿主主题 token（--dsw-alias-*），亮/暗色自动跟随；文案走 Client
 * locale 服务，未注册时退回浏览器语言的内置字典；组件卸载即停轮询。
 */
window.__ModuleLoader__.load({
  id: 'dsh-system-monitor',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useState } = React

    const NS = 'system-monitor'
    const API = 'api/system-monitor'
    const STORAGE_KEY = 'dsh.system-monitor.showNumbers'
    const WIDE_VIEWPORT = 1500
    const DEFAULT_INTERVAL_MS = 2000

    const DICT = {
      zh: {
        'label.cpu': 'CPU',
        'label.memory': '内存',
        'label.gpu': '显卡',
        'label.vram': '显存',
        'tip.host': '主机',
        'tip.cores': '核',
        'tip.uptime': '已运行',
        'tip.load': '负载',
        'tip.memory': '内存',
        'tip.gpu': '显卡',
        'tip.vram': '显存',
        'tip.noGpu': '未检测到可用的采集方式',
        'tip.failed': '采集失败：{message}',
        'tip.sampling': '正在采集…',
        'tip.toggleOn': '点击收起数值',
        'tip.toggleOff': '点击显示数值',
        'tip.usage': '利用率',
      },
      en: {
        'label.cpu': 'CPU',
        'label.memory': 'MEM',
        'label.gpu': 'GPU',
        'label.vram': 'VRAM',
        'tip.host': 'Host',
        'tip.cores': 'cores',
        'tip.uptime': 'up',
        'tip.load': 'load',
        'tip.memory': 'Memory',
        'tip.gpu': 'GPU',
        'tip.vram': 'VRAM',
        'tip.noGpu': 'no probe available',
        'tip.failed': 'Sampling failed: {message}',
        'tip.sampling': 'Sampling…',
        'tip.toggleOn': 'Click to hide values',
        'tip.toggleOff': 'Click to show values',
        'tip.usage': 'usage',
      },
    }

    const CSS = [
      '.dsm{display:inline-flex;flex:0 1 auto;align-items:center;justify-content:center;flex-wrap:wrap;gap:2px 10px;box-sizing:border-box;min-width:0;max-width:100%;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;text-align:center;cursor:pointer}',
      '@media (hover: hover){.dsm:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}',
      '.dsm:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.dsm[data-stale="1"]{opacity:.55}',
      '.dsm-seg{display:inline-flex;align-items:center;gap:5px;min-width:0}',
      '.dsm-key{flex:none;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);letter-spacing:.06em;color:var(--dsw-alias-label-tertiary)}',
      '.dsm-bar{position:relative;flex:none;width:40px;height:6px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}',
      '.dsm-fill{position:absolute;top:0;bottom:0;left:0;border-radius:inherit;background:var(--dsw-alias-brand-primary);transition:width .4s ease}',
      '.dsm-seg[data-tone="warn"] .dsm-fill{background:var(--dsw-alias-state-warn-primary)}',
      '.dsm-seg[data-tone="hot"] .dsm-fill{background:var(--dsw-alias-state-error-primary)}',
      '.dsm-seg[data-na="1"] .dsm-fill{background:var(--dsw-alias-label-tertiary);opacity:.4}',
      '.dsm-value{display:none;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.dsm[data-numbers="1"] .dsm-value{display:inline}',
      '@media (prefers-reduced-motion: reduce){.dsm-fill{transition:none}}',
      '@media (max-width: 760px){.dsm-bar{width:22px}.dsm{gap:2px 8px}}',
    ].join('')

    // 归属 id 必须等于本模块注册 id：宿主按同一个标记认领 / 摘除 style。
    const STYLE_OWNER = 'dsh-system-monitor'

    /** 插入本插件独占的 style 元素。 */
    function insertOwnedStyle(css) {
      const el = document.createElement('style')
      el.setAttribute('data-plugin', STYLE_OWNER)
      el.textContent = css
      document.head.appendChild(el)
      return el
    }

    /** 内置字典的兜底翻译，占位符写作 `{name}`。 */
    function fallbackTranslate(lang, key, params) {
      const table = DICT[lang] ?? DICT.zh
      let text = table[key] ?? DICT.zh[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.split(`{${name}}`).join(String(value))
      }
      return text
    }

    /** 宿主语言，取不到就看浏览器。 */
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

    /** 0..1 的比例，拒绝 NaN 与负数。 */
    function unitOf(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return null
      return Math.min(1, Math.max(0, number))
    }

    /** 内存读数 → 0..1，缺数据时为 null。 */
    function ratioOfBytes(memory) {
      if (memory === null || memory === undefined) return null
      const total = Number(memory.total)
      const used = Number(memory.used)
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null
      return unitOf(used / total)
    }

    /** `42%` / `—`。 */
    function percentText(ratio) {
      if (ratio === null) return '—'
      return `${Math.round(ratio * 100)}%`
    }

    /** GB 读数：10G 以上取整，以下保留一位小数。 */
    function gbShort(bytes) {
      const value = Number(bytes) / 1024 ** 3
      if (!Number.isFinite(value)) return '—'
      return value >= 10 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toFixed(1)
    }

    /** 进度条旁的紧凑读数：`9.1/16G`。 */
    function pairText(memory) {
      if (memory === null || memory === undefined) return '—'
      const total = Number(memory.total)
      if (!Number.isFinite(total) || total <= 0) return '—'
      const used = Number(memory.used)
      const left = Number.isFinite(used) ? gbShort(used) : '—'
      return `${left}/${gbShort(total)}G`
    }

    /** 悬停提示里的完整读数：`9.1 / 16.0 GB（57%）`。 */
    function pairLong(memory) {
      if (memory === null || memory === undefined) return '—'
      const total = Number(memory.total)
      if (!Number.isFinite(total) || total <= 0) return '—'
      const used = Number(memory.used)
      const ratio = ratioOfBytes(memory)
      const left = Number.isFinite(used) ? (used / 1024 ** 3).toFixed(1) : '—'
      const right = (total / 1024 ** 3).toFixed(1)
      return ratio === null ? `${left} / ${right} GB` : `${left} / ${right} GB (${Math.round(ratio * 100)}%)`
    }

    /** 主机已运行时间：`2d 5h` / `5h 12m` / `18m`。 */
    function formatUptime(ms) {
      const value = Number(ms)
      if (!Number.isFinite(value) || value <= 0) return '—'
      const minutes = Math.floor(value / 60_000)
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes % 60}m`
      return `${minutes}m`
    }

    /** 阈值配色：`ok` / `warn` / `hot`；没有读数时不加色。 */
    function toneOf(ratio) {
      if (ratio === null) return 'idle'
      if (ratio >= 0.9) return 'hot'
      if (ratio >= 0.75) return 'warn'
      return 'ok'
    }

    /** 读一次 Host 接口，失败时抛出带原因的 Error。 */
    async function request(method) {
      let response
      try {
        response = await fetch(`${API}/${method}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
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

    /** 只接受形状正确的快照，坏数据不进组件状态。 */
    function isSnapshot(value) {
      return value !== null && typeof value === 'object' && typeof value.at === 'number' && typeof value.host === 'object'
    }

    /** 数值显示开关，默认只在够宽的窗口里打开。 */
    function readShowNumbers() {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        if (stored === '1') return true
        if (stored === '0') return false
      } catch {
        /* 隐私模式下 localStorage 会抛错，退回默认 */
      }
      return typeof window !== 'undefined' && Number(window.innerWidth) >= WIDE_VIEWPORT
    }

    /** 记住开关；写不进去也不影响本次会话。 */
    function writeShowNumbers(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
      } catch {
        /* ignore */
      }
    }

    /**
     * 轮询 Host 快照。页面隐藏时退到低频，重新可见立刻补一次；组件卸载或
     * 插件卸载都会停掉定时器。
     */
    function useSnapshot() {
      const [snapshot, setSnapshot] = useState(null)
      const [failure, setFailure] = useState(null)

      useEffect(() => {
        let disposed = false
        let timer = null
        let inFlight = false
        let interval = DEFAULT_INTERVAL_MS

        const schedule = (delay) => {
          if (disposed) return
          timer = setTimeout(() => {
            void tick()
          }, delay)
        }

        const tick = async () => {
          if (disposed || inFlight) return
          inFlight = true
          try {
            const hidden = typeof document !== 'undefined' && document.hidden
            // 页面不可见时不采集：没有人在看，Host 那边也不用跑 nvidia-smi。
            if (!hidden) {
              const value = await request('snapshot')
              if (disposed) return
              if (isSnapshot(value)) {
                setSnapshot(value)
                setFailure(null)
                const declared = Number(value.intervalMs)
                if (Number.isFinite(declared)) interval = Math.min(60_000, Math.max(500, declared))
              } else {
                setFailure(new Error('快照数据不完整'))
              }
            }
          } catch (error) {
            if (!disposed) setFailure(error instanceof Error ? error : new Error(String(error)))
          } finally {
            inFlight = false
            if (!disposed) {
              const hidden = typeof document !== 'undefined' && document.hidden
              schedule(hidden ? 1500 : interval)
            }
          }
        }

        const onVisibility = () => {
          if (disposed || typeof document === 'undefined' || document.hidden) return
          if (timer !== null) clearTimeout(timer)
          timer = null
          void tick()
        }

        document.addEventListener('visibilitychange', onVisibility)
        void tick()

        return () => {
          disposed = true
          if (timer !== null) clearTimeout(timer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [])

      return { snapshot, failure }
    }

    /** 一根带标签的进度条。 */
    function Segment({ label, ratio, text, tone, unavailable }) {
      const width = ratio === null ? 0 : Math.round(ratio * 1000) / 10
      return h(
        'span',
        {
          className: 'dsm-seg',
          'data-tone': tone,
          'data-na': unavailable === true ? '1' : undefined,
        },
        h('span', { className: 'dsm-key' }, label),
        h('span', { className: 'dsm-bar' }, h('span', { className: 'dsm-fill', style: { width: `${width}%` } })),
        h('span', { className: 'dsm-value' }, text),
      )
    }

    /** dock 里的一枚读数。 */
    function Monitor({ t }) {
      const { snapshot, failure } = useSnapshot()
      const [showNumbers, setShowNumbers] = useState(readShowNumbers)

      const cpuRatio = snapshot === null ? null : unitOf(snapshot.cpu?.usage)
      const memRatio = snapshot === null ? null : ratioOfBytes(snapshot.memory)
      const gpu = snapshot?.gpu ?? null
      const gpuRatio = gpu === null ? null : unitOf(gpu.utilization)
      const vramRatio = gpu === null ? null : ratioOfBytes(gpu.memory)
      const gpuMissing = snapshot !== null && gpu === null
      const vramMissing = snapshot !== null && (gpu === null || gpu.memory === null || gpu.memory === undefined)

      const tip = useMemo(
        () => buildTooltip({ snapshot, failure, t, showNumbers }),
        [snapshot, failure, showNumbers],
      )

      const cpuText = percentText(cpuRatio)
      const memText = snapshot === null ? '—' : pairText(snapshot.memory)
      const gpuText = percentText(gpuRatio)
      const vramText = gpu === null ? '—' : pairText(gpu.memory)

      const aria = [
        `${t('label.cpu')} ${cpuText}`,
        `${t('label.memory')} ${memText}`,
        `${t('label.gpu')} ${gpuText}`,
        `${t('label.vram')} ${vramText}`,
      ].join(' · ')

      const toggle = () => {
        const next = !showNumbers
        setShowNumbers(next)
        writeShowNumbers(next)
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'dsm',
          title: tip,
          'aria-label': aria,
          'aria-pressed': showNumbers ? 'true' : 'false',
          'data-numbers': showNumbers ? '1' : '0',
          'data-stale': failure !== null ? '1' : undefined,
          // 点它不该把焦点从输入框抢走：宿主自己的发送按钮也是这么处理的。
          onMouseDown: (event) => {
            event.preventDefault()
          },
          onClick: toggle,
        },
        h(Segment, {
          label: t('label.cpu'),
          ratio: cpuRatio,
          text: cpuText,
          tone: toneOf(cpuRatio),
          unavailable: snapshot !== null && cpuRatio === null,
        }),
        h(Segment, {
          label: t('label.memory'),
          ratio: memRatio,
          text: memText,
          tone: toneOf(memRatio),
          unavailable: snapshot !== null && memRatio === null,
        }),
        h(Segment, {
          label: t('label.gpu'),
          ratio: gpuRatio,
          text: gpuText,
          tone: toneOf(gpuRatio),
          unavailable: gpuMissing || (snapshot !== null && gpuRatio === null),
        }),
        h(Segment, {
          label: t('label.vram'),
          ratio: vramRatio,
          text: vramText,
          tone: toneOf(vramRatio),
          unavailable: vramMissing || (snapshot !== null && vramRatio === null),
        }),
      )
    }

    /** 悬停提示：主机与四项精确读数，一行一条。 */
    function buildTooltip({ snapshot, failure, t, showNumbers }) {
      const lines = []
      if (snapshot !== null) {
        const host = snapshot.host ?? {}
        lines.push(
          `${t('tip.host')} ${host.name ?? '?'} (${snapshot.platform ?? '?'} · ${host.cores ?? '?'} ${t('tip.cores')}) · ${t('tip.uptime')} ${formatUptime(host.uptimeMs)}`,
        )
        const load = Array.isArray(snapshot.cpu?.load) ? snapshot.cpu.load[0] : null
        lines.push(
          `CPU ${percentText(unitOf(snapshot.cpu?.usage))}${Number.isFinite(load) ? ` · ${t('tip.load')} ${Number(load).toFixed(2)}` : ''}`,
        )
        lines.push(`${t('tip.memory')} ${pairLong(snapshot.memory)}`)
        const gpu = snapshot.gpu ?? null
        if (gpu === null) {
          lines.push(`${t('tip.gpu')} ${t('tip.noGpu')}`)
        } else {
          const reading = unitOf(gpu.utilization)
          lines.push(`${t('tip.gpu')} ${gpu.name ?? '—'}${reading === null ? '' : ` · ${percentText(reading)}`}`)
          lines.push(`${t('tip.vram')} ${pairLong(gpu.memory)}`)
        }
      } else if (failure === null) {
        lines.push(t('tip.sampling'))
      }
      if (failure !== null) lines.push(t('tip.failed', { message: failure.message }))
      lines.push(showNumbers ? t('tip.toggleOn') : t('tip.toggleOff'))
      return lines.join('\n')
    }

    /** 注册到 dock，并把样式 / 文案挂到本插件上下文的生命周期上。 */
    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const styleEl = insertOwnedStyle(CSS)
      ctx.effect(
        () => () => {
          styleEl.remove()
        },
        'system-monitor: styles',
      )

      let lang = resolveLang(ctx)
      let t = (key, params) => fallbackTranslate(lang, key, params)
      const locale = ctx.get('locale')
      if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        ctx.effect(() => {
          let dispose = () => {}
          try {
            const disposeZh = locale.register(NS, 'zh', DICT.zh)
            const disposeEn = locale.register(NS, 'en', DICT.en)
            dispose = () => {
              disposeZh()
              disposeEn()
            }
          } catch (error) {
            console.error('[system-monitor] locale registration failed', error)
          }
          return dispose
        }, 'system-monitor: locale')

        // 字典没注册成功时 bind 会把 key 原样吐回来，逐 key 兜底。
        const translate = locale.bind(NS)
        lang = resolveLang(ctx)
        t = (key, params) => {
          let value
          try {
            value = translate(key, params)
          } catch {
            value = undefined
          }
          return typeof value === 'string' && value !== key ? value : fallbackTranslate(lang, key, params)
        }
      }

      slots.inject('conversation.composer.dock', () => {
        return slots.register(
          { name: 'conversation.composer.dock', id: 'system-monitor', order: 3 },
          () => h(Monitor, { t }),
        )
      })
    }

    return {
      inject: ['slots'],
      apply,
    }
  },
})
