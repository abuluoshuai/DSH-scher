/**
 * 下班倒计时 — Client 半边。
 *
 * 在输入框下方的 ambient dock（conversation.composer.dock）注册一枚
 * 倒计时胶囊：
 *   - 工作日按「上班时间 → 下班时间」倒计时，并用细进度条表示今天走了多远；
 *   - 到点后切换成加班计时，小圆点会呼吸一下；
 *   - 周末只显示一句「周末快乐」，不假装下班；
 *   - 点胶囊弹出设置对话框（注册在 shell.overlay，浮在所有列之上，
 *     不会被输入框卡片的层叠上下文盖住），改完即时生效，只存本机浏览器。
 *
 * 所有颜色走宿主主题 token（--dsw-alias-*），亮/暗色自动跟随；
 * 文案走 Client locale 服务，未注册时退回浏览器语言的内置字典。
 * 两个槽位共享一个极小的模块级 store，组件本身不订阅会话、不写 DOM。
 */
window.__ModuleLoader__.load({
  id: 'dsh-offwork-countdown',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'offwork-countdown'
    const STORAGE_KEY = 'dsh.offwork-countdown.settings.v1'
    /** Host 半边的路由前缀：设置持久化与任务栏闪烁。 */
    const HOST_API = 'api/offwork-countdown'
    const FIREWORK_SCOPES = ['conversation', 'window']
    const FIREWORK_DENSITIES = ['low', 'normal', 'high', 'ultra']
    const DEFAULT_SETTINGS = {
      start: '09:00',
      end: '18:00',
      fireworks: { enabled: true, scope: 'window', density: 'high', duration: 'long' },
    }

    const DICT = {
      zh: {
        work: '距离下班',
        off: '已下班',
        done: '下班啦',
        rest: '周末快乐',
        tip: '点击设置上班与下班时间',
        title: '下班时间',
        start: '上班',
        end: '下班',
        save: '保存',
        cancel: '取消',
        reset: '恢复默认',
        preview: '预览烟花',
        fwTitle: '下班烟花',
        fwEnabled: '到点放烟花',
        fwScope: '范围',
        fwScopeWindow: '整窗',
        fwScopeConversation: '对话区',
        fwDensity: '密度',
        fwDensityLow: '少',
        fwDensityNormal: '标准',
        fwDensityHigh: '多',
        fwDensityUltra: '爆量',
        fwDuration: '持续时间',
        fwDurationShort: '3 秒',
        fwDurationNormal: '6 秒',
        fwDurationLong: '10 秒',
        fwDurationLonger: '15 秒',
        close: '关闭',
        hint: '设置只保存在本机浏览器',
      },
      en: {
        work: 'Off in',
        off: 'Overtime',
        done: 'Off work',
        rest: 'Weekend',
        tip: 'Click to set your work hours',
        title: 'Work hours',
        start: 'Start',
        end: 'End',
        save: 'Save',
        cancel: 'Cancel',
        reset: 'Reset',
        preview: 'Preview fireworks',
        fwTitle: 'Off-work fireworks',
        fwEnabled: 'Fireworks at off-work time',
        fwScope: 'Scope',
        fwScopeWindow: 'Whole window',
        fwScopeConversation: 'Conversation',
        fwDensity: 'Density',
        fwDensityLow: 'Low',
        fwDensityNormal: 'Normal',
        fwDensityHigh: 'High',
        fwDensityUltra: 'Max',
        fwDuration: 'Duration',
        fwDurationShort: '3 s',
        fwDurationNormal: '6 s',
        fwDurationLong: '10 s',
        fwDurationLonger: '15 s',
        close: 'Close',
        hint: 'Saved in this browser only',
      },
    }

    const CSS = [
      '.owc{position:relative;display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary)}',
      '.owc-pill{display:inline-flex;align-items:center;gap:8px;padding:4px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer;transition:background .15s ease,border-color .15s ease}',
      '.owc-pill:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.owc-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.owc-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-brand-primary)}',
      '.owc[data-phase="rest"] .owc-dot{background:var(--dsw-alias-state-idle-primary)}',
      '.owc[data-phase="off"] .owc-dot{background:var(--dsw-alias-state-success-primary)}',
      '.owc[data-pulse="on"] .owc-dot{animation:owc-pulse 1.6s ease-in-out infinite}',
      '.owc-label{white-space:nowrap}',
      '.owc-time{color:var(--dsw-alias-label-primary);font-weight:600;letter-spacing:.02em;font-variant-numeric:tabular-nums}',
      '.owc-bar{position:relative;width:44px;height:3px;flex:none;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}',
      '.owc-bar-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .5s ease}',
      '.owc[data-phase="off"] .owc-bar-fill{background:var(--dsw-alias-state-success-primary)}',
      '@keyframes owc-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.75)}}',
      '@media (prefers-reduced-motion: reduce){.owc[data-pulse="on"] .owc-dot{animation:none}.owc-bar-fill{transition:none}}',
      '.owc-scrim{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.35);pointer-events:auto}',
      '.owc-dialog{width:300px;max-width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-overlay);box-shadow:0 24px 60px rgba(0,0,0,.32);color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;pointer-events:auto}',
      '.owc-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.owc-dialog-title{font-size:13px;font-weight:600}',
      '.owc-close{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:1;cursor:pointer}',
      '.owc-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.owc-fields{display:flex;flex-direction:column;gap:10px}',
      '.owc-field{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.owc-field-label{white-space:nowrap}',
      '.owc-input{width:104px;box-sizing:border-box;padding:3px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums}',
      '.owc-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.owc-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75}',
      '.owc-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.owc-actions-right{display:flex;gap:8px}',
      '.owc-btn{padding:3px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
      '.owc-btn:hover{border-color:var(--dsw-alias-border-l2)}',
      '.owc-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.owc-actions-left{display:flex;align-items:center;gap:8px}',
      '.owc-fw-group{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.owc-fw-group-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.owc-check{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.owc-select{padding:3px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
      '.owc-fw{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:900;opacity:0;transition:opacity .45s ease;filter:saturate(1.15) brightness(0.95)}',
      '.owc-fw[data-on="1"]{opacity:1}',
      '@media (prefers-reduced-motion: reduce){.owc-fw{transition:none}}',
    ].join('')

    // 归属 id 必须等于本模块注册 id：宿主按同一个标记认领 / 摘除 style。
    const STYLE_OWNER = 'dsh-offwork-countdown'

    function insertOwnedStyle(css) {
      const el = document.createElement('style')
      el.setAttribute('data-plugin', STYLE_OWNER)
      el.textContent = css
      document.head.appendChild(el)
      return el
    }

    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    function formatClock(totalSeconds) {
      const seconds = Math.max(0, Math.floor(totalSeconds))
      return (
        pad2(Math.floor(seconds / 3600)) +
        ':' +
        pad2(Math.floor((seconds % 3600) / 60)) +
        ':' +
        pad2(seconds % 60)
      )
    }

    function parseHM(value, fallback) {
      const matched = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? '' : value))
      if (!matched) return fallback
      const hours = Number(matched[1])
      const minutes = Number(matched[2])
      if (!(hours >= 0 && hours <= 23) || !(minutes >= 0 && minutes <= 59)) return fallback
      return { hours: hours, minutes: minutes }
    }

    function formatHM(parsed) {
      return pad2(parsed.hours) + ':' + pad2(parsed.minutes)
    }

    function normalizeFireworkSettings(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      return {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
        scope: FIREWORK_SCOPES.indexOf(source.scope) >= 0 ? source.scope : 'window',
        density: FIREWORK_DENSITIES.indexOf(source.density) >= 0 ? source.density : 'high',
        duration: FIREWORK_DURATION_KEYS.indexOf(source.duration) >= 0 ? source.duration : 'long',
      }
    }

    function normalizeSettings(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      return {
        start: formatHM(parseHM(source.start, parseHM(DEFAULT_SETTINGS.start, { hours: 9, minutes: 0 }))),
        end: formatHM(parseHM(source.end, parseHM(DEFAULT_SETTINGS.end, { hours: 18, minutes: 0 }))),
        fireworks: normalizeFireworkSettings(source.fireworks),
      }
    }

    /**
     * 设置存在 Host 侧文件里（$DSH_HOME/offwork-countdown/settings.json）。
     *
     * 只存 localStorage 是不够的：DSH 每次重启可能换一个随机端口，origin 一变
     * localStorage 就是空的，升级/重启就会看到「设置被重置」。这里的读法以 Host
     * 文件为准，localStorage 只作为 Host 路由不可用时的兜底。
     */
    function readLocalSettings() {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        return stored === null ? null : normalizeSettings(JSON.parse(stored))
      } catch (error) {
        return null
      }
    }

    function loadSettings() {
      return readLocalSettings() || DEFAULT_SETTINGS
    }

    function persistLocalSettings(settings) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      } catch (error) {
        /* 隐私模式或存储被禁用：本次会话照样生效，只是不落盘。 */
      }
    }

    async function hostRequest(path, options = {}) {
      const response = await fetch(`${HOST_API}/${path}`, {
        method: options.method || 'GET',
        headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        keepalive: options.keepalive === true,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    /** Host 文件里的设置；文件还不存在时返回 null。 */
    async function loadHostSettings() {
      try {
        const payload = await hostRequest('settings')
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
        const settings = payload.data === null || typeof payload.data !== 'object' ? null : payload.data.settings
        return settings === null || settings === undefined ? null : normalizeSettings(settings)
      } catch (error) {
        return null
      }
    }

    async function saveHostSettings(settings) {
      try {
        await hostRequest('settings', { method: 'POST', body: { settings } })
      } catch (error) {
        /* Host 路由不可用（老版本/精简组合）：localStorage 里仍有副本 */
      }
    }

    async function requestTaskbarFlash() {
      try {
        await hostRequest('flash', { method: 'POST', body: {}, keepalive: true })
      } catch (error) {
        /* 非 Windows 或 Host 尚未重启时没有闪烁，烟花逻辑继续 */
      }
    }

    /** Host 在到点时记下的「今天烟花待播放」标记（页面在后台也不丢）。 */
    async function takeHostPending() {
      try {
        const payload = await hostRequest('pending')
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
        const pending = payload.data === null || typeof payload.data !== 'object' ? null : payload.data.pending
        return pending !== null && typeof pending === 'object' && typeof pending.dayKey === 'string' ? pending : null
      } catch (error) {
        return null
      }
    }

    async function clearHostPending(dayKey) {
      try {
        await hostRequest('played', { method: 'POST', body: { dayKey } })
      } catch (error) {
        /* 清不掉最多下次再判断一次，不影响播放 */
      }
    }

    /** 保存过的设置不再被启动时的异步读取覆盖。 */
    let settingsTouched = false

    /**
     * 一秒一次的世界观：工作日数到下班、到点转加班、周末只报周末。
     * 返回值里的 seconds 在 work 阶段是「还剩多少」，off 阶段是「已经加了多久」。
     */
    function computeView(timestamp, settings) {
      const now = new Date(timestamp)
      const day = now.getDay()
      const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
      const start = parseHM(settings.start, { hours: 9, minutes: 0 })
      const end = parseHM(settings.end, { hours: 18, minutes: 0 })
      const startSeconds = start.hours * 3600 + start.minutes * 60
      const endSeconds = end.hours * 3600 + end.minutes * 60

      if (day === 0 || day === 6) {
        return { phase: 'rest', seconds: 0, progress: 0 }
      }
      if (nowSeconds < endSeconds) {
        const span = endSeconds - startSeconds
        const progress = span > 0 ? Math.min(1, Math.max(0, (nowSeconds - startSeconds) / span)) : 0
        return { phase: 'work', seconds: endSeconds - nowSeconds, progress: progress }
      }
      return { phase: 'off', seconds: nowSeconds - endSeconds, progress: 1 }
    }

    function fallbackTranslate(key) {
      const zh =
        typeof navigator !== 'undefined' &&
        typeof navigator.language === 'string' &&
        /^zh/i.test(navigator.language)
      const table = zh ? DICT.zh : DICT.en
      return table[key] || DICT.en[key] || key
    }

    // ---------------------------------------------------------------------
    // 极小 store：胶囊和设置对话框注册在两个槽位里，靠它共享「开没开 + 当前时间」。
    // ---------------------------------------------------------------------

    const store = {
      open: false,
      settings: loadSettings(),
    }
    let snapshot = { open: store.open, settings: store.settings }
    const listeners = new Set()

    function getSnapshot() {
      return snapshot
    }

    function emit() {
      snapshot = { open: store.open, settings: store.settings }
      listeners.forEach(function (listener) {
        try {
          listener()
        } catch (error) {
          console.error('[offwork-countdown] store listener failed', error)
        }
      })
    }

    function subscribe(listener) {
      listeners.add(listener)
      return function () {
        listeners.delete(listener)
      }
    }

    function setEditorOpen(open) {
      if (store.open === open) return
      store.open = open
      emit()
    }

    function commitSettings(next) {
      settingsTouched = true
      store.settings = next
      store.open = false
      persistLocalSettings(next)
      void saveHostSettings(next)
      emit()
    }

    function useStore() {
      const [value, setValue] = React.useState(getSnapshot)
      React.useEffect(function () {
        return subscribe(function () {
          setValue(getSnapshot())
        })
      }, [])
      return value
    }

    // ---------------------------------------------------------------------
    // 胶囊：输入框下方那枚安静的小玩意儿。
    // ---------------------------------------------------------------------

    function Countdown(props) {
      const t = props.t
      const [now, setNow] = React.useState(function () {
        return Date.now()
      })
      const current = useStore()

      React.useEffect(function () {
        const timer = window.setInterval(function () {
          setNow(Date.now())
        }, 1000)
        const onVisible = function () {
          if (!document.hidden) setNow(Date.now())
        }
        document.addEventListener('visibilitychange', onVisible)
        return function () {
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      const view = computeView(now, current.settings)
      const label =
        view.phase === 'work'
          ? t('work')
          : view.phase === 'rest'
            ? t('rest')
            : view.seconds < 60
              ? t('done')
              : t('off')
      const showClock = view.phase !== 'rest'
      const progress = view.phase === 'work' ? view.progress : view.phase === 'off' ? 1 : 0

      return h(
        'div',
        {
          className: 'owc',
          'data-phase': view.phase,
          'data-pulse': view.phase === 'off' && view.seconds < 600 ? 'on' : 'off',
        },
        h(
          'button',
          {
            type: 'button',
            className: 'owc-pill',
            title: t('tip'),
            'aria-haspopup': 'dialog',
            'aria-expanded': current.open ? 'true' : 'false',
            onClick: function () {
              setEditorOpen(!store.open)
            },
          },
          h('span', { className: 'owc-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'owc-label' }, label),
          showClock ? h('span', { className: 'owc-time' }, formatClock(view.seconds)) : null,
          showClock
            ? h(
                'span',
                { className: 'owc-bar', 'aria-hidden': 'true' },
                h('span', {
                  className: 'owc-bar-fill',
                  style: { width: Math.round(progress * 100) + '%' },
                }),
              )
            : null,
        ),
      )
    }

    // ---------------------------------------------------------------------
    // 设置对话框：挂在 shell.overlay，浮在所有列之上，不会被输入框盖住。
    // ---------------------------------------------------------------------

    function SettingsDialog(props) {
      const t = props.t
      const current = useStore()
      const [draft, setDraft] = React.useState(current.settings)
      /* Older drafts (or a time-input change racing the state update) may miss
         the nested fireworks block; never let that crash the dialog. */
      const fireworksDraft = draft.fireworks || DEFAULT_SETTINGS.fireworks

      React.useEffect(
        function () {
          if (current.open) setDraft(current.settings)
        },
        [current.open, current.settings],
      )

      React.useEffect(
        function () {
          if (!current.open) return undefined
          const onKey = function (event) {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setEditorOpen(false)
            }
          }
          document.addEventListener('keydown', onKey, true)
          return function () {
            document.removeEventListener('keydown', onKey, true)
          }
        },
        [current.open],
      )

      if (!current.open) return null

      return h(
        'div',
        {
          className: 'owc-scrim',
          onMouseDown: function (event) {
            if (event.target === event.currentTarget) setEditorOpen(false)
          },
        },
        h(
          'div',
          {
            className: 'owc-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('title'),
          },
          h(
            'div',
            { className: 'owc-dialog-head' },
            h('span', { className: 'owc-dialog-title' }, t('title')),
            h(
              'button',
              {
                type: 'button',
                className: 'owc-close',
                'aria-label': t('close'),
                title: t('close'),
                onClick: function () {
                  setEditorOpen(false)
                },
              },
              '\u00d7',
            ),
          ),
          h(
            'div',
            { className: 'owc-fields' },
            h(
              'label',
              { className: 'owc-field' },
              h('span', { className: 'owc-field-label' }, t('start')),
              h('input', {
                type: 'time',
                className: 'owc-input',
                step: 60,
                value: draft.start,
                autoFocus: true,
                onChange: function (event) {
                  const value = event.target.value
                  setDraft(function (previous) {
                    return Object.assign({}, previous, { start: value })
                  })
                },
              }),
            ),
            h(
              'label',
              { className: 'owc-field' },
              h('span', { className: 'owc-field-label' }, t('end')),
              h('input', {
                type: 'time',
                className: 'owc-input',
                step: 60,
                value: draft.end,
                onChange: function (event) {
                  const value = event.target.value
                  setDraft(function (previous) {
                    return Object.assign({}, previous, { end: value })
                  })
                },
              }),
            ),
          ),
          h(
            'div',
            { className: 'owc-fw-group' },
            h('div', { className: 'owc-fw-group-title' }, t('fwTitle')),
            h(
              'label',
              { className: 'owc-field' },
              h('span', { className: 'owc-field-label' }, t('fwEnabled')),
              h('input', {
                type: 'checkbox',
                className: 'owc-check',
                checked: fireworksDraft.enabled,
                onChange: function (event) {
                  const checked = !!event.target.checked
                  setDraft(function (previous) {
                    return Object.assign({}, previous, {
                      fireworks: Object.assign({}, previous.fireworks, { enabled: checked }),
                    })
                  })
                },
              }),
            ),
            h(
              'label',
              { className: 'owc-field' },
              h('span', { className: 'owc-field-label' }, t('fwScope')),
              h(
                'select',
                {
                  className: 'owc-select',
                  value: fireworksDraft.scope,
                  onChange: function (event) {
                    const scope = event.target.value
                    setDraft(function (previous) {
                      return Object.assign({}, previous, {
                        fireworks: Object.assign({}, previous.fireworks, { scope: scope }),
                      })
                    })
                  },
                },
                h('option', { value: 'window' }, t('fwScopeWindow')),
                h('option', { value: 'conversation' }, t('fwScopeConversation')),
              ),
            ),
            h(
              'label',
              { className: 'owc-field' },
              h('span', { className: 'owc-field-label' }, t('fwDensity')),
              h(
                'select',
                {
                  className: 'owc-select',
                  value: fireworksDraft.density,
                  onChange: function (event) {
                    const density = event.target.value
                    setDraft(function (previous) {
                      return Object.assign({}, previous, {
                        fireworks: Object.assign({}, previous.fireworks, { density: density }),
                      })
                    })
                  },
                },
                h('option', { value: 'low' }, t('fwDensityLow')),
                h('option', { value: 'normal' }, t('fwDensityNormal')),
                h('option', { value: 'high' }, t('fwDensityHigh')),
                h('option', { value: 'ultra' }, t('fwDensityUltra')),
              ),
            ),
            h(
              'label',
              { className: 'owc-field' },
              h('span', { className: 'owc-field-label' }, t('fwDuration')),
              h(
                'select',
                {
                  className: 'owc-select',
                  value: fireworksDraft.duration,
                  onChange: function (event) {
                    const duration = event.target.value
                    setDraft(function (previous) {
                      return Object.assign({}, previous, {
                        fireworks: Object.assign({}, previous.fireworks, { duration: duration }),
                      })
                    })
                  },
                },
                h('option', { value: 'short' }, t('fwDurationShort')),
                h('option', { value: 'normal' }, t('fwDurationNormal')),
                h('option', { value: 'long' }, t('fwDurationLong')),
                h('option', { value: 'longer' }, t('fwDurationLonger')),
              ),
            ),
          ),
          h('div', { className: 'owc-hint' }, t('hint')),
          h(
            'div',
            { className: 'owc-actions' },
            h(
              'div',
              { className: 'owc-actions-left' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'owc-btn',
                  onClick: function () {
                    commitSettings(normalizeSettings(DEFAULT_SETTINGS))
                  },
                },
                t('reset'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'owc-btn owc-btn-primary',
                  onClick: function () {
                    if (typeof props.onPreview === 'function') props.onPreview()
                    setEditorOpen(false)
                  },
                },
                t('preview'),
              ),
            ),
            h(
              'div',
              { className: 'owc-actions-right' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'owc-btn',
                  onClick: function () {
                    setEditorOpen(false)
                  },
                },
                t('cancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'owc-btn owc-btn-primary',
                  onClick: function () {
                    commitSettings(normalizeSettings(draft))
                  },
                },
                t('save'),
              ),
            ),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // 下班烟花：走到下班时间那一刻，在整窗背景上放一小段烟花。
    // 画布只在播放期间存在（挂到 body、pointer-events:none，结束即移除），
    // 不改动宿主 DOM 结构；设置对话框里的「预览烟花」按钮可随时试放。
    // 深色主题用 screen 混合（像是从界面背后透出来的光），浅色主题用
    // multiply，文字在烟花播放期间保持可读。
    // ---------------------------------------------------------------------

    const FIREWORKS_STORAGE_KEY = 'dsh.offwork-countdown.fireworks.v1'
    const FIREWORK_COLORS = [
      '#ff2d6f',
      '#ffd60a',
      '#30d158',
      '#0a84ff',
      '#bf5af2',
      '#ff9f0a',
      '#64d2ff',
      '#ff375f',
    ]
    const FIREWORK_GRAVITY = 70
    /** 密度档位 → 粒子与发数倍率。 */
    const FIREWORK_DENSITY_FACTORS = { low: 0.7, normal: 1.2, high: 1.8, ultra: 2.6 }
    /** 持续时间档位（毫秒）。 */
    const FIREWORK_DURATIONS = { short: 3000, normal: 6000, long: 10000, longer: 15000 }
    const FIREWORK_DURATION_KEYS = ['short', 'normal', 'long', 'longer']

    function prefersReducedMotion() {
      try {
        return (
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        )
      } catch (error) {
        return false
      }
    }

    function pickFireworkColor() {
      return FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]
    }

    /** 每天最多自动放一次（多标签页共享同一条记录）；返回是否拿到这次机会。 */
    function claimDailyFireworks(dayKey) {
      try {
        if (window.localStorage.getItem(FIREWORKS_STORAGE_KEY) === dayKey) return false
        window.localStorage.setItem(FIREWORKS_STORAGE_KEY, dayKey)
        return true
      } catch (error) {
        return true
      }
    }

    /**
     * 放一段烟花。返回 { stop() }，stop 会立刻淡出并移除画布。
     * 用 canvas + requestAnimationFrame 手绘：上升的火箭 → 爆开的火花，
     * 重力 + 摩擦 + 拖尾淡出；不依赖任何库。
     */
    function createFireworks(options) {
      const opts = options && typeof options === 'object' ? options : {}
      const duration = typeof opts.duration === 'number' && opts.duration > 0 ? opts.duration : 8500
      const scope = opts.scope === 'conversation' ? 'conversation' : 'window'
      const density = FIREWORK_DENSITIES.indexOf(opts.density) >= 0 ? opts.density : 'high'
      const densityFactor = FIREWORK_DENSITY_FACTORS[density]
      const canvas = document.createElement('canvas')
      canvas.className = 'owc-fw'
      canvas.setAttribute('aria-hidden', 'true')
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null
      if (!context || !document.body) return { stop: function () {} }

      const rockets = []
      const sparks = []
      const flashes = []
      const schedule = []
      /** 画面上的粒子上限：密度再高也不让帧率塌掉。 */
      const maxSparks = Math.round(1200 * densityFactor)
      const burstCount = Math.max(
        3,
        Math.min(18, Math.round((duration / 1000 / 1.2) * Math.min(1.8, densityFactor))),
      )
      const lastLaunchAt = Math.max(600, duration - 3000)
      for (let index = 0; index < burstCount; index += 1) {
        schedule.push(Math.round((index / burstCount) * lastLaunchAt) + (index === 0 ? 0 : 80))
      }

      let width = 0
      let height = 0
      let ratio = 1
      let stage = { x: 0, y: 0, width: 0, height: 0 }
      let startedAt = 0
      let lastFrameTime = 0
      let frameHandle = 0
      let launchIndex = 0
      let stopping = false
      let finished = false
      let safetyTimer = 0

      /**
       * 范围：整窗（默认）或只画在对话区上；对话区优先用宿主给对话内容打的
       * `[data-conversation-content]`，找不到就退回整窗。
       */
      function measureStage() {
        const fallback = { x: 0, y: 0, width: width, height: height }
        if (scope === 'window') return fallback
        try {
          const element =
            document.querySelector('[data-conversation-content]') || document.querySelector('[class*="_frame"]')
          if (!element) return fallback
          const rect = element.getBoundingClientRect()
          if (!(rect.width > 240 && rect.height > 240)) return fallback
          return {
            x: Math.max(0, rect.left),
            y: Math.max(0, rect.top),
            width: Math.min(width, rect.width),
            height: Math.min(height, rect.height),
          }
        } catch (error) {
          return fallback
        }
      }

      function resize() {
        ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
        width = Math.max(1, window.innerWidth)
        height = Math.max(1, window.innerHeight)
        canvas.width = Math.max(1, Math.round(width * ratio))
        canvas.height = Math.max(1, Math.round(height * ratio))
        canvas.style.width = width + 'px'
        canvas.style.height = height + 'px'
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, width, height)
        stage = measureStage()
      }

      function launchRocket() {
        const fromX = stage.x + stage.width * (0.16 + Math.random() * 0.68)
        const bottom = stage.y + stage.height
        const targetY = stage.y + stage.height * (0.14 + Math.random() * 0.36)
        const travel = Math.max(120, bottom - targetY)
        rockets.push({
          x: fromX,
          y: bottom + 10,
          targetY: targetY,
          vy: -(travel / 0.85),
          color: pickFireworkColor(),
        })
      }

      function explode(rocket) {
        const budget = Math.max(0, maxSparks - sparks.length)
        const amount = Math.min(budget, Math.round((70 + Math.random() * 70) * densityFactor))
        if (amount <= 0) return
        const primary = rocket.color
        const accent = pickFireworkColor()
        const maxSpeed = 150 + Math.random() * 130
        for (let index = 0; index < amount; index += 1) {
          // 随机角度 + 开方分布的半径：填满圆面，而不是一圈等距的「颜色环」。
          const angle = Math.random() * Math.PI * 2
          const speed = maxSpeed * Math.sqrt(Math.random()) * (0.5 + Math.random() * 0.5)
          sparks.push({
            x: rocket.x,
            y: rocket.y,
            px: rocket.x,
            py: rocket.y,
            vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 12,
            vy: Math.sin(angle) * speed * 0.92,
            age: 0,
            life: 1.1 + Math.random() * 1.2,
            size: (2.2 + Math.random() * 2.6) * (1 + (densityFactor - 1) * 0.12),
            color: Math.random() < 0.12 ? accent : primary,
            twinkle: Math.random() < 0.4 ? Math.random() * Math.PI * 2 : -1,
          })
        }
        flashes.push({
          x: rocket.x,
          y: rocket.y,
          age: 0,
          life: 0.42,
          radius: 80 + Math.random() * 70,
          color: rocket.color,
        })
      }

      function update(step) {
        const friction = Math.pow(0.985, step * 60)
        for (let index = rockets.length - 1; index >= 0; index -= 1) {
          const rocket = rockets[index]
          rocket.y += rocket.vy * step
          if (rocket.y <= rocket.targetY) {
            explode(rocket)
            rockets.splice(index, 1)
          }
        }
        for (let index = flashes.length - 1; index >= 0; index -= 1) {
          flashes[index].age += step
          if (flashes[index].age >= flashes[index].life) flashes.splice(index, 1)
        }
        for (let index = sparks.length - 1; index >= 0; index -= 1) {
          const spark = sparks[index]
          spark.vx *= friction
          spark.vy = spark.vy * friction + FIREWORK_GRAVITY * step
          spark.px = spark.x
          spark.py = spark.y
          spark.x += spark.vx * step
          spark.y += spark.vy * step
          spark.age += step
          if (spark.age >= spark.life) sparks.splice(index, 1)
        }
      }

      function render() {
        context.globalCompositeOperation = 'destination-out'
        context.fillStyle = 'rgba(0,0,0,0.2)'
        context.fillRect(0, 0, width, height)
        context.globalCompositeOperation = 'lighter'
        context.lineCap = 'round'
        context.save()
        try {
          context.beginPath()
          context.rect(stage.x, stage.y, stage.width, stage.height)
          context.clip()
        } catch (error) {
          /* clip is best-effort; draw without it */
        }
        // 爆点闪光：大的径向渐变，让每一发更亮更大。
        for (const flash of flashes) {
          const progress = flash.age / flash.life
          const radius = flash.radius * (0.35 + progress * 1.05)
          try {
            const gradient = context.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, radius)
            gradient.addColorStop(0, 'rgba(255,255,255,0.55)')
            gradient.addColorStop(0.35, flash.color)
            gradient.addColorStop(1, 'rgba(0,0,0,0)')
            context.globalAlpha = Math.max(0, 1 - progress) * 0.42
            context.fillStyle = gradient
            context.beginPath()
            context.arc(flash.x, flash.y, radius, 0, Math.PI * 2)
            context.fill()
          } catch (error) {
            /* gradient unsupported: skip the flash */
          }
        }
        // 火箭：粗尾迹 + 白色亮头。
        for (const rocket of rockets) {
          context.globalAlpha = 0.85
          context.strokeStyle = rocket.color
          context.lineWidth = 3
          context.beginPath()
          context.moveTo(rocket.x, rocket.y + 30)
          context.lineTo(rocket.x, rocket.y)
          context.stroke()
          context.globalAlpha = 0.9
          context.fillStyle = '#ffffff'
          context.beginPath()
          context.arc(rocket.x, rocket.y, 2.4, 0, Math.PI * 2)
          context.fill()
        }
        // 火花：一层淡光晕 + 闪烁的亮芯；亮度整体压一档。
        for (const spark of sparks) {
          const left = Math.max(0, Math.min(1, 1 - spark.age / spark.life))
          const twinkle = spark.twinkle >= 0 ? 0.72 + 0.28 * Math.sin(spark.age * 24 + spark.twinkle) : 1
          context.strokeStyle = spark.color
          context.globalAlpha = left * 0.2
          context.lineWidth = spark.size * 2.8
          context.beginPath()
          context.moveTo(spark.px, spark.py)
          context.lineTo(spark.x, spark.y)
          context.stroke()
          context.globalAlpha = Math.min(0.85, (0.25 + left * 0.75) * twinkle)
          context.lineWidth = spark.size
          context.beginPath()
          context.moveTo(spark.px, spark.py)
          context.lineTo(spark.x, spark.y)
          context.stroke()
        }
        context.globalAlpha = 1
        context.restore()
        context.globalCompositeOperation = 'source-over'
      }

      function cleanup() {
        if (finished) return
        finished = true
        stopping = true
        if (frameHandle) window.cancelAnimationFrame(frameHandle)
        if (safetyTimer) window.clearTimeout(safetyTimer)
        window.removeEventListener('resize', resize)
        try {
          canvas.remove()
        } catch (error) {
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        }
        if (typeof opts.onEnd === 'function') {
          try {
            opts.onEnd()
          } catch (error) {
            /* ignore */
          }
        }
      }

      function finish() {
        if (stopping) return
        stopping = true
        canvas.dataset.on = '0'
        window.setTimeout(cleanup, 520)
      }

      function frame(timestamp) {
        if (finished) return
        if (startedAt === 0) startedAt = timestamp
        const elapsed = timestamp - startedAt
        const step = lastFrameTime === 0 ? 0.016 : Math.min(0.05, (timestamp - lastFrameTime) / 1000)
        lastFrameTime = timestamp
        if (!stopping) {
          while (launchIndex < schedule.length && elapsed >= schedule[launchIndex]) {
            launchRocket()
            if (Math.random() < Math.min(0.95, 0.45 + densityFactor * 0.22)) launchRocket()
            launchIndex += 1
          }
        }
        update(step)
        render()
        if (stopping) {
          if (elapsed > duration + 1400) {
            cleanup()
            return
          }
        } else if (elapsed > duration && rockets.length === 0 && sparks.length === 0) {
          finish()
        }
        frameHandle = window.requestAnimationFrame(frame)
      }

      function stop() {
        if (finished) return
        stopping = true
        canvas.dataset.on = '0'
        window.setTimeout(cleanup, 420)
      }

      document.body.appendChild(canvas)
      resize()
      window.addEventListener('resize', resize)
      canvas.dataset.on = '0'
      window.requestAnimationFrame(function () {
        canvas.dataset.on = '1'
        frameHandle = window.requestAnimationFrame(frame)
      })
      safetyTimer = window.setTimeout(cleanup, duration + 8000)

      return { stop: stop }
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const styleEl = insertOwnedStyle(CSS)
      ctx.effect(function () {
        return function () {
          styleEl.remove()
        }
      }, 'offwork-countdown: styles')

      let t = fallbackTranslate
      const locale = ctx.get('locale')
      if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        ctx.effect(function () {
          let dispose = function () {}
          try {
            const disposeZh = locale.register(NS, 'zh', DICT.zh)
            const disposeEn = locale.register(NS, 'en', DICT.en)
            dispose = function () {
              disposeZh()
              disposeEn()
            }
          } catch (error) {
            console.error('[offwork-countdown] locale registration failed', error)
          }
          return dispose
        }, 'offwork-countdown: locale')

        // 字典没注册成功时 bind 会把 key 原样吐回来，那样界面上就会出现
        // "work 08:23:45"。逐 key 兜底：拿不到真正的译文就用内置字典。
        const translate = locale.bind(NS)
        t = function (key) {
          let value
          try {
            value = translate(key)
          } catch (error) {
            value = undefined
          }
          return typeof value === 'string' && value !== key ? value : fallbackTranslate(key)
        }
      }

      // 设置以 Host 文件为准：启动时读回。第一次读到空文件时，把旧版本留在
      // 本 origin 的 localStorage 副本迁上去；之后两边保持同步。
      void (async function hydrateSettings() {
        const host = await loadHostSettings()
        if (host !== null) {
          if (!settingsTouched) {
            store.settings = host
            persistLocalSettings(host)
            emit()
          }
          return
        }
        const local = readLocalSettings()
        if (local !== null) await saveHostSettings(local)
      })()

      // Host 到点时页面可能不在前台：它先闪任务栏并留下 pending；页面回到
      // 前台（或重新加载）时把这一天的烟花补上，页面计时器被节流也不影响。
      void consumeHostPending()

      // 烟花：一个当前实例 + 一个每秒检查「是否刚跨过下班时间」的看门狗。
      let activeFireworks = null
      function pageInForeground() {
        try {
          return document.visibilityState === 'visible' && document.hasFocus()
        } catch (error) {
          return true
        }
      }

      // 按「到点事件」去重，而不是按下班日期去重：
      //  - 页面内的跨点检测用 dayKey + end 作为一个事件；
      //  - Host 的 pending 用它的写入时间 at 作为事件。
      // 同一天改了几次下班时间（测试或加班后重设）时，每一次到点都能各自播一次；
      // 同一事件不会因为 focus/visibility 反复触发而重复播放。
      let lastPlayedKey = ''
      let lastPlayedAt = 0
      let queuedPlay = null

      function dayKeyNow() {
        return new Date().toDateString()
      }

      async function playOnce(key, dayKey) {
        if (lastPlayedKey === key) return
        if (!pageInForeground()) {
          queuedPlay = { key, dayKey }
          return
        }
        lastPlayedKey = key
        lastPlayedAt = Date.now()
        queuedPlay = null
        await clearHostPending(dayKey)
        playFireworks()
      }

      function playPendingFireworks() {
        if (queuedPlay === null || !pageInForeground()) return
        const entry = queuedPlay
        queuedPlay = null
        void playOnce(entry.key, entry.dayKey)
      }

      function queueFireworks(dayKey, end) {
        void playOnce(`crossing:${String(dayKey)}:${String(end)}`, dayKey)
      }

      async function consumeHostPending() {
        const pending = await takeHostPending()
        if (pending === null) {
          return
        }
        if (pending.dayKey !== dayKeyNow()) {
          await clearHostPending(pending.dayKey)
          return
        }
        const key = `pending:${String(pending.at)}`
        // 同一个事件刚由跨点检测播过时，只清理，不重播。
        if (lastPlayedKey === key || Math.abs(pending.at - lastPlayedAt) < 10000) {
          await clearHostPending(pending.dayKey)
          return
        }
        await playOnce(key, pending.dayKey)
      }
      function playFireworks(force) {
        const fireworkSettings = store.settings.fireworks || DEFAULT_SETTINGS.fireworks
        if (!force && fireworkSettings.enabled !== true) return
        const duration = FIREWORK_DURATIONS[fireworkSettings.duration] || FIREWORK_DURATIONS.long
        if (activeFireworks) {
          try {
            activeFireworks.stop()
          } catch (error) {
            /* ignore */
          }
          activeFireworks = null
        }
        try {
          activeFireworks = createFireworks({
            duration: duration,
            scope: fireworkSettings.scope,
            density: fireworkSettings.density,
            onEnd: function () {
              activeFireworks = null
            },
          })
        } catch (error) {
          console.error('[offwork-countdown] fireworks failed to start', error)
          activeFireworks = null
        }
      }

      ctx.effect(function () {
        const onForeground = function (event) {
          playPendingFireworks()
          void consumeHostPending()
        }
        window.addEventListener('focus', onForeground)
        document.addEventListener('visibilitychange', onForeground)
        window.addEventListener('pointerdown', onForeground, true)
        return function () {
          window.removeEventListener('focus', onForeground)
          document.removeEventListener('visibilitychange', onForeground)
          window.removeEventListener('pointerdown', onForeground, true)
        }
      }, 'offwork-countdown: fireworks foreground')

      ctx.effect(function () {
        return function () {
          if (activeFireworks) {
            try {
              activeFireworks.stop()
            } catch (error) {
              /* ignore */
            }
            activeFireworks = null
          }
        }
      }, 'offwork-countdown: fireworks')

      ctx.effect(function () {
        let previous = null
        function tick() {
          const timestamp = Date.now()
          const view = computeView(timestamp, store.settings)
          const dayKey = new Date(timestamp).toDateString()
          const current = { phase: view.phase, end: store.settings.end, dayKey: dayKey }
          if (
            previous !== null &&
            previous.phase === 'work' &&
            current.phase === 'off' &&
            previous.dayKey === current.dayKey &&
            previous.end === current.end &&
            store.settings.fireworks.enabled === true
          ) {
            // 先在任务栏提示：不管 DSH 在不在前台，用户都应该知道到点了。
            void requestTaskbarFlash()
            // 动画只在用户看得见的时候放；否则挂起，等窗口回到前台。
            if (!prefersReducedMotion()) queueFireworks(current.dayKey, current.end)
          }
          previous = current
        }
        tick()
        const timer = window.setInterval(tick, 1000)
        return function () {
          window.clearInterval(timer)
        }
      }, 'offwork-countdown: fireworks watcher')

      slots.inject('conversation.composer.dock', function () {
        return slots.register(
          { name: 'conversation.composer.dock', id: 'offwork-countdown', order: 2 },
          function () {
            return h(Countdown, { t: t })
          },
        )
      })

      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'offwork-countdown.settings', order: 50 },
          function () {
            return h(SettingsDialog, {
              t: t,
              onPreview: function () {
                playFireworks(true)
              },
            })
          },
        )
      })
    }

    return {
      inject: ['slots'],
      apply: apply,
    }
  },
})
