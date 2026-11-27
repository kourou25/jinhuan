import { Context, type ExecutionContext } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Env } from '../env'
import type { Ctx, User } from '../types'
import { sha256 } from '../lib/crypto'
import { now } from '../lib/time'
import { ACTIVE_SESSION_USER_SQL, findSessionUser } from './auth'
import { CHAT_HISTORY_FLOOR } from './chat-access'
import { ANON_GROUP_IDS, ANON_HISTORY_SECONDS, seesAnonGroup } from './identity-mask'

export type ChatRealtimeAuth = { userId: number; sessionId: string; host: string }
type ChatViewer = Pick<User, 'id' | 'role' | 'is_admin' | 'main_activated_at'>
export type ChatRealtimeAccess = {
  user: ChatViewer
  generation: string
  joinedAt: number
  historyFloor: number
  notifyOnly: boolean
  membershipEpoch: string | null
}
export const chatRealtimeAuthKey = (auth: ChatRealtimeAuth) => `${auth.host}\n${auth.sessionId}`
const generations = new Map<string, Promise<string>>()
function deriveGeneration(seed: string) {
  const cached = generations.get(seed)
  if (cached) return cached
  if (generations.size >= 4096) generations.clear()
  const next = sha256(seed)
  generations.set(seed, next)
  return next
}
export const chatActivationRequired = (env: Env, host: string) =>
  env.MAIN_ACTIVATION === 'required' && host !== 'cc.52dmeme.com'

export async function authenticateChatRealtime(request: Request, env: Env, ctx?: ExecutionContext): Promise<ChatRealtimeAuth | null> {
  if (!env.CHAT_REALTIME?.groups.size) return null
  const c = new Context<Ctx>(request, { env, executionCtx: ctx })
  const sid = getCookie(c, 'sid')
  if (!sid) return null
  const sessionId = await sha256(sid)
  const user = await findSessionUser(env.DB, sessionId)
  const host = new URL(request.url).hostname
  return user && (!chatActivationRequired(env, host) || user.main_activated_at) ? { userId: user.id, sessionId, host } : null
}

type AccessRow = ChatViewer & {
  session_id: string
  joined_at: number
  history_floor: number
  realtime_epoch: string | null
}

export async function getChatRealtimeAccessBatch(
  auths: ChatRealtimeAuth[], groupId: number, env: Env, _ctx?: ExecutionContext,
): Promise<Map<string, ChatRealtimeAccess>> {
  if (!auths.length || !env.CHAT_REALTIME?.groups.has(groupId)) return new Map()
  const sessions = [...new Set(auths.map(auth => auth.sessionId))]
  const t = now()
  const rows = await env.DB.prepare(`SELECT s.id AS session_id,u.id,u.role,u.is_admin,u.main_activated_at,
    cm.joined_at,cm.realtime_epoch,${CHAT_HISTORY_FLOOR} AS history_floor
    FROM json_each(?) requested CROSS JOIN sessions s ON s.id=requested.value CROSS JOIN users u ON u.id=s.user_id
    CROSS JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=? CROSS JOIN chat_groups g ON g.id=cm.group_id
    WHERE ${ACTIVE_SESSION_USER_SQL}
      AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=cm.group_id AND b.user_id=u.id)`)
    .bind(JSON.stringify(sessions), groupId, t).all<AccessRow>()
  const bySession = new Map(rows.results.map(u => [u.session_id, u]))
  const result = new Map<string, ChatRealtimeAccess>()
  await Promise.all(auths.map(async auth => {
    const u = bySession.get(auth.sessionId)
    if (u?.id !== auth.userId || (chatActivationRequired(env, auth.host) && !u.main_activated_at)) return
    const anonGroup = ANON_GROUP_IDS.has(groupId)
    const notifyOnly = anonGroup && seesAnonGroup(env, u)
    const anon = anonGroup && !notifyOnly
    const generation = await deriveGeneration(JSON.stringify([
      'jinhuan-chat-realtime-v2', auth.host, u.session_id, u.id, groupId, u.realtime_epoch,
      u.joined_at, u.history_floor, anon, notifyOnly, u.is_admin, u.role,
    ]))
    const joinedAt = anon ? Math.max(u.joined_at, t - ANON_HISTORY_SECONDS) : u.joined_at
    const user = { id: u.id, role: u.role, is_admin: u.is_admin, main_activated_at: u.main_activated_at }
    result.set(chatRealtimeAuthKey(auth), { user, generation, joinedAt, historyFloor: u.history_floor, notifyOnly, membershipEpoch: u.realtime_epoch })
  }))
  return result
}

export async function getChatRealtimeAccess(auth: ChatRealtimeAuth, groupId: number, env: Env, ctx?: ExecutionContext) {
  return (await getChatRealtimeAccessBatch([auth], groupId, env, ctx)).get(chatRealtimeAuthKey(auth)) ?? null
}
