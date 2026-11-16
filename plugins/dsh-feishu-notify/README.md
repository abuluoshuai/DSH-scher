# dsh-feishu-notify

在**本机任意根会话完成一轮**时，通过飞书把结果推送给机器人 owner：

- **会话名称** —— 最新 `session/title` 事件；还没有标题时取首条用户输入的前 40 字；
- **用户输入** —— 刚完成这一轮的用户消息原文；
- **结果** —— 这一轮最终助手消息的正文，原样保留 markdown（以飞书卡片 `lark_md` 渲染）。

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

## 说明

- 串行队列发送、token 进程内缓存（提前 60 秒刷新），失败只记警告日志、不打断会话；
- 只监听**根会话**（`ignoreSubagents: true` 时子代理完成不会推送）；
- 消息内容仅来自会话日志，不写回 dsh-im 的任何状态。

## License

MIT
