// 身份遮罩（2026-11-23）
// 1. 匿名群（默认群「迷友」chat/1）：除站长外，看到的发言者是每周一换的系列角色（services/anon-identity.ts，可自己关闭），只能看最近 24 小时消息，5 天不活跃自动移出。
// 2. 新用户（注册不满 30 天）：图廊里看不到发帖人（显示化名），群聊里看到的和老用户一样；只开放图廊、群聊、鱼鱼谷。
// 化名由用户 ID + 日期 + 服务端密钥派生：同一天内同一个人同一个化名，每天轮换，无法反推真实账号；一天以前的内容统一显示「鱼友」。头像、称号、徽章一并去掉。
import { sha256 } from '../lib/crypto'
import { now } from '../lib/time'
import { anonSettings, isAnonGroup, maskAnonJson, messagePeople, redactSystemBody } from './anon-identity'

export const ANON_GROUP_IDS = new Set([1])
export const ANON_HISTORY_SECONDS = 86400
export const ANON_IDLE_SECONDS = 5 * 86400
export const NEWBIE_SECONDS = 30 * 86400
// 被拉进这些群的成员不受新用户限制，也不会因不活跃被移出匿名群（2026-11-23 站长指定 chat/8）
export const TRUSTED_GROUP_IDS = new Set([8])
export const inTrustedGroup = async (db: { prepare(q: string): any }, uid: number) => !!(await db.prepare('SELECT 1 FROM chat_members WHERE user_id=? AND group_id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(uid, JSON.stringify([...TRUSTED_GROUP_IDS])).first())
// 新用户能用的页面 / 接口前缀（其余模块对新用户关闭）
export const NEWBIE_PAGES = ['/', '/chat', '/pets', '/valley', '/m/', '/me', '/login', '/register', '/welcome', '/activate']

type Viewer = { id: number; created_at?: number | null; is_admin?: number | boolean | null; role?: string | null } | null | undefined
type Env = { ADMIN_USER_IDS?: string; PASSWORD_PEPPER?: string }

const ownerIds = (env: Env) => (env.ADMIN_USER_IDS || '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isSafeInteger(x) && x !== 0)
export const isSiteOwner = (env: Env, u: Viewer) => !!u && ownerIds(env).includes(u.id)
const isStaff = (u: Viewer) => !!u && (!!u.is_admin || u.role === 'admin' || u.role === 'gadmin')

// 新用户：注册不满 30 天、不是站长或管理员
export function isNewbie(env: Env, u: Viewer, t = now()) {
  if (!u || isSiteOwner(env, u) || isStaff(u)) return false
  return !!u.created_at && t - Number(u.created_at) < NEWBIE_SECONDS
}
// 匿名群里谁能看到真实身份：只有站长
export const seesAnonGroup = (env: Env, u: Viewer) => isSiteOwner(env, u)

// ---------- 化名 ----------
const ADJ = ['摸鱼', '潜水', '路过', '围观', '吃瓜', '冲浪', '发呆', '散步', '晒网', '打盹', '溜达', '咸鱼']
const cache = new Map<string, Alias>()
export type Alias = { id: number; name: string }
// 一天以前的内容：所有人统一成这个身份
export const OLD_ALIAS: Alias = { id: -1, name: '鱼友' }
const bjDay = (t: number) => new Date((t + 28800) * 1000).toISOString().slice(0, 10)
// ts：内容的时间（秒）。当天内同一个人同一个化名，第二天换新的；超过 24 小时一律 OLD_ALIAS；没有时间按今天算
export async function aliasOf(env: Env, uid: number | string, ts?: number | null): Promise<Alias> {
  const t = now()
  if (ts && t - ts > ANON_HISTORY_SECONDS) return OLD_ALIAS
  const day = bjDay(ts || t), key = uid + '|' + day
  const hit = cache.get(key)
  if (hit) return hit
  const hex = await sha256('identity-mask-v2|' + (env.PASSWORD_PEPPER || 'jinhuan') + '|' + uid + '|' + day)
  const n = parseInt(hex.slice(0, 8), 16)
  // 负数 id：客户端拿去查用户卡片会 404，不会命中任何真实账号
  const alias = { id: -(1e12 + (n % 9e11)), name: ADJ[n % ADJ.length] + '鱼友·' + hex.slice(8, 12).toUpperCase() }
  if (cache.size > 5000) cache.clear()
  cache.set(key, alias)
  return alias
}

// 把一个用户对象（含 id / username / name / avatar 等字段）换成化名；自己保持原样
export async function maskPerson<T extends Record<string, unknown>>(env: Env, viewer: Viewer, person: T, idKey = 'id', ts?: number | null): Promise<T> {
  const uid = Number(person?.[idKey])
  if (!person || !Number.isSafeInteger(uid) || uid === 0 || (viewer && uid === viewer.id)) return person
  const a = await aliasOf(env, uid, ts)
  const out: Record<string, unknown> = { ...person, [idKey]: a.id }
  for (const k of ['username', 'name', 'nick']) if (k in out) out[k] = a.name
  if (!('name' in out) && !('username' in out)) out.name = a.name
  for (const k of ['avatar', 'deco', 'title', 'badges', 'official_titles', 'email']) if (k in out) out[k] = null
  for (const k of ['is_admin', 'fancy']) if (k in out) out[k] = false
  if ('trust_level' in out) out.trust_level = 0
  return out as T
}

// ---------- 通用 JSON 遮罩 ----------
// 识别「人」：带 username / avatar / author_avatar 字段的对象。用户 id 依次取 user_id、author_id、uid、id。
// 群、称号、梗图本身等对象没有这些字段，不会被改动。
const PERSON_ID_KEYS = ['user_id', 'author_id', 'uid', 'id']
const NAME_KEYS = ['username', 'name', 'nick', 'user_name', 'author', 'author_name', 'author_nick', 'author_username', 'by']
const AVATAR_KEYS = ['avatar', 'author_avatar', 'user_avatar', 'author_deco']
const isPerson = (o: Record<string, unknown>) => 'username' in o || 'avatar' in o || 'author_avatar' in o || 'user_avatar' in o
// uniform：未登录访客用，所有人一律「鱼友」，不给每日化名（化名也能把同一作者的帖子串起来）
export async function maskJsonPeople(env: Env, viewer: Viewer, data: unknown, depth = 0, parentTs: number | null = null, uniform = false, chatReference = false): Promise<unknown> {
  if (depth > 12 || data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return Promise.all(data.map((x) => maskJsonPeople(env, viewer, x, depth + 1, parentTs, uniform)))
  const o = data as Record<string, unknown>, out: Record<string, unknown> = {}
  const own = Number(o.created_at ?? o.at), ts = Number.isFinite(own) && own > 1e9 ? own : parentTs
  for (const [k, v] of Object.entries(o)) {
    // 引用摘要的 ID 用于跳到原消息，用户名等字段继续做身份遮罩。
    const reference = k === 'reply_to' && typeof o.group_id === 'number' && typeof o.id === 'number' && !!o.user
    out[k] = await maskJsonPeople(env, viewer, v, depth + 1, ts, uniform, reference)
  }
  if (!isPerson(o)) return out
  // 已经按 1 群匿名身份处理过的人（anon-identity.ts），不再套每日化名
  if ('anon' in o) return out
  // `id` 只在真正的用户对象（带 username）上当作用户 id；梗图、评论等对象的 id 是它们自己的编号，不能动
  const idKey = PERSON_ID_KEYS.filter((k) => k !== 'id' || (!chatReference && 'username' in o))
    .find((k) => o[k] !== null && o[k] !== '' && Number.isSafeInteger(Number(o[k])) && Number(o[k]) !== 0)
  const uid = idKey ? Number(o[idKey]) : 0
  if (viewer && uid === viewer.id) return out
  // 没有用户 id 时（如历史梗图只有作者名）按名字派生，同一作者仍是同一个化名
  const nameSeed = ['username', 'author_name', 'author', 'name'].map((k) => o[k]).find((v) => typeof v === 'string' && v)
  const alias = uniform ? OLD_ALIAS : uid ? await aliasOf(env, uid, ts) : nameSeed ? { ...(await aliasOf(env, 'name:' + nameSeed, ts)), id: 0 } : OLD_ALIAS
  if (idKey) out[idKey] = alias.id
  for (const k of NAME_KEYS) if (typeof out[k] === 'string' && out[k]) out[k] = alias.name
  for (const k of AVATAR_KEYS) if (k in out) out[k] = null
  for (const k of ['deco', 'badges', 'official_titles', 'email', 'bio', 'role', 'last_seen']) if (k in out) out[k] = null
  // title 只在用户对象上是称号；梗图对象（带 author_avatar）的 title 是帖子标题，不能清空
  if ('username' in o && 'title' in out) out.title = null
  for (const k of ['is_admin', 'fancy', 'author_fancy', 'owner', 'creator']) if (k in out) out[k] = false // owner/creator 会暴露哪个化名是站长或群主
  if ('trust_level' in out) out.trust_level = 0
  return out
}

// 新用户不能用的接口和页面
const NEWBIE_BLOCKED_API = ['/api/road', '/api/novels', '/api/xs', '/api/dm', '/api/users/', '/api/guess', '/api/resources', '/api/huancai', '/api/music', '/api/manor', '/api/arcade', '/api/hb', '/api/bottles', '/api/autumn']
const NEWBIE_BLOCKED_PAGE = /^\/(road|autumn|novels|community-updates|music|huancai|manor|arcade|bottles|dm|xs|u\/)(\/|\.html|$)/

type Ctx = { req: { path: string; method: string; url: string }; env: Env & Record<string, any>; get(k: 'user' | 'chatMessageViewFinalized'): any; res: Response; json(o: unknown, s?: number): Response; redirect(u: string, s?: number): Response }

// 历史列表和实时投递在各自的读快照内完成同一层匿名群出口处理。
export async function finalizeChatMessageView<T>(c: Pick<Ctx, 'env' | 'get'>, gid: number, data: T): Promise<T> {
  return isAnonGroup(gid) ? await maskAnonJson(c, gid, data) as T : data
}
// 未登录访客的 GET 接口：所有「人」（上传者、评论者、头像、称号）一律换成「鱼友」
async function maskGuestResponse(c: Ctx) {
  if (!(c.res.headers.get('content-type') || '').includes('application/json')) return
  let data: unknown
  try { data = await c.res.clone().json() } catch { return }
  const headers = new Headers(c.res.headers)
  headers.delete('content-length')
  c.res = new Response(JSON.stringify(await maskJsonPeople(c.env, null, data, 0, null, true)), { status: c.res.status, headers })
}
// 在识别出当前用户之后、业务路由之前注册：app.use('*', identityMaskMiddleware)
export async function identityMaskMiddleware(c: Ctx, next: () => Promise<void>) {
  const viewer = c.get('user'), path = c.req.path
  const newbie = isNewbie(c.env, viewer) && !(await inTrustedGroup(c.env.DB, viewer.id))
  const own = viewer && path === '/api/users/' + viewer.id // 自己的资料卡照常可看
  if (newbie && !own && NEWBIE_BLOCKED_API.some((p) => path.startsWith(p))) return c.json({ error: '注册满 30 天后开放', code: 'newbie_locked' }, 403)
  if (newbie && c.req.method === 'GET' && NEWBIE_BLOCKED_PAGE.test(path)) return c.redirect('/', 302)
  // 未登录访客：不能按作者筛图、不能看用户卡片（2026-11-24 站长要求访客看不到上传者和用户信息）
  const guestGet = !viewer && c.req.method === 'GET' && path.startsWith('/api/')
  if (guestGet && (path.startsWith('/api/users/') || (path === '/api/memes' && new URL(c.req.url).searchParams.get('author')))) return c.json({ error: '登录后才能查看用户信息', code: 'login_required' }, 401)
  await next()
  if (guestGet) return maskGuestResponse(c)
  if (!viewer || !path.startsWith('/api/')) return
  if (c.get('chatMessageViewFinalized')) return
  const type = c.res.headers.get('content-type') || ''
  if (!type.includes('application/json')) return
  let anon = 0, plainAlias = false
  if (!seesAnonGroup(c.env, viewer)) {
    const g = path.match(/^\/api\/chat\/(?:groups\/)?(\d+)(?:\/(.*))?$/)
    if (g && isAnonGroup(g[1])) {
      anon = Number(g[1])
      if (/^bots(\/|$)/.test(g[2] || '')) anon = 0 // 机器人管理页只有机器人
      if (/^(outside|join-req)(\/|$)/.test(g[2] || '')) plainAlias = true // 不在群里的人没有角色，用每日化名
    }
    const m = path.match(/^\/api\/chat\/messages\/(\d+)\//)
    if (m) {
      const row = await c.env.DB.prepare('SELECT group_id FROM chat_messages WHERE id=?').bind(Number(m[1])).first() as { group_id: number } | null
      if (row && isAnonGroup(row.group_id)) anon = Number(row.group_id)
    }
  }
  const isMe = path === '/api/me'
  // 新用户只遮图廊的人（2026-11-26 站长要求）：群聊相关接口不套化名
  const chatPath = /^\/api\/(chat|ai\/chat|guess-sidebar)\//.test(path) || path === '/api/chat/groups' || path === '/api/notifs'
  const galleryNewbie = newbie && !chatPath
  if (!anon && !galleryNewbie && !isMe && path !== '/api/notifs' && path !== '/api/chat/groups') return
  let data: any
  try { data = await c.res.clone().json() } catch { return }
  if (isMe) { if (data && typeof data === 'object' && !Array.isArray(data)) data.newbie = newbie }
  else if (anon && !plainAlias) {
    const all = new URL(c.req.url).searchParams.get('period') === 'all' || /\/title-raffles(\/|$)/.test(path)
    const stats = /\/(guess-stats|packet-luck-stats|sender-stats)$|\/title-raffles(\/|$)/.test(path) ? (all ? 'all' : 'today') : undefined
    data = await maskAnonJson(c as any, anon, data, stats)
  } else {
    const owner = seesAnonGroup(c.env, viewer)
    if (path === '/api/notifs' && Array.isArray(data?.items) && !owner) data.items = await maskNotifs(c, data.items)
    // 新用户：通知里来自图廊的（gid ≤ 0）照旧化名
    if (path === '/api/notifs' && newbie && Array.isArray(data?.items)) data.items = await Promise.all(data.items.map((n: any) => Number(n?.gid) > 0 ? n : maskJsonPeople(c.env, viewer, n)))
    if (path === '/api/chat/groups' && Array.isArray(data?.groups)) data.groups = await maskGroupList(c, data.groups, owner)
    if (galleryNewbie || anon) data = await maskJsonPeople(c.env, viewer, data)
  }
  const headers = new Headers(c.res.headers)
  headers.delete('content-length')
  c.res = new Response(JSON.stringify(data), { status: c.res.status, headers })
}

// 通知里来自匿名群的回复 / @：发起人换成对外身份；红包结果正文里有领取人的名字，换成通用说法
async function maskNotifs(c: Ctx, items: any[]) {
  const mine = items.filter((n) => isAnonGroup(n?.gid) && ['chat_at', 'chat_reply'].includes(n.kind))
  const people = mine.length ? await messagePeople(c as any, mine.map((n) => ({ id: Number(n.meme_id), user_id: Number(n.user_id), created_at: Number(n.at), person: { id: n.user_id, username: n.username, name: n.name, avatar: n.avatar } }))) : null
  return Promise.all(items.map(async (n) => {
    if (!isAnonGroup(n?.gid)) return n
    const p = mine.includes(n) ? people?.get(Number(n.meme_id)) : null
    if (p) return { ...n, user_id: p.id, username: p.username, name: p.name, avatar: p.avatar, anon: p.anon ?? null }
    if (n.kind === 'join_req') return maskJsonPeople(c.env, c.get('user'), n)
    const out: any = await maskAnonJson(c as any, Number(n.gid), n)
    return n.kind === 'packet' ? { ...out, val: redactSystemBody('redpack_result', String(n.val ?? '')) } : out
  }))
}
// 群列表里最后一条消息的发言人和摘要；匿名群附上自己的匿名状态
async function maskGroupList(c: Ctx, groups: any[], owner: boolean) {
  return Promise.all(groups.map(async (g) => {
    if (!isAnonGroup(g?.id)) return g
    const { enabled, active, eligible_at, identity } = await anonSettings(c as any, Number(g.id)), anon = { enabled, active, eligible_at, identity }
    if (!g.latest || owner) return { ...g, anon }
    const row = await c.env.DB.prepare('SELECT x.id,x.user_id,x.created_at,x.system_kind,x.body,x.deleted,u.username,u.name FROM chat_messages x LEFT JOIN users u ON u.id=x.user_id WHERE x.id=?').bind(g.latest.id).first() as any
    const p = row ? (await messagePeople(c as any, [{ ...row, person: { username: row.username, name: row.name } }], Number(g.id))).get(Number(row.id)) : null
    const text = row?.system_kind && !row.deleted ? redactSystemBody(row.system_kind, String(row.body)).split('\n')[0].slice(0, 60) : g.latest.text
    return { ...g, anon, latest: { ...g.latest, by: p?.name || p?.username || OLD_ALIAS.name, text } }
  }))
}
