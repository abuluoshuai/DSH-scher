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

把 10 个日常插件收进同一个项目、同一个 bundle：在 DeepSeek Harness 里安装一次，Plugins 页只多出一个 **Scher** 条目，它下面挂着 10 个插件行，行为与分别安装这些插件时一致；从 GitHub 自主安装时按 [modules.json](modules.json) 逐个询问用户要哪些模块。

**所有插件代码都是直接落盘的**——`plugins/` 里放的就是整合前正在运行的那一份（含本地定制），
不通过 git clone / submodule 跟随上游。原因很简单：其中若干包（`dsh-ws-recency`、
`dsh-remote`、`dsh-comfyui-workspace` 等）已经按个人习惯改过，和上游发布版不再是同一份代码，
用仓库地址安装只会覆盖掉这些改动。需要换版本时，直接把新代码整包替换 `plugins/<name>/` 即可。
本仓库自研或二次修改的部分（任务栏闪烁、系统监控、ComfyUI 工作台）也按同样方式放在 `plugins/` 里。

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
| `dsh-ws-recency` | 0.29.0 | [chyxhtc/dsh-ws-recency](https://github.com/chyxhtc/dsh-ws-recency) | 侧栏工作区按最近活跃排序；**本地定制**：拖动或表头图钉把整个工作区固定顶部，去掉颜色标记与「全局置顶」区；保留过期历史折叠、归档与回收站、Token 统计、移动工作区、交接到新会话、会话内容搜索；新增「历史」Tab：直接读会话日志列出全部真人提问（过滤系统注入），进入时停在最近提问，点击气泡跳回原消息 |
| `dsh-color-style` | 0.8.0 | [abuluoshuai/dsh-color-style](https://github.com/abuluoshuai/DSH-color-style) | 十种 Markdown 阅读配色：整窗背景、正文排版、左上角主题色；对话中历史用户消息气泡的文字颜色与背景色可单独自定义；**Host 半边**在会话完成一轮、或需要你审批/回答提问而窗口不在前台时闪烁 Windows 任务栏图标（可单独关） |
| `dsh-better-sidebar` | 0.32.0 | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 右侧栏：文件树、编辑器、变更、任务、侧边对话，每个会话独立 |
| `dsh-remote` | 1.1.2 | [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote) | SSH 远程工作区、远程终端、远程文件浏览与搜索；**本地定制**：注册进右侧栏、X11 转发、macOS 主机支持、远程文件树 VS Code 风格图标 |
| `dsh-offwork-countdown` | 0.2.1 | [ZydFirst/dsh-offwork-countdown](https://github.com/ZydFirst/dsh-offwork-countdown) | 输入框下方的下班倒计时胶囊，到点转为加班计时；**本地定制**：到点在窗口上放一段可定制烟花（范围/密度/时长，设置里可预览） |
| `dsh-system-monitor` | 0.1.0 | 自研（本仓库） | dock 里的 CPU／内存／显卡／显存进度条；指标在 DSH Host 进程采集，因此本地与远程工作区显示的都是会话真正所在的主机；支持 Windows/Linux/macOS 与 NVIDIA/AMD/Apple 显卡 |
| `dsh-global-todo` | 0.23.2 | [LUgABeEEE/dsh-global-todo](https://github.com/LUgABeEEE/dsh-global-todo) | 跨会话全局待办：Agent 报「完成」只进待确认，人点头才算数；支持步骤计划、文档与地址、交给会话继续做、多机同步 |
| `@xmanrui/dsh-im` | 5.10.0 | [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | IM 机器人：微信／飞书／企业微信／钉钉／QQ／Telegram／WhatsApp／Slack／Discord／Matrix 接入 DSH |
| `dsh-comfyui-workspace` | 0.7.0 | 自研（本仓库） | ComfyUI 简易工作台：导入工作流、卡片式调参、跑图/跑视频、归档每次参数与种子 |
| `dsh-feishu-notify` | 0.1.0 | 本仓库新增 | 本机任意根会话完成一轮时，用 dsh-im 的飞书机器人推送会话名 + 用户输入 + 最终 markdown 正文 |

# 安装

## 从本地目录安装（当前方式）

1. 打开 **Plugins** 页 → **Add plugin**，选择本目录 `DSH-scher`；
   或者让 Agent 用 `plugin_manager` `install_bundle` 指向本目录。
2. 安装完成后，Plugins 页出现 **Scher** 组合包，展开可见 10 个插件行。
3. 如果之前分别装过这些插件，请把原来那些组合包**停用**，避免同一个插件挂两份
   （客户端模块 id 会撞车）。

## 从 GitHub 自主安装（给 DSH / Agent 的流程）

> 这段是给「让 DSH 从 GitHub 自主安装本仓库」用的行为约定：**不要一次全装**。按下面的顺序
> 逐个询问用户，遇到相互依赖与外部前提必须重点提醒。更完整的逐模块问答话术见
> [INSTALL.md](INSTALL.md)。

1. **先只落依赖、不挂载**：`plugin_manager` 的 `install_bundle`，`target` 指向本仓库（本地目录
   或 GitHub 地址），`enabled: false`。这样不会先把 10 个模块全挂上再拆。
2. **读模块目录**：[modules.json](modules.json)，或运行
   `node scripts/select-modules.mjs list`（`--json` 供 Agent 解析）。把模块清单**逐条**问
   用户「这个需要吗？」——一次只问一个，附一句话说明和体积。
3. **重点提醒相互依赖与外部前提**（见下表）——这类提醒不能省，否则用户按默认装完才发现
   缺东西。
4. **把选择写进 profile**：

   ```sh
   node scripts/select-modules.mjs apply --modules color-style,ws-recency,better-sidebar,remote
   ```

   未选中的行会被写成 `disabled: true`（只动 profile 里由脚本维护的那段块）；`--dry-run`
   先预览，`--json` 给 Agent 读。
5. **启用组合包**：在 Plugins 里启用 **Scher**，按提示重启 DSH（或停用再启用触发 HMR 重组合）。
6. **汇报**：装了哪些模块、跳过了哪些、每个装上的模块有什么外部前提需要用户自己准备。

### 模块依赖与外部前提

| 模块 | 关系 | 说明 |
| --- | --- | --- |
| `remote` | 推荐同时装 `better-sidebar` | 远程资源管理器、远程文件与终端会注册进右侧栏；只装 remote 时用 DSH 原生侧栏 |
| `system-monitor` | 推荐同时装 `remote` | 想监控**远程工作区所在主机**的资源，需要 remote 提供远程会话；只装本模块只看本机 |
| `color-style` | 仅 Windows 的能力 | 配色全平台可用；其中的任务栏闪烁只在 Windows、依赖系统 PowerShell，可在 `taskbarFlash.enabled` 单独关闭 |
| `im` | 外部前提 | 各平台自己的机器人凭据（token／应用 ID 与密钥／扫码）与网络；体积最大（约 22 MB 代码 + 40 MB 依赖） |
| `comfyui` | 外部前提 | 一个可访问的 ComfyUI 服务（默认 `http://127.0.0.1:8188`）；没有它面板能开、任务跑不了 |

## 模块选择（装好之后也能改）

`modules.json` 是模块目录，`scripts/select-modules.mjs` 把选择写进 profile 的
`cordis.patch.yml`（一段带标记的托管块，删除整块 = 全部启用）：

| 命令 | 作用 |
| --- | --- |
| `node scripts/select-modules.mjs list` | 列出模块、体积、相互依赖与外部前提（Agent 逐条询问时用它） |
| `node scripts/select-modules.mjs status` | 显示当前 profile 里哪些模块被关掉 |
| `node scripts/select-modules.mjs apply --modules a,b,c` | 启用选中的模块、关闭其余；`all` / `none` 也行 |
| `… apply … --dry-run --json` | 预览／机器可读输出；`--profile-dir` 可指定别的 profile |

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
├── modules.json          # 模块目录：id / 行 id / 版本 / 体积 / 相互依赖与外部前提
├── scripts/              # select-modules.mjs：维护 profile 里的模块选择
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
    └── dsh-comfyui-workspace/
```

每个 `plugins/<name>/` 内保持上游包结构：入口模块、`client` 产物、`locale/`、图标、
`cordis.patch.yml`、`README`、`LICENSE`。`dsh-im` 只保留了运行需要的 `lib`、`locale`、
`assets`（含插件图标）、`package.json`、`cordis.patch.yml` 与文档，没有带上游仓库里的
`src/`、`plugin-src/`、`bin/`、`scripts/` 构建/开发目录（运行时用不到）。

# 配置

十个行 id 都可被 profile 的 `cordis.patch.yml` 按 id 覆盖（`config` 是整体替换，不深合并）：

| 行 id | 插件 | 可配置项 |
| --- | --- | --- |
| `color-style` | 配色方案 + 任务栏闪烁 | `taskbarFlash.enabled`、`.ignoreSubagents`、`.onlyWhenUnfocused`、`.onInteraction`、`.flashCount`、`.cooldownMs`、`.processName`、`.powerShellCommand`、`.log`（用户消息气泡颜色走浏览器 localStorage，不在行 config 里） |
| `global-todo` | 全局待办 | `storePath`、`dispatchDir`、`activityLimit`、`requireExistingFiles`、`guidance`、`toolGroups`、`browseRoot`、`sync.dir`、`sync.intervalMinutes` |
| `dsh-offwork-countdown` | 下班倒计时 | 无（时间与烟花设置在胶囊里改） |
| `better-sidebar` | 右侧栏 | 无（在「设置 → 侧边卡片」里改） |
| `ws-recency` | 工作区最近顺序 | 无（置顶状态存在浏览器本地） |
| `dsh-remote` | 远程工作区 | 无（机器列表在面板里维护） |
| `system-monitor` | 系统监控 | `intervalMs`、`gpuCacheMs` |
| `xmanrui-dsh-im` | IM 机器人 | 无（频道与凭据在插件自己的设置页里维护） |
| `comfyui-workspace` | ComfyUI 工作台 | `home`、`server.url`、`server.username`、`server.password`、`server.headers`、`archiveLimit`、`downloadOutputs`、`toolGroups`、`guidance` |

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
  记得把 [modules.json](modules.json) 里该模块的 `version` 与新代码对齐。
- **依赖变化**：在 `DSH-scher` 目录执行 `pnpm install`。
- **新增插件进整合包**：把包放进 `plugins/`，在根 `cordis.patch.yml` 的 `insert` 里加一行
  `name: './plugins/<name>/<入口>.js'`，行 id 用该插件自己的 id；再在
  [modules.json](modules.json) 里补一条目录（含依赖/外部前提说明），否则选择器看不到它。

# 已知差异（相对分别安装）

- 行名是相对路径而不是裸包名，因此：
  - `better-sidebar` 的「聚合 bundle 重复挂载保护」`!!js` 表达式按包名 `dsh-better-sidebar`
    判断——本整合包内不会自己触发；若以后另装一个以该包名挂载的聚合包，保护仍生效。
  - 需要按包名解析的少数诊断/兼容性检查不会把这九行当成独立安装的包。
- 组合包只有一个（Scher），各插件原来的独立组合包开关变成 Scher 这一个开关；
  按模块启停用 `node scripts/select-modules.mjs apply --modules …`（等价于给对应行加
  `disabled: true`）。
- `dsh-color-style` 的 Host 半边负责任务栏闪烁：仅 Windows，依赖系统 PowerShell；不想用时
  在 `config.taskbarFlash.enabled: false` 关掉，不影响配色。
- `dsh-offwork-countdown` 的基线是整合前的 0.1.0，加入本地「下班烟花」与设置框修复后版本记为 0.2.1；
  上游此后的 0.1.1 窄屏换行修复没有并入，需要时可手动合并（注意保留 client.js 的烟花改动）。
- `dsh-im` 落盘的是已安装的 5.10.0；它的 `dsh.compatibility` 声明的仍是旧 DSH 兼容范围，
  但当前 DSH 版本下实际运行正常（整合包不检查子包兼容声明）。
- 本仓库不通过 submodule 跟随上游；所有插件代码都在本仓库内，改了就生效、换了就覆盖。

# 许可证与致谢

本仓库（Scher 的组装部分）以 MIT 发布。`plugins/` 下各插件保留其上游许可证与版权，见各自
的 `LICENSE`；`dsh-im` 另有 `THIRD_PARTY_NOTICES.md`。感谢上述作者把插件开源出来。
