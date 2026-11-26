import type { Env } from '../env'
import type { ExecutionContext } from 'hono'
import { atReads, CHAT_SELECT, decorateMsgs } from '../legacy/live-app.js'
import { hydrateChatDecorations } from './chat-message-hydrate'
import type { ChatRealtimeAccess, ChatRealtimeAuth } from './chat-realtime-access'
import { chatCommandIds } from './chat-realtime-store'
import { maskJsonPeople } from './identity-mask'
import { hydrateChatPackets } from './chat-packet-projection'

export type ChatRealtimeRow = {
  id: number; group_id: number; user_id: number; created_at: number; seq: number
  deleted: number; redpack_id: string | null; body: string
}
type ChatRealtimeEvent = {
  seq: number; group_id: number; message_id: number; kind: 'create' | 'update' | 'delete'; audience_user_id?: number | null
}

export async function hydrateChatRealtimeBatch(env: Env, groupId: number, messageIds: number[]) {
  const rows = messageIds.length ? (await env.DB.prepare(`${CHAT_SELECT}
    WHERE x.group_id=? AND x.id IN (SELECT value FROM json_each(?))`)
    .bind(groupId, JSON.stringify(messageIds)).all<ChatRealtimeRow>()).results : []
  const [decorations, reads, packets] = await Promise.all([
    hydrateChatDecorations(env.DB, rows.map(row => row.id)),
    atReads({ env }, rows),
    hydrateChatPackets(env.DB, rows),
  ])
  return { byId: new Map(rows.map(row => [row.id, row])), decorations, reads, packets }
}

export async function projectChatRealtimeBatch(
  auth: ChatRealtimeAuth, access: ChatRealtimeAccess, groupId: number,
  batch: Awaited<ReturnType<typeof hydrateChatRealtimeBatch>>, events: ChatRealtimeEvent[], env: Env, _ctx?: ExecutionContext,
) {
  if (access.user.id !== auth.userId) return { items: [], changed: [], resync: true }
  const live = new Map<number, { row: ChatRealtimeRow; firstSeen: boolean }>()
  for (const event of events) {
    if (event.group_id !== groupId || (event.audience_user_id != null && event.audience_user_id !== auth.userId)) continue
    const row = batch.byId.get(event.message_id)
    // 硬删除行已经不可用于权限判断，用通用重载信号修复缓存。
    if (!row) return { items: [], changed: [], resync: true }
    if (row.created_at < access.joinedAt || row.id < access.historyFloor) continue
    const firstSeen = event.kind === 'create' || live.get(row.id)?.firstSeen === true
    live.set(row.id, { row, firstSeen })
  }
  if (!live.size) return { items: [], changed: [] }
  const rows = [...live.values()].map(item => item.row)
  const [messages, commandIds] = await Promise.all([
    decorateMsgs({ env, get: () => access.user }, rows, {
      decorations: batch.decorations, reads: batch.reads, packets: batch.packets, joinedAt: access.joinedAt, historyFloor: access.historyFloor,
    }),
    chatCommandIds(env.DB, auth.userId, rows.filter(row => row.user_id === auth.userId).map(row => row.id)),
  ])
  // 与 HTTP 的身份遮罩相同，匿名群和受限新账号投影按订阅者生成。
  const masked = access.masked ? await maskJsonPeople(env, access.user, messages) as typeof messages : messages
  const items: typeof messages = [], changed: typeof messages = []
  for (const message of masked) {
    const entry = live.get(message.id)!
    const commandId = commandIds.get(message.id)
    const projected = { ...message, floor: entry.row.seq, ...(commandId ? { command_id: commandId } : {}) }
    const destination = entry.firstSeen ? items : changed
    destination.push(projected)
  }
  return { items, changed }
}
