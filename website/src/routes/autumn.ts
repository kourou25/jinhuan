// 「死如秋叶」：好久不见、跃进
// 匿名帖：任何响应都不带 user_id、昵称、头像；时间只精确到天；作者在自己匿名帖下的评论只显示「匿名楼主」。
// 本板块不写通知、推送、搜索、D 币、称号流水，这些地方都会带出作者。
import { Hono } from 'hono'
import type { C, Ctx, User } from '../types'
import { needUser, isOwner } from '../services/auth'
import { boundedJson, fail } from '../lib/http'
import { now } from '../lib/time'
import { randHex, sha256 } from '../lib/crypto'
import { ensureCoinWallet } from '../farm/coin-packets'
import { prepareMedia, mediaKeys, type Media } from '../services/content-media'
import { commitUploadContent, storeUpload } from '../services/upload-operations'
import { bjDay, ensureMemorial, memorialConfig, MEMORIAL_IDLE_DAYS, MEMORIAL_WHERE, sniffAutumnImage, stripMetadata } from '../services/autumn'

export const autumn = new Hono<Ctx>()
autumn.use('/api/autumn/*', async (c, next) => {
  needUser(c)
  c.header('cache-control', 'private, no-store')
  await next()
})

const str = (v: unknown, max: number, name: string) => {
  if (typeof v !== 'string') fail(400, `${name}格式错误`)
  const s = (v as string).trim()
  if ([...s].length > max) fail(400, `${name}不能超过 ${max} 字`)
  return s
}
const requestId = (v: unknown) => typeof v === 'string' && /^[a-f\d-]{36}$/i.test(v) ? v : fail(400, '请求编号无效')
const nameOf = (u: { nick?: string | null; name?: string | null; username: string }) => u.nick || u.name || u.username
// 匿名内容的时间只到天，避免和在线时间对上
const dayStart = (t: number) => Math.floor((t + 28800) / 86400) * 86400 - 28800

// ---------- 板块首页 ----------
autumn.get('/api/autumn/home', async (c) => {
  const u = needUser(c), db = c.env.DB
  const opt = await db.prepare('SELECT 1 FROM autumn_opt_out WHERE user_id=?').bind(u.id).first()
  const fresh = await db.prepare('SELECT COUNT(*) n FROM autumn_gifts WHERE recipient_id=? AND seen_at IS NULL AND hidden=0').bind(u.id).first<{ n: number }>()
  return c.json({ fresh_gifts: fresh!.n, boards: [['miss', '好久不见'], ...BOARDS.map((b) => [b.key, b.label])], opt_out: !!opt, owner: isOwner(c, u) })
})

// ---------- 好久不见：想念很久没来的朋友 ----------
const WORDS = ['今天也有人提起你', '位置一直给你留着', '新出的梗还没跟你讲', '回来记得吱一声', '天冷了，记得加衣', '群里少了你的笑声', '下次聚，叫上你', '有好玩的第一个想到你', '最近过得还好吗', '等你回来接着聊', '你讲的笑话我们还记得', '门没锁，随时回来']
// 礼物：价格以这里为准，下单时核对页面上看到的价格
export const GIFTS = [
  { key: 'candy', name: '一把糖果', price: 10000, text: '想你的时候，吃一颗就甜一点' },
  { key: 'tea', name: '一杯热奶茶', price: 15000, text: '还是你爱喝的那个甜度' },
  { key: 'postcard', name: '一张明信片', price: 20000, text: '这里的近况，写给你听' },
  { key: 'lamp', name: '一盏小夜灯', price: 36000, text: '什么时候回来，都有光' },
  { key: 'scarf', name: '一条围巾', price: 58000, text: '路上风大，别着凉' },
  { key: 'ticket', name: '一张回程车票', price: 88000, text: '随时出发，我们去接你' },
  { key: 'dinner', name: '一顿重逢的晚饭', price: 188000, text: '菜点好了，就等你入座' },
] as const
const missArgs = async (db: any, t: number) => { const cfg = await memorialConfig(db); return { cut: t - MEMORIAL_IDLE_DAYS * 86400, ...cfg } }
const personId = (c: C) => { const id = Number(c.req.param('id')); if (!Number.isSafeInteger(id) || id === 0) fail(400, '编号无效'); return id }

autumn.get('/api/autumn/miss', async (c) => {
  const u = needUser(c), db = c.env.DB, t = now()
  await ensureMemorial(db, t)
  const a = await missArgs(db, t)
  const rows = (await db.prepare(`SELECT u.id,u.username,u.name,u.nick,u.avatar,u.created_at,m.days,
      (SELECT COUNT(*) FROM autumn_leaves l WHERE l.user_id=u.id) misses,
      EXISTS(SELECT 1 FROM autumn_leaves l WHERE l.user_id=u.id AND l.giver_id=?4 AND l.day=?5) missed
    FROM autumn_memorial m JOIN users u ON u.id=m.user_id WHERE m.peak>=?2 AND m.score>=?3 AND u.id<>?4 AND ${MEMORIAL_WHERE} ORDER BY m.score DESC,u.id LIMIT 150`)
    .bind(a.cut, a.peak, a.score, u.id, bjDay(t)).all<{ id: number; username: string; name: string | null; nick: string | null; avatar: string | null; created_at: number; days: number; misses: number; missed: number }>()).results
  const gifts = (await db.prepare(`SELECT recipient_id id,gift,COUNT(*) n FROM autumn_gifts WHERE recipient_id IN (SELECT value FROM json_each(?)) GROUP BY 1,2`).bind(JSON.stringify(rows.map((r) => r.id))).all<{ id: number; gift: string; n: number }>()).results
  const byId = new Map<number, Record<string, number>>()
  for (const g of gifts) byId.set(g.id, { ...byId.get(g.id), [g.gift]: g.n })
  // 不返回发言数、最后上线时间；照片大小只分三档。谁送的、写了什么只有本人回来后能看到
  return c.json({ idle_days: MEMORIAL_IDLE_DAYS, gifts: GIFTS, people: rows.map((r, i) => ({ id: r.id, username: r.username, name: nameOf(r), avatar: r.avatar, joined: bjDay(r.created_at).slice(0, 7), days: r.days,
    tier: i < Math.max(1, Math.ceil(rows.length * 0.12)) ? 1 : i < Math.ceil(rows.length * 0.45) ? 2 : 3,
    words: WORDS[Math.abs(r.id) % WORDS.length], misses: r.misses, missed: !!r.missed, gifts: byId.get(r.id) ?? {} })) })
})
autumn.post('/api/autumn/miss/:id/hello', async (c) => {
  const u = needUser(c), db = c.env.DB, t = now(), id = personId(c), a = await missArgs(db, t)
  const ok = id !== u.id && await db.prepare(`SELECT 1 FROM autumn_memorial m JOIN users u ON u.id=m.user_id WHERE m.user_id=?2 AND m.peak>=?3 AND m.score>=?4 AND ${MEMORIAL_WHERE}`).bind(a.cut, id, a.peak, a.score).first()
  if (!ok) fail(404, 'TA 已经不在这面墙上了，也许刚刚回来了')
  await db.prepare('INSERT OR IGNORE INTO autumn_leaves(user_id,giver_id,day) VALUES(?,?,?)').bind(id, u.id, bjDay(t)).run()
  const n = await db.prepare('SELECT COUNT(*) n FROM autumn_leaves WHERE user_id=?').bind(id).first<{ n: number }>()
  return c.json({ misses: n!.n, missed: true })
})
// ---- 送礼 ----
autumn.get('/api/autumn/miss/wallet', async (c) => {
  const u = needUser(c)
  await ensureCoinWallet(c.env.DB, u.id, now())
  const w = await c.env.DB.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(u.id).first<{ balance: number }>()
  return c.json({ balance: Number(w?.balance ?? 0) })
})
const ownerId = (c: C) => (c.env.ADMIN_USER_IDS ?? '').split(',').map((x) => Number(x.trim())).find((n) => Number.isSafeInteger(n) && n !== 0) ?? fail(503, '收款账户未配置，暂不能送礼')
autumn.post('/api/autumn/miss/:id/gift', async (c) => {
  const u = await actor(c, 'comment'), db = c.env.DB, t = now(), to = personId(c), b = await boundedJson(c, 2000)
  const gift = GIFTS.find((g) => g.key === b.gift) ?? fail(400, '没有这种礼物'), note = str(b.note ?? '', 80, '留言'), nonce = requestId(b.nonce)
  if (b.confirm !== true) fail(400, '请确认从本人钱包支付')
  if (b.price !== gift.price) fail(409, '礼物价格已变化，请刷新后再送', 'gift_price_changed')
  const id = await sha256(`miss-gift:${u.id}:${nonce}`)
  type Row = { recipient_id: number; gift: string; price: number }
  const done = async (duplicate: boolean) => {
    const row = await db.prepare('SELECT recipient_id,gift,price FROM autumn_gifts WHERE id=? AND sender_id=?').bind(id, u.id).first<Row>()
    if (!row) return null
    if (row.recipient_id !== to || row.gift !== gift.key) fail(409, '这个请求编号已用于另一份礼物')
    const w = await db.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(u.id).first<{ balance: number }>()
    return c.json({ sent: true, duplicate, price: row.price, balance: Number(w?.balance ?? 0) })
  }
  const prior = await done(true)
  if (prior) return prior
  const owner = ownerId(c), self = owner === u.id, a = await missArgs(db, t)
  await ensureCoinWallet(db, u.id, t)
  if (!self) await ensureCoinWallet(db, owner, t)
  const attempt = crypto.randomUUID(), gate = 'EXISTS(SELECT 1 FROM autumn_gifts WHERE attempt=?1)'
  // 校验（对方仍在墙上、没选择不展示、双方账号正常、余额够）和扣款、入账、送礼在同一个事务里
  const result = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO autumn_gifts(id,sender_id,recipient_id,gift,price,note,attempt,created_at)
      SELECT ?5,?6,?2,?7,?8,?9,?10,?11 WHERE ?6<>?2
      AND EXISTS(SELECT 1 FROM autumn_memorial m JOIN users u ON u.id=m.user_id WHERE m.user_id=?2 AND m.peak>=?3 AND m.score>=?4 AND ${MEMORIAL_WHERE})
      AND EXISTS(SELECT 1 FROM users WHERE id=?6 AND disabled=0 AND silenced=0 AND kind='user')
      AND EXISTS(SELECT 1 FROM users WHERE id=?12 AND disabled=0 AND kind='user')
      AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?2,?6,?12))
      AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?6 AND balance>=?8)
      AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?12 AND (?6=?12 OR balance<=9007199254740991-?8)) RETURNING id`)
      .bind(a.cut, to, a.peak, a.score, id, u.id, gift.key, gift.price, note, attempt, t, owner),
    // 支出一条、收入一条。站长自己送：同一账户先减后加，余额不变，账面平
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT user_id,'miss-gift-send',?2,?1||':send',-?3,balance-?3,?4 FROM coin52_wallets WHERE user_id=?5 AND ${gate}`).bind(attempt, id, gift.price, t, u.id),
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT user_id,'miss-gift-income',?2,?1||':income',?3,CASE WHEN ?5=1 THEN balance ELSE balance+?3 END,?4 FROM coin52_wallets WHERE user_id=?6 AND ${gate}`).bind(attempt, id, gift.price, t, self ? 1 : 0, owner),
    db.prepare(`UPDATE coin52_wallets SET balance=balance+COALESCE((SELECT SUM(l.delta) FROM coin52_ledger l WHERE l.user_id=coin52_wallets.user_id AND l.attempt IN(?1||':send',?1||':income')),0),revision=revision+1,updated_at=?2 WHERE user_id IN(?3,?4) AND ${gate}`).bind(attempt, t, u.id, owner),
  ])
  if (!result[0].results.length) {
    const again = await done(true)
    if (again) return again
    const w = await db.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(u.id).first<{ balance: number }>()
    if (Number(w?.balance ?? 0) < gift.price) fail(409, `D币不够：需要 ${gift.price}，你有 ${Number(w?.balance ?? 0)}。没有扣款`, 'balance_insufficient')
    fail(409, '没有送出，也没有扣款：TA 可能刚刚回来了，或不再展示', 'gift_not_sent')
  }
  return (await done(false))!
})
// 寄给我的 / 我送出的
autumn.get('/api/autumn/miss/mine', async (c) => {
  const u = needUser(c), db = c.env.DB, names = new Map<string, string>(GIFTS.map((g) => [g.key, g.name]))
  type Row = { id: string; gift: string; note: string; price: number; created_at: number; seen_at: number | null; uid: number; username: string; name: string | null; nick: string | null; avatar: string | null }
  const q = (me: string, other: string, extra: string) => db.prepare(`SELECT g.id,g.gift,g.note,g.price,g.created_at,g.seen_at,u.id uid,u.username,u.name,u.nick,u.avatar FROM autumn_gifts g JOIN users u ON u.id=g.${other} WHERE g.${me}=? ${extra} ORDER BY g.created_at DESC,g.id LIMIT 200`).bind(u.id).all<Row>()
  const [got, sent] = await Promise.all([q('recipient_id', 'sender_id', 'AND g.hidden=0'), q('sender_id', 'recipient_id', '')])
  const misses = await db.prepare('SELECT COUNT(*) n FROM autumn_leaves WHERE user_id=?').bind(u.id).first<{ n: number }>()
  const view = (r: Row) => ({ id: r.id, gift: r.gift, gift_name: names.get(r.gift) || '礼物', note: r.note, at: r.created_at, person: { id: r.uid, username: r.username, name: nameOf(r), avatar: r.avatar } })
  return c.json({ misses: misses!.n, received: got.results.map((r) => ({ ...view(r), fresh: r.seen_at === null })), sent: sent.results.map((r) => ({ ...view(r), price: r.price })) })
})
autumn.post('/api/autumn/miss/mine/seen', async (c) => {
  const u = needUser(c)
  await c.env.DB.prepare('UPDATE autumn_gifts SET seen_at=? WHERE recipient_id=? AND seen_at IS NULL').bind(now(), u.id).run()
  return c.json({ ok: true })
})
// 收到的人可以收起某一份（比如留言不合适）；不影响已完成的付款
autumn.delete('/api/autumn/miss/mine/:gid', async (c) => {
  const u = needUser(c), r = await c.env.DB.prepare('UPDATE autumn_gifts SET hidden=1 WHERE id=? AND recipient_id=? AND hidden=0').bind(c.req.param('gid'), u.id).run()
  if (!r.meta.changes) fail(404, '礼物不存在')
  return c.json({ ok: true })
})
autumn.put('/api/autumn/miss/opt-out', async (c) => {
  const u = needUser(c), b = await boundedJson(c, 200)
  if (typeof b.on !== 'boolean') fail(400, '参数无效')
  await c.env.DB.prepare(b.on ? 'INSERT OR IGNORE INTO autumn_opt_out(user_id,at) VALUES(?,?)' : 'DELETE FROM autumn_opt_out WHERE user_id=? AND ?>0').bind(u.id, now()).run()
  return c.json({ opt_out: b.on })
})
// 名单门槛：站长可调，预览各档人数
autumn.get('/api/autumn/miss/config', async (c) => {
  const u = needUser(c)
  if (!isOwner(c, u)) fail(403, '仅站长可用')
  const db = c.env.DB, t = now(), cut = t - MEMORIAL_IDLE_DAYS * 86400
  await ensureMemorial(db, t)
  const rows = (await db.prepare(`SELECT m.peak,m.score FROM autumn_memorial m JOIN users u ON u.id=m.user_id WHERE ${MEMORIAL_WHERE}`).bind(cut).all<{ peak: number; score: number }>()).results
  const peaks = [1, 2, 3, 5, 7, 10], scores = [0, 10, 30, 50, 100, 200]
  return c.json({ config: await memorialConfig(db), peaks, scores, table: peaks.map((p) => scores.map((s) => rows.filter((r) => r.peak >= p && r.score >= s).length)) })
})
autumn.put('/api/autumn/miss/config', async (c) => {
  const u = needUser(c)
  if (!isOwner(c, u)) fail(403, '仅站长可用')
  const b = await boundedJson(c, 300), peak = Number(b.peak), score = Number(b.score)
  if (![peak, score].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 10000)) fail(400, '门槛无效')
  await c.env.DB.prepare("INSERT INTO site_settings(k,v,updated_at) VALUES('autumn_memorial',?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at").bind(JSON.stringify({ peak, score }), now()).run()
  return c.json({ ok: true })
})

// ---------- 跃进 ----------
type Board = {
  key: 'leap'; posts: string; comments: string; likes: string; prefix: 'q'; label: string; intro: string; rulesVersion: string
  categories: [string, string][]; rules: string[]; confirms: string[]; reasons: [string, string][]
  hideNow: string[] // 命中这些举报理由立即隐藏，等管理员处理
}
const BOARDS: Board[] = [
  { key: 'leap', posts: 'leap_posts', comments: 'leap_comments', likes: 'leap_likes', prefix: 'q', label: '跃进', intro: '生意、情感、学习、生活里的新体会，和值得分享的资源。', rulesVersion: '',
    categories: [['biz', '生意'], ['love', '情感'], ['study', '学习'], ['life', '生活'], ['res', '资源']],
    rules: ['分享自己的真实体会，不发广告和引流', '资源链接请说明用途，不发盗版、木马和付费陷阱', '匿名不等于免责，违规内容会被移除'], confirms: [],
    reasons: [['ad', '广告引流'], ['unsafe', '有害或盗版资源'], ['privacy', '泄露他人隐私'], ['abuse', '人身攻击'], ['other', '其他']], hideNow: [] },
]

type PostRow = { id: number; pid: string; user_id: number; anon: number; category: string; title: string; body: string; links: string; media: string; hidden: number; likes: number; comments: number; created_at: number
  username: string; name: string | null; nick: string | null; avatar: string | null; liked?: number }
type CommentRow = { id: number; cid: string; user_id: number; as_op: number; body: string; created_at: number; username: string; name: string | null; nick: string | null; avatar: string | null }

async function actor(c: C, kind: 'post' | 'comment' | 'react'): Promise<User> {
  const u = needUser(c)
  if (u.silenced) fail(403, '账号已禁言')
  if (!u.is_admin && await c.env.DB.prepare('SELECT 1 FROM user_limits WHERE user_id=? AND kind=? AND (until=0 OR until>?)').bind(u.id, kind, now()).first()) fail(403, '当前账号暂不能进行此操作')
  if (kind === 'post' && !u.is_admin && u.trust_level < Number(c.env.MIN_POST_TRUST_LEVEL ?? 1)) fail(403, '当前信任等级暂不能发帖')
  return u
}
function cleanLinks(raw: unknown) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > 8) fail(400, '最多 8 个资源链接')
  return (raw as Record<string, unknown>[]).map((r) => {
    const url = str(r?.url, 2048, '链接'), title = str(r?.title ?? '', 80, '资源名称'), note = str(r?.note ?? '', 160, '资源说明')
    let x: URL
    try { x = new URL(url) } catch { return fail(400, '链接格式不正确') }
    if (!['http:', 'https:'].includes(x.protocol) || x.username || x.password) fail(400, '仅支持不含登录凭据的 HTTP/HTTPS 链接')
    return { url: x.href, title: title || x.hostname, note }
  })
}

for (const B of BOARDS) {
  const base = '/api/autumn/' + B.key
  const isMod = (c: C, u: User) => isOwner(c, u) || u.is_admin === 1
  const person = (r: { user_id: number; username: string; name: string | null; nick: string | null; avatar: string | null }) => ({ id: r.user_id, username: r.username, name: nameOf(r), avatar: r.avatar })
  const imgUrl = (k: string) => `${base}/media/${k}`
  const view = (p: PostRow, u: User, mod: boolean, full: boolean) => {
    const mine = p.user_id === u.id, media = (JSON.parse(p.media || '[]') as Media[]).map((m) => ({ u: imgUrl(m.k), w: m.w, h: m.h }))
    return { pid: p.pid, category: p.category, title: p.title, anon: !!p.anon, author: p.anon ? null : person(p),
      at: p.anon ? dayStart(p.created_at) : p.created_at, mine, can_delete: mine || mod, liked: !!p.liked, likes: p.likes, comments: p.comments,
      ...(full ? { body: p.body, media, links: JSON.parse(p.links || '[]') }
        : { excerpt: [...p.body].slice(0, 180).join(''), length: [...p.body].length, cover: media[0] ?? null, media_count: media.length, link_count: JSON.parse(p.links || '[]').length }) }
  }
  const SELECT = `SELECT p.*,u.username,u.name,u.nick,u.avatar,EXISTS(SELECT 1 FROM ${B.likes} l WHERE l.post_id=p.id AND l.user_id=?1) liked FROM ${B.posts} p JOIN users u ON u.id=p.user_id`
  const find = async (c: C, uid: number) => {
    const pid = c.req.param('pid') || ''
    if (!/^[a-f0-9]{20}$/.test(pid)) fail(404, '帖子不存在或已删除')
    return await c.env.DB.prepare(`${SELECT} WHERE p.pid=?2 AND p.hidden=0`).bind(uid, pid).first<PostRow>() ?? fail(404, '帖子不存在或已删除')
  }

  autumn.get(base + '/config', (c) => {
    const u = needUser(c)
    return c.json({ key: B.key, label: B.label, intro: B.intro, categories: B.categories, rules: B.rules, confirms: B.confirms, rules_version: B.rulesVersion, reasons: B.reasons, mod: isMod(c, u) })
  })

  // 图片：只有帖子可见（或者是本人刚上传还没发的）才给；不进任何缓存
  autumn.get(base + '/media/*', async (c) => {
    const u = needUser(c), key = decodeURIComponent(c.req.path.slice((base + '/media/').length))
    const gone = () => c.json({ error: '接口不存在' }, 404)
    if (!new RegExp(`^${B.prefix}/\\d{4}/\\d{2}/[a-f0-9]+\\.(jpg|png|gif|webp)$`).test(key)) return gone()
    const row = await c.env.DB.prepare(`SELECT 1 FROM uploads f WHERE f.key=?1 AND ((f.user_id=?2 AND f.used=0) OR EXISTS(SELECT 1 FROM autumn_media a JOIN ${B.posts} p ON p.id=a.post_id
      WHERE a.key=f.key AND a.board=?3 AND (p.hidden=0 OR (p.hidden=3 AND ?4=1))))`).bind(key, u.id, B.key, isMod(c, u) ? 1 : 0).first()
    const obj = row && await c.env.BUCKET.get(key)
    if (!obj) return gone()
    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('cache-control', 'private, no-store')
    headers.set('cdn-cache-control', 'no-store')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('cross-origin-resource-policy', 'same-origin')
    headers.set('content-disposition', 'inline')
    headers.set('referrer-policy', 'no-referrer')
    return new Response(obj.body, { headers })
  })
  autumn.post(base + '/uploads', async (c) => {
    const u = await actor(c, 'post')
    const form = await c.req.formData(), file = form.get('file')
    if (!(file instanceof File) || !file.size) return fail(400, '请选择图片')
    if (file.size > 12 * 1024 * 1024) fail(413, '单张图片不能超过 12MB')
    const raw = new Uint8Array(await file.arrayBuffer()), kind = sniffAutumnImage(raw)
    if (!kind) return fail(415, '只支持 PNG / JPG / GIF / WebP 图片')
    let bytes: Uint8Array
    try { bytes = stripMetadata(raw, kind[0]) } catch { return fail(415, '图片文件已损坏，请换一张') }
    return c.json(await storeUpload(c.env.DB, c.env.BUCKET, { uid: u.id, nonce: form.get('nonce'), bytes, mime: kind[0], ext: kind[1], purpose: B.key, asFile: false, limited: u.is_admin !== 1, t: now() }))
  })

  // ---- 帖子 ----
  autumn.get(base + '/posts', async (c) => {
    const u = needUser(c), cat = c.req.query('category') || '', mine = c.req.query('mine') === '1', before = c.req.query('before') || ''
    if (cat && !B.categories.some(([k]) => k === cat)) fail(400, '分类无效')
    if (before && !/^[a-f0-9]{20}$/.test(before)) fail(400, '分页位置无效')
    const where = ['p.hidden=0'], args: unknown[] = [u.id]
    if (cat) { args.push(cat); where.push(`p.category=?${args.length}`) }
    if (mine) where.push('p.user_id=?1')
    if (before) { args.push(before); where.push(`p.id<(SELECT id FROM ${B.posts} WHERE pid=?${args.length})`) }
    const rows = (await c.env.DB.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 21`).bind(...args).all<PostRow>()).results
    const mod = isMod(c, u)
    return c.json({ items: rows.slice(0, 20).map((p) => view(p, u, mod, false)), next: rows.length > 20 ? rows[19].pid : null })
  })
  autumn.get(base + '/posts/:pid', async (c) => { const u = needUser(c); return c.json({ post: view(await find(c, u.id), u, isMod(c, u), true) }) })
  autumn.post(base + '/posts', async (c) => {
    const u = await actor(c, 'post'), db = c.env.DB, t = now(), b = await boundedJson(c, 120000), rid = requestId(b.request_id)
    const old = await db.prepare(`SELECT pid FROM ${B.posts} WHERE user_id=? AND request_id=?`).bind(u.id, rid).first<{ pid: string }>()
    if (old) return c.json(old)
    const title = str(b.title, 80, '标题'), body = str(b.body, 20000, '正文'), category = str(b.category, 20, '分类'), links = cleanLinks(b.links)
    if (!B.categories.some(([k]) => k === category)) fail(400, '请选择分类')
    if (!title) fail(400, '请填写标题')
    if (!body && !links.length && !(Array.isArray(b.media) && b.media.length)) fail(400, '写点内容再发吧')
    if (b.anon !== undefined && typeof b.anon !== 'boolean') fail(400, '参数无效')
    if (B.confirms.length && !(Array.isArray(b.confirms) && b.confirms.length === B.confirms.length && b.confirms.every((x) => x === true) && b.rules_version === B.rulesVersion)) fail(400, '请先确认已满 18 岁，并阅读、同意发布规则')
    if (!Array.isArray(b.media ?? []) || ((b.media as unknown[] | undefined)?.length ?? 0) > 9) fail(400, '最多 9 张图片')
    if (!u.is_admin && (await db.prepare(`SELECT COUNT(*) n FROM ${B.posts} WHERE user_id=? AND created_at>?`).bind(u.id, t - 86400).first<{ n: number }>())!.n >= 20) fail(429, '今天发得够多了，明天再来')
    const media = await prepareMedia(c, u.id, b.media ?? [], false, B.prefix), pid = randHex(10)
    if (media.some((m) => m.kind === 'v' || m.kind === 'l')) fail(400, '这里只能发图片')
    await commitUploadContent(db, u.id, mediaKeys(media), [
      db.prepare(`INSERT INTO ${B.posts}(pid,user_id,anon,category,title,body,links,media,request_id,rules,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(pid, u.id, b.anon ? 1 : 0, category, title, body, JSON.stringify(links), JSON.stringify(media), rid, B.rulesVersion, t),
      db.prepare(`INSERT INTO autumn_media(key,board,post_id) SELECT value,?,(SELECT id FROM ${B.posts} WHERE pid=?) FROM json_each(?)`).bind(B.key, pid, JSON.stringify(mediaKeys(media))),
    ])
    return c.json({ pid })
  })
  // 删除后图片文件一并清掉
  const purge = async (c: C, postId: number, state: 1 | 2) => {
    const db = c.env.DB, keys = (await db.prepare('SELECT key FROM autumn_media WHERE board=? AND post_id=?').bind(B.key, postId).all<{ key: string }>()).results.map((r) => r.key)
    await db.batch([
      db.prepare(`UPDATE ${B.posts} SET hidden=? WHERE id=? AND hidden IN(0,3)`).bind(state, postId),
      db.prepare('DELETE FROM autumn_media WHERE board=? AND post_id=?').bind(B.key, postId),
    ])
    if (keys.length) c.executionCtx.waitUntil(c.env.BUCKET.delete(keys).catch(() => console.error('autumn_media_purge_failed')))
  }
  autumn.delete(base + '/posts/:pid', async (c) => {
    const u = needUser(c), p = await find(c, u.id)
    if (p.user_id !== u.id && !isMod(c, u)) fail(403, '没有删除权限')
    await purge(c, p.id, p.user_id === u.id ? 1 : 2)
    await c.env.DB.prepare("UPDATE autumn_reports SET state='removed',handled_by=?,handled_at=? WHERE board=? AND kind='post' AND target_id=? AND state='open'").bind(u.id, now(), B.key, p.id).run()
    return c.json({ ok: true })
  })
  autumn.put(base + '/posts/:pid/like', async (c) => {
    const u = await actor(c, 'react'), p = await find(c, u.id), b = await boundedJson(c, 100), db = c.env.DB
    await db.batch([
      db.prepare(b.on === true ? `INSERT OR IGNORE INTO ${B.likes}(post_id,user_id) VALUES(?,?)` : `DELETE FROM ${B.likes} WHERE post_id=? AND user_id=?`).bind(p.id, u.id),
      db.prepare(`UPDATE ${B.posts} SET likes=(SELECT COUNT(*) FROM ${B.likes} WHERE post_id=?1) WHERE id=?1`).bind(p.id),
    ])
    const n = await db.prepare(`SELECT likes FROM ${B.posts} WHERE id=?`).bind(p.id).first<{ likes: number }>()
    return c.json({ liked: b.on === true, likes: n!.likes })
  })

  // ---- 评论 ----
  autumn.get(base + '/posts/:pid/comments', async (c) => {
    const u = needUser(c), p = await find(c, u.id), mod = isMod(c, u), after = c.req.query('after') || ''
    if (after && !/^[a-f0-9]{20}$/.test(after)) fail(400, '分页位置无效')
    const rows = (await c.env.DB.prepare(`SELECT r.id,r.cid,r.user_id,r.as_op,r.body,r.created_at,u.username,u.name,u.nick,u.avatar FROM ${B.comments} r JOIN users u ON u.id=r.user_id
      WHERE r.post_id=?1 AND r.hidden=0 AND r.id>COALESCE((SELECT id FROM ${B.comments} WHERE cid=?2),0) ORDER BY r.id LIMIT 51`).bind(p.id, after).all<CommentRow>()).results
    return c.json({ items: rows.slice(0, 50).map((r) => {
      // 匿名帖的作者：无论评论时记的是什么，一律不给身份
      const op = r.user_id === p.user_id, hideId = r.as_op === 1 || (op && p.anon === 1), mine = r.user_id === u.id
      return { cid: r.cid, body: r.body, op, anon: hideId, author: hideId ? null : person(r), at: hideId ? dayStart(r.created_at) : r.created_at, mine, can_delete: mine || mod }
    }), next: rows.length > 50 ? rows[49].cid : null })
  })
  autumn.post(base + '/posts/:pid/comments', async (c) => {
    const u = await actor(c, 'comment'), p = await find(c, u.id), b = await boundedJson(c, 12000), body = str(b.body, 2000, '评论'), rid = requestId(b.request_id), db = c.env.DB, t = now()
    if (!body) fail(400, '评论不能为空')
    if (await db.prepare(`SELECT 1 FROM ${B.comments} WHERE user_id=? AND request_id=?`).bind(u.id, rid).first()) return c.json({ ok: true })
    if ((await db.prepare(`SELECT COUNT(*) n FROM ${B.comments} WHERE user_id=? AND created_at>?`).bind(u.id, t - 60).first<{ n: number }>())!.n >= 10) fail(429, '评论太快了，稍后再试')
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO ${B.comments}(cid,post_id,user_id,as_op,body,request_id,created_at) VALUES(?,?,?,?,?,?,?)`).bind(randHex(10), p.id, u.id, p.anon && p.user_id === u.id ? 1 : 0, body, rid, t),
      db.prepare(`UPDATE ${B.posts} SET comments=(SELECT COUNT(*) FROM ${B.comments} WHERE post_id=?1 AND hidden=0) WHERE id=?1`).bind(p.id),
    ])
    return c.json({ ok: true })
  })
  const findComment = async (c: C, postId: number) => await c.env.DB.prepare(`SELECT id,user_id FROM ${B.comments} WHERE cid=? AND post_id=? AND hidden=0`).bind(c.req.param('cid') ?? '', postId).first<{ id: number; user_id: number }>() ?? fail(404, '评论不存在')
  const hideComment = (c: C, id: number, state: number) => c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${B.comments} SET hidden=? WHERE id=?`).bind(state, id),
    c.env.DB.prepare(`UPDATE ${B.posts} SET comments=(SELECT COUNT(*) FROM ${B.comments} x WHERE x.post_id=${B.posts}.id AND x.hidden=0) WHERE id=(SELECT post_id FROM ${B.comments} WHERE id=?)`).bind(id),
  ])
  autumn.delete(base + '/posts/:pid/comments/:cid', async (c) => {
    const u = needUser(c), p = await find(c, u.id), row = await findComment(c, p.id)
    if (row.user_id !== u.id && !isMod(c, u)) fail(403, '没有权限')
    await hideComment(c, row.id, row.user_id === u.id ? 1 : 2)
    await c.env.DB.prepare("UPDATE autumn_reports SET state='removed',handled_by=?,handled_at=? WHERE board=? AND kind='comment' AND target_id=? AND state='open'").bind(u.id, now(), B.key, row.id).run()
    return c.json({ ok: true })
  })

  // ---- 举报 ----
  autumn.post(base + '/posts/:pid/report', async (c) => {
    const u = needUser(c), p = await find(c, u.id), b = await boundedJson(c, 3000), reason = str(b.reason, 20, '理由'), note = str(b.note ?? '', 300, '说明'), db = c.env.DB, t = now()
    if (!B.reasons.some(([k]) => k === reason)) fail(400, '请选择举报理由')
    const cid = b.cid ? str(b.cid, 20, '编号') : ''
    let kind: 'post' | 'comment' = 'post', target = p.id
    if (cid) {
      const row = await db.prepare(`SELECT id FROM ${B.comments} WHERE cid=? AND post_id=? AND hidden=0`).bind(cid, p.id).first<{ id: number }>() ?? fail(404, '评论不存在')
      kind = 'comment'; target = row.id
    }
    if ((await db.prepare('SELECT COUNT(*) n FROM autumn_reports WHERE reporter_id=? AND created_at>?').bind(u.id, t - 86400).first<{ n: number }>())!.n >= 20) fail(429, '今天举报次数已用完')
    await db.prepare('INSERT OR IGNORE INTO autumn_reports(board,kind,target_id,reporter_id,reason,note,created_at) VALUES(?,?,?,?,?,?,?)').bind(B.key, kind, target, u.id, reason, note, t).run()
    const open = await db.prepare("SELECT COUNT(*) n FROM autumn_reports WHERE board=? AND kind=? AND target_id=? AND state='open'").bind(B.key, kind, target).first<{ n: number }>()
    // 已经被管理员判过「保留」的内容不再自动隐藏，避免反复举报
    const kept = await db.prepare("SELECT 1 FROM autumn_reports WHERE board=? AND kind=? AND target_id=? AND state='kept'").bind(B.key, kind, target).first()
    const hide = !kept && (B.hideNow.includes(reason) || open!.n >= 3)
    if (hide) kind === 'post' ? await db.prepare(`UPDATE ${B.posts} SET hidden=3 WHERE id=? AND hidden=0`).bind(target).run() : await hideComment(c, target, 3)
    return c.json({ ok: true, hidden: hide })
  })
  autumn.get(base + '/reports', async (c) => {
    const u = needUser(c)
    if (!isMod(c, u)) fail(403, '仅管理员可用')
    const rows = (await c.env.DB.prepare(`SELECT r.id,r.kind,r.reason,r.note,r.created_at,r.target_id,COALESCE(ru.nick,ru.name,ru.username) reporter,
        p.pid,p.title,p.body pbody,p.media,p.anon,p.hidden phidden,p.user_id puid,k.body cbody,k.as_op,k.user_id kuid,k.hidden khidden
      FROM autumn_reports r JOIN users ru ON ru.id=r.reporter_id LEFT JOIN ${B.comments} k ON r.kind='comment' AND k.id=r.target_id
      LEFT JOIN ${B.posts} p ON p.id=CASE WHEN r.kind='post' THEN r.target_id ELSE k.post_id END
      WHERE r.board=? AND r.state='open' ORDER BY r.id LIMIT 100`).bind(B.key).all<any>()).results
    const reasons = new Map(B.reasons)
    return c.json({ owner: isOwner(c, u), items: rows.map((r) => ({ id: r.id, kind: r.kind, reason: reasons.get(r.reason) || r.reason, note: r.note, at: r.created_at, reporter: r.reporter, pid: r.pid, title: r.title,
      body: r.kind === 'comment' ? r.cbody : [...String(r.pbody || '')].slice(0, 2000).join(''), media: r.kind === 'post' ? (JSON.parse(r.media || '[]') as Media[]).map((m) => ({ u: imgUrl(m.k) })) : [],
      hidden: (r.kind === 'post' ? r.phidden : r.khidden) === 3, anon: r.kind === 'post' ? !!r.anon : !!r.as_op || (!!r.anon && r.puid === r.kuid) })) })
  })
  autumn.post(base + '/reports/:id', async (c) => {
    const u = needUser(c), db = c.env.DB, id = Number(c.req.param('id')), b = await boundedJson(c, 200)
    if (!isMod(c, u)) fail(403, '仅管理员可用')
    if (b.action !== 'keep' && b.action !== 'remove') fail(400, '操作无效')
    const r = await db.prepare("SELECT kind,target_id FROM autumn_reports WHERE id=? AND board=? AND state='open'").bind(id, B.key).first<{ kind: string; target_id: number }>() ?? fail(404, '举报已处理')
    if (b.action === 'remove') r.kind === 'post' ? await purge(c, r.target_id, 2) : await hideComment(c, r.target_id, 2)
    else if (r.kind === 'post') await db.prepare(`UPDATE ${B.posts} SET hidden=0 WHERE id=? AND hidden=3`).bind(r.target_id).run()
    else if (await db.prepare(`SELECT 1 FROM ${B.comments} WHERE id=? AND hidden=3`).bind(r.target_id).first()) await hideComment(c, r.target_id, 0)
    await db.prepare("UPDATE autumn_reports SET state=?,handled_by=?,handled_at=? WHERE board=? AND kind=? AND target_id=? AND state='open'").bind(b.action === 'keep' ? 'kept' : 'removed', u.id, now(), B.key, r.kind, r.target_id).run()
    return c.json({ ok: true })
  })
  // 只有站长、只在处理未结的举报时能看匿名作者，每次留痕
  autumn.post(base + '/reports/:id/reveal', async (c) => {
    const u = needUser(c), db = c.env.DB, id = Number(c.req.param('id'))
    if (!isOwner(c, u)) fail(403, '仅站长可用')
    const r = await db.prepare(`SELECT w.id,w.username,w.name,w.nick FROM autumn_reports r LEFT JOIN ${B.posts} p ON r.kind='post' AND p.id=r.target_id LEFT JOIN ${B.comments} k ON r.kind='comment' AND k.id=r.target_id
      JOIN users w ON w.id=COALESCE(p.user_id,k.user_id) WHERE r.id=? AND r.board=? AND r.state='open'`).bind(id, B.key).first<{ id: number; username: string; name: string | null; nick: string | null }>() ?? fail(404, '举报已处理')
    await db.prepare('INSERT INTO autumn_reveals(report_id,actor_id,at) VALUES(?,?,?)').bind(id, u.id, now()).run()
    return c.json({ username: r.username, name: nameOf(r) })
  })
}
