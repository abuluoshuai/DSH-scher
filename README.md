<div align="center">
  <img src="icon/scher.png" alt="Scher" width="120" height="120" />
</div>

<h1 align="center">DSH-scher</h1>

<p align="center"><i>个人插件合集 · 个人常用 DSH 插件整合包</i></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license" />
  <img src="https://img.shields.io/badge/version-0.1.0-informational.svg" alt="version" />
  <img src="https://img.shields.io/badge/DSH-0.2.2--rc.1%2B-4d6bfe" alt="DSH" />
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/changelog-view-informational.svg" alt="changelog" /></a>
</p>

# 这是什么

把 10 个日常插件收进同一个项目、同一个 bundle：在 DeepSeek Harness 里安装一次，Plugins 页只多出一个 **Scher** 条目，它下面挂着 10 个插件行，行为与分别安装这些插件时一致。

**所有插件代码都是直接落盘的**——`plugins/` 里放的就是整合前正在运行的那一份（含本地定制），
不通过 git clone / submodule 跟随上游。原因很简单：其中若干包（`dsh-ws-recency`、
`dsh-remote`、`dsh-comfyui-workspace` 等）已经按个人习惯改过，和上游发布版不再是同一份代码，
用仓库地址安装只会覆盖掉这些改动。需要换版本时，直接把新代码整包替换 `plugins/<name>/` 即可。
自研插件（系统监控、ComfyUI 工作台、完成时闪烁任务栏）也按同样方式放在 `plugins/` 里。

整合的做法不是把代码揉成一个大文件，而是**把插件放进同一个可安装项目**：

- `plugins/` 下每个插件都是完整、独立的包，原来的 `package.json`、`exports`、
  `dsh.client`、`locale`、`icon` 原样保留；
- 根目录的 `cordis.patch.yml` 用相对路径行（`./plugins/<包名>/<入口>.js`）把 10 个 Host 行
  插进 Loader；
- Client 半边按「最近的 `package.json`」认定身份，所以每个插件继续用**自己原来的包名**
  注册客户端模块——槽位、locale、图标、`/plugins/<包名>/…` 资源路由都与单独安装时一样；
- 行 id 也与各插件单独发布时一致，profile 的 `cordis.patch.yml` 仍可按 id 覆盖配置。

# 包含的插件

以下版本就是整合前**正在运行的那一份**（含本地修改），不是上游最新版的重装。

| 插件 | 版本 | 上游 / 来源 | 在 Scher 里做的事 |
| --- | --- | --- | --- |
| `dsh-ws-recency` | 0.27.1 | [chyxhtc/dsh-ws-recency](https://github.com/chyxhtc/dsh-ws-recency) | 侧栏工作区按最近活跃排序；**本地定制**：拖动或表头图钉把整个工作区固定顶部，去掉颜色标记与「全局置顶」区；保留过期历史折叠、归档与回收站、Token 统计、移动工作区、交接到新会话、会话内容搜索 |
| `dsh-color-style` | 0.5.0 | [abuluoshuai/dsh-color-style](https://github.com/abuluoshuai/DSH-color-style) | 十种 Markdown 阅读配色：整窗背景、正文排版、左上角主题色 |
| `dsh-better-sidebar` | 0.32.0 | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 右侧栏：文件树、编辑器、变更、任务、侧边对话，每个会话独立 |
| `dsh-remote` | 1.1.2 | [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote) | SSH 远程工作区、远程终端、远程文件浏览与搜索；**本地定制**：注册进右侧栏、X11 转发、macOS 主机支持、远程文件树 VS Code 风格图标 |
| `dsh-offwork-countdown` | 0.1.0 | [ZydFirst/dsh-offwork-countdown](https://github.com/ZydFirst/dsh-offwork-countdown) | 输入框下方的下班倒计时胶囊，到点转为加班计时 |
| `dsh-system-monitor` | 0.1.0 | 自研（本仓库） | dock 里的 CPU／内存／显卡／显存进度条；指标在 DSH Host 进程采集，因此本地与远程工作区显示的都是会话真正所在的主机；支持 Windows/Linux/macOS 与 NVIDIA/AMD/Apple 显卡 |
| `dsh-global-todo` | 0.23.2 | [LUgABeEEE/dsh-global-todo](https://github.com/LUgABeEEE/dsh-global-todo) | 跨会话全局待办：Agent 报「完成」只进待确认，人点头才算数；支持步骤计划、文档与地址、交给会话继续做、多机同步 |
| `@xmanrui/dsh-im` | 5.10.0 | [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | IM 机器人：微信／飞书／企业微信／钉钉／QQ／Telegram／WhatsApp／Slack／Discord／Matrix 接入 DSH |
| `dsh-comfyui-workspace` | 0.7.0 | 自研（本仓库） | ComfyUI 简易工作台：导入工作流、卡片式调参、跑图/跑视频、归档每次参数与种子 |
| `dsh-taskbar-flash` | 0.1.0 | 自研（本仓库） | 会话跑完一轮、而 DSH 窗口不在前台时，闪烁 Windows 任务栏上的 DSH 图标；窗口在前台不闪，子代理完成默认忽略 |

# 安装

## 从本地目录安装（当前方式）

1. 打开 **Plugins** 页 → **Add plugin**，选择本目录 `DSH-scher`；
   或者让 Agent 用 `plugin_manager` `install_bundle` 指向本目录。
2. 安装完成后，Plugins 页出现 **Scher** 组合包，展开可见 10 个插件行。
3. 如果之前分别装过这些插件，请把原来那些组合包**停用**，避免同一个插件挂两份
   （客户端模块 id 会撞车）。

## 依赖

本机 checkout 的 `node_modules/` 已经放好了 Host 半边运行所需的第三方依赖，因此当前目录
可以直接被 profile 链接使用。`node_modules/` 不进 git；从仓库重新检出后，在本目录执行
`pnpm install` 重建（会按 `pnpm-workspace.yaml` 把 `plugins/*` 的依赖装成 hoisted 布局）。

已落盘的第三方依赖（约 41 MB）：

- `dsh-remote`：`ssh2` 及其原生依赖、`iconv-lite`、`yaml`；
- `dsh-better-sidebar`：`ws`、`yaml`；
- `@xmanrui/dsh-im`：`sharp` + `@img/sharp-win32-x64`（图片处理，可选依赖）、
  `dingtalk-stream`/`axios`/`ws`、`imapflow`、`mailparser`、`nodemailer`、`qrcode`、
  `undici`、`@matrix-org/olm`、腾讯 QQ 与企微 SDK 等；
- 公共：`@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit`、`@standard-schema/spec`。

Host 半边的 `@deepseek-ai/*` 依赖（`dsh-tools`、`dsh-settings`、`dsh-session` 等）由 DSH
运行时的解析器提供，不在本仓库里装第二份。`dsh-comfyui-workspace` 没有第三方依赖。

Client 半边全部是预构建产物（各插件的 `client.js` / `lib/client*.js`），**没有构建步骤**。

# 目录结构

```
DSH-scher/
├── package.json          # bundle 清单：dsh.bundle.patch / engines / icon / locale
├── cordis.patch.yml      # 十个 Host 行的唯一配置层（相对路径行）
├── pnpm-workspace.yaml   # plugins/* 的依赖工作区
├── locale/               # 组合包在 Plugins 页的标题与说明（en / zh）
├── icon/                 # 组合包图标（Scher）
└── plugins/
    ├── dsh-ws-recency/
    ├── dsh-color-style/
    ├── dsh-better-sidebar/
    ├── dsh-remote/
    ├── dsh-offwork-countdown/
    ├── dsh-system-monitor/
    ├── dsh-global-todo/
    ├── dsh-im/                     # 包名仍是 @xmanrui/dsh-im
    ├── dsh-comfyui-workspace/
    └── dsh-taskbar-flash/
```

每个 `plugins/<name>/` 内保持上游包结构：入口模块、`client` 产物、`locale/`、图标、
`cordis.patch.yml`、`README`、`LICENSE`。`dsh-im` 只保留了运行需要的 `lib`、`locale`、
`assets`（含插件图标）、`package.json`、`cordis.patch.yml` 与文档，没有带上游仓库里的
`src/`、`plugin-src/`、`bin/`、`scripts/` 构建/开发目录（运行时用不到）。

# 配置

十个行 id 都可被 profile 的 `cordis.patch.yml` 按 id 覆盖（`config` 是整体替换，不深合并）：

| 行 id | 插件 | 可配置项 |
| --- | --- | --- |
| `color-style` | 配色方案 | 无（纯前端） |
| `global-todo` | 全局待办 | `storePath`、`dispatchDir`、`activityLimit`、`requireExistingFiles`、`guidance`、`toolGroups`、`browseRoot`、`sync.dir`、`sync.intervalMinutes` |
| `dsh-offwork-countdown` | 下班倒计时 | 无（时间设置在胶囊里改） |
| `better-sidebar` | 右侧栏 | 无（在「设置 → 侧边卡片」里改） |
| `ws-recency` | 工作区最近顺序 | 无（置顶状态存在浏览器本地） |
| `dsh-remote` | 远程工作区 | 无（机器列表在面板里维护） |
| `system-monitor` | 系统监控 | `intervalMs`、`gpuCacheMs` |
| `xmanrui-dsh-im` | IM 机器人 | 无（频道与凭据在插件自己的设置页里维护） |
| `comfyui-workspace` | ComfyUI 工作台 | `home`、`server.url`、`server.username`、`server.password`、`server.headers`、`archiveLimit`、`downloadOutputs`、`toolGroups`、`guidance` |
| `taskbar-flash` | 完成时闪烁任务栏 | `enabled`、`ignoreSubagents`、`onlyWhenUnfocused`、`flashCount`、`cooldownMs`、`processName`、`powerShellCommand`、`log` |

例如把系统监控采样放慢到 5 秒（只写 `id`，不要写 `name`——该行的模块名是整合包内的
相对路径，写 `name` 反而会断言失败）：

```yaml
- id: system-monitor
  config:
    intervalMs: 5000
    gpuCacheMs: 1500
```

# 维护与升级

- **升级 / 替换某个插件**：把你想要的那一份代码整包替换 `plugins/<name>/`（可以是你自己
  改过的版本，也可以是上游新版本），重启或重新安装即可；行 id、包名不变，其余插件不受影响。
- **依赖变化**：在 `DSH-scher` 目录执行 `pnpm install`。
- **新增插件进整合包**：把包放进 `plugins/`，在根 `cordis.patch.yml` 的 `insert` 里加一行
  `name: './plugins/<name>/<入口>.js'`，行 id 用该插件自己的 id。

# 已知差异（相对分别安装）

- 行名是相对路径而不是裸包名，因此：
  - `better-sidebar` 的「聚合 bundle 重复挂载保护」`!!js` 表达式按包名 `dsh-better-sidebar`
    判断——本整合包内不会自己触发；若以后另装一个以该包名挂载的聚合包，保护仍生效。
  - 需要按包名解析的少数诊断/兼容性检查不会把这十行当成独立安装的包。
- 组合包只有一个（Scher），各插件原来的独立组合包开关变成 Scher 这一个开关；
  个别插件的启停请用 profile 的 `cordis.patch.yml` 给对应行加 `disabled: true`。
- `dsh-offwork-countdown` 落盘的是整合前正在运行的 0.1.0；上游此后有 0.1.1 的换行修复，
  需要时可整包替换。
- `dsh-im` 落盘的是已安装的 5.10.0；它的 `dsh.compatibility` 声明的仍是旧 DSH 兼容范围，
  但当前 DSH 版本下实际运行正常（整合包不检查子包兼容声明）。
- 本仓库不通过 submodule 跟随上游；所有插件代码都在本仓库内，改了就生效、换了就覆盖。

# 许可证与致谢

本仓库（Scher 的组装部分）以 MIT 发布。`plugins/` 下各插件保留其上游许可证与版权，见各自
的 `LICENSE`；`dsh-im` 另有 `THIRD_PARTY_NOTICES.md`。感谢上述作者把插件开源出来。
