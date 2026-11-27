# 尽欢群机器人使用与接入指南

本文适用于新版群机器人。每个群共用一个机器人身份。群友可以自行登记回调和命令，在群里用同一个机器人查资料、发图、收提醒或对话。

## 在群里使用

- 发 `/help` 查看本群已启用的命令和描述，发 `/doc` 打开群管配置的说明帖。
- 命令从消息开头输入，例如 `/status api`。长命令和短命令都能直接发送，大小写通用。
- 发 `@机器人 你好` 或 `/chat 你好` 开始对话。只有艾特、没有正文时保持静默。

### 聊天身份与会话

群里只有一个可用身份时，首次对话会自动使用它。有多个时，机器人会列出选项。点选身份，或发 `/chat 选择 身份名`，机器人就会继续处理刚才那句。身份选择按群和成员保存。发 `@机器人 切换身份` 可以重新选择。

群管可以设置每次会话的轮数上限，默认不限。开启上限后，收到一次回复才算完成一轮，下一轮等上一条回复后再发。达到上限时会结束会话，下次艾特会重新选身份。

本群若沿用默认结束口令，可以发 `@机器人 结束会话`。群管可以改口令和站点结束语，也可以把结束口令交给当前回调，由它回复自己的结束语。选择由站点结束时，这条口令由站点直接处理。

## 登记自己的回调

1. 打开「成员与设置 → 群机器人」，填写回调名称和你服务的公开 HTTPS 地址。该地址需要能直接接收 POST。
2. 在命令栏每行填一条命令及其描述。长命令和短命令可以放在同一份配置里。

   ```text
   /nsfw 发送 NSFW 图
   /n 发送 NSFW 图
   ```

   如果通过配置接口登记，`commands` 对应 `["nsfw", "n"]`。两个命令共用回调地址，触发 `/N` 时回调收到的是 `n`。同一个群内命令名唯一，`/help`、`/doc` 和 `/chat` 由群机器人分发。
3. 要提供对话服务，就填写一个「聊天身份名」。要用回调读取站内图库，再勾选「允许此回调使用我的图库读取权限」。
4. 保存后，将推送地址、推送 Token 和回调签名密钥保存在接收端。凭证通过私下配置传递。

群成员可以看见命令、描述和维护者。维护者本人可以更新自己的回调、描述与聊天身份，也可以暂停配置、轮换凭证和查看投递记录。

## 接收回调与回复

群友发 `/status api` 时，接收端会收到 `type: "chat.command"`，其中 `command` 是 `status`，`args` 是 `api`。事件还带有 `event_id`、`installation_id`、`group_id`、`message_id`、`bot_username`、`sender_id`、`sender_username` 和 `created_at`。

接收端用回调签名密钥的 UTF-8 字节，对 `X-Jinhuan-Timestamp + "." + 原始请求正文` 计算 HMAC-SHA256。将结果的十六进制值和 `X-Jinhuan-Signature` 去掉 `sha256=` 后的值做恒定时间比较，同时核对时间戳。验签通过后按 `event_id` 去重，再入队处理并尽快返回 2xx。投递失败时，尽欢会重试。

向配置里提供的推送地址发送以下请求。用 `reply_event_id` 可以引用触发命令的群消息。每个事件支持一条引用回复，重复提交相同回复会返回原消息 ID。

```sh
curl "$PUSH_URL" \
  -H "Authorization: Bearer $PUSH_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"API 正常","reply_event_id":"收到的 event_id"}'
```

主动发送消息时可以只填 `text`，并带上 `Idempotency-Key` 请求头以便重试。相同的幂等键和内容会返回原消息 ID。群机器人共用每分钟 30 条消息的发送限额。

### 对话回调

对话沿用 `chat.command`，`command` 固定为 `chat`，用户正文放在 `args`。回调还会收到 `chat_name` 和 `conversation_id`。请按 `conversation_id` 保存上下文。重新选择身份会开启新的会话。

- 普通对话用 `reply_event_id` 回复，发布成功才计一轮。设置轮次上限时，待回复的普通事件有十分钟回复窗口。最后一轮的请求带 `last_turn: true`。
- 由回调方处理结束口令时，回调会收到 `end_requested: true`。用 `reply_event_id` 发出自定义结束语即可关闭会话。在回调结束模式下，也可以在普通回复里加 `"end_conversation": true` 提前结束，或在最后一轮用自己的结束语收尾。
- 达到轮次上限时，站点会在最后一轮回复后关闭会话。如果回调没有自行收尾，站点会发送群管配置的结束语。

## 上传图片和视频

使用配置里提供的附件上传地址，或把推送地址末尾的 `/messages` 换成 `/uploads`。上传和推送共用 Token。

```sh
curl "$UPLOAD_URL" \
  -H "Authorization: Bearer $PUSH_TOKEN" \
  -F 'file=@photo.jpg' \
  -F 'nonce=unique-upload-operation-42'
```

每个文件最大 20 MiB，每条消息最多带 12 个附件。把上传返回的 `key` 放进推送请求的 `media`。视频需单独上传封面，然后把封面的 key 填进 `poster`。设 `blur: 1` 会先显示模糊预览。只发附件时正文可以留空。

```json
{
  "text": "图片和视频",
  "media": [
    {"key": "图片的 key", "blur": 1},
    {"key": "视频的 key", "poster": "封面的 key", "kind": "v", "w": 1280, "h": 720}
  ]
}
```

把推送地址末尾换成 `/status`，可以查看对应的群和接口权限。启用图库读取后，可以用相同令牌调用 `/gallery/days` 和 `/gallery/memes`，例如 `/gallery/memes?tag=meme&author=用户名`，沿用站内图库的查询参数和可见范围。

## 迁移原来的图片和视频机器人

1. 在 Tool 机器人后台打开「群原生机器人回调」，选群并点「复制本群命令」。[打开 Tool 机器人后台](https://tool.luo-xd.com/media/#bot)
2. 在尽欢为这个群登记回调，粘贴命令并勾选图库读取权限。回调地址填 `https://tool.luo-xd.com/webhook/meme-chat`。
3. 将尽欢生成的推送地址、Token 和签名密钥填回 Tool。保存时会核对群号、附件和图库权限，并试读图库。验证通过后，重启机器人服务即可让该群改用原生回调，沿用现有命令规则、定时任务和历史。

## 设置本帖为 /doc

发帖后，群管可以在「成员与设置 → 群机器人」的「/doc 站内帖子链接」填入本帖链接。后续直接编辑本帖即可更新说明。

## 站点部署

已有数据库需依次应用未执行的迁移，包括 `migrations/0222_unified_chat_bots.sql` 和 `migrations/0223_chat_bot_conversation_limits.sql`。新库通过 `schema.sql` 初始化。启用回调时配置随机签名密钥 `CHAT_BOT_WEBHOOK_KEY`。回调必须直接接收 POST，重定向会视为投递失败。
