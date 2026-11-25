# 群机器人 Webhook

群管理员在「成员与设置 → 群机器人」安装机器人。每次安装绑定一个群，生成独立的推送地址、Token 和机器人用户名。安装或轮换时复制凭证，之后可暂停、恢复或移除机器人。

已有数据库在部署 Worker 前应用 `migrations/0003_group_chat_bots.sql`。新库通过 `schema.sql` 初始化。要启用双向回调，在 Worker 设置随机签名密钥 `CHAT_BOT_WEBHOOK_KEY`，并在 `CHAT_BOT_WEBHOOK_ORIGINS` 列出允许的 HTTPS 源，以逗号分隔。填写回调时使用这些源下的地址。回调必须直接接收 POST，重定向会视为投递失败。

## 推送到群聊

```sh
curl "$PUSH_URL" \
  -H "Authorization: Bearer $PUSH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: service-up-42" \
  --data '{"text":"备份已完成"}'
```

响应包含 `message_id` 和 `group_id`。相同的幂等键重发相同文本会返回原消息 ID。每个机器人每分钟最多发送 30 条文本。

## 接收和回复指令

安装时填写回调地址和指令名，例如 `status`。群成员发出 `@bot_… /status api` 时，尽欢向回调发送 `type` 为 `chat.command` 的 JSON，其他字段包括 `event_id`、`installation_id`、`group_id`、`message_id`、`bot_username`、`sender_id`、`sender_username`、`command`、`args` 和 `created_at`。

接收端用签名密钥字符串的 UTF-8 字节，对 `X-Jinhuan-Timestamp + "." + 原始请求正文` 计算 HMAC-SHA256。对比十六进制结果和 `X-Jinhuan-Signature` 中 `sha256=` 后的值，并核对时间窗口。拿到已验证的 `sender_id` 后，可以按指令检查调用者权限。

接收后尽快返回 2xx。失败会重试，按 `event_id` 去重。用同一安装的推送地址发送 `{"text":"API 正常","reply_event_id":"收到的事件 ID"}`，消息会引用触发指令的原消息。每个事件接收一条机器人回复，重试返回原回复 ID。
