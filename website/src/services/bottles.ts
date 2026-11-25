// 漂流瓶的规则与查询（2026-11-25 改版）。匿名的底线都在这里：
// 1. 匿名瓶给前端的列里没有作者；瓶主在自己匿名瓶里的回信 user 固定为 null。实名瓶在发布时选定，之后不能改。
// 2. 对外时间只到日期（北京时间），编号随机；热度、不喜欢的人数和名单不给别人看。
// 3. 瓶主不能赞 / 踩 / 收藏 / 举报自己的瓶子，也捞不到自己的瓶子。
// 4. 昵称和徽章只和这一个瓶子有关（services/bottle-names.ts），不能把同一作者的几个瓶子串起来。
import type { Env } from '../env'
import { fail } from '../lib/http'
import { now } from '../lib/time'
import { BADGES, badgeOf, randomNick, SINK_AT } from './bottle-names'
import * as M from './bottle-money'
import { assertClean } from './bottle-words'

export const BODY_MAX = 500
export const FREE_THROW = 5
export const FREE_DRAW = 20
export const DAYS = [1, 3, 7, 15, 30, 90]
export const DEFAULT_DAYS = 30
export const REPORT_HIDE = 3
export const PAGE = 20
export const MOODS = ['平静', '开心', '想念', '难过', '迷茫', '期待', '疲惫', '感悟']
export const HOST_NAME = '瓶主'

export const bjDay = (t: number) => new Date((t + 28800) * 1000).toISOString().slice(0, 10)
export const dayStart = (t: number) => Math.floor((t + 28800) / 86400) * 86400 - 28800

// 随机编号：48 位，JSON 里是安全整数
export function randomId() {
  return crypto.getRandomValues(new Uint8Array(6)).reduce((n, x) => n * 256 + x, 0) + 1
}
export const opOf = (raw: unknown) => (typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? raw.toLowerCase() : fail(400, '操作编号不正确，请刷新页面'))

export async function cleanBody(db: D1Database, raw: unknown) {
  const text = (typeof raw === 'string' ? raw : '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) fail(400, '写点什么再发吧')
  if ([...text].length > BODY_MAX) fail(400, `最多 ${BODY_MAX} 个字`)
  await assertClean(db, text)
  return text
}

// ---------- 瓶子 ----------
type Person = { id: number; is_admin: number }
export type BottleRow = { id: number; author_id: number; body: string; mood: string; hidden: number; deleted: number; created_at: number; expires_at: number; anon: number; poops: number }

// 能不能打开这个瓶子。管理员始终可以，瓶主可以（自己删掉的除外）；隐藏或删除的其他人都看不到；
// 有效期内知道编号的人都可以；过期或沉底后只有今天捞到的、收藏过或互动过的人可以
async function canSee(db: D1Database, b: BottleRow, u: Person) {
  if (u.is_admin === 1) return true
  if (b.author_id === u.id) return b.deleted !== 1
  if (b.hidden || b.deleted) return false
  if (b.expires_at > now()) return true
  return !!(await db.prepare(`SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM bottle_keeps WHERE user_id=?1 AND bottle_id=?2)
    OR EXISTS(SELECT 1 FROM bottle_likes WHERE bottle_id=?2 AND user_id=?1)
    OR EXISTS(SELECT 1 FROM bottle_draws WHERE user_id=?1 AND bottle_id=?2 AND at>=?3)
    OR EXISTS(SELECT 1 FROM bottle_replies WHERE user_id=?1 AND bottle_id=?2 AND deleted=0)`).bind(u.id, b.id, dayStart(now())).first())
}
// 结果含 author_id，只在服务端判断权限用，不能直接返回给前端
export async function needBottle(db: D1Database, id: number, u: Person) {
  const b = await db.prepare('SELECT * FROM bottles WHERE id=?').bind(id).first<BottleRow>()
  if (!b || !(await canSee(db, b, u))) return fail(404, '这个瓶子已经漂远了')
  return b
}

const NAME = (u: string) => `COALESCE(NULLIF(${u}.nick,''),NULLIF(${u}.name,''),${u}.username)`
// 给前端的列：?1 = 当前用户。作者信息只在实名瓶（anon=0）时才取出来
const VIEW = `b.id,b.body,b.mood,b.hidden,b.deleted,b.created_at,b.expires_at,b.anon,b.nick,b.show_badge,b.poops,b.author_id=?1 AS mine,
  au.id AS au_id,au.username AS au_username,${NAME('au')} AS au_name,au.avatar AS au_avatar,
  EXISTS(SELECT 1 FROM bottle_likes l WHERE l.bottle_id=b.id AND l.user_id=?1) AS liked,
  EXISTS(SELECT 1 FROM bottle_poops x WHERE x.bottle_id=b.id AND x.user_id=?1) AS pooped,
  EXISTS(SELECT 1 FROM bottle_keeps k WHERE k.user_id=?1 AND k.bottle_id=b.id) AS kept,
  (SELECT COUNT(*) FROM bottle_likes l WHERE l.bottle_id=b.id) AS likes,
  (SELECT COUNT(DISTINCT r.user_id) FROM bottle_replies r WHERE r.bottle_id=b.id AND r.is_host=0 AND r.deleted=0 AND r.hidden=0) AS repliers,
  (SELECT COUNT(*) FROM bottle_replies r WHERE r.bottle_id=b.id AND r.deleted=0 AND r.hidden=0) AS replies`
const FROM = 'bottles b LEFT JOIN users au ON au.id=b.author_id AND b.anon=0'
type ViewRow = { id: number; body: string; mood: string; hidden: number; deleted: number; created_at: number; expires_at: number; anon: number; nick: string; show_badge: number; poops: number; mine: number
  au_id: number | null; au_username: string | null; au_name: string | null; au_avatar: string | null
  liked: number; pooped: number; kept: number; likes: number; repliers: number; replies: number }
function toView(r: ViewRow) {
  const mine = !!r.mine, anon = !!r.anon
  const key = anon && (r.show_badge || mine) ? badgeOf(r.likes, r.repliers, r.poops) : null
  return {
    id: r.id, body: r.body, mood: r.mood, day: bjDay(r.created_at), mine, anon,
    nick: anon ? r.nick || randomNick(r.id) : null,
    user: anon ? null : { id: r.au_id, username: r.au_username, name: r.au_name, avatar: r.au_avatar },
    badge: key ? { key, ...BADGES[key] } : null,
    liked: !!r.liked, pooped: !!r.pooped, kept: !!r.kept, likes: r.likes, replies: r.replies,
    expired: r.expires_at <= now(),
    // 只有瓶主和管理员会拿到被隐藏 / 删除的瓶子（canSee 挡住其他人）
    state: r.deleted ? 'removed' : r.hidden ? 'hidden' : 'ok',
    // 只给瓶主自己看的
    ...(mine ? { expires_day: bjDay(r.expires_at), poops: r.poops, sunk: r.poops >= SINK_AT, show_badge: !!r.show_badge } : {}),
  }
}
export async function bottleView(db: D1Database, id: number, uid: number) {
  const r = await db.prepare(`SELECT ${VIEW} FROM ${FROM} WHERE b.id=?2`).bind(uid, id).first<ViewRow>()
  return r ? toView(r) : null
}

// 热度：只影响被捞到的机会，不返回给任何人
export const reheat = (db: D1Database, id: number) => db.prepare(`UPDATE bottles SET
  poops=(SELECT COUNT(*) FROM bottle_poops x WHERE x.bottle_id=?1),
  heat=4*(SELECT COUNT(*) FROM bottle_likes l WHERE l.bottle_id=?1)
   +6*(SELECT COUNT(DISTINCT r.user_id) FROM bottle_replies r WHERE r.bottle_id=?1 AND r.is_host=0 AND r.deleted=0 AND r.hidden=0)
   -5*(SELECT COUNT(*) FROM bottle_poops x WHERE x.bottle_id=?1) WHERE id=?1`).bind(id)
const weight = (heat: number) => Math.min(100, Math.max(1, 10 + heat))
export function pickWeighted(rows: { id: number; heat: number }[], random = Math.random) {
  let left = random() * rows.reduce((n, r) => n + weight(r.heat), 0)
  for (const r of rows) { left -= weight(r.heat); if (left < 0) return r.id }
  return rows.length ? rows[rows.length - 1].id : null
}

// ---------- 次数与价格 ----------
export async function quota(db: D1Database, uid: number) {
  const r = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM bottles WHERE author_id=?1 AND created_at>=?2 AND paid=0) AS threw,
    (SELECT COUNT(*) FROM bottles WHERE author_id=?1 AND created_at>=?2 AND paid>0) AS threw_paid,
    (SELECT COUNT(*) FROM bottle_draws WHERE user_id=?1 AND at>=?2 AND paid=0) AS drew,
    (SELECT COUNT(*) FROM bottle_draws WHERE user_id=?1 AND at>=?2 AND paid>0) AS drew_paid`).bind(uid, dayStart(now())).first<{ threw: number; threw_paid: number; drew: number; drew_paid: number }>()
  const q = r ?? { threw: 0, threw_paid: 0, drew: 0, drew_paid: 0 }
  const price = (free: number, paid: number) => (free > 0 ? 0 : paid >= M.MAX_PAID ? null : M.priceOf(paid))
  const throw_left = Math.max(0, FREE_THROW - q.threw), draw_left = Math.max(0, FREE_DRAW - q.drew)
  // price：0 = 免费，null = 今天到顶了
  return { throw_left, draw_left, throw_price: price(throw_left, q.threw_paid), draw_price: price(draw_left, q.drew_paid), throw_paid: q.threw_paid, draw_paid: q.drew_paid }
}
// 前端带上它看到并确认过的价格；对不上就报新价格，让用户重新确认，绝不按没看过的价格扣
function agreed(price: number | null, shown: unknown, verb: string): number {
  if (price === null) return fail(429, `今天付费${verb}的次数也用完了，明天再来`)
  if (price > 0 && shown !== price) return fail(409, `今天的免费次数用完了，这次要 ${price} D币`, 'price')
  return price
}

export async function throwBottle(env: Env, uid: number, p: { op: string; body: string; mood: string; days: number; anon: boolean; nick: string; show_badge: boolean; price: unknown }) {
  const db = env.DB, t = now(), start = dayStart(t)
  const old = await db.prepare('SELECT id FROM bottles WHERE author_id=? AND op=?').bind(uid, p.op).first<{ id: number }>()
  if (old) return old.id
  const q = await quota(db, uid), price = agreed(q.throw_price, p.price, '扔瓶子'), id = randomId()
  const cols = [id, uid, p.body, p.mood, t, t + p.days * 86400, p.anon ? 1 : 0, p.anon ? p.nick : '', p.show_badge ? 1 : 0, price, p.op]
  const into = 'INSERT INTO bottles(id,author_id,body,mood,created_at,expires_at,anon,nick,show_badge,paid,op) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11 WHERE '
  // 次数检查和写入在同一条语句 / 同一个事务里，连点不会超
  if (!price) {
    const r = await db.prepare(into + `(SELECT COUNT(*) FROM bottles WHERE author_id=?2 AND created_at>=?12 AND paid=0)<${FREE_THROW}`).bind(...cols, start).run()
    return r.meta.changes ? id : fail(409, '次数刚刚用完了，请再试一次', 'price')
  }
  const payee = M.incomeUser(env), attempt = crypto.randomUUID()
  await M.prepareWallets(db, uid, payee)
  const out = await db.batch([
    ...M.payStatements(db, { uid, payee, kind: 'bottle-throw', op: p.op, price, attempt, t,
      guard: '(SELECT COUNT(*) FROM bottles WHERE author_id=?1 AND created_at>=?6 AND paid>0)=?7', guardArgs: [start, q.throw_paid] }),
    db.prepare(into + 'EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=?2 AND attempt=?12) RETURNING id').bind(...cols, attempt),
  ])
  return out[out.length - 1].results.length ? id : unpaid(db, uid, price)
}
async function unpaid(db: D1Database, uid: number, price: number): Promise<never> {
  return await M.balanceOf(db, uid) < price ? fail(400, `D币不够，需要 ${price}`) : fail(409, '价格或次数刚刚变了，请再试一次', 'price')
}

// 捞一个没捞过的；没有合适的返回 null，不扣次数也不扣钱
export async function drawBottle(env: Env, uid: number, p: { op: string; mood: string; price: unknown }) {
  const db = env.DB, t = now(), start = dayStart(t)
  const old = await db.prepare('SELECT bottle_id FROM bottle_draws WHERE user_id=? AND op=?').bind(uid, p.op).first<{ bottle_id: number }>()
  if (old) return old.bottle_id
  const q = await quota(db, uid), price = agreed(q.draw_price, p.price, '捞瓶子')
  const { results } = await db.prepare(`SELECT b.id,b.heat FROM bottles b WHERE b.deleted=0 AND b.hidden=0 AND b.expires_at>?2 AND b.poops<${SINK_AT} AND b.author_id<>?1 AND (?3='' OR b.mood=?3)
    AND NOT EXISTS(SELECT 1 FROM bottle_draws d WHERE d.user_id=?1 AND d.bottle_id=b.id) LIMIT 3000`).bind(uid, t, p.mood).all<{ id: number; heat: number }>()
  const id = pickWeighted(results)
  if (id === null) return null
  const into = 'INSERT OR IGNORE INTO bottle_draws(user_id,bottle_id,at,paid,op) SELECT ?1,?2,?3,?4,?5 WHERE '
  if (!price) {
    const r = await db.prepare(into + `(SELECT COUNT(*) FROM bottle_draws WHERE user_id=?1 AND at>=?6 AND paid=0)<${FREE_DRAW}`).bind(uid, id, t, 0, p.op, start).run()
    return r.meta.changes ? id : fail(409, '次数刚刚用完了，请再试一次', 'price')
  }
  const payee = M.incomeUser(env), attempt = crypto.randomUUID()
  await M.prepareWallets(db, uid, payee)
  const out = await db.batch([
    ...M.payStatements(db, { uid, payee, kind: 'bottle-draw', op: p.op, price, attempt, t,
      guard: `(SELECT COUNT(*) FROM bottle_draws WHERE user_id=?1 AND at>=?6 AND paid>0)=?7 AND NOT EXISTS(SELECT 1 FROM bottle_draws WHERE user_id=?1 AND bottle_id=?8)
        AND EXISTS(SELECT 1 FROM bottles WHERE id=?8 AND deleted=0 AND hidden=0 AND expires_at>?5)`, guardArgs: [start, q.draw_paid, id] }),
    db.prepare(into + 'EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=?1 AND attempt=?6) RETURNING bottle_id').bind(uid, id, t, price, p.op, attempt),
  ])
  return out[out.length - 1].results.length ? id : unpaid(db, uid, price)
}

// ---------- 我的 ----------
export const TABS = ['thrown', 'drawn', 'liked', 'replied', 'kept'] as const
export type Tab = (typeof TABS)[number]
function parseCursor(raw: string | undefined): [number, number] {
  if (!raw) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
  const m = /^(\d{1,15})\.(\d{1,15})$/.exec(raw)
  return m ? [Number(m[1]), Number(m[2])] : fail(400, '翻页参数不正确')
}
// 游标都是本人自己的时间（扔、捞、赞、回、收藏），不会带出别人的
export async function mineList(db: D1Database, uid: number, tab: Tab, rawCursor: string | undefined) {
  const [at, id] = parseCursor(rawCursor)
  const source: Record<Tab, string> = {
    thrown: `(SELECT id AS bottle_id,created_at AS cur FROM bottles WHERE author_id=?1 AND deleted<>1)`,
    drawn: `(SELECT bottle_id,at AS cur FROM bottle_draws WHERE user_id=?1 AND at>=${dayStart(now())})`,
    liked: `(SELECT bottle_id,created_at AS cur FROM bottle_likes WHERE user_id=?1)`,
    replied: `(SELECT bottle_id,MAX(created_at) AS cur FROM bottle_replies WHERE user_id=?1 AND deleted=0 AND is_host=0 GROUP BY bottle_id)`,
    kept: `(SELECT bottle_id,created_at AS cur FROM bottle_keeps WHERE user_id=?1)`,
  }
  const alive = tab === 'thrown' ? '' : 'AND b.deleted=0 AND b.hidden=0'
  const { results } = await db.prepare(`SELECT ${VIEW},x.cur FROM ${source[tab]} x JOIN ${FROM.replace('bottles b', 'bottles b ON b.id=x.bottle_id')}
    WHERE (x.cur<?2 OR x.cur=?2 AND b.id<?3) ${alive} ORDER BY x.cur DESC,b.id DESC LIMIT ${PAGE + 1}`).bind(uid, at, id).all<ViewRow & { cur: number }>()
  const rows = results.slice(0, PAGE), last = rows[rows.length - 1]
  return { items: rows.map(toView), next: results.length > PAGE ? `${last.cur}.${last.id}` : null }
}

// ---------- 回信 ----------
type ReplyRow = { id: number; body: string; created_at: number; is_host: number; anon: number; mine: number; uid: number | null; username: string | null; name: string | null; avatar: string | null; to_id: number | null; to_host: number | null; to_name: string | null; to_gone: number | null }
// 匿名瓶的瓶主回信在 SQL 里就不取用户信息
export async function replyPage(db: D1Database, bottleId: number, uid: number, after: number) {
  const { results } = await db.prepare(`SELECT r.id,r.body,r.created_at,r.is_host,b.anon,r.user_id=?2 AS mine,
      u.id AS uid,u.username,${NAME('u')} AS name,u.avatar,
      p.id AS to_id,p.is_host AS to_host,${NAME('pu')} AS to_name,(p.deleted<>0 OR p.hidden<>0) AS to_gone
    FROM bottle_replies r JOIN bottles b ON b.id=r.bottle_id LEFT JOIN users u ON u.id=r.user_id AND (r.is_host=0 OR b.anon=0)
    LEFT JOIN bottle_replies p ON p.id=r.reply_to LEFT JOIN users pu ON pu.id=p.user_id AND p.is_host=0
    WHERE r.bottle_id=?1 AND r.id>?3 AND r.deleted=0 AND r.hidden=0 ORDER BY r.id LIMIT ${PAGE + 1}`).bind(bottleId, uid, after).all<ReplyRow>()
  const rows = results.slice(0, PAGE)
  return {
    items: rows.map((r) => ({
      id: r.id, body: r.body, day: bjDay(r.created_at), host: !!r.is_host, mine: !!r.mine,
      user: r.is_host && r.anon ? null : { id: r.uid, username: r.username, name: r.name, avatar: r.avatar },
      reply_to: r.to_id ? { id: r.to_id, host: !!r.to_host, name: r.to_host ? HOST_NAME : r.to_gone ? '已删除的回信' : r.to_name } : null,
    })),
    next: results.length > PAGE ? rows[rows.length - 1].id : null,
  }
}

export async function likers(db: D1Database, bottleId: number, rawCursor: string | undefined) {
  const [at, id] = parseCursor(rawCursor)
  const { results } = await db.prepare(`SELECT l.created_at AS at,u.id,u.username,${NAME('u')} AS name,u.avatar
    FROM bottle_likes l JOIN users u ON u.id=l.user_id WHERE l.bottle_id=?1 AND (l.created_at<?2 OR l.created_at=?2 AND u.id<?3)
    ORDER BY l.created_at DESC,u.id DESC LIMIT ${PAGE + 1}`).bind(bottleId, at, id).all<{ at: number; id: number; username: string; name: string; avatar: string | null }>()
  const rows = results.slice(0, PAGE), last = rows[rows.length - 1]
  return { items: rows.map(({ at: _at, ...u }) => u), next: results.length > PAGE ? `${last.at}.${last.id}` : null }
}

// ---------- 举报 ----------
export type Kind = 'bottle' | 'reply'
const tableOf = (kind: Kind) => (kind === 'bottle' ? 'bottles' : 'bottle_replies')
export const report = (db: D1Database, kind: Kind, id: number, uid: number, reason: string) => db.batch([
  db.prepare('INSERT OR IGNORE INTO bottle_reports(kind,target_id,user_id,reason,created_at) VALUES(?,?,?,?,?)').bind(kind, id, uid, reason, now()),
  // 只数还没处理的举报：管理员判定「保留」后，旧举报不会再把它隐藏
  db.prepare(`UPDATE ${tableOf(kind)} SET hidden=1 WHERE id=?1 AND deleted=0
    AND (SELECT COUNT(*) FROM bottle_reports WHERE kind=?2 AND target_id=?1 AND resolved=0)>=${REPORT_HIDE}`).bind(id, kind),
])
export const resolveReports = (db: D1Database, kind: Kind, id: number, remove: boolean) => db.batch([
  remove ? db.prepare(`UPDATE ${tableOf(kind)} SET deleted=2 WHERE id=? AND deleted=0`).bind(id)
    : db.prepare(`UPDATE ${tableOf(kind)} SET hidden=0 WHERE id=?`).bind(id),
  db.prepare('UPDATE bottle_reports SET resolved=? WHERE kind=? AND target_id=? AND resolved=0').bind(remove ? 2 : 1, kind, id),
])
// 待处理列表：不含匿名作者，也不含举报人
export async function openReports(db: D1Database) {
  const { results } = await db.prepare(`SELECT q.kind,q.target_id AS id,q.n,q.reasons,
      CASE q.kind WHEN 'bottle' THEN b.body ELSE r.body END AS body,
      CASE q.kind WHEN 'bottle' THEN b.hidden ELSE r.hidden END AS hidden,
      CASE q.kind WHEN 'bottle' THEN b.id ELSE r.bottle_id END AS bottle_id,
      COALESCE(r.is_host,1) AS host,
      CASE WHEN q.kind='reply' AND r.is_host=0 THEN ${NAME('u')} END AS name
    FROM (SELECT kind,target_id,COUNT(*) AS n,MIN(created_at) AS first,json_group_array(reason) AS reasons FROM bottle_reports WHERE resolved=0 GROUP BY kind,target_id ORDER BY first LIMIT 100) q
    LEFT JOIN bottles b ON q.kind='bottle' AND b.id=q.target_id
    LEFT JOIN bottle_replies r ON q.kind='reply' AND r.id=q.target_id
    LEFT JOIN users u ON u.id=r.user_id AND r.is_host=0 ORDER BY q.first`)
    .all<{ kind: Kind; id: number; n: number; reasons: string; body: string | null; hidden: number; bottle_id: number; host: number; name: string | null }>()
  return results.filter((r) => r.body !== null).map((r) => ({ ...r, hidden: !!r.hidden, host: !!r.host, reasons: (JSON.parse(r.reasons) as string[]).filter(Boolean) }))
}
export async function openReportCount(db: D1Database) {
  return (await db.prepare('SELECT COUNT(*) AS n FROM (SELECT DISTINCT kind,target_id FROM bottle_reports WHERE resolved=0)').first<{ n: number }>())?.n ?? 0
}
// 站长查看作者：必须有别人举报过这个瓶子（或瓶主在里面的回信），每次留记录
export async function revealAuthor(db: D1Database, id: number, viewer: number) {
  const ok = await db.prepare(`SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM bottle_reports WHERE kind='bottle' AND target_id=?1 AND user_id<>?2)
    OR EXISTS(SELECT 1 FROM bottle_replies r JOIN bottle_reports p ON p.kind='reply' AND p.target_id=r.id AND p.user_id<>?2 WHERE r.bottle_id=?1 AND r.is_host=1)`).bind(id, viewer).first()
  if (!ok) fail(403, '只有被别人举报的瓶子可以查看作者')
  // 先留记录再取作者
  await db.prepare('INSERT INTO bottle_author_views(bottle_id,viewer_id,at) VALUES(?,?,?)').bind(id, viewer, now()).run()
  return db.prepare(`SELECT u.id,u.username,${NAME('u')} AS name FROM bottles b JOIN users u ON u.id=b.author_id WHERE b.id=?`).bind(id).first()
}
