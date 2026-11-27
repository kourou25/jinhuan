// 「斗」接口。全部要求登录；人放在带 user_id + avatar 的对象里，新用户看到的名字由身份遮罩中间件统一换成化名。
// 不写通知、推送、搜索、D 币。战斗结算全部在服务端（services/dou.ts + dou-battle.ts），前端只播放事件。
import { Hono } from 'hono'
import type { C, Ctx } from '../types'
import { needUser, isOwner } from '../services/auth'
import { boundedJson, fail } from '../lib/http'
import { now } from '../lib/time'
import {
  ACHIEVEMENTS, BASE_SKILLS, BOARD_LEVEL, CARDS, CHAPTERS, DAILY, EXCLUSIVE_UNLOCK, MAX_LEVEL, OUTFITS, OUTFIT_SLOTS, OUTFIT_SLOT_NAMES, PASSIVES, PASSIVE_BY_KEY,
  PICK_ACTION, STAGES, WEAPONS, ROLES, WEAPON_KIND_NAMES, WEAPON_SKILLS, deckSize, expToNext,
} from '../services/dou-data'
import { rolePassive, roleExclusive, sanitizeSkill } from '../services/dou-battle'
import {
  boardList, boardRow, dailyOf, hueOf, joinBoard, joinDou, leaveDou, loadHero, opponents, pickCard, replay, reports, roleConfig, setLoadout, settleStale,
  stageStatus, startBattle, setRole, type StartReq,
} from '../services/dou'

export const dou = new Hono<Ctx>()
dou.use('/api/dou/*', async (c, next) => {
  needUser(c)
  c.header('cache-control', 'private, no-store')
  await next()
})

const heroOrFail = async (c: C) => { const u = needUser(c); return (await loadHero(c.env.DB, u.id)) ?? fail(404, '还没有开启「斗」') }
// 每人 3 秒内只能开一场（单进程内存即可）
const lastStart = new Map<number, number>()
function throttle(uid: number) {
  if (Date.now() - (lastStart.get(uid) ?? 0) < 3000) fail(429, '歇口气，3 秒后再打')
}
// 只有真的开打了才计时，参数不对被拒的不算
function started(uid: number) {
  const t = Date.now()
  lastStart.set(uid, t)
  if (lastStart.size > 5000) for (const [k, v] of lastStart) if (t - v > 60000) lastStart.delete(k)
}

// 静态数据：技能、武器、卡、关卡、装扮、成就（前端缓存）
dou.get('/api/dou/catalog', (c) => {
  c.header('cache-control', 'private, max-age=600')
  return c.json({
    roles: ROLES,
    max_level: MAX_LEVEL, board_level: BOARD_LEVEL, daily: DAILY, pick_action: PICK_ACTION, exclusive_unlock: EXCLUSIVE_UNLOCK,
    weapon_kinds: WEAPON_KIND_NAMES, base_skills: BASE_SKILLS, weapon_skills: WEAPON_SKILLS, weapons: WEAPONS, passives: PASSIVES, cards: CARDS,
    outfits: OUTFITS, outfit_slots: OUTFIT_SLOTS.map((k) => [k, OUTFIT_SLOT_NAMES[k]]), achievements: ACHIEVEMENTS,
    chapters: CHAPTERS.map((ch) => ({ n: ch.n, vol: ch.vol, name: ch.name, scene: ch.scene, boss: ch.boss.name, boss_kind: ch.boss.kind, mooks: ch.mooks.map((m) => m[0]), weapon: ch.weapon, outfit: ch.outfit ?? null, cards: ch.firstCards })),
    stages: STAGES.map((s) => ({ id: s.id, ch: s.ch.n, k: s.k, level: s.level })),
  })
})

dou.get('/api/dou/home', async (c) => {
  const u = needUser(c), db = c.env.DB, t = now()
  const h = await loadHero(db, u.id)
  if (!h) return c.json({ joined: false, owner: isOwner(c, u) })
  await settleStale(db, u.id, t)
  const cfg = await roleConfig(db, u.id)
  const items = (await db.prepare('SELECT item_id, kind FROM dou_items WHERE user_id=? ORDER BY got_at').bind(u.id).all<{ item_id: string; kind: string }>()).results
  const achs = (await db.prepare('SELECT ach, got_at FROM dou_achievements WHERE user_id=? ORDER BY got_at').bind(u.id).all<{ ach: string; got_at: number }>()).results
  const board = await boardRow(db, u.id)
  const pending = await db.prepare("SELECT id FROM dou_battles WHERE attacker=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(u.id).first<{ id: string }>()
  const fresh = await db.prepare("SELECT COUNT(*) n FROM dou_battles WHERE defender=? AND created_at>? AND status='done'").bind(u.id, t - 86400).first<{ n: number }>()
  const passive = rolePassive(u.id, cfg, h.role)
  return c.json({
    joined: true, owner: isOwner(c, u),
    hero: {
      active: !!h.active, level: h.level, exp: h.exp, next: expToNext(h.level), weapon: h.weapon, deck: JSON.parse(h.deck), outfit: JSON.parse(h.outfit), deck_size: deckSize(h.level),
      points: h.pvp_points, wins: h.pvp_wins, losses: h.pvp_losses, daily: dailyOf(h, t), passive: passive.key,
      role: h.role, exclusive: roleExclusive(u.id, cfg, h.role).map((s, i) => ({ ...s, unlock: EXCLUSIVE_UNLOCK[i] })), look: { hue: cfg.hue ?? hueOf(u.id), sheet: cfg.sheet ?? null, role: h.role || 'deepseek' },
    },
    items, achievements: achs, board: board ? { rank: board.rank } : null, pending: pending?.id ?? null, defended_today: fresh?.n ?? 0,
  })
})

dou.post('/api/dou/join', async (c) => {
  const u = needUser(c), b = await boundedJson(c, 256)
  await joinDou(c.env.DB, u.id, now(), typeof b.role === 'string' ? b.role : null)
  return c.json({ ok: true })
})
dou.post('/api/dou/leave', async (c) => {
  const u = needUser(c)
  await leaveDou(c.env.DB, u.id, now())
  return c.json({ ok: true })
})

dou.put('/api/dou/role', async (c) => {
  const h = await heroOrFail(c), b = await boundedJson(c, 256)
  await setRole(c.env.DB, h.user_id, b.role, now())
  return c.json({ ok: true })
})
dou.put('/api/dou/loadout', async (c) => {
  const h = await heroOrFail(c), b = await boundedJson(c, 4096)
  await setLoadout(c.env.DB, h, b, now())
  return c.json({ ok: true })
})

dou.get('/api/dou/stages', async (c) => {
  const h = await heroOrFail(c)
  return c.json({ stages: await stageStatus(c.env.DB, h.user_id) })
})
dou.get('/api/dou/opponents', async (c) => {
  const h = await heroOrFail(c)
  if (!h.active) fail(403, '先开启「斗」再来')
  return c.json({ list: await opponents(c.env.DB, h) })
})

dou.post('/api/dou/battle', async (c) => {
  const h = await heroOrFail(c), b = await boundedJson(c, 1024)
  let req: StartReq
  if (b.kind === 'pve' && typeof b.stage === 'string') req = { kind: 'pve', stage: b.stage }
  else if (b.kind === 'pvp' && typeof b.npc === 'string') req = { kind: 'pvp', npc: b.npc }
  else if (b.kind === 'pvp') req = { kind: 'pvp', target: Number(b.target) }
  else if (b.kind === 'board') req = { kind: 'board', target: Number(b.target) }
  else return fail(400, '对战类型无效')
  throttle(h.user_id)
  const r = await startBattle(c.env.DB, h, req, now())
  started(h.user_id)
  return c.json(r)
})
dou.post('/api/dou/battle/:id/pick', async (c) => {
  const u = needUser(c), b = await boundedJson(c, 256), id = c.req.param('id')
  if (!/^[a-f\d]{24}$/.test(id)) fail(400, '编号无效')
  return c.json(await pickCard(c.env.DB, u.id, id, Number(b.n), Number(b.pick), now()))
})
dou.get('/api/dou/battle/:id', async (c) => {
  const u = needUser(c), id = c.req.param('id')
  if (!/^[a-f\d]{24}$/.test(id)) fail(400, '编号无效')
  return c.json(await replay(c.env.DB, u.id, id))
})
dou.get('/api/dou/reports', async (c) => {
  const u = needUser(c)
  return c.json({ list: await reports(c.env.DB, u.id) })
})

dou.get('/api/dou/board', async (c) => {
  const u = needUser(c)
  return c.json(await boardList(c.env.DB, u.id))
})
dou.post('/api/dou/board/join', async (c) => {
  const h = await heroOrFail(c)
  if (!h.active) fail(403, '先开启「斗」再来')
  await joinBoard(c.env.DB, h, now())
  return c.json({ ok: true })
})

// ---------- 站长：标注头像、给角色单独配被动 / 专属技能 / 精灵图 ----------
const ownerOnly = (c: C) => { const u = needUser(c); if (!isOwner(c, u)) fail(404, '页面不存在'); return u }
dou.get('/api/dou/admin/heroes', async (c) => {
  ownerOnly(c)
  const rows = (await c.env.DB.prepare(`SELECT d.user_id, d.level, d.active, u.username, u.name, u.nick, u.avatar, COALESCE(r.avatar_kind, 'pending') avatar_kind, COALESCE(r.config, '{}') config
    FROM dou_heroes d JOIN users u ON u.id=d.user_id LEFT JOIN dou_roles r ON r.user_id=d.user_id ORDER BY d.created_at DESC LIMIT 500`).all<Record<string, any>>()).results
  return c.json({ list: rows.map((r) => ({ ...r, config: JSON.parse(r.config || '{}') })) })
})
dou.put('/api/dou/admin/roles/:uid', async (c) => {
  ownerOnly(c)
  const uid = Number(c.req.param('uid')), b = await boundedJson(c, 8192), db = c.env.DB
  if (!Number.isSafeInteger(uid) || !(await loadHero(db, uid))) fail(404, '这个人没有开启「斗」')
  const kind = b.avatar_kind
  if (kind !== undefined && !['pending', 'person', 'other'].includes(kind as string)) fail(400, '头像类型无效')
  let config: string | null = null
  if (b.config !== undefined) {
    if (!b.config || typeof b.config !== 'object' || Array.isArray(b.config)) fail(400, '配置格式错误')
    const raw = b.config as Record<string, any>
    const cfg: Record<string, unknown> = {}
    if (raw.passive !== undefined && raw.passive !== null) { if (!PASSIVE_BY_KEY.has(raw.passive)) fail(400, '没有这个被动'); cfg.passive = raw.passive }
    if (raw.skills !== undefined) {
      if (!Array.isArray(raw.skills) || raw.skills.length > 3) fail(400, '专属技能最多 3 个')
      cfg.skills = raw.skills.map((s: unknown, i: number) => s === null ? null : sanitizeSkill(s, `u${uid}_${i}`) ?? fail(400, `第 ${i + 1} 个技能缺名字`))
    }
    // 精灵图文件名用随机串，不要用用户编号（前端能看到路径）
    if (raw.sheet !== undefined && raw.sheet !== null) { if (typeof raw.sheet !== 'string' || !/^\/assets\/dou\/heroes\/[a-z\d-]{6,40}\.(png|webp)$/.test(raw.sheet)) fail(400, '精灵图路径应为 /assets/dou/heroes/<随机串>.png'); cfg.sheet = raw.sheet }
    if (raw.hue !== undefined && raw.hue !== null) { const n = Number(raw.hue); if (!Number.isInteger(n) || n < 0 || n > 359) fail(400, '色相 0–359'); cfg.hue = n }
    config = JSON.stringify(cfg)
  }
  const t = now()
  await db.prepare(`INSERT INTO dou_roles(user_id, avatar_kind, config, updated_at) VALUES(?, COALESCE(?, 'pending'), COALESCE(?, '{}'), ?)
    ON CONFLICT(user_id) DO UPDATE SET avatar_kind=COALESCE(?, avatar_kind), config=COALESCE(?, config), updated_at=?`).bind(uid, kind ?? null, config, t, kind ?? null, config, t).run()
  return c.json({ ok: true })
})
