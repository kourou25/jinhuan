// 「！xx」圈内标签（2026-11-23 站长需求）
// 带「！xx」标签的帖子（标签名里含「！xx」的组合标签也算，例如「！xx/某某」）只有 chat/8 群成员和站长能看到。
// 图廊的查询分散在几十处，这里在出口统一处理，不逐个改 SQL：
//   - 列表类接口：从返回的 JSON 里剔除这些帖子，标签列表里去掉这类标签
//   - 帖子详情接口和 /m/<id> 页面：返回 404
//   - 帖子的站内图片 /img/<key>：返回 404
// 有权限的人拿到的响应改成 private, no-store，避免被缓存后给别人看到。
import { TRUSTED_GROUP_IDS, isSiteOwner } from './identity-mask'
import { sha256 } from '../lib/crypto'

export const CIRCLE_TAG = '！xx'
// 同时认半角「!xx」，不区分大小写
export const isCircleTag = (tag: unknown) => typeof tag === 'string' && /[!！]xx/i.test(tag)
const TAG_SQL = "lower(tag) LIKE '%！xx%' OR lower(tag) LIKE '%!xx%'"

type Db = { prepare(q: string): any }
type Hidden = { ids: Set<number>; keys: Set<string>; at: number }
let hidden: Hidden | null = null, loading: Promise<Hidden> | null = null
const TTL = 15_000

async function load(db: Db): Promise<Hidden> {
  const { results } = await db.prepare(`SELECT m.id, m.image_key, m.gallery FROM memes m WHERE m.id IN (SELECT meme_id FROM meme_tags WHERE ${TAG_SQL})`).all()
  const ids = new Set<number>(), keys = new Set<string>()
  for (const r of results as { id: number; image_key: string | null; gallery: string | null }[]) {
    ids.add(Number(r.id))
    if (r.image_key) keys.add(r.image_key)
    try { for (const g of JSON.parse(r.gallery || '[]')) for (const v of [g?.u, g?.t, g?.o, g?.v]) if (typeof v === 'string' && v.startsWith('/img/')) keys.add(decodeURIComponent(v.slice(5))) } catch {}
  }
  return { ids, keys, at: Date.now() }
}
export async function hiddenCircle(db: Db) {
  if (hidden && Date.now() - hidden.at < TTL) return hidden
  loading ??= load(db).then((h) => (hidden = h)).finally(() => { loading = null })
  return loading
}
// 打标签、改标签之后立即生效
export const invalidateCircle = () => { hidden = null }

const allowedCache = new Map<number, { ok: boolean; at: number }>()
export async function seesCircle(env: { DB: Db; ADMIN_USER_IDS?: string }, viewer: { id: number } | null | undefined) {
  if (!viewer) return false
  if (isSiteOwner(env, viewer)) return true
  const c = allowedCache.get(viewer.id)
  if (c && Date.now() - c.at < TTL) return c.ok
  const ok = !!(await env.DB.prepare('SELECT 1 FROM chat_members WHERE user_id=? AND group_id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(viewer.id, JSON.stringify([...TRUSTED_GROUP_IDS])).first())
  allowedCache.set(viewer.id, { ok, at: Date.now() })
  if (allowedCache.size > 20000) allowedCache.clear()
  return ok
}

// 递归剔除：帖子对象（有 id 且带图片字段，或者 meme_id 指向隐藏帖）、圈内标签
const POST_KEYS = ['image', 'thumb', 'images', 'image_count', 'layout', 'image_url', 'thumb_url']
function strip(data: unknown, ids: Set<number>, depth = 0): { value: unknown; changed: boolean } {
  if (depth > 8 || !data || typeof data !== 'object') return { value: data, changed: false }
  let changed = false
  if (Array.isArray(data)) {
    const out: unknown[] = []
    for (const item of data) {
      if (isCircleTag(item)) { changed = true; continue }
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const o = item as Record<string, unknown>
        const post = ids.has(Number(o.id)) && POST_KEYS.some((k) => k in o)
        if (post || ids.has(Number(o.meme_id)) || (isCircleTag(o.tag) && !('id' in o)) || (isCircleTag(o.name) && 'count' in o)) { changed = true; continue }
      }
      const r = strip(item, ids, depth + 1); changed ||= r.changed; out.push(r.value)
    }
    return { value: out, changed }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const r = strip(v, ids, depth + 1); changed ||= r.changed; out[k] = r.value
  }
  return { value: out, changed }
}

// 站点在图片请求上不加载登录用户（省一次查询）；只有隐藏帖的图片才在这里自己查一次
async function imageViewer(c: Ctx) {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(c.req.header('cookie') || '')?.[1]
  if (!sid) return null
  return await c.env.DB.prepare('SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>unixepoch() AND u.disabled=0').bind(await sha256(decodeURIComponent(sid))).first() as { id: number } | null
}

// Hono 给 c.res 赋新值时会把旧响应的头抄回去，所以直接改原响应的头；改不了（只读）时才换新响应
function setHeader(c: Ctx, k: string, v: string) {
  try { c.res.headers.set(k, v) } catch { const headers = new Headers(c.res.headers); headers.set(k, v); c.res = new Response(c.res.body, { status: c.res.status, headers }) }
}

type Ctx = { req: { path: string; method: string; header(k: string): string | undefined }; env: { DB: Db; ADMIN_USER_IDS?: string }; get(k: 'user'): any; res: Response; json(o: unknown, s?: number): Response; text(t: string, s?: number): Response }
// 在识别出当前用户之后注册：app.use('*', circleTagMiddleware)
export async function circleTagMiddleware(c: Ctx, next: () => Promise<void>) {
  const path = c.req.path, method = c.req.method
  // 改动标签的请求结束后刷新名单
  if (method !== 'GET' && method !== 'HEAD') { await next(); if (/^\/api\/memes|tag/.test(path)) invalidateCircle(); return }
  const isApi = path.startsWith('/api/'), isImg = path.startsWith('/img/'), page = path.match(/^\/m\/(\d+)$/)
  if (!isApi && !isImg && !page) return next()
  const h = await hiddenCircle(c.env.DB)
  if (!h.ids.size) return next()
  let imgKey = ''
  if (isImg) { imgKey = path.slice(5); try { imgKey = decodeURIComponent(imgKey) } catch {} if (!h.keys.has(imgKey)) return next() }
  const allowed = await seesCircle(c.env, isImg ? await imageViewer(c) : c.get('user'))
  if (!allowed) {
    const detail = path.match(/^\/api\/memes\/(\d+)(?:\/|$)/)
    if ((detail && h.ids.has(Number(detail[1]))) || (page && h.ids.has(Number(page[1])))) return isApi ? c.json({ error: '内容不存在' }, 404) : c.text('Not Found', 404)
    if (isImg) return c.text('Not Found', 404)
  }
  await next()
  // 有权限的人打开隐藏帖的图片：不让 Cloudflare 公共缓存存下来
  if (isImg) { setHeader(c, 'cache-control', 'private, max-age=86400'); return }
  // 聊天、私信里的消息 ID 和帖子 ID 是两套编号，不做剔除
  if (!isApi || /^\/api\/(chat|dm)\//.test(path) || !(c.res.headers.get('content-type') || '').includes('application/json')) return
  if (allowed) {
    // 有权限的人看到的完整结果不能进任何共享缓存
    if (/public|s-maxage/.test(c.res.headers.get('cache-control') || '')) setHeader(c, 'cache-control', 'private, no-store')
    // 标签栏只显示热门前 24 个，圈内标签帖子少排不进去：给有权限的人固定放在最前面
    if (path === '/api/tags') {
      let data: any
      try { data = await c.res.clone().json() } catch { return }
      if (!Array.isArray(data?.tags)) return
      const { results } = await c.env.DB.prepare(`SELECT tag, COUNT(*) AS n FROM meme_tags t JOIN memes m ON m.id=t.meme_id WHERE m.hidden=0 AND (${TAG_SQL}) GROUP BY tag ORDER BY n DESC LIMIT 5`).all()
      const circle = (results as { tag: string; n: number }[]).filter((r) => !data.tags.some((t: any) => t?.tag === r.tag))
      if (!circle.length) return
      data.tags = [...circle, ...data.tags]
      c.res = new Response(JSON.stringify(data), { status: c.res.status, headers: c.res.headers })
    }
    return
  }
  let data: unknown
  try { data = await c.res.clone().json() } catch { return }
  const r = strip(data, h.ids)
  if (!r.changed) return
  const headers = new Headers(c.res.headers); headers.delete('content-length')
  c.res = new Response(JSON.stringify(r.value), { status: c.res.status, headers })
}
