// 「斗」的数据库层：角色、每日次数、奖励、战斗的开局 / 选卡 / 结算、武林大会。
// 战斗本身在 dou-battle.ts（纯函数）。每场开局和每次选卡各一次模拟（约 0.05 毫秒），写 1–3 行，没有轮询。
import { randHex } from '../lib/crypto'
import { fail } from '../lib/http'
import {
  ACHIEVEMENTS, BOARD_LEVEL, BOARD_REACH, CARD_BY_ID, CHAPTERS, DAILY, MAX_LEVEL, OUTFIT_BY_ID, OUTFIT_SLOTS, STAGE_BY_ID, STAGES, STARTER_CARDS,
  WEAPON_BY_ID, ROLE_BY_KEY, deckSize, expToNext,
} from './dou-data'
import { hashSeed, heroFighter, npcFighter, simulate, stageFighter, type Fighter, type RoleConfig, type SimResult } from './dou-battle'

type DB = D1Database
export type HeroDb = { user_id: number; role: string | null; active: number; level: number; exp: number; weapon: string | null; deck: string; outfit: string; daily: string; pvp_points: number; pvp_wins: number; pvp_losses: number; created_at: number; updated_at: number }
export type Daily = { d: string; pve: number; pvp: number; board: number; auto: number }
export type DailyKey = 'pve' | 'pvp' | 'board' | 'auto'
// 战斗里出现的人：真人放在带 user_id + avatar 的对象里，让身份遮罩中间件统一处理；关卡对手和江湖散人只有 npc + name
export type SideMeta = ({ user_id: number; name: string; avatar: string | null } | { npc: 1; name: string; boss?: 1 }) & { level: number; look: Record<string, unknown>; kind: string | null; weapon: string | null; max: number; passive: string | null }
type Snap = { a: Fighter; b: Fighter; sides: [SideMeta, SideMeta]; scene: string }
export type BattleRow = { id: string; kind: 'pve' | 'pvp' | 'board' | 'auto'; attacker: number; defender: number | null; stage: string | null; seed: string; snap: string; picks: string; status: 'pending' | 'done'; winner: number | null; reward: string | null; created_at: number; updated_at: number }

const no = fail

export const bjDay = (t: number) => new Date((t + 28800) * 1000).toISOString().slice(0, 10)
export const PENDING_TTL = 15 * 60 // 进行中的战斗 15 分钟没人选卡，按推荐自动打完
export const BATTLE_KEEP_DAYS = 30

export function dailyOf(h: Pick<HeroDb, 'daily'>, t: number): Daily {
  const d = bjDay(t)
  try { const o = JSON.parse(h.daily); if (o && o.d === d) return { d, pve: o.pve | 0, pvp: o.pvp | 0, board: o.board | 0, auto: o.auto | 0 } } catch {}
  return { d, pve: 0, pvp: 0, board: 0, auto: 0 }
}
// 扣一次次数：带上旧值做条件更新，并发时只有一个成功
async function spend(db: DB, h: HeroDb, key: DailyKey, t: number) {
  const cur = dailyOf(h, t)
  if (cur[key] >= DAILY[key]) no(429, '今天的次数用完了，明天再来')
  const next = JSON.stringify({ ...cur, [key]: cur[key] + 1 })
  const r = await db.prepare('UPDATE dou_heroes SET daily=?, updated_at=? WHERE user_id=? AND daily=?').bind(next, t, h.user_id, h.daily).run()
  if (!r.meta.changes) no(409, '操作太快了，再试一次')
  h.daily = next
}

export const loadHero = (db: DB, uid: number) => db.prepare('SELECT * FROM dou_heroes WHERE user_id=?').bind(uid).first<HeroDb>()
export async function roleConfig(db: DB, uid: number): Promise<RoleConfig> {
  const r = await db.prepare('SELECT config FROM dou_roles WHERE user_id=?').bind(uid).first<{ config: string }>()
  try { return r ? JSON.parse(r.config) || {} : {} } catch { return {} }
}
const nameOf = (u: { nick?: string | null; name?: string | null; username: string }) => u.nick || u.name || u.username
type UserLite = { id: number; username: string; name: string | null; nick: string | null; avatar: string | null }
const userLite = (db: DB, uid: number) => db.prepare('SELECT id, username, name, nick, avatar FROM users WHERE id=? AND disabled=0').bind(uid).first<UserLite>()
// 头像外观色相：由编号派生，不直接把编号给前端
export const hueOf = (uid: number) => hashSeed('dou-hue|' + uid) % 360

async function heroSide(db: DB, h: HeroDb): Promise<{ f: Fighter; meta: SideMeta }> {
  const u = await userLite(db, h.user_id) ?? no(404, '对手不存在')
  const cfg = await roleConfig(db, h.user_id)
  const f = heroFighter(h, nameOf(u), cfg)
  f.look = { outfit: f.look.outfit, sheet: f.look.sheet, hue: cfg.hue ?? hueOf(h.user_id), role: f.look.role }
  return { f, meta: { user_id: u.id, name: nameOf(u), avatar: u.avatar, level: f.level, look: f.look, kind: f.kind, weapon: f.weapon, max: f.stats.hp, passive: f.passive?.key ?? null } }
}
const npcSide = (f: Fighter, boss = false): { f: Fighter; meta: SideMeta } => ({ f, meta: { npc: 1, name: f.name, ...(boss ? { boss: 1 as const } : {}), level: f.level, look: f.look, kind: f.kind, weapon: f.weapon, max: f.stats.hp, passive: f.passive?.key ?? null } })

// ---------- 加入 / 退出 ----------
export async function joinDou(db: DB, uid: number, t: number, role: string | null = null) {
  if (role !== null && !ROLE_BY_KEY.has(role)) no(400, '没有这个主角')
  const old = await loadHero(db, uid)
  if (old) { if (!old.active) await db.prepare('UPDATE dou_heroes SET active=1, updated_at=? WHERE user_id=?').bind(t, uid).run(); if (role) await setRole(db, uid, role, t); return }
  await db.batch([
    db.prepare("INSERT INTO dou_heroes(user_id, role, weapon, deck, created_at, updated_at) VALUES(?, ?, 'w_code_sword', ?, ?, ?)").bind(uid, role, JSON.stringify(STARTER_CARDS.slice(0, deckSize(1))), t, t),
    db.prepare("INSERT OR IGNORE INTO dou_items(user_id, item_id, kind, got_at) VALUES(?, 'w_code_sword', 'weapon', ?)").bind(uid, t),
    ...STARTER_CARDS.map((c) => db.prepare("INSERT OR IGNORE INTO dou_items(user_id, item_id, kind, got_at) VALUES(?, ?, 'card', ?)").bind(uid, c, t)),
    db.prepare("INSERT OR IGNORE INTO dou_roles(user_id, updated_at) VALUES(?, ?)").bind(uid, t),
  ])
  await grantAch(db, uid, 'join', t)
}
// 退出：立即从对手列表和武林大会下线；等级和物品保留，再开启时恢复
export async function leaveDou(db: DB, uid: number, t: number) {
  await db.prepare('UPDATE dou_heroes SET active=0, updated_at=? WHERE user_id=?').bind(t, uid).run()
  await leaveBoard(db, uid)
}

// 选 / 换主角
export async function setRole(db: DB, uid: number, role: unknown, t: number) {
  if (typeof role !== 'string' || !ROLE_BY_KEY.has(role)) no(400, '没有这个主角')
  await db.prepare('UPDATE dou_heroes SET role=?, updated_at=? WHERE user_id=?').bind(role, t, uid).run()
}

// ---------- 物品 / 成就 / 经验 ----------
async function grantItem(db: DB, uid: number, id: string, kind: 'weapon' | 'outfit' | 'card', t: number) {
  const r = await db.prepare('INSERT OR IGNORE INTO dou_items(user_id, item_id, kind, got_at) VALUES(?, ?, ?, ?)').bind(uid, id, kind, t).run()
  return !!r.meta.changes
}
async function grantAch(db: DB, uid: number, ach: string, t: number, out?: Reward) {
  const a = ACHIEVEMENTS[ach]
  if (!a) return
  const r = await db.prepare('INSERT OR IGNORE INTO dou_achievements(user_id, ach, got_at) VALUES(?, ?, ?)').bind(uid, ach, t).run()
  if (!r.meta.changes) return
  out?.achievements.push(ach)
  if (a.outfit && await grantItem(db, uid, a.outfit, 'outfit', t)) out?.items.push(a.outfit)
}
// 加经验，满级后不再累计
export function levelAfter(level: number, exp: number, add: number) {
  let lv = Math.max(1, Math.min(MAX_LEVEL, level)), e = Math.max(0, exp) + Math.max(0, Math.floor(add))
  while (lv < MAX_LEVEL && e >= expToNext(lv)) { e -= expToNext(lv); lv++ }
  if (lv >= MAX_LEVEL) e = 0
  return { level: lv, exp: e }
}
async function addExp(db: DB, uid: number, add: number, t: number, out: Reward) {
  const h = await loadHero(db, uid)
  if (!h) return
  const n = levelAfter(h.level, h.exp, add)
  await db.prepare('UPDATE dou_heroes SET level=?, exp=?, updated_at=? WHERE user_id=?').bind(n.level, n.exp, t, uid).run()
  out.exp = add; out.level = n.level; out.levelUp = n.level > h.level
  if (n.level >= MAX_LEVEL) await grantAch(db, uid, 'lv52', t, out)
}

// ---------- 装备 ----------
export async function setLoadout(db: DB, h: HeroDb, body: { weapon?: unknown; deck?: unknown; outfit?: unknown }, t: number) {
  const own = new Set((await db.prepare('SELECT item_id FROM dou_items WHERE user_id=?').bind(h.user_id).all<{ item_id: string }>()).results.map((r) => r.item_id))
  let weapon = h.weapon, deck = h.deck, outfit = h.outfit
  if (body.weapon !== undefined) {
    if (body.weapon !== null && (typeof body.weapon !== 'string' || !WEAPON_BY_ID.has(body.weapon) || !own.has(body.weapon))) no(400, '没有这把武器')
    weapon = body.weapon as string | null
  }
  if (body.deck !== undefined) {
    if (!Array.isArray(body.deck)) no(400, '卡组格式错误')
    const ids = body.deck as unknown[]
    if (ids.length > deckSize(h.level)) no(400, `当前等级最多带 ${deckSize(h.level)} 张卡`)
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !CARD_BY_ID.has(id) || !own.has(id))) no(400, '卡组里有没有的卡或重复的卡')
    deck = JSON.stringify(ids)
  }
  if (body.outfit !== undefined) {
    const o = body.outfit as Record<string, unknown>
    if (!o || typeof o !== 'object' || Array.isArray(o)) no(400, '装扮格式错误')
    const next: Record<string, string> = {}
    for (const [slot, id] of Object.entries(o)) {
      if (!(OUTFIT_SLOTS as readonly string[]).includes(slot)) no(400, '没有这个挂点')
      if (id === null || id === '') continue
      const item = typeof id === 'string' ? OUTFIT_BY_ID.get(id) : undefined
      if (!item || item.slot !== slot || !own.has(item.id)) no(400, '没有这件装扮')
      next[slot] = item!.id
    }
    outfit = JSON.stringify(next)
  }
  await db.prepare('UPDATE dou_heroes SET weapon=?, deck=?, outfit=?, updated_at=? WHERE user_id=?').bind(weapon, deck, outfit, t, h.user_id).run()
}

// ---------- 关卡 ----------
export async function stageStatus(db: DB, uid: number) {
  const rows = (await db.prepare('SELECT stage, wins, tries FROM dou_progress WHERE user_id=?').bind(uid).all<{ stage: string; wins: number; tries: number }>()).results
  const m = new Map(rows.map((r) => [r.stage, r]))
  let open = true
  return STAGES.map((s) => {
    const p = m.get(s.id), item = { id: s.id, ch: s.ch.n, k: s.k, level: s.level, open, wins: p?.wins ?? 0, tries: p?.tries ?? 0 }
    open = open && !!p?.wins
    return item
  })
}

// ---------- 对手 ----------
export async function opponents(db: DB, h: HeroDb) {
  const rows = (await db.prepare(`SELECT d.user_id, d.level, d.weapon, d.role, d.pvp_points, u.username, u.name, u.nick, u.avatar FROM dou_heroes d JOIN users u ON u.id=d.user_id
    WHERE d.active=1 AND u.disabled=0 AND d.user_id<>? AND d.level BETWEEN ? AND ? ORDER BY random() LIMIT 5`).bind(h.user_id, h.level - 5, h.level + 5)
    .all<{ user_id: number; level: number; weapon: string | null; role: string | null; pvp_points: number; username: string; name: string | null; nick: string | null; avatar: string | null }>()).results
  const list: Record<string, unknown>[] = rows.map((r) => ({ user_id: r.user_id, name: nameOf(r), avatar: r.avatar, level: r.level, weapon: r.weapon, points: r.pvp_points, look: { hue: hueOf(r.user_id), role: r.role || 'deepseek' } }))
  // 真人不够 5 个时补江湖散人
  while (list.length < 5) {
    const lv = Math.max(1, Math.min(MAX_LEVEL, h.level + Math.floor(Math.random() * 5) - 2)), seed = `L${lv}-${randHex(4)}`, f = npcFighter(lv, seed)
    list.push({ npc: seed, name: f.name, level: lv, weapon: null, kind: f.kind, look: f.look })
  }
  return list
}

// ---------- 武林大会 ----------
export async function boardRow(db: DB, uid: number) { return db.prepare('SELECT * FROM dou_board WHERE user_id=?').bind(uid).first<{ user_id: number; rank: number; joined_at: number; auto_day: string | null }>() }
export async function joinBoard(db: DB, h: HeroDb, t: number) {
  if (h.level < BOARD_LEVEL) no(403, `${BOARD_LEVEL} 级才能上武林大会`)
  if (await boardRow(db, h.user_id)) return
  await db.prepare('INSERT INTO dou_board(user_id, rank, joined_at) VALUES(?, (SELECT COALESCE(MAX(rank), 0) + 1 FROM dou_board), ?)').bind(h.user_id, t).run()
}
async function leaveBoard(db: DB, uid: number) {
  const r = await boardRow(db, uid)
  if (!r) return
  await db.batch([db.prepare('DELETE FROM dou_board WHERE user_id=?').bind(uid), db.prepare('UPDATE dou_board SET rank=rank-1 WHERE rank>?').bind(r.rank)])
}
export async function boardList(db: DB, uid: number) {
  const me = await boardRow(db, uid)
  const rows = (await db.prepare(`SELECT b.user_id, b.rank, d.level, d.weapon, d.role, u.username, u.name, u.nick, u.avatar FROM dou_board b JOIN dou_heroes d ON d.user_id=b.user_id JOIN users u ON u.id=b.user_id
    WHERE b.rank<=50 OR (? > 0 AND b.rank BETWEEN ? AND ?) ORDER BY b.rank LIMIT 80`).bind(me ? 1 : 0, (me?.rank ?? 0) - BOARD_REACH, (me?.rank ?? 0) + 3)
    .all<{ user_id: number; rank: number; level: number; weapon: string | null; role: string | null; username: string; name: string | null; nick: string | null; avatar: string | null }>()).results
  return { me: me ? { rank: me.rank } : null, list: rows.map((r) => ({ user_id: r.user_id, name: nameOf(r), avatar: r.avatar, rank: r.rank, level: r.level, weapon: r.weapon, look: { hue: hueOf(r.user_id), role: r.role || 'deepseek' }, can: !!me && r.rank < me.rank && me.rank - r.rank <= BOARD_REACH })) }
}
async function swapRanks(db: DB, winner: number, loser: number) {
  const a = await boardRow(db, winner), b = await boardRow(db, loser)
  if (!a || !b || a.rank < b.rank) return false
  await db.batch([db.prepare('UPDATE dou_board SET rank=? WHERE user_id=?').bind(b.rank, winner), db.prepare('UPDATE dou_board SET rank=? WHERE user_id=?').bind(a.rank, loser)])
  return true
}

// ---------- 战斗 ----------
export type Reward = { exp: number; level?: number; levelUp?: boolean; items: string[]; achievements: string[]; points?: number; rank?: number }
export type StartReq = { kind: 'pve'; stage: string } | { kind: 'pvp'; target?: number; npc?: string } | { kind: 'board'; target: number }

export async function startBattle(db: DB, h: HeroDb, req: StartReq, t: number) {
  if (!h.active) no(403, '先开启「斗」再来')
  await settleStale(db, h.user_id, t, true)
  const me = await heroSide(db, h)
  let foe: { f: Fighter; meta: SideMeta }, kind: BattleRow['kind'] = req.kind, defender: number | null = null, stage: string | null = null, scene = 'arena'
  if (req.kind === 'pve') {
    const s = STAGE_BY_ID.get(req.stage) ?? no(404, '没有这一关')
    const st = await stageStatus(db, h.user_id)
    if (!st.find((x) => x.id === s!.id)!.open) no(403, '先打过前面的关卡')
    foe = npcSide(stageFighter(s!.id)!, s!.k === 4); stage = s!.id; scene = s!.ch.scene
  } else if (req.kind === 'pvp') {
    if (req.npc !== undefined) {
      const m = typeof req.npc === 'string' ? /^L(\d{1,2})-[a-f\d]{8}$/.exec(req.npc) : null
      const lv = m ? Number(m[1]) : 0
      if (!m || lv < 1 || lv > MAX_LEVEL || Math.abs(lv - h.level) > 5) no(400, '对手无效')
      foe = npcSide(npcFighter(lv, req.npc)); stage = 'npc:' + req.npc
    } else {
      const uid = Number(req.target)
      if (!Number.isSafeInteger(uid) || uid === h.user_id) no(400, '对手无效')
      const other = await loadHero(db, uid)
      if (!other || !other.active || Math.abs(other.level - h.level) > 5) no(404, '对手不在了，换一个吧')
      foe = await heroSide(db, other!); defender = uid
    }
  } else if (req.kind === 'board') {
    const uid = Number(req.target), mine = await boardRow(db, h.user_id), theirs = Number.isSafeInteger(uid) ? await boardRow(db, uid) : null
    if (!mine) no(403, '先报名武林大会')
    if (!theirs || theirs.rank >= mine!.rank || mine!.rank - theirs.rank > BOARD_REACH) no(400, `只能挑战排名比你高、且相差 ${BOARD_REACH} 名以内的人`)
    const other = await loadHero(db, uid)
    if (!other?.active) no(404, '对手不在了')
    foe = await heroSide(db, other!); defender = uid; scene = 'board'
  } else return no(400, '未知的对战类型')
  await spend(db, h, req.kind === 'board' ? 'board' : req.kind, t)
  const snap: Snap = { a: me.f, b: foe!.f, sides: [me.meta, foe!.meta], scene }
  const id = randHex(12), seed = randHex(16)
  await db.prepare('INSERT INTO dou_battles(id, kind, attacker, defender, stage, seed, snap, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, kind, h.user_id, defender, stage, seed, JSON.stringify(snap), t, t).run()
  if (stage && kind === 'pve') await db.prepare('INSERT INTO dou_progress(user_id, stage, tries) VALUES(?, ?, 1) ON CONFLICT(user_id, stage) DO UPDATE SET tries=tries+1').bind(h.user_id, stage).run()
  const row = (await db.prepare('SELECT * FROM dou_battles WHERE id=?').bind(id).first<BattleRow>())!
  return advance(db, row, null, t)
}

const parseSnap = (row: BattleRow) => JSON.parse(row.snap) as Snap
const picksOf = (row: BattleRow) => { try { const p = JSON.parse(row.picks); return Array.isArray(p) ? p.map((x) => Math.max(0, Math.min(2, x | 0))) : [] } catch { return [] } }

// 甲方选卡 n（第几次三选一）选了 pick
export async function pickCard(db: DB, uid: number, id: string, n: number, pick: number, t: number) {
  const row = await db.prepare('SELECT * FROM dou_battles WHERE id=? AND attacker=?').bind(id, uid).first<BattleRow>() ?? no(404, '没有这场对战')
  if (row!.status !== 'pending') no(409, '这场已经打完了')
  const picks = picksOf(row!)
  if (n !== picks.length) no(409, '这一手已经选过了')
  if (!Number.isInteger(pick) || pick < -1 || pick > 2) no(400, '选择无效')
  // -1：限时到了，按推荐选
  if (pick === -1) { const snap = parseSnap(row!); pick = simulate({ a: snap.a, b: snap.b, seed: row!.seed, picks }).pending?.auto ?? 0 }
  const next = [...picks, pick]
  const r = await db.prepare('UPDATE dou_battles SET picks=?, updated_at=? WHERE id=? AND picks=? AND status=\'pending\'').bind(JSON.stringify(next), t, id, row!.picks).run()
  if (!r.meta.changes) no(409, '这一手已经选过了')
  row!.picks = JSON.stringify(next)
  return advance(db, row!, n, t)
}

// 从种子重算。mark：刚选的是第几次三选一（开局为 null），只返回那之后的事件，前面的前端已经播过
async function advance(db: DB, row: BattleRow, mark: number | null, t: number, auto = false) {
  const snap = parseSnap(row), picks = picksOf(row)
  const sim = simulate({ a: snap.a, b: snap.b, seed: row.seed, picks, autoA: auto || row.kind === 'auto' })
  const from = mark !== null && sim.marks[mark] !== undefined ? sim.marks[mark] : 0
  let reward: Reward | null = null
  if (!sim.pending) reward = await finish(db, row, sim, t)
  return view(row, snap, sim, from, reward)
}
function view(row: BattleRow, snap: Snap, sim: SimResult, from: number, reward: Reward | null) {
  return { id: row.id, kind: row.kind, stage: row.stage?.startsWith('npc:') ? null : row.stage, scene: snap.scene, sides: snap.sides, from, events: sim.events.slice(from),
    pending: sim.pending, result: sim.pending ? null : { winner: sim.winner, reward } }
}

// 结算：先把状态从 pending 改成 done（条件更新保证只结算一次），再发奖励
async function finish(db: DB, row: BattleRow, sim: SimResult, t: number): Promise<Reward | null> {
  const win = sim.winner === 0, out: Reward = { exp: 0, items: [], achievements: [] }
  const r = await db.prepare("UPDATE dou_battles SET status='done', winner=?, updated_at=? WHERE id=? AND status='pending'").bind(sim.winner, t, row.id).run()
  if (!r.meta.changes) { const old = await db.prepare('SELECT reward FROM dou_battles WHERE id=?').bind(row.id).first<{ reward: string | null }>(); try { return old?.reward ? JSON.parse(old.reward) : null } catch { return null } }
  const uid = row.attacker, snap = parseSnap(row), foeLv = snap.sides[1].level
  if (row.kind === 'pve' && row.stage) {
    const s = STAGE_BY_ID.get(row.stage)!, boss = s.k === 4
    if (win) {
      const first = await db.prepare('UPDATE dou_progress SET wins=wins+1, first_at=COALESCE(first_at, ?) WHERE user_id=? AND stage=? RETURNING wins').bind(t, uid, s.id).first<{ wins: number }>()
      const isFirst = first?.wins === 1
      await addExp(db, uid, Math.round((20 + 6 * s.level) * (boss ? 3 : 1) * (isFirst ? 1.5 : 1)), t, out)
      if (isFirst && !boss) { const card = s.ch.firstCards[s.k - 1]; if (card && await grantItem(db, uid, card, 'card', t)) out.items.push(card) }
      if (isFirst && boss) {
        if (await grantItem(db, uid, s.ch.weapon, 'weapon', t)) out.items.push(s.ch.weapon)
        await grantAch(db, uid, `boss${s.ch.n}`, t, out)
        const vol = { 3: 'vol1', 6: 'vol2', 9: 'vol3', 13: 'vol4', 15: 'hidden' }[s.ch.n]
        if (vol) await grantAch(db, uid, vol, t, out)
      }
    } else await addExp(db, uid, 5 + s.level, t, out)
  } else if (row.kind === 'pvp') {
    const npc = !row.defender
    const gain = win ? Math.round((25 + 4 * foeLv) * (npc ? 0.7 : 1)) : 8 + foeLv
    out.points = win ? 12 : -4
    await db.prepare('UPDATE dou_heroes SET pvp_points=MAX(0, pvp_points+?), pvp_wins=pvp_wins+?, pvp_losses=pvp_losses+?, updated_at=? WHERE user_id=?').bind(out.points, win ? 1 : 0, win ? 0 : 1, t, uid).run()
    await addExp(db, uid, gain, t, out)
    if (win) {
      const w = await db.prepare('SELECT pvp_wins FROM dou_heroes WHERE user_id=?').bind(uid).first<{ pvp_wins: number }>()
      await grantAch(db, uid, 'pvp1', t, out)
      if ((w?.pvp_wins ?? 0) >= 10) await grantAch(db, uid, 'pvp10', t, out)
    }
  } else if (row.kind === 'board' || row.kind === 'auto') {
    if (win && row.defender && await swapRanks(db, uid, row.defender)) {
      const me = await boardRow(db, uid)
      out.rank = me?.rank
      if (me?.rank === 1) await grantAch(db, uid, 'board1', t, out)
    }
    if (row.kind === 'board') await addExp(db, uid, win ? 60 : 15, t, out)
  }
  await db.prepare('UPDATE dou_battles SET reward=? WHERE id=?').bind(JSON.stringify(out), row.id).run()
  return out
}

// 进行中、超过 15 分钟没人选卡的战斗（或开新战斗时还没打完的），按推荐自动打完
export async function settleStale(db: DB, uid: number, t: number, all = false) {
  const rows = (await db.prepare("SELECT * FROM dou_battles WHERE attacker=? AND status='pending' AND (? OR updated_at<?) LIMIT 5").bind(uid, all ? 1 : 0, t - PENDING_TTL).all<BattleRow>()).results
  for (const row of rows) await advance(db, row, null, t, true)
}

// 重放：只给参战双方看
export async function replay(db: DB, uid: number, id: string) {
  const row = await db.prepare('SELECT * FROM dou_battles WHERE id=?').bind(id).first<BattleRow>()
  if (!row || (row.attacker !== uid && row.defender !== uid)) no(404, '没有这场对战')
  if (row!.status !== 'done') {
    if (row!.attacker !== uid) no(404, '没有这场对战')
    const snap = parseSnap(row!), sim = simulate({ a: snap.a, b: snap.b, seed: row!.seed, picks: picksOf(row!) })
    return view(row!, snap, sim, 0, null)
  }
  const snap = parseSnap(row!), sim = simulate({ a: snap.a, b: snap.b, seed: row!.seed, picks: picksOf(row!), autoA: true })
  let reward: Reward | null = null
  try { reward = row!.attacker === uid && row!.reward ? JSON.parse(row!.reward) : null } catch {}
  return view(row!, snap, sim, 0, reward)
}
export async function reports(db: DB, uid: number) {
  const rows = (await db.prepare("SELECT id, kind, attacker, defender, stage, snap, winner, created_at FROM dou_battles WHERE status='done' AND (attacker=? OR defender=?) ORDER BY created_at DESC LIMIT 30").bind(uid, uid)
    .all<{ id: string; kind: string; attacker: number; defender: number | null; stage: string | null; snap: string; winner: number; created_at: number }>()).results
  return rows.map((r) => {
    const s = JSON.parse(r.snap) as Snap, mine = r.attacker === uid
    return { id: r.id, kind: r.kind, stage: r.stage?.startsWith('npc:') ? null : r.stage, created_at: r.created_at, attacking: mine, won: mine ? r.winner === 0 : r.winner === 1, other: mine ? s.sides[1] : s.sides[0] }
  })
}

// ---------- 武林大会托管（每天的定时任务调用，限量） ----------
export async function runDouAuto(db: DB, t: number, limit = 60) {
  const today = bjDay(t)
  const rows = (await db.prepare('SELECT b.user_id FROM dou_board b JOIN dou_heroes d ON d.user_id=b.user_id WHERE d.active=1 AND b.rank>1 AND (b.auto_day IS NULL OR b.auto_day<>?) ORDER BY b.rank LIMIT ?').bind(today, Math.ceil(limit / DAILY.auto)).all<{ user_id: number }>()).results
  let fought = 0
  for (const { user_id } of rows) {
    await db.prepare('UPDATE dou_board SET auto_day=? WHERE user_id=?').bind(today, user_id).run()
    const h = await loadHero(db, user_id)
    if (!h || dailyOf(h, t).board > 0) continue // 今天自己打过的人不托管
    for (let k = 0; k < DAILY.auto && fought < limit; k++) {
      const me = await boardRow(db, user_id)
      if (!me || me.rank <= 1) break
      const above = await db.prepare('SELECT user_id FROM dou_board WHERE rank<? ORDER BY rank DESC LIMIT 1').bind(me.rank).first<{ user_id: number }>()
      const other = above ? await loadHero(db, above.user_id) : null
      if (!other?.active) break
      const a = await heroSide(db, h), b = await heroSide(db, other)
      const snap: Snap = { a: a.f, b: b.f, sides: [a.meta, b.meta], scene: 'board' }, id = randHex(12)
      await db.prepare("INSERT INTO dou_battles(id, kind, attacker, defender, seed, snap, created_at, updated_at) VALUES(?, 'auto', ?, ?, ?, ?, ?, ?)").bind(id, user_id, other.user_id, randHex(16), JSON.stringify(snap), t, t).run()
      const row = (await db.prepare('SELECT * FROM dou_battles WHERE id=?').bind(id).first<BattleRow>())!
      const r = await advance(db, row, null, t, true)
      fought++
      if (r.result?.winner !== 0) break
    }
    if (fought >= limit) break
  }
  await db.prepare('DELETE FROM dou_battles WHERE id IN (SELECT id FROM dou_battles WHERE created_at<? LIMIT 500)').bind(t - BATTLE_KEEP_DAYS * 86400).run()
  return fought
}

export { CHAPTERS }
