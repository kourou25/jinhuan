// 1 群匿名身份
// - 2026-11-26 起：默认实名，自己在群设置里开启匿名；进群满 3 天才生效。角色自己抽（见「自选角色」），持有到被换掉或被侵占。
// - 每条消息发出时的匿名状态和角色由触发器写进 anon_messages；之后怎么切换、换角色都不影响旧消息。
// - 2026-11-25 那版按周分系列（anon_weeks / anon_assignments），只用来显示那几天的旧消息。
// - 站长看到真实身份，另附角色名。
import { ANON_GROUP_IDS, OLD_ALIAS, isSiteOwner } from './identity-mask'
import { SERIES, SERIES_LIST, type Series } from '../anon/catalog'
import AVATARS from '../anon/avatar-manifest.json'
import { now } from '../lib/time'
import { TITLE_COLLECTION, TITLE_STAGES } from '../shared/title-collection'
import { raffleTitleEnabled } from '../shared/raffle-policy'

const AVATAR_SET = AVATARS as Record<string, number[]>

export { SERIES }
export const isAnonGroup = (gid: unknown) => ANON_GROUP_IDS.has(Number(gid))
type Db = { prepare(q: string): any; batch(s: any[]): Promise<any[]> }
type Row = Record<string, any>
export type Assignment = { week: string; user_id: number; series: string; item: number; suffix: number; alias_id: number }
export type AnonTag = { name: string; series: string; series_name: string; item: number; self?: boolean; owner?: boolean; generic?: boolean }

const all = async <T = Row>(db: Db, sql: string, ...args: unknown[]): Promise<T[]> => (await db.prepare(sql).bind(...args).all()).results as T[]
const json = (list: Iterable<unknown>) => JSON.stringify([...list])

// ---------- 周 ----------
const DAY = 86400, BJ = 28800
export const weekOf = (t: number) => {
  const day = Math.floor((t + BJ) / DAY) // 1970-01-01 是周四
  return new Date((day - ((day + 3) % 7)) * DAY * 1000).toISOString().slice(0, 10)
}
export const weekStart = (week: string) => Date.parse(week + 'T00:00:00+08:00') / 1000
export const nextWeek = (week: string) => weekOf(weekStart(week) + 7 * DAY + 3600)

export function secureInt(n: number) {
  const limit = Math.floor(4294967296 / n) * n
  let v: number
  do { v = crypto.getRandomValues(new Uint32Array(1))[0] } while (v >= limit)
  return v % n
}

// ---------- 系列与角色 ----------
const seriesCache = new WeakMap<object, Map<string, string>>()
const assignCache = new WeakMap<object, Map<string, Assignment>>()
const cacheOf = <T>(store: WeakMap<object, Map<string, T>>, db: object) => {
  let m = store.get(db)
  if (!m) store.set(db, (m = new Map()))
  if (m.size > 20000) m.clear()
  return m
}

// 用过的系列在全部轮完之前不重复
async function drawSeries(db: Db, gid: number) {
  const skip = new Set((await all<{ series: string }>(db, 'SELECT series FROM anon_weeks WHERE group_id=? ORDER BY week DESC LIMIT ?', gid, SERIES_LIST.length - 1)).map((r) => r.series))
  // 只自动抽头像齐全的系列（缺图的站长仍可在群设置里手动指定）；一个都没有时退回全部
  const ready = SERIES_LIST.filter((x) => (AVATAR_SET[x.id]?.length || 0) >= x.items.length), base = ready.length ? ready : SERIES_LIST
  const pool = base.filter((x) => !skip.has(x.id)), list = pool.length ? pool : base
  return list[secureInt(list.length)].id
}
// 上线之前的周没有系列，返回 null（那些旧消息显示「鱼友」）
export async function seriesOf(db: Db, gid: number, week: string): Promise<Series | null> {
  const cache = cacheOf(seriesCache, db), key = gid + '|' + week, hit = cache.get(key)
  if (hit) return SERIES[hit] || null
  const read = async () => await db.prepare('SELECT series FROM anon_weeks WHERE group_id=? AND week=?').bind(gid, week).first() as { series: string } | null
  let row = await read()
  const current = weekOf(now())
  if (!row) {
    if (week > nextWeek(current)) return null
    if (week < current && !await db.prepare('SELECT 1 FROM anon_weeks WHERE group_id=? AND week<? LIMIT 1').bind(gid, week).first()) return null
    await db.prepare('INSERT OR IGNORE INTO anon_weeks(group_id,week,series,created_at) VALUES(?,?,?,?)').bind(gid, week, await drawSeries(db, gid), now()).run()
    row = await read()
  }
  if (!row) return null
  if (week <= current) cache.set(key, row.series) // 下周的系列站长还可以换，不缓存
  return SERIES[row.series] || null
}

const akey = (gid: number, week: string, uid: number) => gid + '|' + week + '|' + uid
export async function assignmentsFor(db: Db, gid: number, pairs: Iterable<{ uid: number; week: string }>) {
  const cache = cacheOf(assignCache, db), out = new Map<string, Assignment>(), need = new Map<string, Set<number>>()
  for (const { uid, week } of pairs) {
    const hit = cache.get(akey(gid, week, uid))
    if (hit) out.set(week + '|' + uid, hit)
    else { if (!need.has(week)) need.set(week, new Set()); need.get(week)!.add(uid) }
  }
  for (const [week, uids] of need) {
    const series = await seriesOf(db, gid, week)
    if (!series) continue
    const load = async () => {
      for (const r of await all<Assignment>(db, 'SELECT week,user_id,series,item,suffix,alias_id FROM anon_assignments WHERE group_id=? AND week=? AND user_id IN (SELECT value FROM json_each(?))', gid, week, json(uids))) {
        uids.delete(r.user_id)
        out.set(week + '|' + r.user_id, r)
        cache.set(akey(gid, week, r.user_id), r)
      }
    }
    await load()
    // 每周第一次匿名发言才获得角色：没发过言的人不占名额，点表情、领红包、看设置都不会分到
    if (uids.size) {
      const spoke = new Set((await all(db, 'SELECT user_id FROM anon_active WHERE group_id=? AND week=? AND anon=1 AND user_id IN (SELECT value FROM json_each(?))', gid, week, json(uids))).map((r) => r.user_id))
      for (const uid of [...uids]) if (!spoke.has(uid)) uids.delete(uid)
    }
    for (let round = 0; uids.size && round < 5; round++) {
      const used = new Set((await all(db, 'SELECT item,suffix FROM anon_assignments WHERE group_id=? AND week=?', gid, week)).map((r) => r.item + '|' + r.suffix))
      // 先打乱再分配，抽取顺序也不反映用户编号
      const order = [...uids]
      for (let i = order.length - 1; i > 0; i--) { const j = secureInt(i + 1); [order[i], order[j]] = [order[j], order[i]] }
      const statements = order.map((uid) => {
        let suffix = 0, free: number[] = []
        while (!free.length) { suffix++; free = series.items.map((_, i) => i + 1).filter((n) => !used.has(n + '|' + suffix)) }
        const item = free[secureInt(free.length)]
        used.add(item + '|' + suffix)
        return db.prepare('INSERT OR IGNORE INTO anon_assignments(group_id,week,user_id,series,item,suffix,alias_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .bind(gid, week, uid, series.id, item, suffix, -(1e12 + secureInt(4e9) * 2000 + secureInt(2000)), now())
      })
      await db.batch(statements)
      await load()
    }
  }
  return out
}
// 前端拿到的匿名 id 换回真实用户（只在服务端用，例如指定红包领取人）
export async function realIdOf(db: Db, alias: number): Promise<number | null> {
  return Number((await db.prepare('SELECT user_id FROM anon_assignments WHERE alias_id=?').bind(alias).first())?.user_id) || null
}

const SUFFIX = ['', '', '·贰', '·叁', '·肆', '·伍', '·陆']
export function charName(a: Assignment) {
  return (SERIES[a.series]?.items[a.item - 1]?.name || OLD_ALIAS.name) + (SUFFIX[a.suffix] ?? '·' + a.suffix)
}
const avatarCache = new Map<string, string>()
// 有图用图；没有图用统一的占位头像：系列底色 + 名字首字 + 像素边框
export function charAvatar(a: { series: string; item: number }) {
  if (AVATAR_SET[a.series]?.includes(a.item)) return `/assets/anon/${a.series}/${String(a.item).padStart(3, '0')}.webp`
  const key = a.series + '|' + a.item, hit = avatarCache.get(key)
  if (hit) return hit
  const s = SERIES[a.series]
  const ch = ([...(s?.items[a.item - 1]?.name || '鱼')].find((x) => /[\p{L}\p{N}]/u.test(x)) || '鱼').toUpperCase()
  const hue = ((s?.hue ?? 200) + (a.item * 37) % 60 - 30 + 360) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="hsl(${hue},45%,42%)" d="M0 0h16v16H0z"/><path fill="hsl(${hue},50%,62%)" d="M2 2h12v12H2z"/><path fill="hsl(${hue},55%,76%)" d="M2 2h12v1H2zM2 3h1v11H2z"/><text x="8" y="11.6" font-size="8" font-weight="700" font-family="system-ui,sans-serif" text-anchor="middle" fill="hsl(${hue},60%,16%)">${ch}</text></svg>`
  const url = 'data:image/svg+xml,' + encodeURIComponent(svg)
  if (avatarCache.size > 5000) avatarCache.clear()
  avatarCache.set(key, url)
  return url
}
export const tagOf = (a: Assignment): AnonTag => ({ name: charName(a), series: a.series, series_name: SERIES[a.series]?.name || '', item: a.item })
const BLANK = { trust_level: 0, is_admin: false, fancy: false, deco: null }
// 进群满这么久才匿名；之前的发言、表情、领红包都是实名
export const JOIN_WAIT = 3 * DAY
// 匿名角色的装扮（站长 2026-11-26：气泡、徽章、称号全随机佩戴）：
// 一个抽奖称号（等级随机，称号自带同款气泡）+ 一枚日常徽章（次数随机）。由角色持有时生成的随机编号推出，
// 同一个人持有这个角色期间固定，换角色或被侵占后跟着换；和本人的收藏、佩戴无关，也不写进任何人的收藏。
// 不用：群友专属 / 站长授予 / 限定展出的称号（只有特定的人有，会让人误以为是他）、元老徽章。
const DECO_TITLES = TITLE_COLLECTION.filter((t) => t.enabled && !t.limited && !t.commemorative && raffleTitleEnabled(t.id) && t.id !== 'claude').map((t) => t.id)
const DECO_BADGES = ['luck_king', 'luck_last', 'guess', 'guide', 'newbie', 'moyu_god', 'moyu_pro', 'post_god', 'post_pro', 'sese', 'chunse', 'water', 'react', 'night']
const BADGE_COUNTS = [1, 3, 7, 15, 30]
export function anonDeco(alias: number): Row | null {
  if (!DECO_TITLES.length) return null
  // 编号本身是随机数，这里只要稳定、分布均匀
  let h = 2166136261
  const next = () => { for (const ch of String(alias) + '|deco') h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return h }
  const stage = Math.min(TITLE_STAGES.length - 1, Math.floor(-Math.log(1 - (next() % 10000) / 10000) * 1.6)) // 低等级多、高等级少
  const lo = TITLE_STAGES[stage], hi = (TITLE_STAGES[stage + 1] ?? TITLE_STAGES[stage] + 1) - 1
  return { ft: DECO_TITLES[next() % DECO_TITLES.length], fn: lo + (next() % (hi - lo + 1)), badge_mode: 'custom', bd: DECO_BADGES[next() % DECO_BADGES.length], bn: BADGE_COUNTS[next() % BADGE_COUNTS.length] }
}
export const charPerson = (a: Assignment): Row => ({ id: a.alias_id, username: charName(a), name: charName(a), avatar: charAvatar(a), ...BLANK, deco: anonDeco(a.alias_id), anon: tagOf(a) })
export const genericPerson = (): Row => ({ id: OLD_ALIAS.id, username: OLD_ALIAS.name, name: OLD_ALIAS.name, avatar: null, ...BLANK, anon: { name: OLD_ALIAS.name, series: '', series_name: '', item: 0, generic: true } })
const asSelf = (p: Row, uid: number): Row => ({ ...p, id: uid, anon: { ...p.anon, self: true } })

// ---------- 匿名开关 ----------
// 自己的开关（2026-11-26 起默认关）
export async function anonEnabled(db: Db, gid: number, uid: number) {
  const r = await db.prepare('SELECT anon FROM anon_members WHERE group_id=? AND user_id=?').bind(gid, uid).first() as { anon: number } | null
  return !!r?.anon
}
// 进群时间：没在群里返回 0（已经退群的人按开关算）
async function joinedAt(db: Db, gid: number, uid: number) {
  return Number((await db.prepare('SELECT joined_at FROM chat_members WHERE group_id=? AND user_id=?').bind(gid, uid).first())?.joined_at) || 0
}
export async function setAnonEnabled(db: Db, gid: number, uid: number, on: boolean, t = now()) {
  if (await anonEnabled(db, gid, uid) === on) return
  await db.batch([
    db.prepare('INSERT INTO anon_members(group_id,user_id,anon,changed_at) VALUES(?,?,?,?) ON CONFLICT(group_id,user_id) DO UPDATE SET anon=excluded.anon,changed_at=excluded.changed_at').bind(gid, uid, on ? 1 : 0, t),
    db.prepare('INSERT INTO anon_member_log(group_id,user_id,anon,at) VALUES(?,?,?,?)').bind(gid, uid, on ? 1 : 0, t),
  ])
}
type Log = { logs: Map<number, { anon: number; at: number }[]>; joined: Map<number, number> }
async function logsOf(db: Db, gid: number, uids: Iterable<number>): Promise<Log> {
  const out: Log = { logs: new Map(), joined: new Map() }, list = json(uids)
  for (const r of await all(db, 'SELECT user_id,anon,at FROM anon_member_log WHERE group_id=? AND user_id IN (SELECT value FROM json_each(?)) ORDER BY at,id', gid, list)) {
    if (!out.logs.has(r.user_id)) out.logs.set(r.user_id, [])
    out.logs.get(r.user_id)!.push(r as { anon: number; at: number })
  }
  for (const r of await all(db, 'SELECT user_id,joined_at FROM chat_members WHERE group_id=? AND user_id IN (SELECT value FROM json_each(?))', gid, list)) out.joined.set(r.user_id, r.joined_at)
  return out
}
// 没有快照的记录按时间查；切换当秒内分不清先后，按匿名处理；进群不满 3 天是实名；没有记录是实名（默认关）
function anonAt(log: Log, uid: number, t: number) {
  if ((log.joined.get(uid) || 0) > t - JOIN_WAIT) return false
  const list = log.logs.get(uid)
  if (!list) return false
  if (list.some((x) => x.at === t)) return true
  let on = false
  for (const x of list) if (x.at < t) on = !!x.anon
  return on
}

// ---------- 查看者 ----------
export type Viewer = { id: number; owner: boolean }
type Ctx = { env: any; get(k: any): any; set?(k: any, v: any): void }
export async function viewerOf(c: Ctx): Promise<Viewer> {
  const u = c.get('user')
  if (!u) return { id: 0, owner: false }
  const cached = c.get('anonViewer') as Viewer | undefined
  if (cached?.id === u.id) return cached!
  const v = { id: u.id, owner: isSiteOwner(c.env, u) }
  c.set?.('anonViewer', v)
  return v
}
// 普通群友的视角：用来决定写进正文、发给机器人和 AI 的名字
export const publicCtx = (env: any): Ctx => ({ env, get: (k: string) => k === 'anonViewer' ? { id: 0, owner: false } : k === 'user' ? { id: 0 } : undefined })
// 没开匿名的人：群里谁都看得到（2026-11-26 起新用户在群聊里也看实名，只有图廊的发帖人遮住）
const realFor = (person: Row): Row => ({ ...person, anon: null })

// ---------- 自选角色（2026-11-26）----------
// 不再按周分系列：角色池是所有有头像的角色，自己抽，免费 3 次，之后 10 万 D币一次；
// 抽到的角色别人在用，可以花 52 万 D币侵占，原主人收到提醒并多一次免费抽取。D币直接扣掉，不给任何人。
export const FREE_DRAWS = 3, DRAW_COST = 100000, SEIZE_COST = 520000, THEME_COST = 520000
export const POOL: { series: string; item: number }[] = SERIES_LIST.flatMap((s) => (AVATAR_SET[s.id] || []).filter((n) => n <= s.items.length).map((item) => ({ series: s.id, item })))
const identityOf = (r: Row): Assignment => ({ week: '', user_id: r.user_id, series: r.series, item: r.item, suffix: 1, alias_id: r.alias_id })
export async function identitiesOf(db: Db, gid: number, uids: Iterable<number>) {
  const out = new Map<number, Assignment>()
  for (const r of await all(db, 'SELECT user_id,series,item,alias_id FROM anon_identities WHERE group_id=? AND user_id IN (SELECT value FROM json_each(?))', gid, json(uids))) out.set(r.user_id, identityOf(r))
  return out
}
const newAlias = () => -(1e12 + secureInt(4e9) * 2000 + secureInt(2000))
async function drawState(db: Db, gid: number, uid: number) {
  return (await db.prepare('SELECT free_used,bonus,pending_series,pending_item FROM anon_draw_state WHERE group_id=? AND user_id=?').bind(gid, uid).first()) as Row | null
}
const charge = (db: Db, uid: number, kind: string, ref: string, attempt: string, cost: number, t: number) => [
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?1,?2,?3,?4,-?5,balance-?5,?6 FROM coin52_wallets WHERE user_id=?1 AND balance>=?5
    AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='user' AND disabled=0) AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1) RETURNING id`).bind(uid, kind, ref, attempt, cost, t),
  db.prepare('UPDATE coin52_wallets SET balance=balance-?,revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=? AND attempt=?)').bind(cost, t, uid, uid, attempt),
]
// 抽一次：结果只是候选，换不换由本人决定（放弃也算用掉这次）
// series：只在这个主题里抽（要先解锁）；不传就是全部角色。已有候选时再抽就是「继续抽」，候选换成新的
export async function drawCharacter(db: Db, gid: number, uid: number, series?: string | null, t = now()) {
  const pool = series ? POOL.filter((p) => p.series === series) : POOL
  if (series && !SERIES[series]) throw new AnonError('没有这个主题')
  if (!pool.length) throw new AnonError(series ? '这个主题还没有头像，暂时不能抽' : '角色池还没有准备好')
  if (series && !await db.prepare('SELECT 1 FROM anon_theme_unlocks WHERE group_id=? AND user_id=? AND series=?').bind(gid, uid, series).first()) throw new AnonError(`先花 ${THEME_COST} D币解锁这个主题`, 403)
  const st = await drawState(db, gid, uid), free = FREE_DRAWS + Number(st?.bonus || 0) - Number(st?.free_used || 0) > 0
  const mine = (await identitiesOf(db, gid, [uid])).get(uid)
  let pick = pool[secureInt(pool.length)]
  for (let i = 0; i < 5 && pool.length > 1 && mine && pick.series === mine.series && pick.item === mine.item; i++) pick = pool[secureInt(pool.length)]
  const attempt = 'anon-draw:' + crypto.randomUUID()
  await db.prepare('INSERT OR IGNORE INTO anon_draw_state(group_id,user_id) VALUES(?,?)').bind(gid, uid).run()
  const set = db.prepare(`UPDATE anon_draw_state SET pending_series=?1,pending_item=?2,pending_at=?3,free_used=free_used+?4 WHERE group_id=?5 AND user_id=?6
    AND (?4=0 OR free_used<${FREE_DRAWS}+bonus)${free ? '' : ' AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=?6 AND attempt=?7)'} RETURNING user_id`)
    .bind(...[pick.series, pick.item, t, free ? 1 : 0, gid, uid, ...(free ? [] : [attempt])])
  const log = db.prepare('INSERT INTO anon_draws(group_id,user_id,series,item,name,cost,result,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(gid, uid, pick.series, pick.item, SERIES[pick.series].items[pick.item - 1].name, free ? 0 : DRAW_COST, 'drawn', t)
  if (!free) await ensureWallet(db, uid, t)
  const r = await db.batch([...(free ? [] : charge(db, uid, 'anon-draw', attempt, attempt, DRAW_COST, t)), set])
  if (!r[r.length - 1].results.length) throw new AnonError(free ? '抽取状态已变化，请刷新后重试' : `D币不足，抽一次要 ${DRAW_COST} D币`)
  await log.run()
  return anonSettingsFor(db, gid, uid)
}
// 解锁主题：一次性 52 万 D币；流水按主题去重，重复点不会扣第二次
export async function unlockTheme(db: Db, gid: number, uid: number, series: string, t = now()) {
  if (!SERIES[series] || !POOL.some((p) => p.series === series)) throw new AnonError('这个主题还没有头像，暂时不能解锁')
  if (await db.prepare('SELECT 1 FROM anon_theme_unlocks WHERE group_id=? AND user_id=? AND series=?').bind(gid, uid, series).first()) return anonSettingsFor(db, gid, uid)
  await ensureWallet(db, uid, t)
  const attempt = 'anon-theme:' + crypto.randomUUID()
  const r = await db.batch([
    ...charge(db, uid, 'anon-theme', gid + ':' + series, attempt, THEME_COST, t),
    db.prepare('INSERT OR IGNORE INTO anon_theme_unlocks(group_id,user_id,series,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=? AND attempt=?)').bind(gid, uid, series, t, uid, attempt),
  ]).catch((e) => { if (String(e).includes('UNIQUE')) return null; throw e })
  if (r && !r[0].results.length) throw new AnonError(`D币不足，解锁主题要 ${THEME_COST} D币`)
  return anonSettingsFor(db, gid, uid)
}
// 换上 / 放弃 / 侵占当前候选
export async function claimCharacter(db: Db, gid: number, uid: number, action: string, t = now()) {
  const st = await drawState(db, gid, uid)
  if (!st?.pending_series) throw new AnonError('先抽一个角色')
  const series = String(st.pending_series), item = Number(st.pending_item), name = SERIES[series]?.items[item - 1]?.name || ''
  const clear = db.prepare('UPDATE anon_draw_state SET pending_series=NULL,pending_item=NULL,pending_at=NULL WHERE group_id=? AND user_id=? AND pending_series=? AND pending_item=?').bind(gid, uid, series, item)
  if (action === 'skip') { await clear.run(); return anonSettingsFor(db, gid, uid) }
  const holder = Number((await db.prepare('SELECT user_id FROM anon_identities WHERE group_id=? AND series=? AND item=?').bind(gid, series, item).first())?.user_id) || 0
  if (holder === uid) { await clear.run(); return anonSettingsFor(db, gid, uid) }
  const take = [
    db.prepare('DELETE FROM anon_identities WHERE group_id=? AND user_id=?').bind(gid, uid),
    db.prepare('INSERT INTO anon_identities(group_id,user_id,series,item,alias_id,since) VALUES(?,?,?,?,?,?)').bind(gid, uid, series, item, newAlias(), t),
    clear,
  ]
  if (action === 'take') {
    if (holder) throw new AnonError('这个角色已经被群友用了，可以花 52 万 D币侵占，或者放弃', 409)
    try { await db.batch(take) } catch (e) { if (String(e).includes('UNIQUE')) throw new AnonError('这个角色刚被群友换上了，请刷新', 409); throw e }
    await db.prepare("INSERT INTO anon_draws(group_id,user_id,series,item,name,cost,result,created_at) VALUES(?,?,?,?,?,0,'taken',?)").bind(gid, uid, series, item, name, t).run()
    return anonSettingsFor(db, gid, uid)
  }
  if (action !== 'seize') throw new AnonError('操作无效')
  if (!holder) throw new AnonError('这个角色没人用，直接换上就行', 409)
  await ensureWallet(db, uid, t)
  const attempt = 'anon-seize:' + crypto.randomUUID()
  const gate = (sql: string) => sql + ` AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=${Number(uid)} AND attempt='${attempt}')`
  const r = await db.batch([
    ...charge(db, uid, 'anon-seize', attempt, attempt, SEIZE_COST, t),
    db.prepare(gate('DELETE FROM anon_identities WHERE group_id=? AND user_id=? AND series=? AND item=?')).bind(gid, holder, series, item),
    db.prepare(gate('DELETE FROM anon_identities WHERE group_id=? AND user_id=?')).bind(gid, uid),
    db.prepare(gate('INSERT INTO anon_identities(group_id,user_id,series,item,alias_id,since) SELECT ?,?,?,?,?,? WHERE 1')).bind(gid, uid, series, item, newAlias(), t),
    db.prepare(gate('INSERT INTO anon_draw_state(group_id,user_id,bonus) SELECT ?,?,1 WHERE 1 ON CONFLICT(group_id,user_id) DO UPDATE SET bonus=bonus+1')).bind(gid, holder),
    db.prepare(gate("INSERT INTO anon_draws(group_id,user_id,series,item,name,cost,result,victim_id,created_at) SELECT ?,?,?,?,?,?,'seized',?,? WHERE 1")).bind(gid, uid, series, item, name, SEIZE_COST, holder, t),
    db.prepare(gate('UPDATE anon_draw_state SET pending_series=NULL,pending_item=NULL,pending_at=NULL WHERE group_id=? AND user_id=?')).bind(gid, uid),
  ])
  if (!r[0].results.length) throw new AnonError(`D币不足，侵占要 ${SEIZE_COST} D币`)
  return anonSettingsFor(db, gid, uid)
}
export class AnonError extends Error { constructor(message: string, public status = 400) { super(message) } }
async function ensureWallet(db: Db, uid: number, t: number) {
  await db.prepare("INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND kind='user' AND disabled=0)").bind(uid, t, uid).run()
}

// ---------- 消息 ----------
type Snap = { user_id: number; anon: boolean; series?: string | null; item?: number | null; alias_id?: number | null }
async function snapshots(db: Db, ids: Iterable<number>) {
  const out = new Map<number, Snap>()
  for (const r of await all(db, 'SELECT message_id,user_id,anon,series,item,alias_id FROM anon_messages WHERE message_id IN (SELECT value FROM json_each(?))', json(ids))) out.set(r.message_id, { user_id: r.user_id, anon: !!r.anon, series: r.series, item: r.item, alias_id: r.alias_id })
  return out
}
// 消息上记下的身份；旧消息（按周分系列时）没有记，用当时那周的角色；匿名但还没抽角色是「鱼友」
const snapRole = (s: Snap, legacy: Map<string, Assignment>, ts: number): Assignment | undefined =>
  s.series && s.item && s.alias_id ? { week: '', user_id: s.user_id, series: s.series, item: s.item, suffix: 1, alias_id: s.alias_id } : legacy.get(weekOf(ts) + '|' + s.user_id)
const legacyPairs = (s: Snap, ts: number) => s.anon && !s.series ? [{ uid: s.user_id, week: weekOf(ts) }] : []
// 已有的周角色只读不新建：新消息都带着自己的身份
async function legacyRoles(db: Db, gid: number, pairs: { uid: number; week: string }[]) {
  const out = new Map<string, Assignment>()
  if (!pairs.length) return out
  for (const r of await all<Assignment>(db, 'SELECT week,user_id,series,item,suffix,alias_id FROM anon_assignments WHERE group_id=? AND user_id IN (SELECT value FROM json_each(?)) AND week IN (SELECT value FROM json_each(?))', gid, json(new Set(pairs.map((p) => p.uid))), json(new Set(pairs.map((p) => p.week))))) out.set(r.week + '|' + r.user_id, r)
  return out
}
// 这些系统消息正文里没有人名，可以原样给群友看；其余一律改写
const PLAIN_SYSTEM = new Set(['join', 'sleep_reminder', 'release_notice', 'title_raffle', 'title_raffle_open', 'redpack_due', 'chat_bot', 'ldc_question', 'ldc_game', 'ldc_cancel', 'ldc_expired'])
// 正文或归属会暴露是谁的播报：连发送者也不显示
const FACELESS_SYSTEM = new Set(['rank_award', 'guess_level', 'luck_level', 'huancai_draw', 'redpack_draw'])
// 搜索正文时排除含真名的播报，否则能用真名试出对应的角色
export const SEARCHABLE_SQL = `(x.system_kind IS NULL OR x.system_kind IN (${[...PLAIN_SYSTEM].map((k) => `'${k}'`).join(',')}))`
export function redactSystemBody(kind: string | null | undefined, body: string) {
  if (!kind || PLAIN_SYSTEM.has(kind)) return body
  if (kind === 'ldc_winner') {
    if (/ 首先猜中！/.test(body)) return body.replace(/^[\s\S]* 首先猜中！/, '有群友首先猜中！')
    return /^猜词已猜中 /.test(body) ? body.replace(/^(\d+)\. .* · (?=奖励核定中|[\d.]+ )/gm, '$1. 鱼友 · ') : '本轮猜词已有人猜中'
  }
  if (kind === 'redpack_result') return /^红包抽奖已取消/.test(body) ? '红包抽奖已取消，本轮未开奖。' : /^红包开奖结果/.test(body) ? '红包已开奖，打开红包查看明细' : '红包已结束，打开红包查看明细'
  if (kind === 'redpack_draw') return '红包开奖结果已同步，打开红包查看'
  if (kind === 'guess_level') return '有群友解锁了新的猜词称号'
  if (kind === 'luck_level') return '有群友解锁了新的手气称号'
  if (kind === 'rank_award') return /^每日榜单 · [\d-]+$/.test(body.split('\n')[0]) ? body.split('\n')[0] : '有群友获得了榜单称号'
  if (kind === 'huancai_draw') return '欢彩开奖结果已公布'
  return '系统消息'
}
// 每日榜单播报：只留当日成绩，名字、总榜、称号都不出现（名次和经验会写进公开资料，配上角色名就能反推）
async function redactDigest(db: Db, ref: string | null, body: string) {
  const m = /^rank:daily:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(ref || '')
  if (!m) return redactSystemBody('rank_award', body)
  const rows = await all(db, "SELECT board,place,score FROM rank_placements WHERE group_id=? AND day=? AND period='day' ORDER BY board,place", Number(m[1]), m[2])
  const label: Record<string, string> = { guess: '猜中', guess_winrate: '胜率', sender_count: '发包次数', sender_paid: '发放额度', chat_count: '发言', chat_early: '早安', chat_late: '晚安' }
  const score = (r: Row) => r.board === 'guess_winrate' ? (r.score / 100).toFixed(1) + '%' : r.board === 'sender_paid' ? (r.score / 100).toFixed(2) + ' LDC' : r.board === 'chat_count' ? r.score + '条' : r.board === 'chat_early' || r.board === 'chat_late' ? new Date((r.score + BJ) * 1000).toISOString().slice(11, 16) : r.score + '次'
  const lines = ['每日榜单 · ' + m[2], '日榜']
  for (const board of Object.keys(label)) {
    const list = rows.filter((r) => r.board === board)
    if (list.length) lines.push(label[board] + '｜' + list.map((r) => ['①', '②', '③'][r.place - 1] + '鱼友 ' + score(r)).join(' · '))
  }
  return lines.join('\n')
}
const QUOTE_RE = /\[quote="([^"\]]*?), msg:(\d+)((?:, g:(\d+))?)"\]/g

// msgs：decorateMsgsRaw 的结果，附带只在服务端用的 _uid（消息、引用、一句回应）、_at、_kind（引用）
export async function finishMessages(c: Ctx, msgs: Row[]) {
  const strip = (m: Row): Row => {
    const { _uid, ...out } = m
    if (out.reply_to) { const { _uid: _a, _at, _kind, ...r } = out.reply_to; out.reply_to = r }
    if (Array.isArray(out.boosts)) out.boosts = out.boosts.map(({ _uid: _b, ...b }: Row) => b)
    return out
  }
  const mine = msgs.filter((m) => isAnonGroup(m.group_id))
  if (!mine.length) return msgs.map(strip)
  const db: Db = c.env.DB, viewer = await viewerOf(c), gid = Number(mine[0].group_id)
  const snap = await snapshots(db, mine.flatMap((m) => [m.id, ...(m.reply_to ? [m.reply_to.id] : [])]))
  const boosters = new Set<number>(mine.flatMap((m) => (m.boosts || []).filter((b: Row) => !b.ai).map((b: Row) => Number(b._uid))))
  const log = await logsOf(db, gid, boosters), current = await identitiesOf(db, gid, boosters)
  const who = (id: number, uid: number): Snap => snap.get(id) || { user_id: uid, anon: false }
  const mentions = await all(db, 'SELECT message_id,user_id FROM anon_mentions WHERE message_id IN (SELECT value FROM json_each(?))', json(mine.map((m) => m.id)))
  const legacy = await legacyRoles(db, gid, mine.flatMap((m) => [...legacyPairs(who(m.id, m._uid), m.created_at), ...(m.reply_to ? legacyPairs(who(m.reply_to.id, m.reply_to._uid), m.reply_to._at) : [])]))
  const mentioned = await all(db, 'SELECT message_id,series,item FROM anon_mention_names WHERE message_id IN (SELECT value FROM json_each(?))', json(mine.map((m) => m.id)))
  // 一个人在某个时刻的样子；role 为空表示匿名但没有角色（显示「鱼友」）
  const show = (person: Row, uid: number, anon: boolean, role: Assignment | undefined): Row => {
    if (viewer.owner) return { ...person, anon: anon && role ? { ...tagOf(role), owner: true } : null }
    if (!anon) return realFor(person)
    const p = role ? charPerson(role) : genericPerson()
    return uid === viewer.id ? asSelf(p, uid) : p
  }
  return Promise.all(msgs.map(async (m) => {
    const out = strip(m)
    if (!isAnonGroup(m.group_id)) return out
    const s = who(m.id, m._uid)
    out.user = show(m.user, s.user_id, s.anon, snapRole(s, legacy, m.created_at))
    out.at_me = mentions.some((x) => x.message_id === m.id && x.user_id === viewer.id)
    out.anon_at = mentioned.filter((x) => x.message_id === m.id).map((x) => SERIES[x.series]?.items[x.item - 1]?.name).filter((n) => n && String(m.body).includes(n))
    if (m.reply_to) {
      const r = who(m.reply_to.id, m.reply_to._uid), kind = m.reply_to._kind
      let p = show({ username: m.reply_to.username, name: m.reply_to.name, avatar: m.reply_to.avatar, deco: m.reply_to.deco, fancy: m.reply_to.fancy }, r.user_id, r.anon, snapRole(r, legacy, m.reply_to._at))
      if (!viewer.owner && kind) {
        if (FACELESS_SYSTEM.has(kind)) p = genericPerson()
        out.reply_to.text = redactSystemBody(kind, out.reply_to.text || '')
      }
      out.reply_to = { ...out.reply_to, username: p.username, name: p.name, avatar: p.avatar, deco: p.deco ?? null, fancy: !!p.fancy, anon: p.anon, me: r.user_id === viewer.id }
    }
    out.boosts = (m.boosts || []).map(({ _uid, ...b }: Row) => {
      if (b.ai) return b
      const uid = Number(_uid), p = show({ username: b.username, name: b.name, avatar: b.avatar, deco: b.deco }, uid, anonAt(log, uid, b.at), current.get(uid))
      return { ...b, username: p.username, name: p.name, avatar: p.avatar, deco: p.deco ?? null, anon: p.anon }
    })
    if (viewer.owner) return out
    if (m.system_kind && !m.deleted) {
      out.body = m.system_kind === 'rank_award' ? await redactDigest(db, m.system_ref, m.body) : redactSystemBody(m.system_kind, m.body)
      if (FACELESS_SYSTEM.has(m.system_kind)) out.user = genericPerson()
    }
    if (Array.isArray(out.reactions)) out.reactions = out.reactions.map((r: Row) => ({ ...r, who: [] }))
    out.at_read = null // 键是被 @ 的用户名，会泄露身份
    if (out.redpack?.draw) out.redpack = { ...out.redpack, draw: hideRoster(out.redpack.draw) }
    return out
  }))
}
// 外部平台开奖名单里是平台昵称，群里不显示
function hideRoster(draw: Row) {
  const out: Row = { ...draw }
  for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = out[k].map((x: unknown) => x && typeof x === 'object' && 'name' in (x as Row) ? { ...(x as Row), name: OLD_ALIAS.name } : x)
  return out
}
// 一批消息的作者（引用、群列表预览、通知、回复名单用）
export type MessageAuthor = { id: number; user_id: number; created_at: number; system_kind?: string | null; person: Row }
export async function messagePeople(c: Ctx, rows: MessageAuthor[], gid = 1) {
  const viewer = await viewerOf(c), db: Db = c.env.DB, snap = await snapshots(db, rows.map((r) => r.id)), out = new Map<number, Row>()
  const who = (r: MessageAuthor): Snap => snap.get(r.id) || { user_id: r.user_id, anon: false }
  const legacy = await legacyRoles(db, gid, rows.flatMap((r) => legacyPairs(who(r), r.created_at)))
  for (const r of rows) {
    const s = who(r), role = s.anon ? snapRole(s, legacy, r.created_at) : undefined
    if (viewer.owner) out.set(r.id, { ...r.person, anon: role ? { ...tagOf(role), owner: true } : null })
    else if (r.system_kind && FACELESS_SYSTEM.has(r.system_kind)) out.set(r.id, genericPerson())
    else if (!s.anon) out.set(r.id, realFor(r.person))
    else { const p = role ? charPerson(role) : genericPerson(); out.set(r.id, s.user_id === viewer.id ? asSelf(p, viewer.id) : p) }
  }
  return out
}

// ---------- 发送 ----------
// 引用里的名字一律按对外身份重写（站长看到的是真名，不能写进正文）；站长 @ 真实用户名也换成角色名
export async function rewriteOutgoing(c: Ctx, gid: number, body: string) {
  if (!isAnonGroup(gid) || !/[@＠]|\[quote=/.test(body)) return body
  const db: Db = c.env.DB
  const ids = [...body.matchAll(QUOTE_RE)].filter((m) => !m[4] || Number(m[4]) === gid).map((m) => Number(m[2]))
  if (ids.length) {
    const rows = await all(db, 'SELECT x.id,x.user_id,x.created_at,x.system_kind,u.username,u.name FROM chat_messages x LEFT JOIN users u ON u.id=x.user_id WHERE x.group_id=? AND x.id IN (SELECT value FROM json_each(?))', gid, json(ids))
    const pub = await messagePeople(publicCtx(c.env), rows.map((r) => ({ id: r.id, user_id: r.user_id, created_at: r.created_at, system_kind: r.system_kind, person: { username: r.username, name: r.name } })), gid)
    body = body.replace(QUOTE_RE, (text, _n, id, tail, g) => {
      if (g && Number(g) !== gid) return text
      const p = pub.get(Number(id))
      return `[quote="${String(p?.name || p?.username || OLD_ALIAS.name).replace(/[",\]\[]/g, '')}, msg:${id}${tail}"]`
    })
  }
  if (isSiteOwner(c.env, c.get('user'))) {
    const AT = /(?<![\w@.])@([A-Za-z0-9_][\w.-]{0,30}[\w])/g
    const names = [...new Set([...body.matchAll(AT)].map((m) => m[1].toLowerCase()))].slice(0, 20)
    if (names.length) {
      const people = await all(db, `SELECT u.id,lower(u.username) n,i.series,i.item FROM users u JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=?1
        JOIN anon_members a ON a.group_id=cm.group_id AND a.user_id=u.id AND a.anon=1 JOIN anon_identities i ON i.group_id=cm.group_id AND i.user_id=u.id
        WHERE u.kind='user' AND cm.joined_at<=unixepoch()-${JOIN_WAIT} AND lower(u.username) IN (SELECT value FROM json_each(?2))`, gid, json(names))
      const by = new Map(people.map((p) => [p.n, SERIES[p.series]?.items[p.item - 1]?.name]))
      body = body.replace(AT, (s, n) => { const r = by.get(n.toLowerCase()); return r ? '@' + r : s })
    }
  }
  return body
}
// 「@角色名」→ 现在持有这个角色的人
export async function mentionTargets(db: Db, gid: number, body: string): Promise<{ user_id: number; series: string; item: number }[]> {
  if (!isAnonGroup(gid) || !/[@＠]/.test(body)) return []
  let text = body.replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/g, ' ').replace(/＠/g, '@')
  const rows = await all(db, 'SELECT user_id,series,item FROM anon_identities WHERE group_id=?', gid)
  const name = (r: Row) => SERIES[r.series]?.items[r.item - 1]?.name || ''
  const out: { user_id: number; series: string; item: number }[] = []
  for (const r of rows.filter(name).sort((a, b) => name(b).length - name(a).length)) {
    const token = '@' + name(r)
    if (text.includes(token)) { out.push(r as { user_id: number; series: string; item: number }); text = text.split(token).join(' ') }
    if (out.length >= 20) break
  }
  return out
}
export const mentionStatements = (db: Db, mid: number, list: { user_id: number; series: string; item: number }[]) => [
  db.prepare('DELETE FROM anon_mentions WHERE message_id=?').bind(mid),
  db.prepare('DELETE FROM anon_mention_names WHERE message_id=?').bind(mid),
  ...list.flatMap((x) => [db.prepare('INSERT OR IGNORE INTO anon_mentions(message_id,user_id) VALUES(?,?)').bind(mid, x.user_id), db.prepare('INSERT OR IGNORE INTO anon_mention_names(message_id,series,item) VALUES(?,?,?)').bind(mid, x.series, x.item)]),
]

// ---------- 成员列表 ----------
// 普通群友看到的：实名的人（没开匿名、进群不满 3 天、本周实名发过言）+ 本周匿名发过言、现在有角色的人。
// 没有入群时间、在线状态，顺序也不反映真实成员。
export async function anonRoster(c: Ctx, gid: number) {
  const db: Db = c.env.DB, viewer = await viewerOf(c), t = now(), week = weekOf(t)
  const spoke = await all(db, 'SELECT user_id,anon FROM anon_active WHERE group_id=? AND week=?', gid, week)
  const chars = new Set<number>(spoke.filter((r) => r.anon).map((r) => r.user_id)), reals = new Set<number>(spoke.filter((r) => !r.anon).map((r) => r.user_id))
  for (const r of await all(db, `SELECT cm.user_id FROM chat_members cm JOIN users u ON u.id=cm.user_id AND u.kind='user' LEFT JOIN anon_members a ON a.group_id=cm.group_id AND a.user_id=cm.user_id
    WHERE cm.group_id=? AND (COALESCE(a.anon,0)=0 OR cm.joined_at>?)`, gid, t - JOIN_WAIT)) reals.add(r.user_id)
  if (viewer.id) { const me = await anonSettingsFor(db, gid, viewer.id); if (me.active && me.identity) chars.add(viewer.id) }
  const roles = await identitiesOf(db, gid, chars)
  const people = await all(db, "SELECT id,username,name,avatar FROM users WHERE kind='user' AND disabled=0 AND id IN (SELECT value FROM json_each(?))", json(reals))
  const list: Row[] = []
  for (const uid of chars) { const r = roles.get(uid); if (r) list.push(uid === viewer.id ? asSelf(charPerson(r), uid) : charPerson(r)) }
  for (const p of people) list.push(realFor({ ...p, ...BLANK }))
  return list.sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username), 'zh-CN'))
}
// 站长的成员列表：真实身份附上角色；@ 补全里 username 用对外名字，免得把真实用户名发进群里
export async function tagMembers(c: Ctx, gid: number, rows: Row[], mention = false) {
  const db: Db = c.env.DB
  const on = new Set((await all(db, 'SELECT a.user_id FROM anon_members a JOIN chat_members cm ON cm.group_id=a.group_id AND cm.user_id=a.user_id WHERE a.group_id=? AND a.anon=1 AND cm.joined_at<=?', gid, now() - JOIN_WAIT)).map((r) => r.user_id))
  const roles = await identitiesOf(db, gid, rows.map((r) => Number(r.id)).filter((id) => on.has(id)))
  return rows.map((r) => {
    const a = roles.get(Number(r.id))
    return a ? { ...r, ...(mention ? { username: charName(a), name: charName(a) + '（' + (r.name || r.username) + '）' } : {}), anon: { ...tagOf(a), owner: true } } : { ...r, anon: null }
  })
}

// ---------- 水群榜 ----------
export async function anonRank(c: Ctx, gid: number, metric: string, today: string, period: string, view: Row) {
  const viewer = await viewerOf(c)
  if (viewer.owner) return view
  // 总榜跨身份累计，配上角色名就能把身份串起来：除本人外一律「鱼友」
  if (period === 'all') return { ...view, leaders: view.leaders.map((r: Row) => Number(r.user_id) === viewer.id ? { ...r, anon: null } : { ...r, user_id: OLD_ALIAS.id, name: OLD_ALIAS.name, avatar: null, anon: genericPerson().anon }) }
  const db: Db = c.env.DB, start = Date.parse(today + 'T04:00:00+08:00') / 1000
  const order = metric === 'count' ? 'messages DESC' : metric === 'early' ? 'first_at ASC' : 'last_at DESC'
  // 按发言时的身份分开算：实名、每个角色各一行
  const rows = await all(db, `SELECT s.user_id,s.anon,s.series,s.item,s.alias_id,COUNT(*) messages,MIN(x.created_at) first_at,MAX(x.created_at) last_at
    FROM chat_messages x JOIN anon_messages s ON s.message_id=x.id JOIN users u ON u.id=s.user_id
    WHERE x.group_id=?1 AND x.created_at>=?2 AND x.deleted=0 AND x.system_kind IS NULL AND u.kind='user' AND u.disabled=0
    GROUP BY s.user_id,s.anon,s.alias_id,(x.created_at>=?3) ORDER BY ${order},MIN(x.id)`, gid, start, weekStart(weekOf(now())))
  const at = rows.findIndex((r) => r.user_id === viewer.id), top = rows.slice(0, 20)
  const legacy = await legacyRoles(db, gid, top.flatMap((r) => legacyPairs(r as Snap, r.first_at)))
  const people = new Map((await all(db, 'SELECT id,username,COALESCE(nick,name,username) name,avatar FROM users WHERE id IN (SELECT value FROM json_each(?))', json(top.filter((r) => !r.anon).map((r) => r.user_id)))).map((r) => [r.id, r]))
  const leaders = top.map((r) => {
    const role = r.anon ? snapRole(r as Snap, legacy, r.first_at) : undefined
    const p: Row = r.anon ? (role ? charPerson(role) : genericPerson()) : realFor({ ...people.get(r.user_id) })
    return { user_id: r.user_id === viewer.id ? viewer.id : p.id, name: p.name || p.username, avatar: p.avatar, anon: r.anon ? { ...p.anon, ...(r.user_id === viewer.id ? { self: true } : {}) } : null,
      value: metric === 'count' ? r.messages : metric === 'early' ? r.first_at : r.last_at, messages: r.messages, first_at: r.first_at, last_at: r.last_at }
  })
  return { ...view, leaders, mineRank: at + 1 }
}

// ---------- 搜索发言人 ----------
// 只按对外名字找：角色名匹配匿名时以这个角色发的消息，真名只匹配实名发的消息。需要 LEFT JOIN anon_messages s ON s.message_id=x.id
export async function senderFilter(c: Ctx, gid: number, who: string, since: number) {
  const db: Db = c.env.DB, viewer = await viewerOf(c), q = who.toLowerCase(), parts: string[] = [], args: unknown[] = []
  const roles = POOL.filter((p) => SERIES[p.series].items[p.item - 1].name.toLowerCase().includes(q)).slice(0, 300).map((p) => p.series + '|' + p.item)
  if (roles.length) { parts.push("(s.anon=1 AND s.series IS NOT NULL AND (s.series||'|'||s.item) IN (SELECT value FROM json_each(?)))"); args.push(json(roles)) }
  // 按周分系列时期的旧消息
  const weeks = (await all(db, 'SELECT week FROM anon_weeks WHERE group_id=? AND week>=? AND week<=? ORDER BY week DESC LIMIT 12', gid, weekOf(since), weekOf(now()))).map((r) => r.week as string)
  for (const w of weeks) {
    const hits = (await all<Assignment>(db, 'SELECT week,user_id,series,item,suffix,alias_id FROM anon_assignments WHERE group_id=? AND week=?', gid, w)).filter((r) => charName(r).toLowerCase().includes(q)).map((r) => r.user_id)
    if (hits.length) { parts.push('(COALESCE(s.anon,1)=1 AND s.series IS NULL AND x.created_at>=? AND x.created_at<? AND COALESCE(s.user_id,x.user_id) IN (SELECT value FROM json_each(?)))'); args.push(weekStart(w), weekStart(nextWeek(w)), json(hits)) }
  }
  const reals = (await all(db, "SELECT id FROM users WHERE username LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' LIMIT 500", '%' + who.replace(/[\\%_]/g, (s) => '\\' + s) + '%')).map((r) => r.id)
  if (reals.length) { parts.push(`(${viewer.owner ? '' : 'COALESCE(s.anon,0)=0 AND '}COALESCE(s.user_id,x.user_id) IN (SELECT value FROM json_each(?)))`); args.push(json(reals)) }
  return parts.length ? { sql: '(' + parts.join(' OR ') + ')', args } : null
}

// ---------- 通用 JSON 遮罩 ----------
// 匿名群里除消息以外的接口（红包、猜词、榜单、回应名单……）：凡是能认出是「人」的对象都按发生时的状态替换
const ID_KEYS = ['user_id', 'recipient_id', 'author_id', 'actor_id', 'winner_id', 'uid', 'owner_id', 'sender_id', 'creator_id']
const NAME_KEYS = ['username', 'name', 'nick', 'user_name', 'author', 'author_name', 'author_nick', 'author_username', 'by']
const AVATAR_KEYS = ['avatar', 'author_avatar', 'user_avatar']
const ROLE_PREFIX = ['owner', 'winner', 'author', 'sender', 'recipient', 'actor', 'creator']
const intOf = (v: unknown) => v !== null && v !== '' && typeof v !== 'boolean' && Number.isSafeInteger(Number(v)) && Number(v) !== 0 ? Number(v) : 0
const isPerson = (o: Row) => !('is_default' in o) && ('username' in o || 'avatar' in o || 'author_avatar' in o || 'user_avatar' in o || (typeof o.name === 'string' && ID_KEYS.some((k) => k in o)))
const timeOf = (o: Row) => { for (const k of ['created_at', 'claimed_at', 'at', 'joined_at']) { const n = Number(o[k]); if (Number.isFinite(n) && n > 1e9) return n } return 0 }
const idKeyOf = (o: Row) => ID_KEYS.find((k) => intOf(o[k])) || ('id' in o && intOf(o.id) && ('username' in o || ('avatar' in o && 'name' in o && !('text' in o || 'body' in o || 'question' in o || 'kind' in o))) ? 'id' : '')
const done = (o: Row) => 'anon' in o && isPerson(o)
// 还有没处理过的「人」或名字字段吗（消息列表已经处理过，轮询时不必再查库）
const hasPeople = (v: unknown, depth = 0): boolean => {
  if (depth > 14) return true
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some((x) => hasPeople(x, depth + 1))
  const o = v as Row
  if (done(o)) return false
  return isPerson(o) || ROLE_PREFIX.some((p) => p + '_name' in o || p + '_username' in o) || Object.values(o).some((x) => hasPeople(x, depth + 1))
}
// stats：'all' 总榜，其他人一律鱼友；'today' 今日榜，本周切换过开关的人显示鱼友（合计跨了两种状态，显示任一身份都会对上号）
export async function maskAnonJson(c: Ctx, gid: number, data: unknown, stats?: 'today' | 'all') {
  const viewer = await viewerOf(c)
  if (viewer.owner) return data
  const db: Db = c.env.DB, t0 = now(), refs: { uid: number; ts: number }[] = []
  const walk = (v: unknown, ts: number, depth: number): void => {
    if (depth > 14 || v === null || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach((x) => walk(x, ts, depth + 1))
    const o = v as Row, own = timeOf(o) || ts
    if (done(o)) return
    for (const k of new Set([...ID_KEYS, isPerson(o) ? idKeyOf(o) : ''])) if (k && intOf(o[k])) refs.push({ uid: intOf(o[k]), ts: own || t0 })
    for (const x of Object.values(o)) walk(x, own, depth + 1)
  }
  walk(data, 0, 0)
  if (!refs.length && !hasPeople(data)) return data
  const uids = json(new Set(refs.map((r) => r.uid)))
  const kinds = new Map((await all(db, 'SELECT id,kind FROM users WHERE id IN (SELECT value FROM json_each(?))', uids)).map((r) => [r.id as number, r.kind as string]))
  const log = await logsOf(db, gid, kinds.keys()), current = await identitiesOf(db, gid, kinds.keys())
  const thisWeek = weekStart(weekOf(t0))
  // null = 不用遮
  const identity = (uid: number, ts: number): Row | null => {
    if (uid === viewer.id || kinds.get(uid) === 'bot') return null
    if (stats === 'all' || (stats && (log.logs.get(uid) || []).some((x) => x.at >= thisWeek))) return genericPerson()
    if (!anonAt(log, uid, ts)) return null
    const role = current.get(uid)
    return role ? charPerson(role) : genericPerson()
  }
  const apply = async (v: unknown, ts: number, depth: number): Promise<unknown> => {
    if (v === null || typeof v !== 'object') return v
    if (depth > 14) return null
    if (Array.isArray(v)) return Promise.all(v.map((x) => apply(x, ts, depth + 1)))
    const o = v as Row, own = timeOf(o) || ts, at = own || t0
    if (done(o)) return o
    const out: Row = {}
    for (const [k, x] of Object.entries(o)) out[k] = await apply(x, own, depth + 1)
    const person = isPerson(o), idKey = person ? idKeyOf(o) : ''
    for (const k of ID_KEYS) if (k !== idKey && kinds.has(intOf(o[k]))) { const p = identity(intOf(o[k]), at); if (p) out[k] = p.id }
    for (const prefix of ROLE_PREFIX) for (const k of [prefix + '_name', prefix + '_username']) if (typeof o[k] === 'string' && o[k]) {
      const uid = intOf(o[prefix + '_id']), p = uid ? identity(uid, at) : genericPerson()
      if (p) out[k] = p.name
    }
    if (!person) return out
    const uid = idKey ? intOf(o[idKey]) : 0
    if (uid && uid === viewer.id) return { ...out, anon: null }
    const p = uid ? identity(uid, at) : genericPerson()
    if (!p) return { ...out, anon: null }
    if (idKey) out[idKey] = p.id
    for (const k of NAME_KEYS) if (typeof out[k] === 'string' && out[k]) out[k] = p.name
    for (const k of AVATAR_KEYS) if (k in out) out[k] = p.avatar ?? null
    for (const k of ['deco', 'badges', 'official_titles', 'email', 'bio', 'role', 'last_seen', 'joined_at', 'author_deco']) if (k in out) out[k] = null
    if ('deco' in out) out.deco = p.deco ?? null
    if ('username' in o && 'title' in out) out.title = null
    for (const k of ['is_admin', 'fancy', 'author_fancy', 'owner', 'creator']) if (k in out) out[k] = false
    if ('trust_level' in out) out.trust_level = 0
    return { ...out, anon: p.anon ?? null }
  }
  return apply(data, 0, 0)
}

// ---------- 群设置 ----------
export async function anonSettingsFor(db: Db, gid: number, uid: number) {
  const enabled = await anonEnabled(db, gid, uid), joined = await joinedAt(db, gid, uid), eligibleAt = joined ? joined + JOIN_WAIT : 0
  const st = await drawState(db, gid, uid), role = (await identitiesOf(db, gid, [uid])).get(uid)
  const freeLeft = Math.max(0, FREE_DRAWS + Number(st?.bonus || 0) - Number(st?.free_used || 0))
  const pending = st?.pending_series ? { series: st.pending_series as string, item: Number(st.pending_item) } : null
  const holder = pending ? Number((await db.prepare('SELECT user_id FROM anon_identities WHERE group_id=? AND series=? AND item=?').bind(gid, pending.series, pending.item).first())?.user_id) || 0 : 0
  const card = (a: { series: string; item: number }) => { const x: Assignment = { week: '', user_id: uid, series: a.series, item: a.item, suffix: 1, alias_id: 0 }; return { ...tagOf(x), avatar: charAvatar(x), anon: tagOf(x) } }
  return {
    enabled, // 自己的开关（默认关）
    active: enabled && eligibleAt <= now(), // 现在发言是不是匿名（开着、进群满 3 天）
    eligible_at: eligibleAt > now() ? eligibleAt : null,
    identity: role ? card(role) : null,
    pending: pending ? { ...card(pending), taken: !!holder && holder !== uid, mine: holder === uid } : null,
    free_left: freeLeft, draw_cost: DRAW_COST, seize_cost: SEIZE_COST, theme_cost: THEME_COST, pool: POOL.length,
    themes: await themesFor(db, gid, uid),
    balance: Number((await db.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(uid).first())?.balance || 0),
  }
}
async function themesFor(db: Db, gid: number, uid: number) {
  const unlocked = new Set((await all(db, 'SELECT series FROM anon_theme_unlocks WHERE group_id=? AND user_id=?', gid, uid)).map((r) => r.series))
  return SERIES_LIST.map((s) => ({ id: s.id, name: s.name, count: POOL.filter((p) => p.series === s.id).length, unlocked: unlocked.has(s.id) })).filter((x) => x.count)
}
export async function anonSettings(c: Ctx, gid: number) {
  return anonSettingsFor(c.env.DB, gid, (await viewerOf(c)).id)
}
