// 漂流瓶接口（2026-11-25 改版）。规则见 services/bottles.ts；未登录由 needUser 挡住，新用户由 identity-mask 挡住。
import { Hono } from 'hono'
import type { C, Ctx, User } from '../types'
import { boundedJson, fail } from '../lib/http'
import { now } from '../lib/time'
import { isOwner, needUser } from '../services/auth'
import { isleThrottle } from './isle'
import * as S from '../services/bottles'
import * as M from '../services/bottle-money'
import { cleanNick, randomNick } from '../services/bottle-names'
import { loadWords, saveWords } from '../services/bottle-words'

export const bottles = new Hono<Ctx>()
bottles.use('/api/bottles/*', async (c, next) => { c.header('cache-control', 'private, no-store'); await next() })

const idOf = (c: C, key = 'id') => {
  const n = Number(c.req.param(key))
  return Number.isSafeInteger(n) && n > 0 ? n : fail(400, '瓶子编号不正确')
}
// 频率上限：内存计数，单进程够用
const slow = (u: User, what: string, limit: number, seconds: number) => {
  if (isleThrottle(`bottle-${what}:${u.id}`, limit, seconds)) fail(429, '慢一点，歇会儿再来')
}
// 禁言和站内限制沿用现有记录（post / comment / react）
async function actor(c: C, kind: 'post' | 'comment' | 'react') {
  const u = needUser(c)
  if (u.silenced) fail(403, '你在 linux.do 处于禁言状态')
  if (!u.is_admin && await c.env.DB.prepare('SELECT 1 AS ok FROM user_limits WHERE user_id=? AND kind=? AND (until=0 OR until>?)').bind(u.id, kind, now()).first()) fail(403, '你的账号暂时不能这样做')
  return u
}
const needAdmin = (c: C) => { const u = needUser(c); if (!u.is_admin && !isOwner(c, u)) fail(403, '只有管理员能做这个'); return u }
const needOwner = (c: C) => { const u = needUser(c); if (!isOwner(c, u)) fail(403, '只有站长能做这个'); return u }
const moodOf = (raw: unknown) => {
  const m = typeof raw === 'string' ? raw : ''
  return !m || S.MOODS.includes(m) ? m : fail(400, '没有这个心情')
}
const reasonOf = async (c: C) => String((await boundedJson(c, 2000)).reason ?? '').trim().slice(0, 100)
const state = async (c: C, u: User) => ({ ...(await S.quota(c.env.DB, u.id)), balance: await M.balanceOf(c.env.DB, u.id) })

// ---------- 首页 ----------
bottles.get('/api/bottles', async (c) => {
  const u = needUser(c), owner = isOwner(c, u), admin = !!u.is_admin || owner
  c.header('cache-control', 'private, no-store')
  return c.json({
    ...(await state(c, u)), moods: S.MOODS, max: S.BODY_MAX, days: S.DAYS, default_days: S.DEFAULT_DAYS, nick: randomNick(S.randomId()),
    reward: await M.rewardSource(c.env.DB) === 'off' ? 0 : M.REWARD, admin, owner, reports: admin ? await S.openReportCount(c.env.DB) : 0,
  })
})
bottles.post('/api/bottles', async (c) => {
  const u = await actor(c, 'post')
  slow(u, 'throw', 20, 60)
  const b = await boundedJson(c, 8000), op = S.opOf(b.op), mood = moodOf(b.mood)
  const days = b.days === undefined ? S.DEFAULT_DAYS : S.DAYS.includes(Number(b.days)) ? Number(b.days) : fail(400, '有效期不正确')
  // 默认匿名：只有明确传 anon:false 才是实名
  const anon = b.anon !== false
  const body = await S.cleanBody(c.env.DB, b.body), nick = anon ? await cleanNick(c.env.DB, b.nick) : ''
  const id = await S.throwBottle(c.env, u.id, { op, body, mood, days, anon, nick, show_badge: b.show_badge !== false, price: b.price })
  return c.json({ bottle: await S.bottleView(c.env.DB, id, u.id), ...(await state(c, u)) })
})
bottles.post('/api/bottles/draw', async (c) => {
  const u = needUser(c)
  slow(u, 'draw', 40, 60)
  const b = await boundedJson(c, 400)
  const id = await S.drawBottle(c.env, u.id, { op: S.opOf(b.op), mood: moodOf(b.mood), price: b.price })
  return c.json({ bottle: id ? await S.bottleView(c.env.DB, id, u.id) : null, ...(await state(c, u)) })
})
bottles.get('/api/bottles/mine', async (c) => {
  const u = needUser(c), tab = (c.req.query('tab') ?? 'thrown') as S.Tab
  if (!S.TABS.includes(tab)) fail(400, '没有这个列表')
  return c.json(await S.mineList(c.env.DB, u.id, tab, c.req.query('cursor')))
})

// ---------- 管理（管理员看不到匿名作者；只有站长能查被举报瓶子的作者） ----------
bottles.get('/api/bottles/reports', async (c) => { needAdmin(c); return c.json({ items: await S.openReports(c.env.DB) }) })
bottles.post('/api/bottles/reports', async (c) => {
  needAdmin(c)
  const b = await boundedJson(c, 400), id = Number(b.id)
  if (!Number.isSafeInteger(id) || id < 1) fail(400, '编号不正确')
  if (b.kind !== 'bottle' && b.kind !== 'reply') return fail(400, '类型不正确')
  if (b.action !== 'keep' && b.action !== 'delete') fail(400, '操作不正确')
  await S.resolveReports(c.env.DB, b.kind, id, b.action === 'delete')
  return c.json({ ok: true })
})
bottles.get('/api/bottles/settings', async (c) => {
  needOwner(c)
  return c.json({ ...(await loadWords(c.env.DB)), reward_source: await M.rewardSource(c.env.DB), reward_short: await M.shortCount(c.env.DB) })
})
bottles.put('/api/bottles/settings', async (c) => {
  needOwner(c)
  const b = await boundedJson(c, 128000)
  if (b.words !== undefined || b.allow !== undefined) await saveWords(c.env.DB, b.words ?? [], b.allow ?? [])
  if (b.reward_source !== undefined) await M.setRewardSource(c.env.DB, b.reward_source)
  return c.json({ ...(await loadWords(c.env.DB)), reward_source: await M.rewardSource(c.env.DB) })
})
bottles.get('/api/bottles/author-log', async (c) => {
  needOwner(c)
  const { results } = await c.env.DB.prepare('SELECT bottle_id,at FROM bottle_author_views ORDER BY id DESC LIMIT 100').all()
  return c.json({ items: results })
})

// ---------- 单个回信 ----------
async function needReply(c: C, u: User) {
  const r = await c.env.DB.prepare('SELECT id,bottle_id,user_id,deleted,hidden FROM bottle_replies WHERE id=?').bind(idOf(c, 'rid'))
    .first<{ id: number; bottle_id: number; user_id: number; deleted: number; hidden: number }>()
  if (!r || r.deleted || (r.hidden && !u.is_admin && r.user_id !== u.id)) return fail(404, '这封回信已经不在了')
  await S.needBottle(c.env.DB, r.bottle_id, u)
  return r
}
bottles.delete('/api/bottles/replies/:rid', async (c) => {
  const u = needUser(c), r = await needReply(c, u)
  if (r.user_id === u.id) await c.env.DB.prepare('UPDATE bottle_replies SET deleted=1 WHERE id=? AND deleted=0').bind(r.id).run()
  else if (u.is_admin) await S.resolveReports(c.env.DB, 'reply', r.id, true)
  else fail(403, '没有权限')
  await S.reheat(c.env.DB, r.bottle_id).run()
  return c.json({ ok: true })
})
bottles.post('/api/bottles/replies/:rid/report', async (c) => {
  const u = needUser(c), r = await needReply(c, u)
  if (r.user_id === u.id) fail(400, '不用举报自己的回信')
  slow(u, 'report', 20, 3600)
  await S.report(c.env.DB, 'reply', r.id, u.id, await reasonOf(c))
  return c.json({ ok: true })
})

// ---------- 单个瓶子 ----------
bottles.get('/api/bottles/:id', async (c) => {
  const u = needUser(c), b = await S.needBottle(c.env.DB, idOf(c), u)
  const page = await S.replyPage(c.env.DB, b.id, u.id, 0)
  return c.json({ bottle: await S.bottleView(c.env.DB, b.id, u.id), replies: page.items, next: page.next })
})
bottles.delete('/api/bottles/:id', async (c) => {
  const u = needUser(c), b = await S.needBottle(c.env.DB, idOf(c), u)
  if (b.deleted) fail(404, '这个瓶子已经漂远了')
  // 瓶主删除时连正文一起清空；有待处理的举报时保留正文给管理员看
  if (b.author_id === u.id) await c.env.DB.prepare(`UPDATE bottles SET deleted=1,body=CASE WHEN EXISTS(SELECT 1 FROM bottle_reports WHERE kind='bottle' AND target_id=?1 AND resolved=0) THEN body ELSE '' END WHERE id=?1`).bind(b.id).run()
  else if (u.is_admin) await S.resolveReports(c.env.DB, 'bottle', b.id, true)
  else fail(403, '没有权限')
  return c.json({ ok: true })
})
// 徽章显示与否：只有瓶主能改，实名瓶没有徽章
bottles.put('/api/bottles/:id/badge', async (c) => {
  const u = needUser(c), b = await S.needBottle(c.env.DB, idOf(c), u)
  if (b.author_id !== u.id) fail(403, '没有权限')
  const on = (await boundedJson(c, 100)).on !== false
  await c.env.DB.prepare('UPDATE bottles SET show_badge=? WHERE id=?').bind(on ? 1 : 0, b.id).run()
  return c.json({ bottle: await S.bottleView(c.env.DB, b.id, u.id) })
})
bottles.get('/api/bottles/:id/replies', async (c) => {
  const u = needUser(c), b = await S.needBottle(c.env.DB, idOf(c), u)
  const after = Number(c.req.query('after') ?? 0)
  const page = await S.replyPage(c.env.DB, b.id, u.id, Number.isSafeInteger(after) && after > 0 ? after : 0)
  return c.json({ replies: page.items, next: page.next })
})
bottles.get('/api/bottles/:id/likes', async (c) => {
  const u = needUser(c), b = await S.needBottle(c.env.DB, idOf(c), u)
  return c.json(await S.likers(c.env.DB, b.id, c.req.query('cursor')))
})

// 能互动的瓶子：没被隐藏或删除；瓶主不能赞 / 踩 / 收藏自己的（名单是实名的，会暴露瓶主）
async function target(c: C, u: User, hostOk = false) {
  const b = await S.needBottle(c.env.DB, idOf(c), u)
  if (b.deleted || b.hidden) fail(409, '这个瓶子暂时不能互动')
  if (!hostOk && b.author_id === u.id) fail(400, '这是你自己的瓶子')
  return b
}
for (const [path, table] of [['like', 'bottle_likes'], ['poop', 'bottle_poops'], ['keep', 'bottle_keeps']] as const) {
  bottles.put(`/api/bottles/:id/${path}`, async (c) => {
    const u = await actor(c, 'react'), b = await target(c, u)
    slow(u, path, 60, 60)
    await c.env.DB.prepare(`INSERT OR IGNORE INTO ${table}(bottle_id,user_id,created_at) VALUES(?,?,?)`).bind(b.id, u.id, now()).run()
    if (path !== 'keep') await S.reheat(c.env.DB, b.id).run()
    if (path === 'like') await M.queueReward(c.env, { bottle: b.id, author: b.author_id, actor: u.id, kind: 'like' })
    return c.json({ bottle: await S.bottleView(c.env.DB, b.id, u.id) })
  })
  bottles.delete(`/api/bottles/:id/${path}`, async (c) => {
    const u = needUser(c), b = await S.needBottle(c.env.DB, idOf(c), u)
    slow(u, path, 60, 60)
    const view = await S.bottleView(c.env.DB, b.id, u.id)
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE bottle_id=? AND user_id=?`).bind(b.id, u.id).run()
    if (path !== 'keep') await S.reheat(c.env.DB, b.id).run()
    return c.json({ bottle: (await S.bottleView(c.env.DB, b.id, u.id)) ?? view })
  })
}

bottles.post('/api/bottles/:id/replies', async (c) => {
  const u = await actor(c, 'comment'), b = await target(c, u, true)
  const input = await boundedJson(c, 8000), db = c.env.DB, op = S.opOf(input.op)
  const done = await db.prepare('SELECT id FROM bottle_replies WHERE user_id=? AND op=?').bind(u.id, op).first<{ id: number }>()
  if (done) return c.json({ reply: (await S.replyPage(db, b.id, u.id, done.id - 1)).items[0] })
  slow(u, 'reply', 10, 60)
  const body = await S.cleanBody(db, input.body), host = b.author_id === u.id
  // 页面打开后在别的标签页换了账号：身份和输入框上写的不一致就不寄，免得匿名变实名
  if (typeof input.as_host === 'boolean' && input.as_host !== host) fail(409, '登录的账号变了，刷新页面后再寄')
  let to: number | null = null
  if (input.reply_to != null) {
    to = Number(input.reply_to)
    if (!Number.isSafeInteger(to) || !await db.prepare('SELECT 1 AS ok FROM bottle_replies WHERE id=? AND bottle_id=? AND deleted=0 AND hidden=0').bind(to, b.id).first()) fail(400, '要回复的那封信已经不在了')
  }
  // 是不是瓶主由服务端判断，前端改不了
  const r = await db.prepare('INSERT INTO bottle_replies(bottle_id,user_id,is_host,reply_to,body,created_at,op) VALUES(?,?,?,?,?,?,?) RETURNING id')
    .bind(b.id, u.id, host ? 1 : 0, to, body, now(), op).first<{ id: number }>()
  await S.reheat(db, b.id).run()
  if (!host) await M.queueReward(c.env, { bottle: b.id, author: b.author_id, actor: u.id, kind: 'reply' })
  return c.json({ reply: (await S.replyPage(db, b.id, u.id, r!.id - 1)).items[0] })
})
bottles.post('/api/bottles/:id/report', async (c) => {
  const u = needUser(c), b = await target(c, u)
  slow(u, 'report', 20, 3600)
  await S.report(c.env.DB, 'bottle', b.id, u.id, await reasonOf(c))
  return c.json({ ok: true })
})
bottles.post('/api/bottles/:id/author', async (c) => {
  const u = needOwner(c)
  return c.json({ author: await S.revealAuthor(c.env.DB, idOf(c), u.id) })
})
