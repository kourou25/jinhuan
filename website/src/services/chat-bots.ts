import type { Env } from '../env'
import { hmacHex } from '../lib/crypto'
import { now } from '../lib/time'
import { CHAT_HISTORY_FLOOR } from './chat-access'

const MAX_ATTEMPTS = 5
const RETENTION = 7 * 86400

export function botCallbackUrl(env: Env, value: string) {
  try {
    const url = new URL(value)
    const local = env.DEV_LOGIN_KEY && url.protocol === 'http:' && url.hostname === '127.0.0.1'
    const origins = (env.CHAT_BOT_WEBHOOK_ORIGINS ?? '').split(',').map(origin => origin.trim().replace(/\/$/, ''))
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.hash || url.search ||
        !origins.includes(url.origin)) return null
    return url.href
  } catch { return null }
}

export function botSigningSecret(key: string, id: string, version: string) {
  return hmacHex(key, 'jinhuan-chat-bot:' + id + ':' + version)
}

export const BOT_GROUP_LIMIT = 10
export const BOT_TEXT_LIMIT = 2000
export const BOT_COMMAND = /^[a-z][a-z0-9_-]{0,31}$/

// A single exact mention at the start of a human message can produce an event.
export function botCommandInsert(db: D1Database, groupId: number, body: string, at: number, webhookReady: boolean) {
  if (!webhookReady) return null
  const command = /^@(bot_[a-f0-9]{12})[ \t]+\/([a-z][a-z0-9_-]{0,31})(?:[ \t]+([^\r\n]*))?$/i.exec(body)
  if (!command || (command[3]?.length ?? 0) > 1000) return null
  const id = crypto.randomUUID()
  const statement = db.prepare(`INSERT INTO chat_bot_events(id,installation_id,message_id,command,args,source_body,next_at,created_at)
    SELECT ?1,i.id,m.id,?2,?3,m.body,?4,?4 FROM chat_bot_installations i
    JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    JOIN chat_messages m ON m.id=last_insert_rowid() AND m.group_id=i.group_id
    WHERE i.group_id=?5 AND b.username=?6 AND i.enabled=1 AND i.callback_url IS NOT NULL
      AND EXISTS(SELECT 1 FROM json_each(i.commands) WHERE value=?2)
      AND (SELECT COUNT(*) FROM chat_bot_events e WHERE e.installation_id=i.id AND e.created_at>?4-60)<30
    RETURNING id`).bind(id, command[2].toLowerCase(), command[3]?.trim() ?? '', at, groupId, command[1].toLowerCase())
  return { id, statement }
}

type Delivery = {
  installation_id: string; message_id: number; command: string; args: string; created_at: number
  group_id: number; callback_url: string; key_version: string; username: string
  sender_id: number; sender_username: string
}

export async function deliverBotEvent(env: Env, id: string) {
  const { DB: db, CHAT_BOT_WEBHOOK_KEY: key } = env
  if (!key) return
  const lease = crypto.randomUUID(), at = now()
  const claimed = await db.prepare(`UPDATE chat_bot_events SET state='delivering',lease=?2,next_at=?3+30,attempts=attempts+1
    WHERE id=?1 AND state IN('pending','delivering') AND next_at<=?3 AND attempts<?4
    RETURNING attempts`).bind(id, lease, at, MAX_ATTEMPTS).first<{ attempts: number }>()
  if (!claimed) return

  const event = await db.prepare(`SELECT e.installation_id,e.message_id,e.command,e.args,e.created_at,
      i.group_id,i.callback_url,i.key_version,b.username,u.id sender_id,u.username sender_username
    FROM chat_bot_events e JOIN chat_bot_installations i ON i.id=e.installation_id AND i.enabled=1
    JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    JOIN chat_messages m ON m.id=e.message_id AND m.group_id=i.group_id AND m.deleted=0 AND m.body=e.source_body
    JOIN users u ON u.id=m.user_id AND u.kind='user' AND u.disabled=0 AND u.silenced=0
    JOIN chat_members cm ON cm.group_id=m.group_id AND cm.user_id=u.id
    WHERE e.id=? AND e.lease=? AND i.callback_url IS NOT NULL
      AND m.created_at>=cm.joined_at AND m.id>=${CHAT_HISTORY_FLOOR}
      AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=m.group_id AND user_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM user_limits WHERE user_id=u.id AND u.is_admin=0 AND kind='chat' AND (until=0 OR until>unixepoch()))`)
    .bind(id, lease).first<Delivery>()

  let state = 'cancelled', error: string | null = null, nextAt = at
  if (event) {
    const url = botCallbackUrl(env, event.callback_url)
    if (url) {
      const payload = JSON.stringify({
        type: 'chat.command', event_id: id, installation_id: event.installation_id,
        group_id: event.group_id, message_id: event.message_id,
        bot_username: event.username, sender_id: event.sender_id, sender_username: event.sender_username,
        command: event.command, args: event.args, created_at: event.created_at,
      })
      const timestamp = String(now())
      const secret = await botSigningSecret(key, event.installation_id, event.key_version)
      const signature = await hmacHex(secret, timestamp + '.' + payload)
      try {
        const response = await fetch(url, {
          method: 'POST', body: payload, redirect: 'manual', signal: AbortSignal.timeout(5000),
          headers: {
            'content-type': 'application/json', 'x-jinhuan-event': id,
            'x-jinhuan-timestamp': timestamp, 'x-jinhuan-signature': 'sha256=' + signature,
          },
        })
        if (!response.ok) error = 'HTTP ' + response.status
        await response.body?.cancel().catch(() => {})
      } catch { error = '回调连接失败或超时' }
      state = error ? (claimed.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending') : 'delivered'
      if (state === 'pending') nextAt = now() + 30 * 2 ** (claimed.attempts - 1)
    } else { state = 'failed'; error = '回调域名未开放' }
  } else { error = '消息或机器人已不可用' }

  await db.prepare('UPDATE chat_bot_events SET state=?,error=?,next_at=?,lease=NULL WHERE id=? AND lease=?')
    .bind(state, error, nextAt, id, lease).run()
}

export async function runBotDeliveries(env: Env, at: number) {
  if (!env.CHAT_BOT_WEBHOOK_KEY) return
  const { results } = await env.DB.prepare(`SELECT id,attempts FROM chat_bot_events
    WHERE state IN('pending','delivering') AND next_at<=? ORDER BY next_at,id LIMIT 20`).bind(at)
    .all<{ id: string; attempts: number }>()
  for (let i = 0; i < results.length; i += 4) {
    await Promise.allSettled(results.slice(i, i + 4).map(event => event.attempts < MAX_ATTEMPTS
      ? deliverBotEvent(env, event.id)
      : env.DB.prepare(`UPDATE chat_bot_events SET state='failed',lease=NULL,error='投递超时'
          WHERE id=? AND state IN('pending','delivering') AND next_at<=? AND attempts>=?`)
        .bind(event.id, at, MAX_ATTEMPTS).run()))
  }
}

export async function pruneBotEvents(db: D1Database, at: number) {
  await db.prepare('DELETE FROM chat_bot_events WHERE id IN (SELECT id FROM chat_bot_events WHERE created_at<? ORDER BY created_at,id LIMIT 500)')
    .bind(at - RETENTION).run()
}
