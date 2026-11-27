// 「斗」战斗模拟：纯函数，不碰数据库。
// 结果只由「种子 + 双方快照 + 甲方的选卡」决定：同样的输入永远得到同样的逐帧事件，可以重放、防作弊。
// 甲方（发起者，下标 0）遇到三选一时先用 picks 里的选择，用完了：autoA 时按固定规则自动选，否则停下来等玩家选；乙方（下标 1）总是自动选。
import {
  BASE_SKILLS, CARD_BY_ID, CHAPTERS, DEFAULT_EXCLUSIVE, EXCLUSIVE_UNLOCK, MAX_ACTIONS, PASSIVES, PASSIVE_BY_KEY, PICK_ACTION,
  SKILL_LIMITS, STAGE_BY_ID, ROLE_BY_KEY, OLD_WEAPON_IDS, STARTER_CARDS, WEAPON_BY_ID, WEAPON_KINDS, WEAPON_SKILLS, baseStats,
  type Card, type Passive, type Skill, type Stats, type WeaponKind,
} from './dou-data'

// ---------- 随机数 ----------
export function hashSeed(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
export function rng(seed: string) {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- 参战者快照 ----------
export type Look = { uid?: number; boss?: boolean; outfit?: Record<string, string>; sheet?: string; hue?: number; role?: string; foe?: string }
export type Fighter = { name: string; level: number; stats: Stats; skills: Skill[]; passive: Passive | null; deck: string[]; kind: WeaponKind | null; weapon: string | null; look: Look }

const clampLevel = (l: number) => Math.max(1, Math.min(52, Math.floor(Number(l) || 1)))
function applyPassive(st: Stats, p: Passive | null): Stats {
  const s = { ...st }
  if (!p?.stat) return s
  for (const [k, v] of Object.entries(p.stat) as [keyof Stats, number][]) {
    if (k === 'crit' || k === 'dodge' || k === 'tough') s[k] += v
    else s[k] = Math.round(s[k] * (1 + v))
  }
  return s
}
// 站长给角色单独配的技能：只保留合法字段，数值夹到上限内
export function sanitizeSkill(raw: any, id: string): Skill | null {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return null
  const num = (v: unknown, max: number, min = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined }
  const r = SKILL_LIMITS.ratio
  const sk: Skill = { id, name: raw.name.trim().slice(0, 12), power: num(raw.power, SKILL_LIMITS.power) ?? 1, cost: Math.round(num(raw.cost, SKILL_LIMITS.cost) ?? 30), cd: Math.round(num(raw.cd, SKILL_LIMITS.cd) ?? 3) }
  const hits = num(raw.hits, SKILL_LIMITS.hits, 1); if (hits) sk.hits = Math.round(hits)
  for (const k of ['acc', 'critUp', 'pierce', 'stun', 'bleed', 'heal', 'shield', 'drain'] as const) { const v = num(raw[k], r); if (v) sk[k] = v }
  const mp = num(raw.mp, 60); if (mp) sk.mp = mp
  const stat = (o: any, ok: string[]) => o && ok.includes(o.stat) ? { stat: o.stat, v: num(o.v, r, -r) ?? 0, turns: Math.round(num(o.turns, 5, 1) ?? 2) } : undefined
  const b = stat(raw.buff, ['atk', 'def', 'spd', 'crit', 'dodge']); if (b) sk.buff = b as Skill['buff']
  const d = stat(raw.debuff, ['atk', 'def', 'spd']); if (d) sk.debuff = { ...d, v: -Math.abs(d.v) } as Skill['debuff']
  if (typeof raw.anim === 'string' && /^[a-z]{2,10}$/.test(raw.anim)) sk.anim = raw.anim
  return sk
}
// 角色配置（dou_roles.config）：{ passive?: 'wind'|…, skills?: [Skill×3], look?: {...} }
export type RoleConfig = { passive?: string; skills?: unknown[]; sheet?: string; hue?: number }
export const defaultPassiveKey = (uid: number) => PASSIVES[Math.abs(uid) % 7].key
// 被动：站长单独配置 > 所选主角 > 按编号的默认套路
export function rolePassive(uid: number, cfg: RoleConfig | null | undefined, role?: string | null) {
  return PASSIVE_BY_KEY.get(cfg?.passive || '') ?? PASSIVE_BY_KEY.get(ROLE_BY_KEY.get(role || '')?.passive || '') ?? PASSIVE_BY_KEY.get(defaultPassiveKey(uid))!
}
// 专属招：站长单独配置 > 所选主角 > 按被动的默认套路
export function roleExclusive(uid: number, cfg: RoleConfig | null | undefined, role?: string | null): Skill[] {
  const custom = Array.isArray(cfg?.skills) ? cfg!.skills.slice(0, 3).map((s, i) => sanitizeSkill(s, `u${uid}_${i}`)) : []
  const def = ROLE_BY_KEY.get(role || '')?.skills ?? DEFAULT_EXCLUSIVE[rolePassive(uid, cfg, role).key]
  return [0, 1, 2].map((i) => custom[i] ?? def[i])
}

export type HeroRow = { user_id: number; level: number; weapon: string | null; deck: string; outfit: string; role?: string | null }
// 武器招式加上这把武器自带的效果（武器特点）
export function weaponSkills(w: { kind: WeaponKind; mod?: Partial<Skill> } | null): Skill[] {
  if (!w) return []
  return WEAPON_SKILLS[w.kind].map((sk) => {
    if (!w.mod || !(sk.power > 0)) return sk
    const m = w.mod, out: Skill = { ...sk }
    if (m.power) out.power = +(sk.power + m.power).toFixed(2)
    if (m.hits) out.hits = (sk.hits ?? 1) + m.hits
    for (const k of ['acc', 'critUp', 'pierce', 'stun'] as const) if (m[k]) out[k] = +((sk[k] ?? 0) + m[k]!).toFixed(2)
    if (m.debuff && !sk.debuff) out.debuff = { ...m.debuff }
    return out
  })
}
export function heroFighter(h: HeroRow, name: string, cfg: RoleConfig | null | undefined): Fighter {
  const level = clampLevel(h.level), passive = rolePassive(h.user_id, cfg, h.role)
  const wid = h.weapon ? OLD_WEAPON_IDS[h.weapon] ?? h.weapon : null
  const w = wid ? WEAPON_BY_ID.get(wid) ?? null : null
  const st = baseStats(level)
  if (w) { st.atk += w.atk; st.spd += w.spd ?? 0; st.def += w.def ?? 0; st.hp += w.hp ?? 0; st.crit += w.crit ?? 0; st.dodge += w.dodge ?? 0 }
  const ex = roleExclusive(h.user_id, cfg, h.role).filter((_, i) => level >= EXCLUSIVE_UNLOCK[i])
  let deck: string[] = [], outfit: Record<string, string> = {}
  try { deck = (JSON.parse(h.deck) as string[]).filter((id) => CARD_BY_ID.has(id)) } catch {}
  try { outfit = JSON.parse(h.outfit) || {} } catch {}
  return { name, level, stats: applyPassive(st, passive), skills: [...BASE_SKILLS, ...weaponSkills(w), ...ex], passive, deck, kind: w?.kind ?? null, weapon: w?.id ?? null,
    look: { uid: h.user_id, outfit, sheet: cfg?.sheet, hue: cfg?.hue, role: ROLE_BY_KEY.has(h.role || '') ? h.role! : 'deepseek' } }
}
// 关卡对手
export function stageFighter(stageId: string): Fighter | null {
  const s = STAGE_BY_ID.get(stageId)
  if (!s) return null
  const st = baseStats(s.level)
  if (s.k === 4) {
    const b = s.ch.boss
    st.hp = Math.round(st.hp * b.hpMul); st.atk = Math.round(st.atk * b.atkMul)
    const passive = PASSIVE_BY_KEY.get(b.passive || '') ?? null
    return { name: b.name, level: s.level, stats: applyPassive(st, passive), skills: [...BASE_SKILLS, ...WEAPON_SKILLS[b.kind].slice(0, 1), ...b.skills], passive, deck: b.cards, kind: b.kind, weapon: null, look: { boss: true, hue: s.ch.n * 27, foe: `b${s.ch.n}` } }
  }
  const [name, kind] = s.ch.mooks[s.k - 1]
  st.hp = Math.round(st.hp * (0.95 + 0.08 * s.k)); st.atk = Math.round(st.atk * (0.88 + 0.06 * s.k))
  return { name, level: s.level, stats: st, skills: [...BASE_SKILLS, ...WEAPON_SKILLS[kind].slice(0, s.level >= 8 ? 2 : 1)], passive: null, deck: [], kind, weapon: null, look: { hue: (s.ch.n * 27 + s.k * 90) % 360, foe: `m${s.ch.n}_${s.k}` } }
}
// 对手不够时补的「江湖散人」：按种子生成，和真人一样有被动、武器和卡组
export const NPC_NAMES = ['过路刀客', '卖艺少年', '游方郎中', '落第书生', '赶考的秀才', '走镖的姑娘', '算命先生', '江湖骗子', '采药老翁', '流浪剑客']
export function npcFighter(level: number, seed: string): Fighter {
  const r = rng('npc|' + seed), pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]
  const lv = clampLevel(level), kind = pick(WEAPON_KINDS), passive = pick(PASSIVES)
  const st = applyPassive(baseStats(lv), passive)
  st.atk += 3 + Math.floor(lv * 0.55); st.hp = Math.round(st.hp * 0.95)
  const pool = [...STARTER_CARDS]
  for (let k = pool.length - 1; k > 0; k--) { const m = Math.floor(r() * (k + 1)); [pool[k], pool[m]] = [pool[m], pool[k]] }
  const deck = pool.slice(0, Math.min(8, 3 + Math.floor((lv - 1) / 8)))
  const ex = DEFAULT_EXCLUSIVE[passive.key].filter((_, i) => lv >= EXCLUSIVE_UNLOCK[i])
  return { name: pick(NPC_NAMES), level: lv, stats: st, skills: [...BASE_SKILLS, ...WEAPON_SKILLS[kind], ...ex], passive, deck, kind, weapon: null, look: { hue: Math.floor(r() * 360), role: r() < 0.5 ? 'deepseek' : 'doubao' } }
}

// ---------- 模拟 ----------
type Buff = { stat: string; v: number; turns: number }
type Side = {
  f: Fighter; hp: number; max: number; mp: number; gauge: number; cd: Record<string, number>; buffs: Buff[]; shield: number
  bleed: { per: number; turns: number } | null; stunned: boolean; immune: number; reflect: { v: number; turns: number } | null
  lastStand: number; nextStrong: boolean; dodgeCrit: boolean; remaining: string[]; fired: Set<string>; acts: number
}
export type Ev = Record<string, unknown> & { k: string }
export type SimInput = { a: Fighter; b: Fighter; seed: string; picks: number[]; autoA?: boolean }
export type SimResult = { events: Ev[]; pending: { trigger: string; offer: string[]; n: number; auto: number } | null; winner: 0 | 1 | null; actions: number; hp: [number, number]; marks: number[] }

const BUFF_CAP = 0.8
function buffSum(s: Side, stat: string) { let v = 0; for (const b of s.buffs) if (b.stat === stat) v += b.v; return Math.max(-BUFF_CAP, Math.min(BUFF_CAP, v)) }
function eff(s: Side, stat: 'atk' | 'def' | 'spd') {
  let v = s.f.stats[stat] * (1 + buffSum(s, stat))
  if (stat === 'atk' && s.f.passive?.rage) v *= 1 + s.f.passive.rage * Math.floor((1 - s.hp / s.max) * 10)
  return Math.max(1, v)
}
const pct = (s: Side) => s.hp / s.max
const costOf = (s: Side, sk: Skill) => Math.round(sk.cost * (s.f.passive?.costMul ?? 1))

// 乙方（以及托管的甲方）怎么选卡：按当前局面给每张卡打分，取最高；同分取靠前的
export function autoPick(offer: string[], me: { hp: number; max: number; mp: number }, foe: { hp: number; max: number }): number {
  let best = 0, bestScore = -Infinity
  offer.forEach((id, i) => {
    const c = CARD_BY_ID.get(id)
    if (!c) return
    const low = me.hp / me.max, foeLow = foe.hp / foe.max
    let s = c.rarity * 3
    if (c.heal) s += (low < 0.5 ? 90 : 10) * c.heal * 2
    if (c.lastStand) s += low > 0.4 ? 22 : 4
    if (c.shield) s += (low < 0.6 ? 45 : 20) * c.shield * 2
    if (c.dmg) s += 30 * c.dmg + (foeLow < 0.3 ? 40 : 0)
    if (c.mp) s += me.mp < 40 ? 25 : 5
    if (c.nextSkill) s += 28
    if (c.bleed) s += foeLow > 0.4 ? 30 : 10
    if (c.reflect) s += 20
    if (c.immune) s += 14
    if (c.gauge) s += 16
    for (const b of c.buffs ?? []) s += b.v * b.turns * 18
    if (c.debuff) s += -c.debuff.v * c.debuff.turns * 16
    if (s > bestScore) { bestScore = s; best = i }
  })
  return best
}

export function simulate(input: SimInput): SimResult {
  const R = rng(input.seed), events: Ev[] = [], marks: number[] = []
  const mk = (f: Fighter): Side => ({ f, hp: f.stats.hp, max: f.stats.hp, mp: 30, gauge: f.passive?.firstStrike ? 500 : 0, cd: {}, buffs: [], shield: 0, bleed: null, stunned: false, immune: 0, reflect: null, lastStand: 0, nextStrong: false, dodgeCrit: false, remaining: [...f.deck], fired: new Set(), acts: 0 })
  const S: [Side, Side] = [mk(input.a), mk(input.b)]
  let picksUsed = 0, actions = 0, winner: 0 | 1 | null = null, pending: SimResult['pending'] = null
  const dead = () => S[0].hp <= 0 || S[1].hp <= 0
  const setHp = (i: number, hp: number) => { S[i].hp = Math.max(0, Math.min(S[i].max, Math.round(hp))) }
  const heal = (i: number, v: number) => { if (v <= 0 || S[i].hp <= 0) return; const before = S[i].hp; setHp(i, S[i].hp + v); if (S[i].hp > before) events.push({ k: 'heal', s: i, v: S[i].hp - before, hp: S[i].hp }) }
  const afterHurt = (i: number) => {
    const s = S[i]
    if (s.hp > 0 && s.lastStand && pct(s) < 0.3) { const v = s.lastStand; s.lastStand = 0; events.push({ k: 'trigger', s: i, what: 'lastStand' }); heal(i, s.max * v) }
  }
  // 受到伤害（护体先吸收）；返回实际掉的血
  const hurt = (i: number, dmg: number, from: number | null) => {
    const s = S[i]
    let d = Math.max(1, Math.round(dmg)), absorbed = 0
    if (s.shield > 0) { absorbed = Math.min(s.shield, d); s.shield -= absorbed; d -= absorbed }
    setHp(i, s.hp - d)
    return { d, absorbed }
  }
  const reflectBack = (i: number, taken: number) => {
    const s = S[i], j = 1 - i
    const ratio = (s.f.passive?.thorns ?? 0) + (s.reflect ? s.reflect.v : 0)
    if (ratio > 0 && taken > 0 && S[j].hp > 0) { const v = Math.max(1, Math.round(taken * ratio)); setHp(j, S[j].hp - v); events.push({ k: 'reflect', s: j, d: v, hp: S[j].hp }); afterHurt(j) }
  }
  const applyCard = (i: number, id: string) => {
    const c = CARD_BY_ID.get(id) as Card, me = S[i], j = 1 - i, foe = S[j]
    events.push({ k: 'card', s: i, id })
    for (const b of c.buffs ?? []) me.buffs.push({ ...b })
    if (c.debuff) foe.buffs.push({ ...c.debuff })
    if (c.cleanse) { me.buffs = me.buffs.filter((b) => b.v > 0); me.bleed = null; me.stunned = false }
    if (c.heal) heal(i, me.max * c.heal)
    if (c.shield) { me.shield += Math.round(me.max * c.shield); events.push({ k: 'shield', s: i, v: me.shield }) }
    if (c.mp) me.mp = Math.min(100, me.mp + c.mp)
    if (c.immune) me.immune = Math.max(me.immune, c.immune)
    if (c.lastStand) me.lastStand = Math.max(me.lastStand, c.lastStand)
    if (c.nextSkill) me.nextStrong = true
    if (c.reflect) me.reflect = { v: c.reflect, turns: 4 }
    if (c.gauge) me.gauge = Math.max(me.gauge, 1000 * c.gauge)
    if (c.bleed) foe.bleed = { per: eff(me, 'atk') * c.bleed, turns: 3 }
    if (c.dmg && foe.hp > 0) {
      const d = eff(me, 'atk') * c.dmg * 100 / (100 + eff(foe, 'def'))
      const r = hurt(j, d, i); events.push({ k: 'hit', s: j, d: r.d, sh: r.absorbed, hp: foe.hp, card: 1 }); afterHurt(j)
    }
  }
  // 三选一。甲方没有现成选择、又不是托管 → 停下来
  const trigger = (i: number, t: string): boolean => {
    const me = S[i]
    if (me.fired.has(t) || me.hp <= 0) return false
    me.fired.add(t)
    if (!me.remaining.length) return false
    const pool = [...me.remaining]
    for (let k = pool.length - 1; k > 0; k--) { const m = Math.floor(R() * (k + 1)); [pool[k], pool[m]] = [pool[m], pool[k]] }
    const offer = pool.slice(0, 3)
    let idx: number
    if (i === 0) {
      marks.push(events.length)
      if (picksUsed < input.picks.length) {
        idx = Math.max(0, Math.min(offer.length - 1, Math.floor(input.picks[picksUsed] || 0)))
        picksUsed++
        events.push({ k: 'offer', s: 0, ids: offer, t, pick: idx })
      } else if (input.autoA) {
        idx = autoPick(offer, me, S[1])
        events.push({ k: 'offer', s: 0, ids: offer, t, pick: idx, auto: 1 })
      } else { pending = { trigger: t, offer, n: picksUsed, auto: autoPick(offer, me, S[1]) }; return true }
    } else idx = autoPick(offer, me, S[0])
    me.remaining = me.remaining.filter((x) => x !== offer[idx])
    applyCard(i, offer[idx])
    return false
  }
  const checkTriggers = (): boolean => {
    for (const i of [0, 1]) {
      if (trigger(i, 'start')) return true
      if (dead()) return false
      if (pct(S[i]) < 0.5 && trigger(i, 'half')) return true
      if (dead()) return false
      if (actions >= PICK_ACTION && trigger(i, 'turn20')) return true
      if (dead()) return false
    }
    return false
  }
  const chooseSkill = (me: Side): Skill => {
    const ready = me.f.skills.filter((s) => !(me.cd[s.id] > 0) && costOf(me, s) <= me.mp)
    if (me.nextStrong) {
      me.nextStrong = false
      const top = me.f.skills.filter((s) => s.power > 0).sort((x, y) => y.power - x.power)[0]
      if (top) return { ...top, cost: 0 }
    }
    const low = pct(me)
    const healer = ready.filter((s) => s.heal).sort((x, y) => (y.heal ?? 0) - (x.heal ?? 0))[0]
    if (low < 0.4 && healer) return healer
    const guard = ready.filter((s) => s.shield && !s.power).sort((x, y) => (y.shield ?? 0) - (x.shield ?? 0))[0]
    if (low < 0.55 && me.shield <= 0 && guard) return guard
    const breath = ready.find((s) => s.mp)
    if (me.mp < 25 && breath) return breath
    const attack = ready.filter((s) => s.power > 0).sort((x, y) => y.power - x.power || y.cost - x.cost)[0]
    return attack ?? me.f.skills[0]
  }
  const act = (i: number) => {
    const me = S[i], j = 1 - i, foe = S[j]
    me.acts++; actions++
    // 出手前：流血、回春
    if (me.bleed) { const v = Math.max(1, Math.round(me.bleed.per)); setHp(i, me.hp - v); events.push({ k: 'bleed', s: i, d: v, hp: me.hp }); if (--me.bleed.turns <= 0) me.bleed = null; afterHurt(i); if (dead()) return }
    if (me.f.passive?.regen) heal(i, me.max * me.f.passive.regen)
    if (me.stunned) { me.stunned = false; events.push({ k: 'skip', s: i }) }
    else {
      const sk = chooseSkill(me)
      me.mp = Math.max(0, Math.min(100, me.mp - costOf(me, sk) + 8))
      if (sk.cd) me.cd[sk.id] = sk.cd + 1
      events.push({ k: 'act', s: i, sk: sk.id, n: sk.name, a: sk.anim ?? 'slash', ...(sk.power >= 2.4 || sk.cost >= 60 ? { big: 1 } : {}) }) // big：大招，前端放演出
      if (sk.mp) me.mp = Math.min(100, me.mp + sk.mp)
      if (sk.shield) { me.shield += Math.round(me.max * sk.shield); events.push({ k: 'shield', s: i, v: me.shield }) }
      if (sk.heal) heal(i, me.max * sk.heal)
      if (sk.buff) { me.buffs.push({ ...sk.buff, turns: sk.buff.turns + 1 }); events.push({ k: 'buff', s: i, stat: sk.buff.stat, v: sk.buff.v }) }
      if (sk.power > 0) {
        const dodge = Math.max(0, Math.min(0.5, foe.f.stats.dodge + buffSum(foe, 'dodge') - (sk.acc ?? 0)))
        if (R() < dodge) {
          events.push({ k: 'miss', s: j })
          if (foe.f.passive?.dodgeCrit) foe.dodgeCrit = true
        } else {
          const hits = sk.hits ?? 1, forced = me.dodgeCrit
          me.dodgeCrit = false
          let landed = 0, dealt = 0
          for (let h = 0; h < hits && foe.hp > 0; h++) {
            const def = eff(foe, 'def') * (1 - (sk.pierce ?? 0))
            let d = eff(me, 'atk') * (sk.power / hits) * 100 / (100 + def) * (0.92 + 0.16 * R())
            const critP = Math.max(0, Math.min(0.75, me.f.stats.crit + (sk.critUp ?? 0) + buffSum(me, 'crit') - foe.f.stats.tough))
            const crit = forced && h === 0 ? true : R() < critP
            if (crit) d *= 1.6
            const r = hurt(j, d, i)
            landed++; dealt += r.d
            events.push({ k: 'hit', s: j, d: r.d, sh: r.absorbed, hp: foe.hp, c: crit ? 1 : 0, h })
            afterHurt(j)
          }
          if (dealt) reflectBack(j, dealt)
          if (sk.drain && dealt) heal(i, dealt * sk.drain)
          if (landed && foe.hp > 0) {
            if (sk.bleed) { foe.bleed = { per: eff(me, 'atk') * sk.bleed, turns: 3 }; events.push({ k: 'bleedOn', s: j }) }
            if (sk.debuff) { foe.buffs.push({ ...sk.debuff }); events.push({ k: 'debuff', s: j, stat: sk.debuff.stat, v: sk.debuff.v }) }
            if (sk.stun) {
              if (foe.immune > 0) events.push({ k: 'resist', s: j })
              else if (R() < Math.max(0, sk.stun - foe.f.stats.tough)) { foe.stunned = true; events.push({ k: 'stun', s: j }) }
            }
          }
        }
      }
    }
    // 出手后：冷却、增益回合
    for (const k of Object.keys(me.cd)) if (me.cd[k] > 0) me.cd[k]--
    me.buffs = me.buffs.filter((b) => --b.turns > 0)
    if (me.immune > 0) me.immune--
    if (me.reflect && --me.reflect.turns <= 0) me.reflect = null
  }

  events.push({ k: 'start', hp: [S[0].hp, S[1].hp], max: [S[0].max, S[1].max] })
  while (true) {
    if (checkTriggers()) break
    if (dead()) break
    if (actions >= MAX_ACTIONS) break
    // 行动条：谁先涨满谁出手；同时满的话速度快的先，再相同甲方先
    const sp = [eff(S[0], 'spd'), eff(S[1], 'spd')]
    const need = [(1000 - S[0].gauge) / sp[0], (1000 - S[1].gauge) / sp[1]]
    const i = need[0] < need[1] || (need[0] === need[1] && sp[0] >= sp[1]) ? 0 : 1
    const t = Math.max(0, need[i])
    S[0].gauge += sp[0] * t; S[1].gauge += sp[1] * t
    S[i].gauge = 0
    act(i)
    if (dead()) break
  }
  if (!pending) {
    if (S[0].hp <= 0 && S[1].hp <= 0) winner = 1
    else if (S[1].hp <= 0) winner = 0
    else if (S[0].hp <= 0) winner = 1
    else winner = pct(S[0]) > pct(S[1]) ? 0 : 1 // 打满回合比剩余气血比例，相同算守方赢
    events.push({ k: 'end', w: winner, timeout: S[0].hp > 0 && S[1].hp > 0 ? 1 : 0 })
  }
  return { events, pending, winner, actions, hp: [S[0].hp, S[1].hp], marks }
}

// 关卡的章节信息（给前端画场景）
export const sceneOf = (stageId: string) => STAGE_BY_ID.get(stageId)?.ch.scene ?? 'arena'
export { CHAPTERS }
