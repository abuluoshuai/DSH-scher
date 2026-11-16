# Changelog

## 0.7.0 — 2026-11-17

- **dsh-ws-recency 升到 0.29.0（本地定制）**：「历史」页改为读会话日志的完整版。
  - Host 半边新增 `/ws-recency/user-messages`，直接解码会话 JSONL（`sessionPersistence`），
    按顺序返回全部真人提问；系统注入消息（时间、工作区指令、技能目录、压缩检查点、策略通知）
    按 `source.kind === "user"` 过滤掉。
  - 历史页进入时默认滚到最底部（最近的提问），点击气泡按日志里的 turn 跳回对话并高亮；
    不再依赖聊天窗口分页，老会话也能一次看全。
  - README / locale / modules.json / package.json 同步。
- Scher 版本 0.7.0。

## 0.6.0 — 2026-11-17

- **dsh-color-style 升到 0.8.0**：任务栏闪烁扩展为「需要用户交互时也闪」。
  - 触发点：根会话完成一轮（原有）、工具审批请求、结构化提问（`ask_user_question`）；
  - 新增 `config.taskbarFlash.onInteraction`（默认 `true`）单独控制交互闪烁；子代理请求
    受 `ignoreSubagents` 约束；一次提问里的多个问题用 250ms 防抖合并成一次；
  - 只观察事件、不替用户作答；不配置时完成闪烁行为与 0.7.0 一致。
- `modules.json` 的 color-style 条目更新到 0.8.0；Scher 版本 0.6.0。

## 0.5.0 — 2026-11-16

- **dsh-color-style 升到 0.7.0（本地定制）**：设置 → 配色方案 页新增「用户消息区域」。
  - 可以单独指定对话里**历史用户消息气泡**的背景色与文字颜色，选色即时生效；
    「跟随主题」恢复成跟随当前配色方案（默认）。
  - 颜色保存在本机浏览器 localStorage（`dsh.color-style.userMessages.v1`），只影响用户
    消息气泡，不改变输入框、助手消息与配色方案本身；取色器旁另有十六进制输入框，可直接
    粘贴 `#rrggbb`（也接受省略 # 与三位简写），与取色器双向同步。
- **dsh-offwork-countdown 0.2.1**：修复设置对话框在改上下班时间后崩溃的问题——两个时间输入的
  onChange 只重建 `start/end`，把「下班烟花」设置块丢掉，下一次渲染访问 `draft.fireworks.*`
  抛异常，宿主把弹层槽位判为崩溃，之后点胶囊打不开；改为保留其它字段并加渲染兜底。
- **dsh-ws-recency 0.28.0（本地定制）**：会话标题下方的 View Tab 新增「历史」。
  - 按顺序把当前会话里全部用户提问（含中途插话）排成一列左对齐气泡，带序号；
  - 点击任意气泡切回「对话」视图，滚动并高亮原始消息；还没加载的老消息会自动向上翻历史查找；
  - 只读、跟随主题配色，不影响原会话内容。
- `modules.json` 的 color-style 条目更新到 0.7.0、countdown 到 0.2.1、ws-recency 到 0.28.0；
  Scher 版本 0.5.0。

## 0.4.0 — 2026-11-16

- **dsh-offwork-countdown 升到 0.2.0（本地定制）**：新增「下班烟花」。
  - 工作日走到下班时间那一刻，在 DSH 窗口上放一段烟花（默认整窗、10 秒、密度「多」）；
    一天只自动放一次，系统开启「减少动态效果」时自动跳过；无声音，播放时是一层
    `pointer-events: none` 的透明 canvas，不挡点击与输入，结束自动移除。
  - 胶囊设置里可配置：到点放烟花开关、范围（整窗/对话区）、密度（少/标准/多/爆量）、
    持续时间（3/6/10/15 秒），并带「预览烟花」按钮随时试放。
  - 实现：`client.js` 内手绘 canvas（requestAnimationFrame + 重力/摩擦/拖尾、随机角度与
    开方分布的爆炸半径、随机寿命与闪烁），无第三方依赖；插件 README / locale 同步更新。
- `modules.json` 的 countdown 条目更新到 0.2.0；Scher 版本 0.4.0。

## 0.3.0 — 2026-11-16

- **任务栏闪烁并入 `dsh-color-style` 0.6.0**：删除独立的 `dsh-taskbar-flash` 插件与它的行，
  闪烁逻辑改由配色方案的 Host 半边负责（`config.taskbarFlash`）。行数回到 9，配色与闪烁
  可分别关闭；`dsh-color-style` 仓库同步更新（0.6.0，新增 10 项单元测试）。
- **按模块安装**：新增 [modules.json](modules.json) 模块目录（id、行 id、版本、体积、
  相互依赖与外部前提）和 `scripts/select-modules.mjs` 选择器。
  - `list` / `status` / `apply --modules …`：把未选中的行写成 profile 里的 `disabled: true`，
    只维护一段带标记的覆盖块，不动用户其它覆盖。
  - README 新增「从 GitHub 自主安装（给 DSH / Agent 的流程）」：安装时先 `enabled: false`
    落依赖，然后**逐条询问用户**要哪些模块，并对相互依赖（remote ↔ better-sidebar、
    system-monitor ↔ remote）与外部前提（ComfyUI 服务、IM 平台凭据、仅 Windows 的闪烁）
    重点提醒，最后再启用组合包。
## 0.2.0 — 2026-11-16

- **新增 `dsh-taskbar-flash 0.1.0`**（自研，Host-only）：会话跑完一轮、且 DSH 桌面窗口
  不在前台时，闪烁 Windows 任务栏上的 DSH 图标提醒用户；窗口在前台时不闪（只看屏幕即可），
  子代理的完成默认忽略，冷却窗口内的多次完成合并成一次。
  - 实现：监听 `agent/status` 的 `running → idle`（根会话），用随包 PowerShell 脚本按
    `process.ppid` 找到 Electron 主进程的任务栏窗口，调用 Win32 `FlashWindowEx`
    （`FLASHW_ALL | FLASHW_TIMERNOFG`，窗口激活后停止）。不修改 DSH 安装目录、不依赖
    Electron 内部 IPC。
  - 配置：`enabled`、`ignoreSubagents`、`onlyWhenUnfocused`、`flashCount`、`cooldownMs`、
    `processName`、`powerShellCommand`、`log`；排查日志 `~/.dsh/taskbar-flash/attention.log`。
  - 限制：仅 Windows；依赖系统 PowerShell；窗口隐藏到托盘时没有任务栏按钮。

## 0.1.0 — 2026-11-16

首个整合版本：把下列 9 个插件按「当前正在运行的修改后版本」收进同一个项目、同一个
bundle，安装一次即可全部挂载。所有插件代码**直接落盘**在本仓库（不用 git clone /
submodule），因为其中若干包已按个人习惯定制，与上游发布版不再是同一份代码。

- **dsh-ws-recency 0.27.1**（本地定制）：工作区整组按最近活跃排序，支持拖动或表头图钉把
  整个工作区固定到顶部；丢弃颜色标记与「全局置顶」区；保留过期历史折叠、归档与回收站、
  Token 统计、移动到工作区、交接到新会话、会话内容搜索。
- **dsh-color-style 0.5.0**：十种 Markdown 阅读配色，控制整窗背景、正文排版与左上角主题色。
- **dsh-better-sidebar 0.32.0**：右侧栏（文件树、编辑器、变更、任务、侧边对话），并按会话隔离。
- **dsh-remote 1.1.2**（本地定制）：SSH 远程工作区、远程终端与文件浏览；注册到右侧栏；
  增加 X11 转发与 macOS 主机支持；远程文件树按 VS Code 风格加图标。
- **dsh-offwork-countdown 0.1.0**：输入框下方的下班倒计时胶囊，到点转为加班计时。
- **dsh-system-monitor 0.1.0**（自研）：dock 里的 CPU／内存／显卡／显存进度条，指标在
  DSH Host 进程采集，支持远程工作区与 Linux/macOS，支持 NVIDIA/AMD/Apple 显卡。
- **dsh-global-todo 0.23.2**：跨会话全局待办，Agent 报「完成」只进待确认，人点头才算数。
- **@xmanrui/dsh-im 5.10.0**：IM 机器人，接入微信／飞书／企业微信／钉钉／QQ／Telegram／
  WhatsApp／Slack／Discord／Matrix；直接整合已安装代码，不再走上游 submodule 跟随路线。
- **dsh-comfyui-workspace 0.7.0**（自研）：ComfyUI 简易工作台，导入工作流、卡片式调参、
  跑图/跑视频并归档每次参数与种子。

工程结构：

- `cordis.patch.yml` 用相对路径行（`./plugins/<name>/<入口>.js`）把 9 个 Host 行插进 Loader；
  Client 半边按最近的 `package.json` 认定身份，沿用各插件原来的包名，客户端模块、槽位、
  locale、图标与 `/plugins/<包名>/…` 资源路由都不变。
- `plugins/` 下每个插件是完整独立包（原 `package.json` / `exports` / `dsh.client` /
  `locale` / `icon` 原样保留）。`dsh-im` 只保留运行需要的文件（`lib`、`locale`、`assets`、
  清单与文档），未带上游的 `src` / `plugin-src` / `bin` / `scripts` 开发目录。
- 为 `dsh-ws-recency` 与 `dsh-remote` 补了 `locale/`（插件行在 Plugins 页的标题与说明）
  与原创 SVG 图标（两者上游都没有图标）；其余插件沿用各自的 locale/icon。
- 行 id 保持与单独安装时一致（`color-style`、`global-todo`、`dsh-offwork-countdown`、
  `better-sidebar`、`ws-recency`、`dsh-remote`、`system-monitor`、`xmanrui-dsh-im`、
  `comfyui-workspace`），profile 的 `cordis.patch.yml` 仍可按 id 覆盖配置。
- `better-sidebar` 自带的「聚合 bundle 重复挂载保护」`!!js` 表达式保留。
- `node_modules/`（不进 git）落盘了各插件 Host 半边需要的第三方依赖，含 `sharp` 与
  `@img/sharp-win32-x64`、`dingtalk-stream`、`imapflow`、`mailparser`、`nodemailer`、
  `qrcode`、`undici`、`@matrix-org/olm`、腾讯 QQ/企微 SDK、`ssh2`、`ws`、`yaml` 等。
- 已核对：`plugins/` 里的运行时代码与整合前正在运行的版本逐字节一致（含 `dsh-im` 与
  `dsh-comfyui-workspace`）。
