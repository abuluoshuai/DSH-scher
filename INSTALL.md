# 给 Agent 的安装流程（从 GitHub 自主安装 DSH-scher）

> 本文件是**给正在替用户安装本仓库的 Agent 读的**。核心要求只有两条：
> **逐模块询问用户要不要装**；**相互依赖 / 外部前提必须重点提醒**。
> 不要一次性把 10 个模块全装上再问。

## 0. 先读模块目录

读仓库根目录的 [`modules.json`](modules.json)：每个模块有 `id`、`row`（Loader 行 id）、
`package`、`version`、`sizeMB`、`summary`、`requires`、`recommends`、`external`、`notes`。
其中 `recommends` 与 `external` 就是必须提醒用户的依赖信息。

也可以运行 `node scripts/select-modules.mjs list` 得到人类可读版本（`--json` 供解析）。

## 1. 先装依赖，不挂载任何模块

用 `plugin_manager`：

```
install_bundle target="git+https://github.com/abuluoshuai/DSH-scher.git" enabled=false
```

- `enabled=false` 只把仓库与第三方依赖装进 profile，**不挂载任何模块**，这样不会先全开再拆。
- 如果 pnpm 拦截了构建脚本（通常是 `sharp`、`cpu-features` 这类原生包），把
  `pendingBuilds` 报给用户，等用户批准后再带 `approvedBuilds` 重试；`ssh2` 没有原生构建也能用，
  `sharp` 缺预编译二进制时才真正影响 IM 的图片处理。

## 2. 逐个询问用户（一次只问一个模块）

按 `modules.json` 的顺序，用 `ask_user_question` 问，例如：

> 需要安装「远程工作区（dsh-remote）」吗？约 1.5 MB。
> 它提供 SSH 远程工作区、远程终端与文件浏览。**注意：它建议与「右侧栏」一起安装**——
> 远程资源管理器与终端会注册进右侧栏；只装它时使用 DSH 原生侧栏。另外需要至少一台
> 可 SSH 连上的主机。

规则：

- **一次只问一个模块**，等用户回答再问下一个；回答「不要」就记下来，不要装。
- 每组依赖在问到**后面的模块时**再强调一次（见下表），不要只靠用户自己想起来。
- 用户不想逐个选时，提供三个预设：`最小`（只装 `color-style`）、`推荐`（除 `im`、`feishu-notify`、`comfyui`）、
  `全部`。
- 不要替用户默认勾选 `im`（体积最大：约 22 MB 代码 + 40 MB 运行时依赖）或 `comfyui`
  （需要外部 ComfyUI 服务）。

## 3. 必须重点提醒的依赖关系

| 模块 | 关系 | 怎么提醒 |
| --- | --- | --- |
| `remote` | 与 `better-sidebar` 相互配合 | 「远程资源管理器 / 远程文件 / 终端会注册进右侧栏；不装右侧栏就只用 DSH 原生侧栏。**建议一起装**」 |
| `system-monitor` | 依赖 `remote` 才能看远程主机 | 「只装系统监控只能看本机；要监控远程工作区所在主机，需要同时装远程工作区」 |
| `color-style` | 包含任务栏闪烁（仅 Windows） | 「配色全平台可用；会话完成时闪烁任务栏是 Windows-only，依赖系统 PowerShell，可在 `config.taskbarFlash.enabled` 单独关闭」 |
| `feishu-notify` | 依赖 `im` + 飞书机器人 | 「先装 IM 模块并配好飞书机器人；默认发给机器人 owner，没有机器人时跳过推送」 |
| `im` | 外部前提 + 最大体积 | 「需要各平台自己的机器人凭据（token / 应用 ID 与密钥 / 扫码）与网络；不用的平台不用配」 |
| `comfyui` | 外部前提 | 「需要一个可访问的 ComfyUI 服务（默认 http://127.0.0.1:8188）；没有它面板能打开但跑不了任务」 |
| `ws-recency` / `better-sidebar` | 不冲突 | 一个管左侧工作区会话栏、一个管右侧栏，可以都要 |

## 4. 应用用户的选择

用户的回答落实为「启用哪些行」。两种做法，优先第一种：

### A. 用 plugin_manager（推荐）

1. `set_bundle target="dsh-scher" enabled=true`（挂载全部 10 行；此时先别让用户以为已经装完）。
2. 对用户**不要**的每个模块，按 `modules.json` 的 `row` 关闭对应行：

   ```
   set_plugin target="include:<row>" enabled=false
   ```

   例如不要 IM：`set_plugin target="include:xmanrui-dsh-im" enabled=false`；
   不要 ComfyUI：`set_plugin target="include:comfyui-workspace" enabled=false`。
3. 用户之后改主意时，反过来 `enabled=true` 即可，不需要重装。

### B. 用仓库脚本（本机 checkout 或已装进 profile 的副本）

```sh
node scripts/select-modules.mjs apply --modules color-style,ws-recency,better-sidebar,remote
```

- 只接受 `modules.json` 里的模块 id（`im`、`comfyui`、`remote`…），未选中的行会写成
  `disabled: true`，维护的是 profile `cordis.patch.yml` 里一段带标记的块，不动用户其它内容。
- `--dry-run` 先预览；`--json` 输出机器可读结果。
- 然后 `set_bundle target="dsh-scher" enabled=true`。

## 5. 验证并汇报

- `list_plugins` 确认 `dsh-scher` 的 10 行里，用户要的是 `active`、不要的是 `disabled`。
- 汇报格式：装了哪些（含版本）、跳过了哪些、**每个已装模块的外部前提**（SSH 主机、ComfyUI
  服务、IM 凭据、仅 Windows 的闪烁）以及重启/刷新要求。
- 不要声称用户已经测试过功能；只报告「已安装、已启用、需要用户自己确认的项」。
- **启用时报 `Cannot find package '@deepseek-ai/dsh-settings'` 之类的 import 错误**（常见于同一台
  机器上刚从本地 `link:` 安装切换到 GitHub 安装）：包其实已经装好，只是正在运行的进程还缓存着
  旧安装的模块路径（`better-sidebar`、`dsh-remote` 最容易中招）。让用户**完全退出并重新打开
  DSH 应用**，重启后这 10 行会从新副本正常加载；重启后再用 `list_plugins` 复核一次即可。

## 附：模块与行 id 对照

| 模块 id | Loader 行 id | 包名 |
| --- | --- | --- |
| `color-style` | `color-style` | `dsh-color-style` |
| `ws-recency` | `ws-recency` | `dsh-ws-recency` |
| `better-sidebar` | `better-sidebar` | `dsh-better-sidebar` |
| `remote` | `dsh-remote` | `dsh-remote` |
| `countdown` | `dsh-offwork-countdown` | `dsh-offwork-countdown` |
| `system-monitor` | `system-monitor` | `dsh-system-monitor` |
| `global-todo` | `global-todo` | `dsh-global-todo` |
| `im` | `xmanrui-dsh-im` | `@xmanrui/dsh-im` |
| `feishu-notify` | `feishu-notify` | `dsh-feishu-notify` |
| `comfyui` | `comfyui-workspace` | `dsh-comfyui-workspace` |
