import { Hono } from 'hono'
import type { C, Ctx, User } from '../types'
import { boundedJson, fail, sameOrigin } from '../lib/http'
import { randHex, sha256 } from '../lib/crypto'
import { now } from '../lib/time'
import { isChatAdmin } from '../services/auth'
import { isAnonGroup, tagMembers } from '../services/anon-identity'
import { assertCurrentAccess, needMember } from '../services/chat-access'
import { NEXT_ACCOUNT_ID_SQL } from '../services/account-ids'
import { BOT_COMMAND, BOT_GROUP_LIMIT, BOT_TEXT_LIMIT, botCallbackUrl, botMaintainerActive, botSigningSecret } from '../services/chat-bots'
import { mediaKeys, prepareMedia } from '../services/content-media'
import { cleanMedia, sniffImage, sniffVideo } from '../services/media-format'
import { commitUploadContent, storeUpload } from '../services/upload-operations'

export const chatBots = new Hono<Ctx>()
const managePath = '/api/chat/groups/:gid/bots'
const nativePath = '/api/chat-bots/:id'
const pushPath = nativePath + '/messages'
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const maxUpload = 20 * 1024 * 1024

async function manage(c: C) {
  const gid = Number(c.req.param('gid'))
  if (!Number.isSafeInteger(gid) || gid < 1) fail(400, '群编号无效')
  const { u } = await needMember(c, gid)
  await assertCurrentAccess(c, u.id, gid)
  if (u.silenced) fail(403, '账号处于禁言状态')
  c.header('Cache-Control', 'private, no-store')
  return { gid, u }
}

function installId(c: C) {
  const id = c.req.param('id') || ''
  if (!uuid.test(id)) fail(404, '机器人不存在')
  return id
}

async function credentials(c: C, id: string, token: string, keyVersion: string, callback: string | null) {
  return {
    push_url: new URL('/api/chat-bots/' + id + '/messages', c.req.url).href,
    upload_url: new URL('/api/chat-bots/' + id + '/uploads', c.req.url).href,
    push_token: token,
    signing_secret: callback && c.env.CHAT_BOT_WEBHOOK_KEY
      ? await botSigningSecret(c.env.CHAT_BOT_WEBHOOK_KEY, id, keyVersion)
      : null,
  }
}

function receiverFields(c: C, body: Record<string,unknown>) {
  if (body.callback_url != null && typeof body.callback_url !== 'string') fail(400, '请填写有效的 HTTPS 回调地址')
  const rawUrl = typeof body.callback_url === 'string' ? body.callback_url.trim() : ''
  const callback = rawUrl && rawUrl.length <= 500 ? botCallbackUrl(c.env, rawUrl) : null
  if (rawUrl && !callback) fail(400, '请填写有效的公开 HTTPS 回调地址')
  const input = body.commands ?? []
  if (!Array.isArray(input) || input.some(name => typeof name !== 'string' || !BOT_COMMAND.test(name))) fail(400, '指令格式无效')
  const commands = [...new Set(input as string[])]
  if (commands.some(name => name === 'doc' || name === 'help')) fail(400, '/help 和 /doc 由本群机器人提供')
  if (body.accept_mentions !== undefined && typeof body.accept_mentions !== 'boolean') fail(400, '对话选项无效')
  const mentions = body.accept_mentions === true ? 1 : 0
  if (!!callback !== !!(commands.length || mentions)) fail(400, '请同时填写回调地址和命令，或启用艾特对话')
  if (callback && !c.env.CHAT_BOT_WEBHOOK_KEY) fail(503, '站点尚未配置机器人回调签名')
  const inputDescriptions = body.descriptions ?? {}
  if (!inputDescriptions || typeof inputDescriptions !== 'object' || Array.isArray(inputDescriptions)) fail(400, '命令描述格式无效')
  const descriptions = Object.fromEntries(Object.entries(inputDescriptions).map(([name, value]) => {
    if (!commands.includes(name) || typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) fail(400, '请为已登记命令填写单行描述')
    return [name, value.trim()]
  }))
  if (body.gallery_access !== undefined && typeof body.gallery_access !== 'boolean') fail(400, '图库读取选项无效')
  return { callback, mentions, commands: JSON.stringify(commands), descriptions: JSON.stringify(descriptions), gallery: body.gallery_access === true ? 1 : 0 }
}

const conflictingCommands = `EXISTS(SELECT 1 FROM chat_bot_installations other
  JOIN json_each(other.commands) existing JOIN json_each(?4) incoming ON incoming.value=existing.value
  WHERE other.group_id=?1 AND other.id!=?2)`

chatBots.get(managePath, async c => {
  const { gid, u } = await manage(c)
  const db = c.env.DB
  const [{ results }, identity] = await Promise.all([
    db.prepare(`SELECT i.id,CASE WHEN i.created_by=?2 THEN i.callback_url END AS callback_url,
      i.created_by=?2 AS own,i.commands,i.command_descriptions,i.gallery_access,i.accept_mentions,i.enabled,
      b.name,owner.id AS maintainer_id,owner.username AS maintainer,(${botMaintainerActive}) AS active_owner
      FROM chat_bot_installations i JOIN users b ON b.id=i.bot_id JOIN users owner ON owner.id=i.created_by
      WHERE i.group_id=?1 ORDER BY i.created_at,i.id`).bind(gid,u.id).all<{
        commands:string;command_descriptions:string;enabled:number;own:number;gallery_access:number;accept_mentions:number;active_owner:number;maintainer_id:number;maintainer:string
      }>(),
    db.prepare(`SELECT b.username,b.name,doc_post_id FROM chat_group_bot_identity identity JOIN users b ON b.id=identity.bot_id
      WHERE group_id=?`).bind(gid).first<{doc_post_id:number|null;username:string;name:string}>(),
  ])
  const anonymous = new Map<number,string>()
  if (isAnonGroup(gid)) {
    const owners = await db.prepare('SELECT user_id FROM anon_members WHERE group_id=? AND anon=1 AND user_id IN(SELECT value FROM json_each(?))')
      .bind(gid,JSON.stringify(results.filter(bot=>!bot.own).map(bot=>bot.maintainer_id))).all<{user_id:number}>()
    const publicOwners = await tagMembers(c,gid,owners.results.map(row=>({id:row.user_id,username:'匿名维护者'})),true)
    publicOwners.forEach((owner,index) => anonymous.set(owners.results[index].user_id,owner.anon?.name ?? '匿名维护者'))
  }
  return c.json({ identity, can_edit_doc: isChatAdmin(u), bots: results.map(({ command_descriptions, maintainer_id, ...bot }) => ({
    ...bot, maintainer:anonymous.get(maintainer_id) ?? bot.maintainer,
    commands: JSON.parse(bot.commands), descriptions: JSON.parse(command_descriptions), own: !!bot.own,
    enabled: !!bot.enabled, active_owner: !!bot.active_owner, gallery_access: !!bot.gallery_access, accept_mentions:!!bot.accept_mentions,
  })) })
})

chatBots.put(managePath + '/doc', async c => {
  sameOrigin(c)
  const { gid, u } = await manage(c)
  if (!isChatAdmin(u)) fail(403, '只有群管能设置本群对接说明')
  const { url } = await boundedJson(c, 2048)
  const origin = new URL(c.req.url).origin
  let id: number|null = null
  if (url != null && url !== '') {
    if (typeof url !== 'string') fail(400, '请填写站内帖子链接')
    try {
      const post = new URL(url as string, origin)
      if (post.origin === origin && !post.username && !post.password) id = Number(/^\/m\/([1-9]\d*)\/?$/.exec(post.pathname)?.[1])
    } catch { /* Invalid URLs fail below. */ }
    if (!id || !Number.isSafeInteger(id) || !await c.env.DB.prepare('SELECT 1 FROM memes WHERE id=? AND hidden=0').bind(id).first()) {
      fail(400, '请填写有效的站内帖子链接')
    }
  }
  const db = c.env.DB
  if (id) {
    const username = 'bot_' + randHex(6), t = now()
    await db.batch([
      db.prepare(`INSERT INTO users(id,username,name,kind,created_at,updated_at)
        SELECT (${NEXT_ACCOUNT_ID_SQL}),?1,'群机器人','bot',?2,?2
        WHERE NOT EXISTS(SELECT 1 FROM chat_group_bot_identity WHERE group_id=?3)`).bind(username,t,gid),
      db.prepare(`INSERT INTO chat_group_bot_identity(group_id,bot_id)
        SELECT ?,id FROM users WHERE username=? AND id=last_insert_rowid() AND changes()=1`).bind(gid,username),
      db.prepare('UPDATE chat_group_bot_identity SET doc_post_id=? WHERE group_id=?').bind(id,gid),
    ])
  } else {
    await db.prepare('UPDATE chat_group_bot_identity SET doc_post_id=NULL WHERE group_id=?').bind(gid).run()
  }
  return c.json({ doc_post_id:id })
})

chatBots.post(managePath, async c => {
  sameOrigin(c)
  const { gid, u } = await manage(c)
  const body = await boundedJson(c)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || [...name].length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) fail(400, '机器人名称需为 1–24 个字符')
  const { callback, commands, descriptions, gallery, mentions } = receiverFields(c,body)

  const id = crypto.randomUUID(), token = 'jhb_' + randHex(32), keyVersion = crypto.randomUUID()
  const username = 'bot_' + randHex(6), t = now(), db = c.env.DB
  // Account and installation are created in the same transaction as the limit check.
  const result = await db.batch([
    db.prepare(`INSERT INTO users(id,username,name,kind,created_at,updated_at)
      SELECT (${NEXT_ACCOUNT_ID_SQL}),?1,?2,'bot',?3,?3
      WHERE (SELECT COUNT(*) FROM chat_bot_installations WHERE group_id=?4)<?5
        AND EXISTS(SELECT 1 FROM chat_members WHERE group_id=?4 AND user_id=?6)
        AND EXISTS(SELECT 1 FROM users WHERE id=?6 AND kind='user' AND disabled=0 AND silenced=0)
        AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=?4 AND user_id=?6)
        AND NOT EXISTS(SELECT 1 FROM chat_bot_installations other JOIN json_each(other.commands) old
          JOIN json_each(?7) incoming ON incoming.value=old.value WHERE other.group_id=?4)
        AND (?8=0 OR NOT EXISTS(SELECT 1 FROM chat_bot_installations i WHERE i.group_id=?4 AND i.accept_mentions=1))
      RETURNING id`).bind(username, name, t, gid, BOT_GROUP_LIMIT, u.id, commands,mentions),
    db.prepare(`INSERT INTO chat_bot_installations(id,group_id,bot_id,created_by,token_hash,key_version,callback_url,commands,created_at,gallery_access,command_descriptions,accept_mentions)
      SELECT ?,?,id,?,?,?,?,?,?,?,?,? FROM users WHERE username=? AND kind='bot' AND id=last_insert_rowid() RETURNING id`)
      .bind(id, gid, u.id, await sha256(token), keyVersion, callback, commands, t, gallery, descriptions, mentions, username),
    db.prepare(`INSERT OR IGNORE INTO chat_group_bot_identity(group_id,bot_id) SELECT group_id,bot_id FROM chat_bot_installations WHERE id=?`)
      .bind(id),
  ])
  if (!result[1].results.length) fail(409, `命令或艾特对话已被登记，或本群已达到 ${BOT_GROUP_LIMIT} 个回调配置`)
  const shared = await db.prepare(`SELECT b.username FROM chat_group_bot_identity identity JOIN users b ON b.id=identity.bot_id
    WHERE identity.group_id=?`).bind(gid).first<{username:string}>()
  return c.json({ id, username:shared?.username ?? username, ...await credentials(c, id, token, keyVersion, callback) }, 201)
})

chatBots.patch(managePath + '/:id', async c => {
  sameOrigin(c)
  const { gid,u } = await manage(c), id = installId(c)
  const body = await boundedJson(c)
  const row = await c.env.DB.prepare(`SELECT * FROM chat_bot_installations WHERE id=? AND group_id=? AND created_by=?`)
    .bind(id,gid,u.id).first<{enabled:number;callback_url:string|null;key_version:string;commands:string;command_descriptions:string;gallery_access:number;accept_mentions:number}>()
  if (!row) return fail(404, '回调配置不存在或不属于你')
  const enabled = body.enabled ?? !!row.enabled
  if (typeof enabled !== 'boolean') fail(400, '请选择暂停或启用')
  // Pause/resume remains valid for previously configured /help or /doc callbacks.
  const changesFields = ['commands','callback_url','descriptions','gallery_access','accept_mentions'].some(key=>key in body)
  const fields = changesFields ? receiverFields(c,{
    commands: JSON.parse(row.commands), callback_url: row.callback_url,
    descriptions: JSON.parse(row.command_descriptions), gallery_access: !!row.gallery_access, accept_mentions:!!row.accept_mentions, ...body,
  }) : {callback:row.callback_url,commands:row.commands,descriptions:row.command_descriptions,gallery:row.gallery_access,mentions:row.accept_mentions}
  const callbackChanged = fields.callback !== row.callback_url
  const keyVersion = callbackChanged ? crypto.randomUUID() : row.key_version
  const invalidate = !enabled || callbackChanged || fields.commands !== row.commands || fields.mentions !== row.accept_mentions
  const [updated] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE chat_bot_installations SET enabled=?5,callback_url=?6,commands=?4,key_version=?7,gallery_access=?8,command_descriptions=?9,accept_mentions=?10
      WHERE group_id=?1 AND id=?2 AND created_by=?3 AND (commands=?4 OR NOT ${conflictingCommands})
      AND (?10=0 OR NOT EXISTS(SELECT 1 FROM chat_bot_installations other WHERE other.group_id=?1 AND other.id!=?2 AND other.accept_mentions=1)) RETURNING id`)
      .bind(gid,id,u.id,fields.commands,enabled?1:0,fields.callback,keyVersion,fields.gallery,fields.descriptions,fields.mentions),
    ...(invalidate ? [c.env.DB.prepare(`UPDATE chat_bot_events SET state='cancelled',lease=NULL,error='回调配置已更新'
      WHERE changes()=1 AND installation_id=? AND state IN('pending','delivering')`).bind(id)] : []),
  ])
  if (!updated.results.length) fail(409, '命令或艾特对话已被另一个回调登记，或该配置已移除')
  return c.json({ ok: true, ...(callbackChanged && fields.callback && c.env.CHAT_BOT_WEBHOOK_KEY ? {
    signing_secret: await botSigningSecret(c.env.CHAT_BOT_WEBHOOK_KEY,id,keyVersion),
  } : {}) })
})

chatBots.post(managePath + '/:id/rotate', async c => {
  sameOrigin(c)
  const { gid,u } = await manage(c), id = installId(c)
  const token = 'jhb_' + randHex(32), keyVersion = crypto.randomUUID()
  const row = await c.env.DB.prepare(`UPDATE chat_bot_installations SET token_hash=?,key_version=? WHERE id=? AND group_id=? AND created_by=?
    RETURNING callback_url`).bind(await sha256(token), keyVersion, id, gid, u.id).first<{ callback_url: string | null }>()
  if (!row) return fail(404, '机器人不存在')
  return c.json(await credentials(c, id, token, keyVersion, row.callback_url))
})

chatBots.delete(managePath + '/:id', async c => {
  sameOrigin(c)
  const { gid,u } = await manage(c), id = installId(c)
  const removed=await c.env.DB.prepare('DELETE FROM chat_bot_installations WHERE id=? AND group_id=? AND created_by=? RETURNING id').bind(id,gid,u.id).first()
  if (!removed) fail(404, '回调配置不存在或不属于你')
  return c.json({ ok: true })
})

chatBots.get(managePath + '/:id/deliveries', async c => {
  const { gid,u } = await manage(c), id = installId(c)
  const { results } = await c.env.DB.prepare(`SELECT e.id,e.message_id,e.command,e.state,e.attempts,e.error,e.created_at
    FROM chat_bot_events e JOIN chat_bot_installations i ON i.id=e.installation_id
    WHERE i.id=? AND i.group_id=? AND i.created_by=? ORDER BY e.created_at DESC,e.id DESC LIMIT 20`).bind(id,gid,u.id).all()
  return c.json({ items: results })
})

async function authorizeBot(c: C) {
  c.header('Cache-Control', 'no-store')
  const id = installId(c)
  const bearer = /^Bearer (jhb_[a-f0-9]{64})$/i.exec(c.req.header('authorization') || '')
  if (!bearer) return fail(401, '机器人凭证无效')
  const hash = await sha256(bearer[1]), db = c.env.DB
  const install = await db.prepare(`SELECT i.group_id,i.bot_id,i.gallery_access,i.created_by,identity.bot_id AS sender_id,shared.username
    FROM chat_bot_installations i
    JOIN chat_groups g ON g.id=i.group_id JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    JOIN chat_group_bot_identity identity ON identity.group_id=i.group_id
    JOIN users shared ON shared.id=identity.bot_id AND shared.disabled=0
    WHERE i.id=? AND i.token_hash=? AND i.enabled=1 AND ${botMaintainerActive}`)
    .bind(id, hash).first<{group_id:number;bot_id:number;gallery_access:number;created_by:number;sender_id:number;username:string}>()
  if (!install) return fail(401, '机器人凭证无效或机器人已停用')
  return {id,hash,install}
}

chatBots.get(nativePath + '/status', async c => {
  const { install } = await authorizeBot(c)
  return c.json({ group_id:install.group_id, bot_username:install.username, media:true, gallery:!!install.gallery_access })
})

export async function botGalleryUser(c: C) {
  const { install } = await authorizeBot(c)
  if (!install.gallery_access) fail(403, '此回调尚未开启图库读取权限')
  const owner = await c.env.DB.prepare('SELECT * FROM users WHERE id=? AND kind=\'user\' AND disabled=0')
    .bind(install.created_by).first<User & {main_activated_at?:number}>()
  if (!owner || c.env.MAIN_ACTIVATION==='required' && new URL(c.req.url).hostname!=='cc.52dmeme.com' && !owner.main_activated_at) {
    return fail(403, '回调维护者账号已不可用或未完成主站激活')
  }
  return owner
}

chatBots.post(nativePath + '/uploads', async c => {
  const { install } = await authorizeBot(c)
  if (!/^multipart\/form-data(?:;|$)/i.test(c.req.header('content-type') || '')) fail(415, '请上传 multipart/form-data')
  if (Number(c.req.header('content-length') || 0) > maxUpload + 65536) fail(413,'附件最大 20 MiB')
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) return fail(400, '请选择图片或视频')
  if (file.size > maxUpload) fail(413, '附件最大 20 MiB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniffImage(bytes) ?? sniffVideo(bytes)
  if (!kind || kind === 'heic') return fail(415, '仅支持 PNG、JPEG、GIF、WebP、MP4、MOV 和 WebM')
  const [mime,ext] = kind
  return c.json(await storeUpload(c.env.DB,c.env.BUCKET,{
    uid:install.bot_id,nonce:form.get('nonce'),bytes:cleanMedia(bytes,mime),mime,ext,purpose:'chat',asFile:false,limited:true,t:now(),
  }))
})

chatBots.post(pushPath, async c => {
  const {id,hash,install}=await authorizeBot(c)
  const db=c.env.DB

  const body = await boundedJson(c, 12_000)
  const text = typeof body.text === 'string' ? body.text.replace(/\r/g, '').trim() : ''
  const raw = body.media ?? []
  if (!Array.isArray(raw) || raw.length > 12 || raw.some(item => !item || typeof item.key !== 'string' || !item.key)) {
    fail(400, '每条消息最多包含 12 个图片或视频附件')
  }
  if ((!text && !(raw as unknown[]).length) || text.length > BOT_TEXT_LIMIT) fail(400, `请发送附件或 1–${BOT_TEXT_LIMIT} 字的文本`)
  const event = body.reply_event_id == null ? null : String(body.reply_event_id)
  if (event !== null && !uuid.test(event)) fail(400, '回复事件编号无效')
  const key = c.req.header('idempotency-key')
  if (key !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(key)) fail(400, '幂等键无效')
  const ref = id + ':' + (event ? 'reply:' + event : key ? await sha256(key) : crypto.randomUUID())
  const prior = () => db.prepare(`SELECT id,body,media,deleted FROM chat_messages
    WHERE system_kind='chat_bot' AND system_ref=? AND group_id=?`).bind(ref,install.group_id)
    .first<{id:number;body:string;media:string|null;deleted:number}>()
  const before = await prior()
  if (before?.deleted) return c.json({message_id:before.id,group_id:install.group_id,duplicate:true})
  // Used keys are read only to compare an idempotent replay. The write still claims unused uploads.
  const attachments = await prepareMedia(c,install.bot_id,raw,true,'c',true)
  if (attachments.some(media=>media.kind==='f')) fail(400,'机器人附件仅支持图片和视频')
  const media = attachments.length ? JSON.stringify(attachments) : null
  const cover = attachments[0]
  const replay = (message: NonNullable<typeof before>) => {
    if (!message.deleted && (message.body !== text || message.media !== media)) fail(409,'该标识已用于另一条消息')
    return c.json({message_id:message.id,group_id:install.group_id,duplicate:true})
  }
  if (before) return replay(before)

  const t = now()
  const write = db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,image_key,width,height,media,reply_to,created_at,updated_at,system_kind,system_ref)
    SELECT i.group_id,identity.bot_id,?3,?7,?8,?9,?10,m.id,?4,?4,'chat_bot',?5 FROM chat_bot_installations i
    JOIN chat_groups g ON g.id=i.group_id JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    JOIN chat_group_bot_identity identity ON identity.group_id=i.group_id
    JOIN users shared ON shared.id=identity.bot_id AND shared.disabled=0
    LEFT JOIN chat_bot_events e ON e.id=?6 AND e.installation_id=i.id AND e.state IN('delivering','delivered')
    LEFT JOIN chat_messages m ON m.id=e.message_id AND m.group_id=i.group_id AND m.deleted=0
    WHERE i.id=?1 AND i.token_hash=?2 AND i.enabled=1 AND (?6 IS NULL OR m.id IS NOT NULL)
      AND ${botMaintainerActive}
      AND (SELECT COUNT(*) FROM chat_messages x WHERE x.user_id=identity.bot_id AND x.created_at>?4-60)<30
    RETURNING id`).bind(id,hash,text,t,ref,event,cover?.p ?? cover?.k ?? null,cover?.w ?? null,cover?.h ?? null,media)
  try {
    const [result] = await commitUploadContent(db,install.bot_id,mediaKeys(attachments),[
      write, db.prepare("SELECT json(CASE WHEN changes()=1 THEN 'true' ELSE 'bot_message_not_inserted' END)"),
    ])
    const saved = result.results[0] as {id:number}
    return c.json({message_id:saved.id,group_id:install.group_id},201)
  } catch (err) {
    const previous = await prior()
    if (previous) return replay(previous)
    // D1 reports invalid JSON when the conditional insert wrote nothing, rolling back attached uploads.
    if (!(err instanceof Error && /malformed JSON/i.test(err.message))) throw err
  }
  if (event && !await db.prepare(`SELECT 1 FROM chat_bot_events e JOIN chat_messages m ON m.id=e.message_id AND m.deleted=0
    WHERE e.id=? AND e.installation_id=? AND e.state IN('delivering','delivered')`).bind(event, id).first()) fail(404, '回复事件不存在或已失效')
  fail(429, '发送太快或机器人状态已变化，请刷新后重试')
})
