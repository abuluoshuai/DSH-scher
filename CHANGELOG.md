# Changelog

## 0.1.0 — 2026-11-16

首个整合版本：把下列 7 个插件按「当前正在运行的修改后版本」收进同一个项目、同一个
bundle，安装一次即可全部挂载。

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

工程结构：

- `cordis.patch.yml` 用相对路径行（`./plugins/<name>/<入口>.js`）把 7 个 Host 行插进 Loader；
  Client 半边按最近的 `package.json` 认定身份，沿用各插件原来的包名，客户端模块、槽位、
  locale、图标与 `/plugins/<包名>/…` 资源路由都不变。
- `plugins/` 下每个插件是完整独立包（原 `package.json` / `exports` / `dsh.client` /
  `locale` / `icon` 原样保留）。
- 为 `dsh-ws-recency` 与 `dsh-remote` 补了 `locale/`（插件行在 Plugins 页的标题与说明）
  与原创 SVG 图标（两者上游都没有图标）；其余插件沿用各自的 locale/icon。
- 行 id 保持与单独安装时一致（`color-style`、`global-todo`、`dsh-offwork-countdown`、
  `better-sidebar`、`ws-recency`、`dsh-remote`、`system-monitor`），profile 的
  `cordis.patch.yml` 仍可按 id 覆盖配置。
- `better-sidebar` 自带的「聚合 bundle 重复挂载保护」`!!js` 表达式保留。
- 已核对：`plugins/` 里的运行时代码与整合前正在运行的版本逐字节一致。
