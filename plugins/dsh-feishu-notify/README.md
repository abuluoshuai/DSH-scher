# dsh-feishu-notify

在**本机任意根会话完成一轮**时，通过飞书把结果推送给机器人 owner：

- **会话名称** —— 最新 `session/title` 事件；还没有标题时取首条用户输入的前 40 字；
- **用户输入** —— 刚完成这一轮的用户消息原文；
- **结果** —— 这一轮最终助手消息的正文，保留 markdown，用**飞书卡片 2.0 的 `markdown` 组件**渲染。

## 飞书渲染

飞书卡片 1.0 的 `lark_md` 只支持内联子集，标题/表格会显示成源码；本模块改用卡片 JSON 2.0：

- 标题、列表、引用、行内代码、**表格**都能正常渲染；
- 单个 `markdown` 组件最多 4 张表，长正文会自动拆成多个组件（表格不会被切断）；
- 2.0 不渲染代码围栏，代码块转成引用块里的行内代码；
- 遇到拒绝 2.0 的旧客户端时，自动退回卡片 1.0 的 `lark_md` 并把表格压平成列表。

## 依赖

复用 **dsh-im** 里已经配好的飞书机器人，不需要单独填 appId / secret：

- appId / secretRef / domain / owner open_id 来自 `$DSH_HOME/integrations/dsh-feishu*/config.json`；
- app secret 从 DSH 的凭据存储里按 `secretRef` 读取；
- 默认接收人 = 机器人 `ownerOpenIds[0]`；也可以用 `receiveIdType` + `receiveId` 指定 chat_id。

没有装 dsh-im 或没配飞书机器人时，插件只会在日志里 `skip: no Feishu bot configured`，不影响 DSH。

## 配置（`cordis.patch.yml` 的行 `feishu-notify`）

```yaml
- id: feishu-notify
  config:
    enabled: true            # 总开关
    ignoreSubagents: true    # 忽略子代理会话的回合完成
    botId: ''                # 空 = 用第一个可用的飞书机器人
    receiveIdType: open_id   # open_id | chat_id
    receiveId: ''            # 空 = 机器人 owner 的 open_id
    maxChars: 8000           # 卡片正文上限，超出截断并注明
    log: true                # 写 Host 日志
```

## 多台个人电脑

模块随 Scher 仓库分发，代码里不包含任何 bot 凭据或个人 open_id：

1. 每台电脑安装 Scher 并启用 `feishu-notify` 模块（依赖同机的 `dsh-im` 模块）；
2. 在各自的 dsh-im 里登录/配置飞书机器人（owner/接收人随之确定）；
3. 如果要把推送发到同一个群，可以在该机器的行配置里填 `receiveIdType: chat_id` 和 `receiveId`。

生产机器如果不需要（例如外网受限），安装时跳过该模块或在 Plugins 页停用它即可。

## 说明

- 串行队列发送、token 进程内缓存（提前 60 秒刷新），失败只记警告日志、不打断会话；
- 只监听**根会话**（`ignoreSubagents: true` 时子代理完成不会推送）；
- 消息内容仅来自会话日志，不写回 dsh-im 的任何状态。

## License

MIT
