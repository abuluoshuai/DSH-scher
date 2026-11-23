# dsh-offwork-countdown

> 下班倒计时 — 一枚安静的小胶囊，告诉你今天还剩多久。

DeepSeek Harness（dsh）Web 界面插件：在输入框下方常驻一枚倒计时胶囊，工作日数到下班，到点自动变成加班计时。

## 它做什么

- **工作日倒计时**：默认 `09:00 → 18:00`，胶囊显示 `距离下班 08:24:00`，右侧一条细进度条表示今天从上班走到现在走了多远。
- **到点切换**：下班时间一到，文案先跳成「下班啦」，随后变成加班计时（`已下班 00:03:12`），小圆点轻轻呼吸一下。
- **下班烟花**：下班时间一到，**先闪任务栏**；如果你不在 DSH 前面，烟花会挂起，等你点击 DSH / 把它切回前台再放（默认整窗、10 秒、密度「多」）。范围 / 密度 / 时长 / **样式**都能在设置里调，并带一个「预览烟花」按钮随时试放。
- **周末**：周六周日只显示「周末快乐」，不倒数。
- **改时间**：点胶囊弹出居中设置框，改上班 / 下班时间即时生效。
- **跟随主题**：只使用 dsh 主题 token（`--dsw-alias-*`），亮色暗色自动适配；文案走 Client locale 服务，中英双语。
- **尊重减少动效**：`prefers-reduced-motion` 下关掉呼吸与进度条过渡。

## 安装

```sh
dsh plugin --profile web add github:ZydFirst/dsh-offwork-countdown
```

装完刷新一次页面。

## 使用

设置默认是 `09:00 – 18:00`。点输入框下方那枚胶囊，弹出设置框：

- 上班时间 / 下班时间：点时间按钮打开两列列表（小时 `00–23`、分钟 `00–59`，滚到两端即止、**不循环**）；点小时保持展开，**点分钟立即更新并收起**；改完点「保存」；「恢复默认」回到 `09:00 – 18:00`。
- Esc、点遮罩、「取消」都可以关掉设置框。

设置保存在 **Host 侧**的 `$DSH_HOME/offwork-countdown/settings.json`（`DSH_HOME` 默认 `~/.dsh`）——插件升级、DSH 重启换端口都不会重置。浏览器 `localStorage`（键名 `dsh.offwork-countdown.settings.v1`）只作为 Host 路由不可用时的兜底副本；不上传、不写会话日志。

## 下班烟花

工作日走到下班时间的那一刻，**先让任务栏图标闪烁**（即使 DSH 在后台也闪，任务栏会一直提示直到你把窗口切回来）；
**只有 DSH 回到前台时**才放烟花——在后台时动画挂起，等你点击 DSH 或把它切回前台再播放，
避免「放完才发现错过了」。默认整窗、10 秒、密度「多」；**每个到点事件**只自动放一次
（同一天改了下班时间、到了新的点，会再放一次）。到点判断由 **Host 侧独立定时**完成，页面在后台被
Chromium 节流也不会漏。系统开启「减少动态效果」时只闪任务栏、不放动画。
烟花播放时是一层透明的全窗口 canvas（`pointer-events: none`），不挡点击、不挡输入，结束后自动移除。

点胶囊 →「下班烟花」组里可以调：

- **到点放烟花**：开 / 关（关掉后只保留手动预览）；
- **范围**：整窗 / 对话区；
- **密度**：少 / 标准 / 多 / 爆量（粒子总量有上限，避免高密度掉帧）；
- **持续时间**：3 / 6 / 10 / 15 秒；
- **样式**：经典爆裂 / 心形 / 五角星 / 圆环 / 双环 / 柳枝 / 螺旋 / 笑脸 / 随机混合（每一发随机挑一个）；「预览烟花」直接用当前选中的样式；
- **预览烟花**：随时试放一次，不占用当天的自动播放次数。

实现：`client.js` 内手绘 canvas（`requestAnimationFrame` + 重力/摩擦/拖尾），无第三方依赖、无声音；
带形状的烟花用参数化轮廓（心形曲线、五角星多边形、圆/双环、螺旋臂、笑脸圆弧）生成粒子目标点，
爆开后先「定格」成形状再自然散开；柳枝用高重力长寿命做下垂长尾。
颜色是固定的霓虹色盘，不跟随宿主主题 token。任务栏闪烁由 Host 侧调用 PowerShell + Win32 `FlashWindowEx` 完成
（仅 Windows，失败静默），所以页面在后台时也能提示你。

## 实现

纯 JavaScript，无构建步骤，无运行时依赖：

- `client.js` 通过 `window.__ModuleLoader__` 注册两个槽位：`conversation.composer.dock`（倒计时胶囊）与 `shell.overlay`（设置框，浮在所有列之上，不会被输入框卡片盖住）。
- 两个槽位共用一个极小的模块级 store；胶囊只有一颗 1 秒的时钟，卸载时随 `ctx.effect` 清掉。
- `index.js` 是 Host 半边：把设置持久化到 `$DSH_HOME/offwork-countdown/settings.json`（原子写入），
  并提供 `/api/offwork-countdown/settings` 与 `/api/offwork-countdown/flash` 两个路由；`lib/flash.js` +
  `scripts/flash-window.ps1` 负责 Windows 任务栏闪烁。没有 Host 路由时客户端退回 `localStorage`。

## 开发

```sh
python scripts/make-icon.py    # 重新生成 assets/icon-256.png（Pillow + numpy）
```

目录结构：

```
client.js            浏览器侧：槽位注册、倒计时组件、设置对话框
index.js             Host 侧：设置持久化 + 任务栏闪烁路由
lib/flash.js         任务栏闪烁（PowerShell + FlashWindowEx）
scripts/flash-window.ps1  Win32 闪烁 helper
cordis.patch.yml     bundle patch
locale/{zh,en}.json  插件清单里的标题与描述
icon.svg             插件图标
assets/icon-256.png  市场卡片用的位图图标
```

## License

MIT © ZydFirst

---

## English

An off-work countdown for the DeepSeek Harness Web UI. A pill under the message composer counts down to the end of the workday (default 09:00–18:00), with a thin progress bar for the day so far. When the end time arrives it switches to an overtime timer, asks the desktop window to flash its taskbar button, and plays a fireworks animation across the DSH window — but only once the window is in the foreground: while DSH is in the background the animation waits for you instead of playing unseen. Scope, density, duration and the firework **style** (classic burst / heart / star / ring / double ring / willow / spiral / smiley / mixed) are configurable in the pill's settings dialog, which also has a preview button that uses the style currently selected. Weekends just say "Weekend". Settings are stored in `$DSH_HOME/offwork-countdown/settings.json` on the Host side (so plugin updates and Host restarts do not reset them); the browser's `localStorage` is only a fallback copy. Nothing leaves the machine.

```sh
dsh plugin --profile web add github:ZydFirst/dsh-offwork-countdown
```

Plain JavaScript, no build step, no runtime dependencies. The client registers a `conversation.composer.dock` entry (the pill) and a `shell.overlay` entry (the settings dialog); colors come from `--dsw-alias-*` theme tokens only, and all visible text goes through the Client locale service (zh/en).
