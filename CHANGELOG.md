# Changelog

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
