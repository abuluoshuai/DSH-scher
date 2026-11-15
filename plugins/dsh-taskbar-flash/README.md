# dsh-taskbar-flash

会话跑完一轮、而 DSH 桌面窗口不在前台时，闪烁 Windows 任务栏上的 DSH 图标提醒你。
窗口一旦被激活闪烁就停止；你正看着屏幕（窗口在前台）时回复到达不会打扰；
子代理的完成默认不算「会话完成」，也不会闪烁。

这是一个 Host-only 插件：没有客户端模块、没有界面、不注册工具、不读写会话内容。

## 为什么是插件 + Win32

任务栏按钮属于 Electron 主进程的窗口，Host 插件不能直接碰它；但 Host 进程是桌面应用
主进程的直接子进程，所以插件在收到「会话完成」事件后，调用一个随包附带的小
PowerShell 脚本：

1. 用 `process.ppid`（Electron 主进程）枚举该进程的顶层可见窗口，拿到任务栏窗口句柄；
2. 若该窗口已是前台窗口则直接跳过；
3. 否则调用 Win32 `FlashWindowEx`（`FLASHW_ALL | FLASHW_TIMERNOFG`），由系统做标准
   的任务栏闪烁，直到窗口被激活。

不修改 DSH 安装目录、不依赖 Electron 内部 IPC，所以 DSH 升级不会把功能冲掉。

## 触发条件

- 一个 **根会话** 的 Agent 状态从 `running` 变为 `idle`（即一轮真的跑完：正常结束、
  报错或中断都算）；
- 子代理（subagent）的 idle 默认忽略；
- 冷却窗口（默认 1.5 秒）内的多次完成合并成一次闪烁；
- 窗口在前台时只写日志、不闪烁。

## 配置

`profile/cordis.patch.yml` 按行 id `taskbar-flash` 覆盖（`config` 整体替换）：

```yaml
- id: taskbar-flash
  config:
    enabled: true
    ignoreSubagents: true
    onlyWhenUnfocused: true
    flashCount: 0
    cooldownMs: 1500
    processName: DeepSeek Harness
    powerShellCommand: powershell.exe
    log: true
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `ignoreSubagents` | `true` | 忽略子代理会话的完成 |
| `onlyWhenUnfocused` | `true` | 窗口在前台时不闪（只写日志） |
| `flashCount` | `0` | `0` = 一直闪到窗口被激活；`1..99` = 闪固定次数 |
| `cooldownMs` | `1500` | 合并连续完成事件的窗口 |
| `processName` | `DeepSeek Harness` | 仅用于手动排查时辨认进程，脚本按 PID 找窗口 |
| `powerShellCommand` | `powershell.exe` | PowerShell 可执行文件名或路径 |
| `log` | `true` | 把加载/完成/闪烁结果写入 `$DSH_HOME/taskbar-flash/attention.log` |

## 排查

- 日志：`~/.dsh/taskbar-flash/attention.log`（超过 256 KiB 轮转为 `.1`）。每次完成会记一行
  `completion detected ...`，随后一行 `flash skip/flash ...` 说明结果；
  `reason: no-window` 表示按 `process.ppid` 找不到窗口（例如 Host 不是由桌面应用启动的）。
- 手动测试闪烁（不经过会话事件）：

  ```powershell
  $main = Get-Process -Name 'DeepSeek Harness' | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  powershell -NoProfile -ExecutionPolicy Bypass -File "<插件目录>\scripts\flash-window.ps1" -ParentPid $main.Id -Force
  ```

- Windows 的「通知和操作」里如果关闭了任务栏闪烁，系统会忽略该请求；这是系统设置，不是
  插件能绕过的。

## 限制

- 只在 Windows 上实现（macOS 的任务栏对应 Dock 弹跳，需要另一套实现）；
- 依赖系统 PowerShell（Windows 自带 5.1 即可）；
- 会话在窗口被最小化到托盘/隐藏时没有任务栏按钮，闪烁不可见；
- 完成事件由 Host 进程产生：如果 Host 已经退出，之后才结束的工作不会再有提醒。
