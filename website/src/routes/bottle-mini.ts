// 漂流瓶 linux.do 小程序网关（2026-11-25）。
// 入口：GET /api/miniapp/bottles/read?route=…，POST /api/miniapp/bottles/write {route,payload}；只认平台 JWT，不认站内 Cookie。
// 程序 ID 是配置项 BOTTLE_APP_ID，留空时入口整个关闭。
// 身份：JWT 里只有论坛编号（sub）可信。关联过站内账号的用站内账号；没有的记在 bottle_mini_users，不建站内账号。
// 发瓶子一律匿名；回信和喜欢实名：站内账号显示站内昵称，没有站内账号的显示「L站用户 #编号」（不用客户端自报的名字，防冒名）。
// 小程序里只用免费次数，不能付费；没有站内账号的不参与奖励。小程序里没有任何管理权限，界面上也不提网站。
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../env'
import { fail } from '../lib/http'
import { now } from '../lib/time'
import { isleThrottle } from './isle'
import * as S from '../services/bottles'
import * as M from '../services/bottle-money'
import { cleanNick, isAnonAvatar, legacyAvatar, randomNick, rollAvatar, rollNick } from '../services/bottle-names'
import { reviewReported } from '../services/bottle-ai'
import { mediaFile, stickerData, videoProgram } from '../services/bottle-mini-media'
import { attachMedia, checkMedia, claimMedia, MAX_BOTTLE_MEDIA, MAX_REPLY_MEDIA, sniffMedia, storeMiniUpload, stripMeta } from '../services/bottle-media'
import { storeUpload } from '../services/upload-operations'
import { avatarData, avatarKey, ldAvatar } from '../services/bottle-avatars'
import { loadWords, inspect } from '../services/bottle-words'

type Claims = { iss: string; sub: string }
type Deps = { verify: (input: Record<string, unknown>) => Promise<Claims>; loadKeys: () => Promise<{ d?: unknown; kty?: string; crv?: string }[]> }
type Actor = { id: number; is_admin: 0; mini: true; shadow: boolean; name: string; blocked: string; sub: string }
type Obj = Record<string, unknown>

const ISSUER = 'https://linux.do', AUDIENCE = 'https://52dmeme.com', PATH = '/api/miniapp/bottles/'
const MAX_BODY = 16384, MAX_REPLY = 262144

async function actorOf(env: Env, db: D1Database, sub: string): Promise<Actor> {
  if (!/^[1-9]\d{0,9}$/.test(sub)) return fail(403, '当前论坛身份暂时不能使用')
  const u = await db.prepare(`SELECT u.id,u.silenced,u.disabled,u.kind,u.main_activated_at,COALESCE(NULLIF(u.nick,''),NULLIF(u.name,''),u.username) AS name
    FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider='linuxdo' AND i.subject=? AND NOT EXISTS(SELECT 1 FROM account_retirements a WHERE a.source_id=u.id)`).bind(sub)
    .first<{ id: number; silenced: number; disabled: number; kind: string; main_activated_at: number | null; name: string }>()
  if (u) {
    if (u.disabled || u.kind !== 'user') fail(403, '账号已停用，请联系管理员')
    const limited = u.silenced ? '你在 linux.do 处于禁言状态'
      : (env as unknown as { MAIN_ACTIVATION?: string }).MAIN_ACTIVATION === 'required' && !u.main_activated_at ? '当前账号尚未启用互动' : ''
    return { id: u.id, is_admin: 0, mini: true, shadow: false, name: u.name, blocked: limited, sub }
  }
  const id = S.shadowId(sub)
  await db.prepare('INSERT OR IGNORE INTO bottle_mini_users(id,sub,created_at) VALUES(?,?,?)').bind(id, sub, now()).run()
  const m = await db.prepare('SELECT blocked,name,username FROM bottle_mini_users WHERE id=?').bind(id).first<{ blocked: number; name: string | null; username: string | null }>()
  return { id, is_admin: 0, mini: true, shadow: true, name: m?.name || m?.username || S.shadowName(sub), blocked: m?.blocked ? '你已被站长禁止使用漂流瓶' : '', sub }
}
async function may(db: D1Database, a: Actor, kind: 'post' | 'comment' | 'react') {
  if (a.blocked) fail(403, a.blocked)
  if (!a.shadow && await db.prepare('SELECT 1 AS ok FROM user_limits WHERE user_id=? AND kind=? AND (until=0 OR until>?)').bind(a.id, kind, now()).first()) fail(403, '你的账号暂时不能这样做')
}
const slow = (a: Actor, what: string, limit: number, seconds: number) => { if (isleThrottle(`bottle-${what}:${a.id}`, limit, seconds)) fail(429, '慢一点，歇会儿再来') }

// 给小程序的人：有 L 站编号（lid）的，由小程序用平台的 user.getById 显示 L 站昵称和头像（平台按编号给，改不了）；
// 没有的（站内用 Google / 邮箱注册的）给站内昵称和头像 key。都不带站内编号和用户名。
type RawPerson = { id?: number | null; name: string | null; avatar?: string | null; sub?: string | null; anon?: boolean }
async function lidOf(db: D1Database, u: RawPerson) {
  if (u.sub) return u.sub
  if (!u.id || u.id < 0) return null
  return (await db.prepare("SELECT subject FROM identities WHERE user_id=? AND provider='linuxdo' ORDER BY created_at LIMIT 1").bind(u.id).first<{ subject: string }>())?.subject ?? null
}
async function person(db: D1Database, u: RawPerson | null) {
  if (!u) return null
  // 匿名的人：这个瓶子里的昵称和像素头像
  if (u.anon) return { lid: null, name: u.name, avatar: await avatarKey(db, u.avatar), anon: true }
  const lid = await lidOf(db, u)
  return lid && /^[1-9]\d{0,9}$/.test(lid) ? { lid: Number(lid), name: u.sub ? null : u.name, avatar: null } : { lid: null, name: u.name, avatar: await avatarKey(db, u.avatar) }
}
const shape = async <T extends { user: unknown }>(db: D1Database, x: T) => ({ ...x, user: await person(db, x.user as RawPerson | null) })
const shapeAll = <T extends { user: unknown }>(db: D1Database, xs: T[]) => Promise.all(xs.map((x) => shape(db, x)))
const bottle = async (db: D1Database, id: number, a: Actor) => { const b = await S.bottleView(db, id, a.id); return b ? { ...(await shape(db, b)), avatar_key: await avatarKey(db, b.avatar) } : null }
const roll = async (db: D1Database) => { const avatar = rollAvatar(); return { nick: rollNick(), avatar, avatar_key: await avatarKey(db, avatar) } }

// ---------- 小程序里的提醒：我的瓶子被喜欢、被回信；我的回信被回复 ----------
const NOTIF_DAYS = 30
async function notifs(db: D1Database, a: Actor) {
  const since = now() - NOTIF_DAYS * 86400
  const { results } = await db.prepare(`SELECT * FROM (
      SELECT 'like' AS kind,l.bottle_id AS bid,l.user_id AS actor,NULL AS body,l.created_at AS at,b.body AS bbody,NULL AS anick,NULL AS aavatar FROM bottle_likes l JOIN bottles b ON b.id=l.bottle_id
        WHERE b.author_id=?1 AND b.deleted=0 AND l.user_id<>?1 AND l.created_at>?2
      UNION ALL SELECT 'reply',r.bottle_id,CASE WHEN r.anon=1 THEN -2 ELSE r.user_id END,r.body,r.created_at,b.body,al.nick,al.avatar FROM bottle_replies r JOIN bottles b ON b.id=r.bottle_id
        LEFT JOIN bottle_aliases al ON al.bottle_id=r.bottle_id AND al.user_id=r.user_id AND r.anon=1
        WHERE b.author_id=?1 AND b.deleted=0 AND r.is_host=0 AND r.deleted=0 AND r.hidden=0 AND r.user_id<>?1 AND r.created_at>?2
      UNION ALL SELECT 're',r.bottle_id,CASE WHEN r.is_host=1 AND b.anon=1 THEN 0 WHEN r.anon=1 THEN -2 ELSE r.user_id END,r.body,r.created_at,b.body,
        CASE WHEN r.is_host=1 AND b.anon=1 THEN COALESCE(NULLIF(b.nick,''),'#'||b.id) ELSE al.nick END,CASE WHEN r.is_host=1 AND b.anon=1 THEN NULLIF(b.avatar,'') ELSE al.avatar END
        FROM bottle_replies p JOIN bottle_replies r ON r.reply_to=p.id JOIN bottles b ON b.id=r.bottle_id
        LEFT JOIN bottle_aliases al ON al.bottle_id=r.bottle_id AND al.user_id=r.user_id AND r.anon=1
        WHERE p.user_id=?1 AND p.is_host=0 AND r.user_id<>?1 AND r.deleted=0 AND r.hidden=0 AND b.deleted=0 AND b.hidden=0 AND (b.mini=1 OR b.author_id=?1) AND r.created_at>?2
    ) ORDER BY at DESC LIMIT 30`).bind(a.id, since).all<{ kind: string; bid: number; actor: number; body: string | null; at: number; bbody: string; anick: string | null; aavatar: string | null }>()
  const ids = [...new Set(results.map((r) => r.actor).filter((x) => x > 0 || x < -2))]
  const people = new Map<number, RawPerson>()
  if (ids.length) {
    const { results: rows } = await db.prepare(`SELECT x.value AS id,u.id AS uid,COALESCE(NULLIF(u.nick,''),NULLIF(u.name,''),u.username,NULLIF(m.name,''),m.username,'L站用户 #'||m.sub,'已注销用户') AS name,
        COALESCE(u.avatar,m.avatar) AS avatar,m.sub FROM json_each(?1) x LEFT JOIN users u ON u.id=x.value LEFT JOIN bottle_mini_users m ON m.id=x.value`).bind(JSON.stringify(ids)).all<{ id: number; uid: number | null; name: string; avatar: string | null; sub: string | null }>()
    for (const r of rows) people.set(r.id, { id: r.uid, name: r.name, avatar: r.avatar, sub: r.sub })
  }
  const read = (await db.prepare('SELECT read_at FROM bottle_notif_reads WHERE user_id=?').bind(a.id).first<{ read_at: number }>())?.read_at ?? 0
  const items = await Promise.all(results.map(async (r) => ({ kind: r.kind, bottle: r.bid, at: r.at, unread: r.at > read, body: r.body ? r.body.slice(0, 80) : null, bottle_text: r.bbody.slice(0, 30),
    // 匿名的人（匿名瓶的瓶主、匿名回信的人）只给这个瓶子里的昵称和头像
    user: r.anick ? await person(db, { anon: true, name: r.anick.startsWith('#') ? randomNick(r.bid) : r.anick, avatar: r.aavatar || legacyAvatar(r.bid) }) : r.actor > 0 || r.actor < -2 ? await person(db, people.get(r.actor) ?? null) : null })))
  return { items, unread: items.filter((x) => x.unread).length }
}
const unreadCount = async (db: D1Database, a: Actor) => (await notifs(db, a)).unread
async function quota(db: D1Database, a: Actor) {
  const q = await S.quota(db, a.id)
  return { throw_left: q.throw_left, draw_left: q.draw_left, throw_price: q.throw_left ? 0 : null, draw_price: q.draw_left ? 0 : null, balance: 0 }
}
const num = (s: string) => { const n = Number(s); return Number.isSafeInteger(n) && n > 0 ? n : fail(400, '编号不正确') }
const moodOf = (raw: unknown) => { const m = typeof raw === 'string' ? raw : ''; return !m || S.MOODS.includes(m) ? m : fail(400, '没有这个心情') }
const FREE_ONLY = '今天的次数用完了，明天再来。'

async function read(env: Env, db: D1Database, a: Actor, route: string, q: URLSearchParams): Promise<unknown> {
  if (route === '/notifs') return notifs(db, a)
  if (route === '/roll') return roll(db)
  if (route === '/vprog') return videoProgram(env, db, a, q.get('k') ?? '')
  if (route === '/sticker') return (await stickerData(env, q.get('k') ?? '')) ?? fail(404, '没有这个表情')
  if (route === '/avatar') return (await avatarData(env, db, q.get('k') ?? '')) ?? fail(404, '没有这张头像')
  if (route === '/state') return { ...(await quota(db, a)), unread: await unreadCount(db, a), name: a.name, linked: !a.shadow, blocked: a.blocked, moods: S.MOODS, max: S.BODY_MAX, days: S.DAYS, default_days: S.DEFAULT_DAYS, ...(await roll(db)) }
  if (route === '/mine') {
    const tab = (q.get('tab') ?? 'thrown') as S.Tab
    if (!S.TABS.includes(tab)) fail(400, '没有这个列表')
    const r = await S.mineList(db, a.id, tab, q.get('cursor') ?? undefined, true)
    return { items: await shapeAll(db, r.items), next: r.next }
  }
  const m = /^\/b\/(\d{1,15})(\/replies)?$/.exec(route)
  if (!m) return fail(403, '操作不在小程序范围内')
  const b = await S.needBottle(db, num(m[1]), a), after = Number(q.get('after') ?? 0)
  const page = await S.replyPage(db, b.id, a.id, m[2] && Number.isSafeInteger(after) && after > 0 ? after : 0)
  const replies = await shapeAll(db, page.items)
  const mine = m[2] || b.author_id === a.id ? null : await S.myAlias(db, b.id, a.id)
  return m[2] ? { replies, next: page.next } : { bottle: await bottle(db, b.id, a), replies, next: page.next, my_alias: mine ? { ...mine, avatar_key: await avatarKey(db, mine.avatar) } : null }
}

async function write(env: Env, db: D1Database, a: Actor, route: string, p: Obj): Promise<unknown> {
  const local = { ...env, DB: db }
  if (route === '/notifs/read') {
    await db.prepare('INSERT INTO bottle_notif_reads(user_id,read_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET read_at=excluded.read_at').bind(a.id, now()).run()
    return { ok: true }
  }
  // 平台给的论坛资料：只给没有站内账号的人用；名字过一遍敏感词，不合格就只显示用户名
  if (route === '/profile') {
    if (!a.shadow) return { ok: true }
    slow(a, 'profile', 10, 60)
    const username = typeof p.username === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(p.username) ? p.username : null
    let name = typeof p.name === 'string' ? p.name.normalize('NFKC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30) : ''
    if (name && inspect(name, await loadWords(db))) name = ''
    if (!username) return fail(400, '论坛资料无效')
    await db.prepare('UPDATE bottle_mini_users SET username=?,name=?,avatar=?,updated_at=? WHERE id=? AND (username IS NOT ? OR name IS NOT ?)').bind(username, name || null, ldAvatar(username), now(), a.id, username, name || null).run()
    return { ok: true, name: name || username }
  }
  if (route === '/throw') {
    await may(db, a, 'post'); slow(a, 'throw', 30, 60)
    const op = S.opOf(p.op), mood = moodOf(p.mood), days = p.days === undefined ? S.DEFAULT_DAYS : S.DAYS.includes(Number(p.days)) ? Number(p.days) : fail(400, '有效期不正确')
    const media = await checkMedia(db, a.id, p.media, MAX_BOTTLE_MEDIA)
    const nick = (await cleanNick(db, p.nick)) || rollNick(), body = await S.cleanBody(local, db, p.body, a.id, media.length > 0)
    if (!(await S.quota(db, a.id)).throw_left && !await db.prepare('SELECT 1 AS ok FROM bottles WHERE author_id=? AND op=?').bind(a.id, op).first()) fail(403, FREE_ONLY, 'free_only')
    const id = await claimMedia(db, a.id, media, () => S.throwBottle(local, a.id, { op, body: body.text, ai: body.ai, mood, days, anon: true, nick, avatar: isAnonAvatar(p.avatar) ? p.avatar : undefined, show_badge: p.show_badge !== false, price: 0, mini: true }))
    await attachMedia(db, media, { bottle: id })
    return { bottle: await bottle(db, id, a), ...(await quota(db, a)) }
  }
  if (route === '/draw') {
    if (a.blocked) fail(403, a.blocked)
    slow(a, 'draw', 40, 60)
    const op = S.opOf(p.op)
    if (!(await S.quota(db, a.id)).draw_left && !await db.prepare('SELECT 1 AS ok FROM bottle_draws WHERE user_id=? AND op=?').bind(a.id, op).first()) fail(403, FREE_ONLY, 'free_only')
    const id = await S.drawBottle(local, a.id, { op, mood: moodOf(p.mood), price: 0, mini: true })
    return { bottle: id ? await bottle(db, id, a) : null, ...(await quota(db, a)) }
  }
  const r = /^\/replies\/(\d{1,15})\/(report|delete)$/.exec(route)
  if (r) {
    const row = await db.prepare('SELECT id,bottle_id,user_id,deleted,hidden FROM bottle_replies WHERE id=?').bind(num(r[1])).first<{ id: number; bottle_id: number; user_id: number; deleted: number; hidden: number }>()
    if (!row || row.deleted || (row.hidden && row.user_id !== a.id)) return fail(404, '这封回信已经不在了')
    await S.needBottle(db, row.bottle_id, a)
    if (r[2] === 'delete') {
      if (row.user_id !== a.id) fail(403, '没有权限')
      await db.prepare('UPDATE bottle_replies SET deleted=1 WHERE id=? AND deleted=0').bind(row.id).run()
      await S.reheat(db, row.bottle_id).run()
    } else {
      if (a.blocked) fail(403, a.blocked)
      if (row.user_id === a.id) fail(400, '不用举报自己的回信')
      slow(a, 'report', 20, 3600)
      await S.report(db, 'reply', row.id, a.id, String(p.reason ?? '').trim().slice(0, 100))
      await reviewReported(local, db, 'reply', row.id)
    }
    return { ok: true }
  }
  const m = /^\/b\/(\d{1,15})\/(like|poop|keep|reply|report|delete|badge)$/.exec(route)
  if (!m) return fail(403, '操作不在小程序范围内')
  const b = await S.needBottle(db, num(m[1]), a), act = m[2], mine = b.author_id === a.id
  if (act === 'delete' || act === 'badge') {
    if (!mine) fail(403, '没有权限')
    if (act === 'delete') { await S.deleteOwn(db, b.id); return { ok: true } }
    await db.prepare('UPDATE bottles SET show_badge=? WHERE id=?').bind(p.on !== false ? 1 : 0, b.id).run()
    return { bottle: await bottle(db, b.id, a) }
  }
  const off = (act === 'like' || act === 'poop' || act === 'keep') && p.on === false
  if (!off) {
    if (b.deleted || b.hidden) fail(409, '这个瓶子暂时不能互动')
    if (mine && act !== 'reply') fail(400, '这是你自己的瓶子')
  }
  if (act === 'report') {
    if (a.blocked) fail(403, a.blocked)
    slow(a, 'report', 20, 3600)
    await S.report(db, 'bottle', b.id, a.id, String(p.reason ?? '').trim().slice(0, 100))
    await reviewReported(local, db, 'bottle', b.id)
    return { ok: true }
  }
  if (act === 'reply') {
    await may(db, a, 'comment')
    const op = S.opOf(p.op)
    const done = await db.prepare('SELECT id FROM bottle_replies WHERE user_id=? AND op=?').bind(a.id, op).first<{ id: number }>()
    if (done) return { reply: await shape(db, (await S.replyPage(db, b.id, a.id, done.id - 1)).items[0]) }
    slow(a, 'reply', 10, 60)
    const anon = p.anon === true && !mine
    const want = anon ? { nick: (await cleanNick(db, p.nick)) || undefined, avatar: isAnonAvatar(p.avatar) ? p.avatar : undefined } : {}
    const media = await checkMedia(db, a.id, p.media, MAX_REPLY_MEDIA)
    const body = await S.cleanBody(local, db, p.body, a.id, media.length > 0)
    // 页面写的身份和实际不一致就不寄（和网站一样），免得匿名变实名
    if (typeof p.as_host === 'boolean' && p.as_host !== mine) fail(409, '登录的账号变了，重新打开后再寄')
    const to = p.reply_to == null ? null : Number(p.reply_to)
    if (to !== null && (!Number.isSafeInteger(to) || !await db.prepare('SELECT 1 AS ok FROM bottle_replies WHERE id=? AND bottle_id=? AND deleted=0 AND hidden=0').bind(to, b.id).first())) fail(400, '要回复的那封信已经不在了')
    if (anon) await S.replyAlias(db, b, a.id, want)
    const row = await claimMedia(db, a.id, media, () => db.prepare('INSERT INTO bottle_replies(bottle_id,user_id,is_host,reply_to,body,created_at,op,anon,ai) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id').bind(b.id, a.id, mine ? 1 : 0, to, body.text, now(), op, anon ? 1 : 0, body.ai).first<{ id: number }>())
    await attachMedia(db, media, { bottle: b.id, reply: row!.id })
    await S.reheat(db, b.id).run()
    if (!mine) await M.queueReward(local, { bottle: b.id, author: b.author_id, actor: a.id, kind: 'reply' })
    return { reply: await shape(db, (await S.replyPage(db, b.id, a.id, row!.id - 1)).items[0]) }
  }
  const table = act === 'like' ? 'bottle_likes' : act === 'poop' ? 'bottle_poops' : 'bottle_keeps'
  slow(a, act, 60, 60)
  if (off) await db.prepare(`DELETE FROM ${table} WHERE bottle_id=? AND user_id=?`).bind(b.id, a.id).run()
  else {
    await may(db, a, 'react')
    await db.prepare(`INSERT OR IGNORE INTO ${table}(bottle_id,user_id,created_at) VALUES(?,?,?)`).bind(b.id, a.id, now()).run()
  }
  if (act !== 'keep') await S.reheat(db, b.id).run()
  if (act === 'like' && !off) await M.queueReward(local, { bottle: b.id, author: b.author_id, actor: a.id, kind: 'like' })
  return { bottle: await bottle(db, b.id, a) }
}

async function bodyOf(request: Request): Promise<Obj | null> {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  if (reader) for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength }
  try { const x = JSON.parse(new TextDecoder().decode(bytes)); return x && typeof x === 'object' && !Array.isArray(x) ? x : null } catch { return null }
}

// 上传图片 / 视频（multipart 的 file 字段）：和网站一样擦掉拍摄信息，存成本人未用的文件，发瓶子 / 回信时再认领
const UPLOAD_MAX = 20 * 1024 * 1024
async function upload(env: Env, db: D1Database, a: Actor, request: Request) {
  if (a.blocked) fail(403, a.blocked)
  slow(a, 'upload', 40, 60)
  if (Number(request.headers.get('content-length') || 0) > UPLOAD_MAX + 65536) fail(413, '单个文件不能超过 20MB')
  let file: unknown, nonce: unknown
  try { const form = await request.formData(); file = form.get('file'); nonce = form.get('nonce') } catch { return fail(400, '请选择文件') }
  if (!(file instanceof File) || !file.size) return fail(400, '请选择文件')
  if (file.size > UPLOAD_MAX) fail(413, '单个文件不能超过 20MB')
  const bytes = new Uint8Array(await file.arrayBuffer()), kind = sniffMedia(bytes)
  if (kind === 'heic') return fail(415, 'HEIC 格式看不了：iPhone 可在 设置 → 相机 → 格式 选「兼容性最佳」')
  if (!kind) return fail(415, '只支持 PNG / JPG / GIF / WebP 图片和 MP4 / MOV / WebM 视频')
  let clean: Uint8Array
  try { clean = stripMeta(bytes, kind[0]) } catch { return fail(415, '文件已损坏，请换一个') }
  // 没有网站账号的人没有 users 记录，单独记账（见 0206）
  if (a.shadow) return storeMiniUpload(db, env.BUCKET, a.id, clean, kind[0], kind[1], now())
  const r = await storeUpload(db, env.BUCKET, { uid: a.id, nonce: typeof nonce === 'string' && nonce ? nonce : null, bytes: clean, mime: kind[0], ext: kind[1], purpose: 'meme', asFile: false, limited: true, t: now() })
  return { key: r.key, mime: r.mime }
}

export function createBottleMini({ verify, loadKeys }: Deps) {
  return async (request: Request, env: Env): Promise<Response> => {
    const headers = { 'access-control-allow-origin': ISSUER, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', 'cache-control': 'no-store', vary: 'Origin' }
    const json = (body: unknown, status = 200) => {
      const text = JSON.stringify(body)
      return new TextEncoder().encode(text).length > MAX_REPLY ? Response.json({ error: '内容过多' }, { status: 502, headers }) : new Response(text, { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } })
    }
    const url = new URL(request.url), e = env as Env & { BOTTLE_APP_ID?: string; MINI_APP_JWKS?: string; MINIAPP_SANDBOX_DB?: D1Database; MINIAPP_DB?: D1Database }
    // 没填程序 ID：入口关闭
    if (!e.BOTTLE_APP_ID) return json({ error: '漂流瓶小程序尚未开放' }, 503)
    if (request.headers.get('origin') !== ISSUER) return json({ error: '来源不受信任' }, 403)
    const name = url.pathname.startsWith(PATH) ? url.pathname.slice(PATH.length) : ''
    const method = name === 'read' || name === 'file' ? 'GET' : name === 'write' || name === 'upload' ? 'POST' : null
    if (!method || url.origin !== AUDIENCE) return json({ error: '接口不存在' }, 404)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== method) return json({ error: '请求方法不支持' }, 405)
    const authorization = request.headers.get('authorization') || ''
    if (authorization.length > 8199 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) return json({ error: '需要平台登录凭据' }, 401)
    let channel: unknown
    try { channel = JSON.parse(atob(authorization.slice(7).split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).channel } catch { /* 下面按无效处理 */ }
    if (channel !== 'sandbox' && channel !== 'production') return json({ error: '平台渠道无效' }, 401)
    // 沙箱只用沙箱库，没配就报错，绝不落到正式库
    const db = channel === 'sandbox' ? e.MINIAPP_SANDBOX_DB : e.MINIAPP_DB
    if (!db || (channel === 'sandbox' && db === e.MINIAPP_DB)) return json({ error: '小程序测试环境尚未配置' }, 503)
    let claims: Claims | undefined
    try {
      const keys = e.MINI_APP_JWKS ? JSON.parse(e.MINI_APP_JWKS).keys : await loadKeys()
      if (!Array.isArray(keys) || !keys.length || keys.some((k) => k.d || k.kty !== 'EC' || k.crv !== 'P-256')) throw Error()
      for (const publicKey of keys.slice(0, 5)) {
        try { claims = await verify({ authorization, publicKey, issuer: ISSUER, audience: AUDIENCE, appId: e.BOTTLE_APP_ID, channel, scope: 'network.request', method, url: request.url }); break } catch { /* 试下一把公钥 */ }
      }
    } catch { return json({ error: '平台公钥暂时不可用' }, 503) }
    if (!claims || claims.iss !== ISSUER) return json({ error: '平台登录凭据无效，请重新打开小程序' }, 401)
    try {
      const a = await actorOf(env, db, claims.sub)
      if (name === 'file') {
        const f = await mediaFile(env, db, a, url.searchParams.get('k') ?? '', url.searchParams.get('p'))
        return new Response(f.bytes, { headers: { ...headers, 'content-type': f.mime, 'cache-control': 'private, max-age=86400' } })
      }
      if (name === 'upload') return json(await upload(env, db, a, request))
      if (method === 'GET') return json(await read(env, db, a, url.searchParams.get('route') ?? '', url.searchParams))
      const input = await bodyOf(request)
      if (!input || typeof input.route !== 'string') return json({ error: '请求格式无效或过大' }, 400)
      const payload = input.payload
      return json(await write(env, db, a, input.route, payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Obj : {}))
    } catch (err) {
      if (err instanceof HTTPException) {
        const code = err.cause && typeof err.cause === 'object' && 'code' in err.cause ? (err.cause as { code?: unknown }).code : undefined
        return json({ error: err.message, ...(typeof code === 'string' ? { code } : {}) }, err.status)
      }
      console.error('bottle_mini_failed', err instanceof Error ? err.message : 'unknown')
      return json({ error: '漂流瓶暂时打不开，请稍后重试' }, 500)
    }
  }
}
