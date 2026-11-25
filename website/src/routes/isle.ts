// 鱼鱼谷重做 · 第 1 阶段：/api/isle/sync 增量同步（2026-11-23，见 docs/yuyugu-redesign.md）。
// 一次返回：自己的小岛存档（rev 或岛日变了才给）、邻居摘要（≥60 秒重算一次）、新的守护对战记录、赛季与鱼币余额。
// 客户端拿上次的 cursor 再来要，没变化时响应只有几十字节；替代原来分别请求 /api/pet/world、/neighbors、/guard-log。
// 旧接口仍保留（老页面 / 操作后刷新还在用），另加按用户的频率上限，挡住脚本高频扫岛。
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Ctx } from '../types'
import { fail } from '../lib/http'
import { needUser } from '../services/auth'
import { fishWallet, isleSeasonAt, isleSeasonView } from '../services/isle-season'

type WorldPayload = { rev: number; isleDay: string; coins: number; state: Record<string, unknown> & { vis?: unknown[] } }
export type IsleDeps = {
  worldPayload: (db: D1Database, userId: number, t: number) => Promise<WorldPayload>
  neighborSummary: (db: D1Database, userId: number, me: WorldPayload['state'], t: number) => Promise<unknown>
}

type Cursor = { v: 1; r: number; d: string; g: number; s: number; k: number; n: number }
const encode = (x: Cursor) => btoa(JSON.stringify(x)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function decode(raw: string | undefined): Cursor | null {
  if (!raw) return null
  if (raw.length > 300) fail(400, '同步参数无效')
  try {
    const x = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))) as Cursor
    if (x.v === 1 && [x.r, x.g, x.s, x.k, x.n].every(Number.isSafeInteger) && typeof x.d === 'string' && x.d.length <= 16) return x
  } catch { /* 落到下面 */ }
  return fail(400, '同步参数无效')
}

// ---- 按用户的滑动窗口限流（自建服务器单进程，内存足够；重启即清零） ----
const hits = new Map<string, number[]>()
let sweptAt = 0
/** 返回需要等待的秒数，0 表示放行。 */
export function isleThrottle(key: string, limit: number, windowS: number, nowMs = Date.now()) {
  if (nowMs - sweptAt > 60_000) { sweptAt = nowMs; for (const [k, v] of hits) if (!v.length || nowMs - v[v.length - 1] > 600_000) hits.delete(k) }
  const list = (hits.get(key) ?? []).filter((x) => nowMs - x < windowS * 1000)
  if (list.length >= limit) { hits.set(key, list); return Math.max(1, Math.ceil((list[0] + windowS * 1000 - nowMs) / 1000)) }
  list.push(nowMs); hits.set(key, list); return 0
}
const tooFast = (c: Parameters<MiddlewareHandler<Ctx>>[0], wait: number) => {
  c.header('retry-after', String(wait)); c.header('cache-control', 'no-store')
  return c.json({ error: '刷新太频繁，请稍后再试', code: 'rate_limited', retry: wait }, 429)
}

// 正常玩家：进岛 / 操作后刷新一次，串门一次点一个岛；上限按正常手速的数倍设置。
const LEGACY_LIMITS: [RegExp, string, number, number][] = [
  [/^\/api\/pet\/world$/, 'world', 30, 60],
  [/^\/api\/pet\/world\/visit\/\d+$/, 'visit', 40, 60],
  [/^\/api\/pet\/world\/neighbors(\/marked)?$/, 'neighbors', 20, 60],
]
export const isleLegacyLimit: MiddlewareHandler<Ctx> = async (c, next) => {
  const user = c.get('user')
  if (c.req.method === 'GET' && user) {
    const rule = LEGACY_LIMITS.find(([re]) => re.test(c.req.path))
    if (rule) { const wait = isleThrottle(rule[1] + ':' + user.id, rule[2], rule[3]); if (wait) return tooFast(c, wait) }
  }
  await next()
}

const NEIGHBOR_EVERY = 60
const GUARD_QUERY = `SELECT b.id,b.attacker_id,b.defender_id,b.winner,b.rounds,b.created_at,
 COALESCE(a.nick,a.name,a.username) attacker,COALESCE(d.nick,d.name,d.username) defender
 FROM pet_battles b JOIN users a ON a.id=b.attacker_id JOIN users d ON d.id=b.defender_id
 WHERE (b.attacker_id=?1 OR b.defender_id=?1) AND b.operation LIKE 'guard:%' AND b.id>?2
 ORDER BY b.id DESC LIMIT 20`

export function isleRoutes(deps: IsleDeps) {
  const isle = new Hono<Ctx>()
  isle.use('/api/isle/*', async (c, next) => { needUser(c); c.header('cache-control', 'no-store'); await next() })

  isle.get('/api/isle/sync', async (c) => {
    const u = needUser(c), db = c.env.DB, t = Math.floor(Date.now() / 1000)
    const since = decode(c.req.query('since'))
    // 客户端正常 15～120 秒一次；首次 / 切回前台可以紧接着来一次。
    const wait = isleThrottle('sync:' + u.id, 6, 30)
    if (wait) return tooFast(c, wait)
    const [world, seasonRow] = await Promise.all([deps.worldPayload(db, u.id, t), isleSeasonAt(db, t)])
    const season = isleSeasonView(seasonRow, t)
    const worldChanged = !since || since.r !== world.rev || since.d !== world.isleDay
    const needNeighbors = !since || worldChanged || t - since.n >= NEIGHBOR_EVERY
    const [guardRows, fish, neighbors] = await Promise.all([
      db.prepare(GUARD_QUERY).bind(u.id, since?.g ?? 0).all<{ id: number }>().then((r) => r.results),
      fishWallet(db, seasonRow.id, u.id),
      needNeighbors ? deps.neighborSummary(db, u.id, world.state, t) : Promise.resolve(null),
    ])
    const cursor: Cursor = {
      v: 1, r: world.rev, d: world.isleDay, s: season.id, k: season.rate,
      g: guardRows.length ? guardRows[0].id : since?.g ?? 0,
      n: needNeighbors ? t : since!.n,
    }
    const seasonChanged = !since || since.s !== season.id || since.k !== season.rate
    return c.json({
      cursor: encode(cursor), now: t,
      // 建议的下次同步间隔（秒）；页面隐藏时客户端自行放慢。
      next: season.phase === 'doomsday' ? 20 : 30,
      changed: worldChanged || guardRows.length > 0 || seasonChanged || !!neighbors,
      world: worldChanged ? world : null,
      neighbors,
      guard: { battles: guardRows, reset: !since },
      season: seasonChanged ? season : null,
      wallet: { coins: world.coins, fish: fish.balance, seasonId: seasonRow.id },
    })
  })

  isle.get('/api/isle/season', async (c) => {
    const u = needUser(c), db = c.env.DB, t = Math.floor(Date.now() / 1000)
    const row = await isleSeasonAt(db, t), fish = await fishWallet(db, row.id, u.id)
    return c.json({ season: isleSeasonView(row, t), wallet: { fish: fish.balance, seasonId: row.id }, now: t })
  })
  return isle
}
