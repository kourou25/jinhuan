import { Context } from 'hono'
import type { C, Ctx } from '../types'
import { hex, sha256 } from '../lib/crypto'
import { fail, jsonBody } from '../lib/http'
import { ACTIVE_SESSION_USER_SQL } from './auth'
import { needMember, CHAT_HISTORY_FLOOR, type ChatGroup } from './chat-access'
import { chatActivationRequired, getChatRealtimeAccess, type ChatRealtimeAccess } from './chat-realtime-access'
import type { ExternalPacket } from '../redpacket'

export const CHAT_REALTIME_HEAD_SQL = `MAX(
  COALESCE((SELECT MAX(seq) FROM chat_realtime_events WHERE group_id=?1),0),
  COALESCE((SELECT seq FROM chat_realtime_pruned WHERE group_id=?1),0))`
const COMMAND_KIND = 'send'
const realtimeSchemaMissing = (error: unknown) => /no such (?:table|column): .*chat_realtime_/i.test(String(error))

export function chatContextWithDb(c: C, db: D1Database): C {
  const scoped = new Context<Ctx>(c.req.raw, { env: { ...c.env, DB: db }, executionCtx: c.executionCtx })
  scoped.set('user', c.get('user'))
  return scoped
}

export async function readChatHistory<T>(
  c: C,
  groupId: number,
  read: (c: C, realtime?: { realtime_cursor: number; realtime_mode: 'shadow' | 'live'; realtime_generation: string }) => Promise<T>,
) {
  const capability = c.env.CHAT_REALTIME
  if (!capability?.groups.has(groupId)) return read(c)
  try {
    // 事件水位、消息行及衍生字段使用同一个 SQLite 读快照。
    return await capability.withSnapshot(async db => {
      const control = await db.prepare('SELECT disabled,shadow FROM chat_realtime_controls WHERE group_id=?')
        .bind(groupId).first<{ disabled: number; shadow: number }>()
      const scoped = chatContextWithDb(c, db)
      if (control?.disabled) return read(scoped)
      const user = c.get('user'), sessionId = c.get('sessionId')
      const access = user && sessionId ? await getChatRealtimeAccess({
        userId: user.id, sessionId, host: new URL(c.req.url).hostname,
      }, groupId, scoped.env) : null
      if (!access) {
        await needMember(scoped, groupId)
        return fail(403, '群聊访问权限已变化，请刷新后重试')
      }
      scoped.set('user', { ...user!, ...access.user })
      const cursor = await db.prepare(`SELECT ${CHAT_REALTIME_HEAD_SQL} AS cursor`).bind(groupId).first<number>('cursor')
      return read(scoped, {
        realtime_cursor: cursor ?? 0,
        realtime_mode: control?.shadow ? 'shadow' : 'live',
        realtime_generation: access.generation,
      })
    })
  } catch (error) {
    if (realtimeSchemaMissing(error)) return read(c)
    throw error
  }
}

export async function readChatRealtimeMessages<T>(
  c: C, groupId: number, generation: string, read: (c: C, access: ChatRealtimeAccess) => Promise<T>,
) {
  const capability = c.env.CHAT_REALTIME
  if (!capability?.groups.has(groupId)) return fail(404, '此群未启用实时消息回读', 'chat_realtime_unavailable')
  const user = c.get('user'), sessionId = c.get('sessionId')
  if (!user || !sessionId) return fail(403, '群聊访问权限已变化，请刷新后重试', 'chat_realtime_forbidden')
  const auth = { userId: user.id, sessionId, host: new URL(c.req.url).hostname }
  try {
    return await capability.withSnapshot(async db => {
      const scoped = chatContextWithDb(c, db)
      const access = await getChatRealtimeAccess(auth, groupId, scoped.env)
      if (!access?.notifyOnly) return fail(403, '群聊访问权限已变化，请刷新后重试', 'chat_realtime_forbidden')
      if (access.generation !== generation) return fail(409, '群聊订阅已变化，请刷新后重试', 'chat_realtime_generation')
      const disabled = await db.prepare('SELECT disabled FROM chat_realtime_controls WHERE group_id=?')
        .bind(groupId).first<number>('disabled')
      if (disabled) return fail(404, '此群未启用实时消息回读', 'chat_realtime_unavailable')
      scoped.set('user', { ...user, ...access.user })
      return read(scoped, access)
    })
  } catch (error) {
    if (realtimeSchemaMissing(error)) return fail(404, '此群未启用实时消息回读', 'chat_realtime_unavailable')
    throw error
  }
}

export type ChatCommand = { id: string; hash: string; sessionId: string; activationRequired: number }
const safeInt = (raw: unknown, min: number, max: number) => {
  const n = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0
}

export async function readChatCommand(c: C, groupId: number, bodyMax: number, uploadMax: number): Promise<ChatCommand | null> {
  if (!c.env.CHAT_REALTIME?.groups.has(groupId)) return null
  const multipart = (c.req.header('content-type') ?? '').includes('multipart/form-data')
  const source = multipart ? await c.req.formData() : await jsonBody<Record<string, unknown>>(c)
  const raw = source instanceof FormData ? source.get('command_id') ?? undefined : source?.command_id
  if (raw === undefined) return null
  if (typeof raw !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(raw)) fail(400, '发送标识无效', 'chat_command_invalid')
  const body = String((source instanceof FormData ? source.get('body') : source?.body) ?? '').replace(/\r/g, '').trim().slice(0, bodyMax)
  const reply = safeInt(source instanceof FormData ? source.get('reply_to') : source?.reply_to, 0, Number.MAX_SAFE_INTEGER)
  const sessionId = c.get('sessionId') ?? fail(401, '请先登录')
  let details
  if (source instanceof FormData) {
    const file = source.get('file')
    if (file instanceof File && file.size > uploadMax) fail(413, '图片不能超过 20MB')
    details = file instanceof File && file.size ? [
      hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
      safeInt(source.get('width'), 1, 20000), safeInt(source.get('height'), 1, 20000),
    ] : []
  } else {
    const media = (Array.isArray(source?.media) ? source.media : []).slice(0, 12).flatMap(m => {
      const key = String(m?.key ?? '')
      return key ? [[key, String(m?.poster || ''), String(m?.orig || ''), safeInt(m?.w, 1, 20000),
        safeInt(m?.h, 1, 20000), String(m?.kind || ''), String(m?.name || ''), !!m?.blur, !!m?.car]] : []
    })
    const favorite = source.favorite as { id?: unknown; version?: unknown } | undefined
    details = [media, favorite === undefined ? null : [Number(favorite?.id), String(favorite?.version ?? '')]]
  }
  const hash = await sha256(JSON.stringify([body, reply, multipart, details]))
  return { id: raw as string, hash, sessionId, activationRequired: Number(chatActivationRequired(c.env, new URL(c.req.url).hostname)) }
}

export async function findChatCommand(db: D1Database, uid: number, groupId: number, command: ChatCommand) {
  const receipt = await db.prepare('SELECT group_id,kind,request_hash,message_id FROM chat_realtime_commands WHERE user_id=? AND command_id=?')
    .bind(uid, command.id).first<{ group_id: number; kind: string; request_hash: string; message_id: number | null }>()
  if (!receipt) return null
  if (receipt.group_id !== groupId || receipt.kind !== COMMAND_KIND || receipt.request_hash !== command.hash) {
    fail(409, '同一发送标识的消息内容已变化', 'chat_command_conflict')
  }
  return receipt.message_id
}

export function beginChatCommand(db: D1Database, uid: number, group: ChatGroup, command: ChatCommand, at: number) {
  // 幂等登记和业务写入同一批提交。并发重复命中唯一键时，附件认领及其余写入全部回滚。
  return db.prepare(`INSERT INTO chat_realtime_commands(user_id,command_id,group_id,kind,request_hash,created_at)
    VALUES(?3,CASE WHEN EXISTS(
      SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
      JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=?1 JOIN chat_groups g ON g.id=cm.group_id
      WHERE s.id=?2 AND u.id=?3 AND ${ACTIVE_SESSION_USER_SQL.replace('?', 'unixepoch()')}
       AND (?4=0 OR u.main_activated_at) AND u.silenced=0
       AND cm.joined_at=?5 AND ${CHAT_HISTORY_FLOOR}=?6
       AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=cm.group_id AND b.user_id=u.id)
       AND (u.is_admin<>0 OR NOT EXISTS(SELECT 1 FROM user_limits l
         WHERE l.user_id=u.id AND l.kind='chat' AND (l.until=0 OR l.until>unixepoch())))
    ) THEN ?7 ELSE NULL END,?1,?8,?9,?10)`)
    .bind(group.id, command.sessionId, uid, command.activationRequired, group.real_joined_at ?? group.joined_at,
      group.history_floor, command.id, COMMAND_KIND, command.hash, at)
}

export function finishChatCommand(db: D1Database, uid: number, command: ChatCommand) {
  return db.prepare('UPDATE chat_realtime_commands SET message_id=last_insert_rowid() WHERE user_id=? AND command_id=?')
    .bind(uid, command.id)
}

export function chatCommandSharedPacket(db: D1Database, uid: number, command: ChatCommand, p: ExternalPacket) {
  return db.prepare(`INSERT OR IGNORE INTO chat_redpacks(id,message_id,secret,mode,game,prompt,phrase,provider,external_ref,external_kind,external_code)
    SELECT 'shared:'||m.id||':'||?1||':'||?2,m.id,'外站红包已解锁','open','','','',?1,?2,?3,?4
    FROM chat_realtime_commands c JOIN chat_messages m ON m.id=c.message_id
    WHERE c.user_id=?5 AND c.command_id=?6 AND m.deleted=0 AND m.redpack_id IS NULL AND m.system_kind IS NULL`)
    .bind(p.provider, p.external_ref, p.external_kind, p.external_code || null, uid, command.id)
}

export async function chatCommandIds(db: D1Database, uid: number, ids: number[]) {
  if (!ids.length) return new Map<number, string>()
  const rows = await db.prepare(`SELECT message_id,command_id FROM chat_realtime_commands
    WHERE user_id=? AND kind=? AND message_id IN (SELECT value FROM json_each(?))`)
    .bind(uid, COMMAND_KIND, JSON.stringify(ids)).all<{ message_id: number; command_id: string }>()
  return new Map(rows.results.map(row => [row.message_id, row.command_id]))
}
