# DSH-comfyui-workspace

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的 ComfyUI 工作流面板：**不开浏览器**，把 ComfyUI 工作流导入成一张张节点卡片，改好参数直接开跑，跑完把这一次的参数和随机种子归档。

第一期只支持 Qwen-Image 2.1 的文生图 / 图生图，随仓库带两个示例工作流（`workflow/文生图.json`、`workflow/图生图.json`）。

```
侧边栏图标 → 中央面板
┌──────────────────────────────────────────────────────────┐
│ ComfyUI 工作台   导入工作流  归档  设置   ● ComfyUI 0.41.3 │
│ [文生图] [图生图] [+]                       隐藏未启用     │
├──────────────────────────────────────────────────────────┤
│ ╭ 分辨率 #512 ................ ●  ╮                      │
│ │ aspect_ratio [9:16 ▾]  megapixels [1.5]  multiple [32] │
│ ╰───────────────────────────────────────────────────────╯ │
│ ╭ 提示词 #517 ................ ●  ╮   ← 大文本框          │
│ │ ██████████████████████████████████████ │               │
│ ╰───────────────────────────────────────────────────────╯ │
│ ╭ 主模型 UNET #523 ........... ●  ╮   ← 红框=服务器没有    │
│ │ unet_name [qwen_image_2.1_int8_convrot ▾]              │
│ ╰───────────────────────────────────────────────────────╯ │
│ …（每个节点一张卡片，从上到下）                            │
│ ╭ 保存位置 #__save__ ........ ╮  ← 本插件自定义，不是节点  │
│ │ 服务器目录 [runs/]   本地目录 [/home/me/out] [浏览]      │
│ ╰───────────────────────────────────────────────────────╯ │
├──────────────────────────────────────────────────────────┤
│ [运行] [停止] ▓▓▓▓░░░░  运行中 · 节点 #515 · 已用 23.1s   │
└──────────────────────────────────────────────────────────┘
```

## 它做什么

- **导入工作流**：选 ComfyUI 导出的「工作流」JSON（`{nodes, links, ...}`）。导入后多一个标签页，名字可以双击改。
- **卡片式参数**：工作流里每个节点 = 一张卡片，按图的执行顺序从上到下排列。七种卡片（每种一个底色 + 左侧色条，边框仍只表示状态：绿=正在跑、红=服务器不支持、灰=未启用）：
  | 卡片 | 底色 | 对应节点 | 长什么样 |
  | --- | --- | --- | --- |
  | 提示词 | 墨绿 | `PrimitiveStringMultiline` / `CLIPTextEncode` 等 | 固定高度的大文本框，自动换行、超出滚动，默认填入工作流里的提示词 |
  | 文件输入 | 蓝 | `LoadImage` / `LoadVideo` / `LoadAudio` | 「+」按钮选本地文件，上传到服务器 input/；图片显示缩略图，视频显示首帧，音频显示波形图标 |
  | 主模型 | 橙 | `UNETLoader` / `CheckpointLoader` | 下拉框，选项来自服务器；服务器没有这个模型时**边框变红** |
  | 小模型 | 紫 | `LoraLoader` / `VAELoader` / `CLIPLoader` / `ControlNetLoader` … | 同样是模型下拉框；不支持时红框 |
  | 输出 | 天蓝 | `SaveImage` / `PreviewImage` / `VHS_VideoCombine` … | 跑完在这里预览：图片/视频/音频，音频带波形 + 时间进度条 + 播放键 |
  | 保存位置 | 灰 | 不对应节点，本插件自定义 | 一处管理所有保存目标：统一的服务器子目录、**每个保存节点各自的相对目录**（`#31 LazyVideoSave → z视频/z`）、本地下载目录（带目录选择器，和「打开」按钮——直接在资源管理器里打开那个目录，目录还不存在就先建好） |
  | 一般 | 米黄 | 其余有参数的节点 | 多列网格列出参数，默认值取自工作流 JSON |

  底色是一层半透明色罩在主题表面上：浅色主题下是淡色、深色主题下是深色，文字对比度沿用主题自己的，两种主题都读得清。
- **运行 / 停止**：运行后持续向服务器取当前状态，**正在跑的节点边框变绿**，已完成的节点淡绿边。停止 = 中断执行 + 移出队列，并把已有的半成品归档。
- **底部占用条**：常驻显示当前服务器的显存与内存占用——`显存 [████░░] 13.2/15.9G 83%`，占用部分绿色填充，超过 90%（显存）/ 92%（内存）转警示色；比当前低时旁边补一个 `峰 92%`（最近 44 个采样的峰值）。数据来自 ComfyUI 核心端点 `GET /system_stats`，每 2 秒一次、只在面板打开时采，单请求在途合并。用 `--cuda-malloc` 时 `torch_vram_*` 不可信，这里用整卡口径的 `vram_free`。悬停能看到精确 GB、百分比、服务器名和上次读取失败的原因。
- **释放显存**：底栏一个按钮，调 ComfyUI 自己的 `POST /free`（等同菜单里的 "Free model and node cache"）——卸载模型 + 清空分配器缓存，把显存还给系统，跑完后提示释放了多少 GB。不删任何文件，下次运行重新加载（会慢几秒）。运行中按钮禁用：正在执行的 prompt 底下抽走模型只会把它搞坏。
- **提示音**：跑完（成功或失败）在面板里放两声不同的短音，**不弹窗**，不抢焦点；可在设置里关掉。
- **归档**：每次结束自动存下这一趟实际发出的参数、解析后的随机种子、产出文件、耗时与成败。面板右上「归档」里可以逐条查看、**套用参数**回当前标签页、或**换种子重跑**。
- **Agent 工具**：Agent 也能跑（`comfy_workspace_run` 等），和面板走同一套实现，参数校验、失败原因、归档完全一致。所以你可以说「用文生图，提示词换成一只猫，跑一张」。

## 安装

在 DSH 里让 Agent 安装本地目录（会写 profile 的 patch）：

```
plugin_manager: action=install_bundle, target=<这个仓库的绝对路径>
```

装完**刷新一下网页**（新的 Client 模块要重新加载才会出现侧边栏图标）。装了之后侧边栏会多一个图标，点开就是面板。

手工装的话，本包是一个标准 bundle：`package.json` 里 `dsh.bundle.patch` 指向 `cordis.patch.yml`，插入一行 `comfyui-workspace`。

## 服务器设置

面板右上「设置」：可以配**多台** ComfyUI，每台一份地址/账号/密码/请求头，单选「使用中」或从顶栏下拉切换。切换后模型列表与运行都走那一台。

| 字段 | 说明 |
| --- | --- |
| 名字 | 顶栏下拉里显示的名字，随便起 |
| 服务器地址 | `127.0.0.1:8188`、`192.168.1.9:8188`、`https://gpu.example.com/comfy` 都行。没写协议补 `http://`，没写端口补 `8188`；写了 `https` 不再补端口（反代的 443 才是对的）。路径前缀保留，子目录部署能用 |
| 用户名 / 密码 | HTTP Basic 认证。密码按服务器分别存在 DSH 的凭据服务里（`comfyui-workspace:server:<id>`），`settings.json` 只记「有没有」；没有凭据服务的精简组合才退回存文件。留空 = 不修改，另有「清除密码」 |
| 额外请求头 | 一行一个 `Name: Value`，给反向代理或 API Token 用 |
| 测试 | 每台单独测，测的是**你当前输入框里的值**（未保存也能测），显示 ComfyUI 版本、延迟、显卡显存 |

> 面板接口只接受两类请求：宿主连接围栏放行的，或者**直连本机回环**的（带 `X-Forwarded-For` 的转发请求不算直连）。围栏本身会按浏览器的实时 peer 鉴权，偶发拒绝时这会兜住——本地进程本来就能读这个 profile 的文件，不该被自己的面板挡在外面。

## 卡片上的约定

- **启用开关**（卡片右上角「日」字形）：关掉这张卡片，这一趟就不提交这个节点，连到它的线也一起断开（如果那条线是某个控件的输入，控件回退到节点自己带的值）。
- **旁路，不是删除**：关掉的节点按 ComfyUI 的 Bypass 语义处理——同类型的输入直通下游。所以关掉 LoRA、TE 加速这类 MODEL→MODEL 的节点，KSampler 仍然接得到加载器；静音（Ctrl+M）的节点没有输出可直通，那时才会缺输入并给出警告。
- **保存节点也算卡片**：`SaveImage`、`VHS_VideoCombine`，以及自定义的保存节点（如 `LazyVideoSave`，它的目标参数叫 `文件名`，值形如 `z视频/z`）都归到「输出」卡片——位置不变，卡片负责**预览它写出来的东西**；它保存到哪，则统一收进最下面的「保存位置」卡片，一行一个节点。实际写盘路径 = 统一服务器子目录 + 节点的相对目录（`runs/z视频/z`）。
- **隐藏卡片**（卡片右上角的眼睛）：只是从堆叠里收起来，**节点仍然启用、仍然按保存的参数运行**——适合把长期不动的节点藏掉。点标签栏右边「显示全部」就能看到，隐藏的卡片带「已隐藏」角标。
- **刷新节点信息**（标签栏右边的 ⟳）：卡片里的模型下拉是打开工作流时读的服务器 `/object_info`；服务器换了模型列表后点它重读，红框会消失。
- **打开本地目录**（保存位置卡片里「浏览」旁边）：浏览器自己打不开资源管理器，这个按钮走 Host 用 `explorer.exe` / `open` / `xdg-open` 打开你填的目录；目录还不存在就先创建再打开（下载目标本来就该先有）。
- **锁住的字段**：值由连线提供的字段（比如 `KSampler.seed` 由「随机种子」节点给）显示为只读，并标出 `由节点 #524 提供`。
- **种子**：带种子的字段旁边有 🎲 和「每次随机」。运行前由面板解析成一个具体整数再发出去，**所以归档里存的一定是真实用过的那个种子**，可以复现。
- **`%date:…%`**：ComfyUI 的这个占位符是**前端**展开的，走 API 不会自动展开。本插件在提交前按同一套 SimpleDateFormat 规则展开（`yyyy MM dd hh mm ss SSS` 等），所以文件名、保存目录里的日期和浏览器里跑出来一致。
- **红框**：这个值不在服务器给的可选列表里（模型、采样器、分辨率比例都算）。仍然可以跑，服务器会给出准确原因。

## Agent 工具

| 工具 | 用途 |
| --- | --- |
| `comfy_workspace_workflows` | 列出已导入的工作流（名字 / id / 节点数） |
| `comfy_workspace_workflow` | 看一个工作流的全部卡片、字段当前值与可选值、服务器不支持的项 |
| `comfy_workspace_run` | 跑：`workflow` + 可选 `prompt` / `seed` / `randomSeed` / `params`（按节点 id 覆盖字段）/ `saveSubfolder` / `localDir` / `wait` |
| `comfy_workspace_status` | 在跑哪个节点、进度、队列、上次结论、服务器版本与显存 |
| `comfy_workspace_stop` | 中断 + 出队 + 归档 |
| `comfy_workspace_archive` | `list` / `get` / `rerun(换新种子)` |
| `comfy_workspace_server` | `list` 列服务器 / `select` 切服务器 / `test` 测连通 / `models` 列某类模型文件名 / `free` 释放显存 |

`toolGroups: none` 可以整组关掉，`core` 只留前四个。

## 数据放在哪

`$DSH_HOME/comfyui-workspace/`（默认 `C:\Users\<你>\.dsh\comfyui-workspace\`）：

| 文件 | 内容 |
| --- | --- |
| `settings.json` | 服务器地址、用户名、请求头、面板偏好（密码不在里面） |
| `workflows.json` | 导入的工作流原文 + 每个节点的启用状态与参数 |
| `archive.json` | 每次运行的参数、种子、产出文件清单，默认每个工作流留 200 条 |
| `debug.client.log` | 面板上报的浏览器端事件（启动、点设置、渲染异常），排障用，超过 96KB 只留后半段 |

三个数据文件都是原子写（临时文件 + rename），按文件串行化，UI 点击和 Agent 调用同时改也不会写出半个 JSON。

## 配置（`cordis.patch.yml`）

```yaml
- id: comfyui-workspace
  name: 'dsh-comfyui-workspace'
  config:
    home: ''                       # 空 = $DSH_HOME/comfyui-workspace
    server:
      url: 'http://127.0.0.1:8188' # 面板里保存过的值优先
      username: ''
      password: ''                 # 建议用面板填（走凭据服务）
      headers: {}
    archiveLimit: 200              # 每个工作流留多少条归档
    downloadOutputs: true          # 跑完把产出下到「本地目录」
    toolGroups: all                # all / core / none
    guidance: true                 # 是否给模型注入用法提示
```

> 覆盖 `config` 是**整体替换**，不是深合并：想改一个字段就把整段重写一遍。

## 已知限制

- 只吃 ComfyUI 的**界面工作流 JSON**（`{nodes, links}`），不吃 API 格式（`{id: {class_type}}`）。导入时会检查并说明。
- 卡片造型依赖一张节点类名表（`lib/workflow.js` 的 `CLASS_TABLE`），表里没有的类按「一般卡片」处理，并根据控件名推断是模型卡还是文件卡。装了新的自定义节点包不必改代码，只是卡片不会自动变成专门造型。
- 同一时间只跑一个任务。两个并发运行要在同一套卡片边框上表达「谁在跑」，那是骗人的。
- 输出卡片预览的是服务器上的文件（经插件路由代理，带 Basic 认证），不写进会话附件。

## 开发

```bash
node --test "test/*.test.mjs"     # 纯 Node，无依赖
# 面板渲染测试需要一个含 react / react-dom / jsdom 的 node_modules：
DSH_PANEL_TEST_DEPS=C:\path\to\workspace node --test test/panel.test.mjs
node scripts/seed.mjs             # 把仓库里两个示例工作流导入本地工作台
```

`lib/` 是纯 ESM，没有构建步骤：`index.js`（挂载）、`app.js`（面板和工具共用的操作）、`routes.js`（HTTP）、`tools.js`（Agent 工具）、`runner.js`（一次运行的完整生命周期）、`workflow.js`（工作流 → 卡片 → API prompt）、`comfy.js`（ComfyUI 客户端）、`store.js`（持久化）、`client.js`（浏览器面板）。

## English

A ComfyUI workflow panel for DeepSeek Harness. Import a workflow JSON, get one card per node in execution order (prompt / file input / main model / sub-model / output / save location / general), run it over the ComfyUI HTTP+WebSocket API, watch the running node's border turn green, and keep every run's parameters and resolved seed in an archive you can re-apply or re-run. The agent gets the same operations as tools (`comfy_workspace_*`), backed by one implementation. Install the directory as a bundle, refresh the page, then click the sidebar icon.

MIT licensed.
