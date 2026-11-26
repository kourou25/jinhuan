import { Context, type ExecutionContext } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Env } from '../env'
import type { Ctx, User } from '../types'
import { sha256 } from '../lib/crypto'
import { now } from '../lib/time'
import { ACTIVE_SESSION_USER_SQL, findSessionUser } from './auth'
import { CHAT_HISTORY_FLOOR } from './chat-access'
import { ANON_GROUP_IDS, ANON_HISTORY_SECONDS, TRUSTED_GROUP_IDS, isNewbie, seesAnonGroup } from './identity-mask'

export type ChatRealtimeAuth = { userId: number; sessionId: string; host: string }
type ChatViewer = Pick<User, 'id' | 'role' | 'is_admin' | 'main_activated_at'> & { created_at: number }
export type ChatRealtimeAccess = {
  user: ChatViewer
  generation: string
  joinedAt: number
  historyFloor: number
  masked: boolean
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
  trusted: number
}

export async function getChatRealtimeAccessBatch(
  auths: ChatRealtimeAuth[], groupId: number, env: Env, _ctx?: ExecutionContext,
): Promise<Map<string, ChatRealtimeAccess>> {
  if (!auths.length || !env.CHAT_REALTIME?.groups.has(groupId)) return new Map()
  const sessions = [...new Set(auths.map(auth => auth.sessionId))]
  const t = now()
  const rows = await env.DB.prepare(`SELECT s.id AS session_id,u.id,u.role,u.is_admin,u.created_at,u.main_activated_at,
    cm.joined_at,cm.realtime_epoch,${CHAT_HISTORY_FLOOR} AS history_floor,
    EXISTS(SELECT 1 FROM chat_members tm WHERE tm.user_id=u.id AND tm.group_id IN (SELECT value FROM json_each(?))) AS trusted
    FROM json_each(?) requested CROSS JOIN sessions s ON s.id=requested.value CROSS JOIN users u ON u.id=s.user_id
    CROSS JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=? CROSS JOIN chat_groups g ON g.id=cm.group_id
    WHERE ${ACTIVE_SESSION_USER_SQL}
      AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=cm.group_id AND b.user_id=u.id)`)
    .bind(JSON.stringify([...TRUSTED_GROUP_IDS]), JSON.stringify(sessions), groupId, t).all<AccessRow>()
  const visible = await Promise.all(rows.results.map(async u => {
    const anon = ANON_GROUP_IDS.has(groupId) && !seesAnonGroup(env, u)
    const masked = anon || (!u.trusted && isNewbie(env, u, t))
    const generation = await deriveGeneration(JSON.stringify([
      'jinhuan-chat-realtime-v1', u.session_id, u.id, groupId, u.realtime_epoch,
      u.joined_at, u.history_floor, anon, masked, u.is_admin, u.role,
    ]))
    const joinedAt = anon ? Math.max(u.joined_at, t - ANON_HISTORY_SECONDS) : u.joined_at
    const user = { id: u.id, role: u.role, is_admin: u.is_admin, main_activated_at: u.main_activated_at, created_at: u.created_at }
    return [u.session_id, { user, generation, joinedAt, historyFloor: u.history_floor, masked, membershipEpoch: u.realtime_epoch }] as const
  }))
  const bySession = new Map(visible), result = new Map<string, ChatRealtimeAccess>()
  for (const auth of auths) {
    const access = bySession.get(auth.sessionId)
    if (access?.user.id === auth.userId && (!chatActivationRequired(env, auth.host) || access.user.main_activated_at)) {
      result.set(chatRealtimeAuthKey(auth), access)
    }
  }
  return result
}

export async function getChatRealtimeAccess(auth: ChatRealtimeAuth, groupId: number, env: Env, ctx?: ExecutionContext) {
  return (await getChatRealtimeAccessBatch([auth], groupId, env, ctx)).get(chatRealtimeAuthKey(auth)) ?? null
}
