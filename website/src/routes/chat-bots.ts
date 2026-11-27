import { Hono } from 'hono'
import type { C, Ctx } from '../types'
import { boundedJson, fail, sameOrigin } from '../lib/http'
import { randHex, sha256 } from '../lib/crypto'
import { now } from '../lib/time'
import { isChatAdmin } from '../services/auth'
import { assertCurrentAccess, needMember } from '../services/chat-access'
import { NEXT_ACCOUNT_ID_SQL } from '../services/account-ids'
import { BOT_COMMAND, BOT_GROUP_LIMIT, BOT_TEXT_LIMIT, botCallbackUrl, botSigningSecret } from '../services/chat-bots'

export const chatBots = new Hono<Ctx>()
const managePath = '/api/chat/groups/:gid/bots'
const pushPath = '/api/chat-bots/:id/messages'
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/

async function manage(c: C) {
  const gid = Number(c.req.param('gid'))
  if (!Number.isSafeInteger(gid) || gid < 1) fail(400, '群编号无效')
  const { u } = await needMember(c, gid)
  if (!isChatAdmin(u)) fail(403, '只有管理员和群管能管理机器人')
  await assertCurrentAccess(c, u.id, gid)
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
    push_token: token,
    signing_secret: callback && c.env.CHAT_BOT_WEBHOOK_KEY
      ? await botSigningSecret(c.env.CHAT_BOT_WEBHOOK_KEY, id, keyVersion)
      : null,
  }
}

chatBots.get(managePath, async c => {
  const { gid } = await manage(c)
  const { results } = await c.env.DB.prepare(`SELECT i.id,i.callback_url,i.commands,i.enabled,i.created_at,b.username,b.name
    FROM chat_bot_installations i JOIN users b ON b.id=i.bot_id WHERE i.group_id=? ORDER BY i.created_at,i.id`)
    .bind(gid).all<{ commands: string; enabled: number }>()
  return c.json({ bots: results.map(bot => ({ ...bot, commands: JSON.parse(bot.commands), enabled: !!bot.enabled })) })
})

chatBots.post(managePath, async c => {
  sameOrigin(c)
  const { gid, u } = await manage(c)
  const body = await boundedJson(c, 4096)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || [...name].length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) fail(400, '机器人名称需为 1–24 个字符')
  const rawUrl = body.callback_url == null ? '' : String(body.callback_url).trim()
  const callback = rawUrl && rawUrl.length <= 500 ? botCallbackUrl(c.env, rawUrl) : null
  const rawCommands = body.commands ?? []
  if (!Array.isArray(rawCommands) || rawCommands.length > 12 ||
      rawCommands.some(command => typeof command !== 'string' || !BOT_COMMAND.test(command))) fail(400, '请填写最多 12 条小写字母开头的指令')
  const commands = [...new Set(rawCommands as string[])]
  if (rawUrl && !callback) fail(400, '请填写有效的 HTTPS 回调地址')
  if ((!!callback) !== (commands.length > 0)) fail(400, '启用回调时请同时填写地址和指令')
  if (callback && !c.env.CHAT_BOT_WEBHOOK_KEY) fail(503, '站点尚未配置机器人回调签名')

  const id = crypto.randomUUID(), token = 'jhb_' + randHex(32), keyVersion = crypto.randomUUID()
  const username = 'bot_' + randHex(6), t = now(), db = c.env.DB
  // Account and installation are created in the same transaction as the limit check.
  const result = await db.batch([
    db.prepare(`INSERT INTO users(id,username,name,kind,created_at,updated_at)
      SELECT (${NEXT_ACCOUNT_ID_SQL}),?1,?2,'bot',?3,?3
      WHERE (SELECT COUNT(*) FROM chat_bot_installations WHERE group_id=?4)<?5
        AND EXISTS(SELECT 1 FROM chat_members WHERE group_id=?4 AND user_id=?6)
        AND EXISTS(SELECT 1 FROM users WHERE id=?6 AND kind='user' AND disabled=0 AND (is_admin=1 OR role='gadmin'))
      RETURNING id`).bind(username, name, t, gid, BOT_GROUP_LIMIT, u.id),
    db.prepare(`INSERT INTO chat_bot_installations(id,group_id,bot_id,created_by,token_hash,key_version,callback_url,commands,created_at)
      SELECT ?,?,id,?,?,?,?,?,? FROM users WHERE username=? AND kind='bot' AND id=last_insert_rowid() RETURNING id`)
      .bind(id, gid, u.id, await sha256(token), keyVersion, callback, JSON.stringify(commands), t, username),
  ])
  if (!result[1].results.length) fail(409, `群内最多安装 ${BOT_GROUP_LIMIT} 个机器人，请核对数量与权限`)
  return c.json({ id, username, ...await credentials(c, id, token, keyVersion, callback) }, 201)
})

chatBots.patch(managePath + '/:id', async c => {
  sameOrigin(c)
  const { gid } = await manage(c), id = installId(c)
  const { enabled } = await boundedJson(c, 1024)
  if (typeof enabled !== 'boolean') fail(400, '请选择暂停或启用')
  const [updated] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE chat_bot_installations SET enabled=? WHERE id=? AND group_id=? RETURNING id')
      .bind(enabled ? 1 : 0, id, gid),
    ...(enabled ? [] : [c.env.DB.prepare(`UPDATE chat_bot_events SET state='cancelled',lease=NULL,error='机器人已暂停'
      WHERE state IN('pending','delivering') AND installation_id IN (SELECT id FROM chat_bot_installations WHERE id=? AND group_id=?)`).bind(id, gid)]),
  ])
  if (!updated.results.length) fail(404, '机器人不存在')
  return c.json({ ok: true })
})

chatBots.post(managePath + '/:id/rotate', async c => {
  sameOrigin(c)
  const { gid } = await manage(c), id = installId(c)
  const token = 'jhb_' + randHex(32), keyVersion = crypto.randomUUID()
  const row = await c.env.DB.prepare(`UPDATE chat_bot_installations SET token_hash=?,key_version=? WHERE id=? AND group_id=?
    RETURNING callback_url`).bind(await sha256(token), keyVersion, id, gid).first<{ callback_url: string | null }>()
  if (!row) return fail(404, '机器人不存在')
  return c.json(await credentials(c, id, token, keyVersion, row.callback_url))
})

chatBots.delete(managePath + '/:id', async c => {
  sameOrigin(c)
  const { gid } = await manage(c), id = installId(c)
  await c.env.DB.prepare('DELETE FROM chat_bot_installations WHERE id=? AND group_id=?').bind(id, gid).run()
  return c.json({ ok: true })
})

chatBots.get(managePath + '/:id/deliveries', async c => {
  const { gid } = await manage(c), id = installId(c)
  const { results } = await c.env.DB.prepare(`SELECT e.id,e.message_id,e.command,e.state,e.attempts,e.error,e.created_at
    FROM chat_bot_events e JOIN chat_bot_installations i ON i.id=e.installation_id
    WHERE i.id=? AND i.group_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 20`).bind(id, gid).all()
  return c.json({ items: results })
})

chatBots.post(pushPath, async c => {
  c.header('Cache-Control', 'no-store')
  const id = installId(c)
  const bearer = /^Bearer (jhb_[a-f0-9]{64})$/i.exec(c.req.header('authorization') || '')
  if (!bearer) return fail(401, '机器人凭证无效')
  const hash = await sha256(bearer[1]), db = c.env.DB
  const install = await db.prepare(`SELECT i.group_id,i.bot_id FROM chat_bot_installations i
    JOIN chat_groups g ON g.id=i.group_id JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    WHERE i.id=? AND i.token_hash=? AND i.enabled=1`).bind(id, hash).first<{ group_id: number; bot_id: number }>()
  if (!install) return fail(401, '机器人凭证无效或机器人已停用')

  const body = await boundedJson(c, 12_000)
  const text = typeof body.text === 'string' ? body.text.replace(/\r/g, '').trim() : ''
  if (!text || text.length > BOT_TEXT_LIMIT) fail(400, `消息需为 1–${BOT_TEXT_LIMIT} 字的文本`)
  const event = body.reply_event_id == null ? null : String(body.reply_event_id)
  if (event !== null && !uuid.test(event)) fail(400, '回复事件编号无效')
  const key = c.req.header('idempotency-key')
  if (key !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(key)) fail(400, '幂等键无效')
  const ref = id + ':' + (event ? 'reply:' + event : key ? await sha256(key) : crypto.randomUUID())
  const t = now()
  const inserted = await db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,reply_to,created_at,updated_at,system_kind,system_ref)
    SELECT i.group_id,i.bot_id,?3,m.id,?4,?4,'chat_bot',?5 FROM chat_bot_installations i
    JOIN chat_groups g ON g.id=i.group_id JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    LEFT JOIN chat_bot_events e ON e.id=?6 AND e.installation_id=i.id AND e.state IN('delivering','delivered')
    LEFT JOIN chat_messages m ON m.id=e.message_id AND m.group_id=i.group_id AND m.deleted=0
    WHERE i.id=?1 AND i.token_hash=?2 AND i.enabled=1 AND (?6 IS NULL OR m.id IS NOT NULL)
      AND (SELECT COUNT(*) FROM chat_messages x WHERE x.user_id=i.bot_id AND x.created_at>?4-60)<30
    RETURNING id`).bind(id, hash, text, t, ref, event).first<{ id: number }>()
  if (inserted) return c.json({ message_id: inserted.id, group_id: install.group_id }, 201)
  const prior = await db.prepare(`SELECT id,body,deleted FROM chat_messages
    WHERE system_kind='chat_bot' AND system_ref=? AND group_id=? AND user_id=?`)
    .bind(ref, install.group_id, install.bot_id).first<{ id: number; body: string; deleted: number }>()
  if (prior) {
    if (!prior.deleted && prior.body !== text) fail(409, '该标识已用于另一条消息')
    return c.json({ message_id: prior.id, group_id: install.group_id, duplicate: true })
  }
  if (event && !await db.prepare(`SELECT 1 FROM chat_bot_events e JOIN chat_messages m ON m.id=e.message_id AND m.deleted=0
    WHERE e.id=? AND e.installation_id=? AND e.state IN('delivering','delivered')`).bind(event, id).first()) fail(404, '回复事件不存在或已失效')
  fail(429, '发送太快或机器人状态已变化，请刷新后重试')
})
