# 群机器人 Webhook

群成员可以在「成员与设置 → 群机器人」登记命令和回调。每个群使用一个机器人身份，每份配置有自己的推送令牌、回调签名和维护者。群成员可以查看命令、描述和维护者。维护者本人可以编辑、暂停、删除、轮换凭证和查看投递记录。

登记时每行填写一个命令及其描述，例如 `/status 查询服务状态`。同群命令名唯一，命令大小写等同。群里发送 `/help` 可查看已启用的命令和描述。群管可以在群机器人设置中填写站内帖子链接，群里发送 `/doc` 即可打开该帖。

已有数据库需依次应用未执行的迁移，包括 `migrations/0222_unified_chat_bots.sql`。新库通过 `schema.sql` 初始化。启用回调时，配置随机签名密钥 `CHAT_BOT_WEBHOOK_KEY` 和站点允许的回调地址。回调必须直接接收 POST，重定向会视为投递失败。

## 推送到群聊

在自己的配置中复制推送地址和令牌。

```sh
curl "$PUSH_URL" \
  -H "Authorization: Bearer $PUSH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: service-up-42" \
  --data '{"text":"备份已完成"}'
```

响应包含 `message_id` 和 `group_id`。相同的幂等键重发相同内容时返回原消息 ID。群内机器人每分钟最多发送 30 条消息。

登记后可以把推送地址末尾的 `/messages` 换成 `/status` 检查所属群和权限。勾选图库读取权限后，可以用同一个令牌调用同一安装路径下的 `/gallery/days` 和 `/gallery/memes`，沿用站内图库的查询参数及维护者的可见范围。

### 推送图片和视频

把推送地址末尾的 `/messages` 换成 `/uploads`，用同一个令牌上传附件。

```sh
curl "$UPLOAD_URL" \
  -H "Authorization: Bearer $PUSH_TOKEN" \
  -F 'file=@photo.jpg' \
  -F 'nonce=unique-upload-operation-42'
```

每个文件最大 20 MiB。把返回的 `key` 放进推送请求的 `media` 数组。每条消息最多 12 个附件，正文可留空。视频封面也需要上传，并把封面的 key 放进 `poster`。设 `blur: 1` 时，群里先显示模糊预览。

```json
{
  "text": "图片和视频",
  "media": [
    {"key": "图片的 key", "blur": 1},
    {"key": "视频的 key", "poster": "封面的 key", "kind": "v", "w": 1280, "h": 720}
  ]
}
```

## 接收和回复指令

群成员发出 `/status api` 时，尽欢向该命令的回调发送 `type` 为 `chat.command` 的 JSON。其他字段有 `event_id`、`installation_id`、`group_id`、`message_id`、`bot_username`、`sender_id`、`sender_username`、`command`、`args` 和 `created_at`。已有的 `@bot_… /status api` 形式也可以使用。

每群可设置一个默认对话回调。接入方勾选「接收艾特机器人后的对话」后，群成员把群机器人放在消息开头并输入正文，如 `@bot_… 你好`，回调会收到 `type: "chat.mention"` 和 `text: "你好"`。它沿用命令事件的消息、群、发送者和签名字段。`text` 取代 `command` 与 `args`。只有艾特且没有正文时不触发。

接收端用签名密钥字符串的 UTF-8 字节，对 `X-Jinhuan-Timestamp + "." + 原始请求正文` 计算 HMAC-SHA256。对比十六进制结果和 `X-Jinhuan-Signature` 中 `sha256=` 后的值，并核对时间窗口。拿到已验证的 `sender_id` 后，可以按指令检查调用者权限。

接收后尽快返回 2xx。失败会重试，按 `event_id` 去重。用同一配置的推送地址发送 `{"text":"API 正常","reply_event_id":"收到的事件 ID"}`，消息会引用触发指令的原消息。每个事件支持一条引用回复，重试返回原回复 ID。还可以继续推送不带引用的消息。
