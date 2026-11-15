# dsh-system-monitor

DSH 插件：在输入框下方的 dock 里用四根进度条显示当前会话所在主机的
**CPU 利用率、内存占用、显卡利用率、显存占用**。

```
CPU ▬▬ MEM ▬▬ GPU ▬▬ VRAM ▬▬
```

- 数据在 **DSH Host 进程**里采集，所以本地启动的 Harness 和部署在远程服务器上的
  Harness 显示的都是会话真正所在的那台机器——不是放着浏览器窗口的那台。
- 支持 **Windows / macOS / Linux**；显卡采集覆盖 **NVIDIA（nvidia-smi）**、
  **AMD（Linux amdgpu sysfs）**、**Apple（ioreg IOAccelerator 的
  Device Utilization 与 In use system memory）**。
- 数字默认收起（dock 一行还要放宿主自己的胶囊），**点一下展开并记住选择**；
  悬停的 title 里始终有精确读数、主机名、运行时间与负载。
- 颜色、字号、圆角全部走宿主主题 token，亮/暗色自动跟随；文案走 Client locale。

## 安装

本仓库就是这个插件包（`package.json` 里声明了 `dsh.bundle.patch`）。整包只依赖
Node 内置模块，没有构建步骤。

- GUI：**插件** → **添加插件** → 选中本目录；或用 `plugin_manager` 的
  `install_bundle` 指向本目录。

安装后它出现在 **插件** 列表里，dock 上的读数在新开 / 刷新后的会话里出现。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖（只写要改的字段即可）：

```yaml
- id: system-monitor
  name: dsh-system-monitor
  config:
    intervalMs: 2000      # 浏览器轮询间隔，500..60000
    gpuCacheMs: 1500      # 复用一次 GPU 采集结果的时长
    cacheMs: 1000         # Host 快照缓存（多个标签页时省掉重复采集）
    gpuIndex: all         # all = 汇总所有显卡；给数字则只看那一块
    commandTimeoutMs: 3000
```

坏值不会让插件消失：每个字段都会退回默认值，并在日志里留一行说明。

## 采集方式

| 指标 | 来源 |
| --- | --- |
| CPU | `os.cpus()` 的累计 tick，两次采样之间算差值 |
| 内存 | Linux `/proc/meminfo`（MemTotal − MemAvailable）、macOS `vm_stat`（active + wired + compressed）、其他 `os.totalmem()` − `os.freemem()` |
| 显卡 | 依次尝试 `nvidia-smi`（Windows/Linux/macOS 旧驱动）、macOS `ioreg -c IOAccelerator`、macOS `system_profiler SPDisplaysDataType`、Linux amdgpu sysfs |
| 显存 | 同上；Apple 芯片是统一内存，所以「显存总量」取系统内存总量 |

多卡时：利用率取最大值，显存取合计。

已知限制：

- 非 NVIDIA 的 Windows 显卡目前没有可靠的免权限采集方式，GPU / 显存两格会显示
  为不可用（进度条压暗、数值为 —），其余三项正常。
- macOS 的 Apple 芯片没有独立的显存池，显存取的是统一内存口径。
- 采集只读：不写文件、不联网、不注册 agent 工具。

## 接口

Host 半边挂了一个只读路由，供本插件的面板轮询：

- `GET /api/system-monitor/snapshot` — 一次快照
- `GET /api/system-monitor/ping` — 版本与平台

两个接口都先过 Connection 的信任判定；Connection 不在该 profile 里时只放行本机
回环请求。返回值形如：

```json
{
  "at": 1763000000000,
  "intervalMs": 2000,
  "platform": "win32",
  "host": { "name": "DESKTOP", "arch": "x64", "cores": 16, "cpuModel": "...", "uptimeMs": 123456 },
  "cpu": { "usage": 0.42, "load": null },
  "memory": { "used": 123, "total": 456, "source": "os" },
  "gpu": {
    "name": "NVIDIA GeForce RTX 5060 Ti",
    "vendor": "nvidia",
    "driver": "617.42",
    "utilization": 0.12,
    "memory": { "used": 1234, "total": 16311 },
    "source": "nvidia-smi"
  },
  "gpuError": null
}
```

## 开发

```sh
npm test                   # 解析器单元测试 + 路由围栏 + 本机真实采样
node --check client.js
```

`lib/` 是 Host 半边（采样 + 路由），`client.js` 是唯一的浏览器模块，直接由宿主
的模块加载器执行，不需要打包。

## 许可

MIT
