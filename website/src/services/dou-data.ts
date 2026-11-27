// 「斗 · 大模型江湖」的全部静态数据：属性成长、主角、技能、武器、被动、策略卡、关卡、装扮、成就。
// 所有角色是原创同人形象（不用官方 logo / 吉祥物）；真人二创只用外号、漫画化、不丑化。改数值只改这里；
// 战斗模拟在 dou-battle.ts，接口在 routes/dou.ts，画面在 public/dou-stage.js（anim 字段决定画面上的招式表现）。

export const MAX_LEVEL = 52
// 升到下一级需要的经验（level 级 → level+1 级）
export const expToNext = (level: number) => level >= MAX_LEVEL ? 0 : Math.round(60 + 18 * level + 1.5 * level * level)

export type Stats = { hp: number; atk: number; def: number; spd: number; crit: number; dodge: number; tough: number }
export const baseStats = (level: number): Stats => {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1
  return { hp: 300 + 22 * l, atk: 40 + 4 * l, def: 16 + 1.2 * l, spd: 100 + l, crit: 0.08, dodge: 0.05, tough: 0.05 }
}

// ---------- 技能 ----------
// power：攻击倍率（0 = 不造成伤害）；cost：内力；cd：冷却（自己的出手次数）；hits：段数（每段 power/hits）
export type Skill = {
  id: string; name: string; power: number; cost: number; cd: number; hits?: number
  acc?: number          // 命中加成（减对方闪避）
  critUp?: number       // 本招暴击率加成
  pierce?: number       // 无视防御比例 0–1
  stun?: number         // 定身概率（对方跳过下一次出手）
  bleed?: number        // 流血：每回合按攻击的这个比例掉血，持续 3 次出手
  heal?: number         // 回复自己最大气血的比例
  shield?: number       // 护体：吸收最大气血这个比例的伤害
  mp?: number           // 回复内力
  drain?: number        // 吸血：造成伤害的这个比例回血
  buff?: { stat: 'atk' | 'def' | 'spd' | 'crit' | 'dodge'; v: number; turns: number }
  debuff?: { stat: 'atk' | 'def' | 'spd'; v: number; turns: number }
  anim?: string         // 前端动画键，见 public/dou-stage.js（没有专属画面的按武器类别兜底）
}

const S = (id: string, name: string, power: number, cost: number, cd: number, extra: Partial<Skill> = {}): Skill => ({ id, name, power, cost, cd, ...extra })

// 人人都有的基础技能
export const BASE_SKILLS: Skill[] = [
  S('basic', '平A', 1, 0, 0, { anim: 'basic' }),
  S('breath', '清缓存', 0, 0, 4, { mp: 45, anim: 'qi' }),
  S('guard', '防火墙', 0, 0, 5, { shield: 0.16, anim: 'firewall' }),
  S('sweep', '扫堂腿', 1.35, 20, 2, { anim: 'sweep' }),
]
// 通用武器：7 类，每类 2 招，随武器换。每类的打法和节奏都不同（见 docs/dou-art-prompts.md 4.1）
export const WEAPON_KINDS = ['sword', 'blade', 'spear', 'staff', 'fan', 'dart', 'fist'] as const
export type WeaponKind = typeof WEAPON_KINDS[number]
export const WEAPON_KIND_NAMES: Record<WeaponKind, string> = { sword: '剑', blade: '刀', spear: '枪', staff: '棍', fan: '扇', dart: '暗器', fist: '拳套' }
export const WEAPON_SKILLS: Record<WeaponKind, Skill[]> = {
  sword: [S('sw1', '剑花三连', 1.5, 25, 2, { hits: 3, acc: 0.1, critUp: 0.1, anim: 'slash3' }), S('sw2', '收剑·迟爆', 2.1, 45, 4, { pierce: 0.3, anim: 'sheath' })],
  blade: [S('bl1', '蓄力劈山', 1.9, 30, 3, { anim: 'cleave' }), S('bl2', '回旋斩', 1.9, 40, 4, { hits: 2, bleed: 0.12, anim: 'spin' })],
  spear: [S('sp1', '龙枪突刺', 1.6, 25, 2, { pierce: 0.25, anim: 'dragon' }), S('sp2', '枪雨', 1.7, 40, 4, { hits: 3, debuff: { stat: 'spd', v: -0.15, turns: 2 }, anim: 'spearrain' })],
  staff: [S('st1', '泰山压顶', 1.5, 30, 3, { stun: 0.25, anim: 'leapsmash' }), S('st2', '风车护体', 0.8, 30, 4, { shield: 0.14, anim: 'windmill' })],
  fan: [S('fa1', '清风刃', 1.3, 25, 2, { hits: 3, debuff: { stat: 'atk', v: -0.15, turns: 2 }, anim: 'windblade' }), S('fa2', '花瓣旋涡', 1.8, 40, 4, { critUp: 0.25, anim: 'vortex' })],
  dart: [S('da1', '漫天飞镖', 1.2, 20, 2, { hits: 3, acc: 0.15, anim: 'volley' }), S('da2', '钉身镖', 1.4, 35, 3, { bleed: 0.18, anim: 'pin' })],
  fist: [S('fi1', '破防拳', 1.6, 25, 2, { debuff: { stat: 'def', v: -0.15, turns: 2 }, anim: 'punch' }), S('fi2', '残影连拳·升龙', 2.0, 45, 4, { hits: 5, anim: 'combo' })],
}

// ---------- 武器 ----------
// mod：这把武器给本类武器招式附加的效果（武器的玩法特点）；fx：画面上的专属表现
export type Weapon = { id: string; name: string; kind: WeaponKind; atk: number; spd?: number; crit?: number; dodge?: number; def?: number; hp?: number; mod?: Partial<Skill>; fx: string; note: string; trait: string }
export const WEAPONS: Weapon[] = [
  { id: 'w_code_sword', name: '代码剑', kind: 'sword', atk: 4, fx: 'code', note: '新人入门送的，剑身刻着一行行代码', trait: '剑光里飘出括号碎片' },
  { id: 'w_selfie_staff', name: '自拍杆', kind: 'staff', atk: 6, def: 3, fx: 'flash', mod: { debuff: { stat: 'atk', v: -0.1, turns: 2 } }, note: '复读机精的战利品，顶上还夹着手机', trait: '砸地时闪光灯爆闪，对手被晃眼（攻击 −10%）' },
  { id: 'w_emoji_darts', name: '表情包飞镖', kind: 'dart', atk: 8, crit: 0.03, fx: 'emoji', note: '关键词机器人攒了一兜表情包', trait: '每次扔出的表情都不一样' },
  { id: 'w_keyboard_fist', name: '机械键盘拳套', kind: 'fist', atk: 11, def: 4, fx: 'keycap', mod: { hits: 1 }, note: '过拟合师兄熬夜刷题敲坏的键盘', trait: '每拳崩飞键帽，连拳多打一下' },
  { id: 'w_scroll_fan', name: '书卷扇', kind: 'fan', atk: 13, dodge: 0.03, fx: 'pages', note: '文心娘的扇子，扇面是一整卷古书', trait: '风里夹着飞舞的书页' },
  { id: 'w_brush_spear', name: '千问长枪', kind: 'spear', atk: 16, spd: 3, fx: 'question', mod: { acc: 0.1 }, note: '通义娘的枪，枪尖是个问号', trait: '枪尖留下问号光痕，更容易命中' },
  { id: 'w_taiji_fist', name: '混元拳套', kind: 'fist', atk: 18, def: 6, fx: 'taiji', note: '混元娘的云纹拳套', trait: '拳风带黑白太极漩涡' },
  { id: 'w_moon_darts', name: '月牙镖', kind: 'dart', atk: 20, crit: 0.04, fx: 'moon', note: 'Kimi 娘熬夜磨的月牙刃', trait: '飞镖走弧线回旋' },
  { id: 'w_light_sword', name: '清言光剑', kind: 'sword', atk: 23, spd: 4, fx: 'light', mod: { hits: 1 }, note: '智谱娘用公式凝成的光剑', trait: '剑光一分为多道，多打一段' },
  { id: 'w_wool_staff', name: '羊驼毛毡棍', kind: 'staff', atk: 25, def: 8, hp: 60, fx: 'wool', mod: { stun: 0.15 }, note: 'Llama 娘的毛毡棍，顶上是羊驼头', trait: '打中炸出毛绒，还会吐口水（定身 +15%）' },
  { id: 'w_rocket_fist', name: '火箭拳套', kind: 'fist', atk: 28, crit: 0.04, fx: 'rocket', mod: { critUp: 0.1 }, note: 'Grok 娘改装的火箭拳套', trait: '出拳带尾焰，暴击 +10%' },
  { id: 'w_twin_fans', name: '双子星扇', kind: 'fan', atk: 30, dodge: 0.04, fx: 'twin', note: 'Gemini 娘的一对星扇', trait: '蓝紫双色风刃交叉' },
  { id: 'w_cable_spear', name: '网线长枪', kind: 'spear', atk: 33, spd: 5, fx: 'cable', mod: { pierce: 0.1 }, note: 'GPT 娘兵器架上最长的一件', trait: '网线甩直成枪，破防 +10%' },
  { id: 'w_gpu_blade', name: '显卡大刀', kind: 'blade', atk: 37, spd: -4, crit: 0.04, fx: 'rgb', mod: { power: 0.2 }, note: 'Claude 娘镇在宪章峰上的一块大显卡', trait: '劈出彩虹月牙，风扇冒热气；慢但威力 +0.2 倍' },
  { id: 'w_whale_sword', name: '鲸落开源剑', kind: 'sword', atk: 40, crit: 0.05, fx: 'whale', note: '梁师父试炼后交给你的剑', trait: '大招时身后浮现鲸影' },
  { id: 'w_tariff_seal', name: '关税大印', kind: 'staff', atk: 40, def: 10, fx: 'seal', mod: { debuff: { stat: 'spd', v: -0.15, turns: 2 } }, note: '从关税大魔王手里抢来的金印', trait: '砸下去盖大红印、飘出单据（对手速度 −15%）' },
]
export const WEAPON_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]))
// 旧版武器编号 → 新编号（迁移 0211 已换掉库里的；这里兜底旧战斗快照）
export const OLD_WEAPON_IDS: Record<string, string> = {
  w_wood_sword: 'w_code_sword', w_kitchen_blade: 'w_selfie_staff', w_paper_fan: 'w_emoji_darts', w_broom_staff: 'w_keyboard_fist', w_ferry_spear: 'w_scroll_fan',
  w_night_darts: 'w_brush_spear', w_escort_fist: 'w_taiji_fist', w_dune_blade: 'w_moon_darts', w_frost_sword: 'w_light_sword', w_miasma_darts: 'w_wool_staff',
  w_river_spear: 'w_rocket_fist', w_cliff_staff: 'w_twin_fans', w_cloud_fan: 'w_cable_spear', w_peak_fist: 'w_gpu_blade',
}

// ---------- 被动与专属技能（按角色单独配置，没配置的用默认套路） ----------
export type Passive = {
  key: string; name: string; text: string
  stat?: Partial<Record<'hp' | 'atk' | 'def' | 'spd' | 'crit' | 'dodge' | 'tough', number>> // 比例加成（crit/dodge/tough 是加点数）
  regen?: number        // 每次出手回复最大气血比例
  rage?: number         // 气血每少 10%，攻击 +rage
  dodgeCrit?: boolean   // 闪避后下一击必暴
  firstStrike?: boolean // 开场行动条先涨一半
  thorns?: number       // 受到伤害按比例反弹
  costMul?: number      // 内力消耗倍率
}
export const PASSIVES: Passive[] = [
  { key: 'wind', name: '踏风', text: '速度 +10%，开场先蓄半条行动条', stat: { spd: 0.1 }, firstStrike: true },
  { key: 'iron', name: '铜皮', text: '防御 +15%，气血 +8%', stat: { def: 0.15, hp: 0.08 } },
  { key: 'edge', name: '锋芒', text: '暴击率 +10%', stat: { crit: 0.1 } },
  { key: 'cat', name: '猫步', text: '闪避 +6%，闪避后下一击必定暴击', stat: { dodge: 0.06 }, dodgeCrit: true },
  { key: 'spring', name: '回春', text: '每次出手回复 3% 气血', regen: 0.03 },
  { key: 'fury', name: '越战越勇', text: '气血每少 10%，攻击 +4%', rage: 0.04 },
  { key: 'thorn', name: '反骨', text: '受到伤害的 12% 反弹给对方', thorns: 0.12 },
  { key: 'cheap', name: '便宜大碗', text: '所有招式内力消耗 −30%', costMul: 0.7 },
]
export const PASSIVE_BY_KEY = new Map(PASSIVES.map((p) => [p.key, p]))
// 默认专属技能：按被动套路给 3 招（10 / 25 / 40 级解锁）
export const EXCLUSIVE_UNLOCK = [10, 25, 40]
export const DEFAULT_EXCLUSIVE: Record<string, Skill[]> = {
  wind: [S('x_wind1', '掠影', 1.7, 30, 3, { acc: 0.2, buff: { stat: 'spd', v: 0.15, turns: 3 }, anim: 'thrust' }), S('x_wind2', '风过无痕', 2.2, 45, 4, { hits: 3, acc: 0.2, anim: 'slash' }), S('x_wind3', '八方风雨', 3.0, 70, 6, { hits: 6, acc: 0.3, anim: 'slash' })],
  iron: [S('x_iron1', '铁山靠', 1.6, 30, 3, { stun: 0.3, anim: 'smash' }), S('x_iron2', '金钟罩', 0, 35, 5, { shield: 0.22, buff: { stat: 'def', v: 0.25, turns: 3 }, anim: 'guard' }), S('x_iron3', '移山', 2.8, 70, 6, { stun: 0.5, pierce: 0.3, anim: 'smash' })],
  edge: [S('x_edge1', '见血', 1.7, 30, 3, { critUp: 0.3, anim: 'slash' }), S('x_edge2', '一剑西来', 2.4, 50, 4, { critUp: 0.2, pierce: 0.4, anim: 'thrust' }), S('x_edge3', '天外流光', 3.2, 75, 6, { critUp: 0.5, anim: 'slash' })],
  cat: [S('x_cat1', '扑影', 1.5, 25, 2, { buff: { stat: 'dodge', v: 0.1, turns: 3 }, anim: 'kick' }), S('x_cat2', '九命', 0, 40, 6, { heal: 0.18, buff: { stat: 'dodge', v: 0.12, turns: 3 }, anim: 'heal' }), S('x_cat3', '月下抓痕', 2.6, 65, 5, { hits: 4, bleed: 0.15, anim: 'slash' })],
  spring: [S('x_spr1', '春水掌', 1.4, 25, 2, { drain: 0.4, anim: 'palm' }), S('x_spr2', '枯木逢春', 0, 45, 6, { heal: 0.25, anim: 'heal' }), S('x_spr3', '万物生', 2.4, 70, 6, { drain: 0.6, heal: 0.1, anim: 'qi' })],
  fury: [S('x_fury1', '怒拳', 1.8, 30, 3, { anim: 'palm' }), S('x_fury2', '破釜', 2.3, 45, 4, { buff: { stat: 'atk', v: 0.2, turns: 3 }, anim: 'smash' }), S('x_fury3', '背水一战', 3.3, 75, 6, { pierce: 0.3, drain: 0.3, anim: 'smash' })],
  thorn: [S('x_thorn1', '倒刺', 1.4, 25, 2, { bleed: 0.15, anim: 'thrust' }), S('x_thorn2', '荆棘甲', 0, 40, 5, { shield: 0.18, buff: { stat: 'def', v: 0.2, turns: 3 }, anim: 'guard' }), S('x_thorn3', '万箭归宗', 2.8, 70, 6, { hits: 5, bleed: 0.12, anim: 'throw' })],
}
// ---------- 主角（玩家开局选一个，以后可以换） ----------
export type Role = { key: string; name: string; nick: string; passive: string; skills: Skill[]; color: string; text: string }
export const ROLES: Role[] = [
  { key: 'deepseek', name: '深度求索娘', nick: '小鲸', passive: 'cheap', color: '#3b5bdb', text: '刚出山的穷门派弟子，便宜大碗、敢打敢拼',
    skills: [S('r_ds1', '深度思考', 0, 30, 5, { buff: { stat: 'crit', v: 0.45, turns: 2 }, mp: 10, anim: 'think' }), S('r_ds2', '混合专家', 2.2, 45, 4, { hits: 4, acc: 0.15, anim: 'moe' }), S('r_ds3', '开源冲击', 3.1, 75, 6, { pierce: 0.35, anim: 'whale' })] },
  { key: 'doubao', name: '豆包娘', nick: '小豆', passive: 'spring', color: '#e8954a', text: '人缘超好的邻家姑娘，嘴甜会聊、打不死',
    skills: [S('r_db1', '陪聊', 0, 30, 5, { heal: 0.15, buff: { stat: 'atk', v: 0.2, turns: 3 }, anim: 'chat' }), S('r_db2', '豆豆连发', 2.1, 40, 3, { hits: 6, anim: 'beans' }), S('r_db3', '全家桶', 3.0, 75, 6, { hits: 4, stun: 0.3, anim: 'bun' })] },
]
export const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]))
DEFAULT_EXCLUSIVE.cheap = ROLES[0].skills // 江湖散人抽到「便宜大碗」时用小鲸的招
// 站长给某个角色单独配置时的校验上限（防止填错把数值打爆）
export const SKILL_LIMITS = { power: 4, cost: 100, cd: 10, hits: 8, ratio: 0.6 }

// ---------- 策略卡 ----------
// 每次弹出时从自己卡组里抽 3 张，选 1 张立即生效。turns 是自己的出手次数。
export type Card = {
  id: string; name: string; text: string; rarity: 1 | 2 | 3
  buffs?: { stat: 'atk' | 'def' | 'spd' | 'crit' | 'dodge'; v: number; turns: number }[]
  debuff?: { stat: 'atk' | 'def' | 'spd'; v: number; turns: number }
  heal?: number; shield?: number; mp?: number; cleanse?: boolean; immune?: number
  lastStand?: number    // 气血低于 30% 时回复这个比例（只触发一次）
  nextSkill?: 'strongest' // 下一招必出最强技能，且不耗内力
  dmg?: number          // 立即造成攻击这个倍率的伤害（无视闪避）
  bleed?: number; reflect?: number; gauge?: number // gauge：立刻涨行动条（0–1）
}
export const CARDS: Card[] = [
  { id: 'c_fierce', name: '杀意', text: '攻击 +20%，持续 4 次出手', rarity: 1, buffs: [{ stat: 'atk', v: 0.2, turns: 4 }] },
  { id: 'c_wall', name: '稳如泰山', text: '防御 +30%，持续 4 次出手', rarity: 1, buffs: [{ stat: 'def', v: 0.3, turns: 4 }] },
  { id: 'c_swift', name: '身轻如燕', text: '速度 +25%，持续 4 次出手', rarity: 1, buffs: [{ stat: 'spd', v: 0.25, turns: 4 }] },
  { id: 'c_focus', name: '凝神', text: '暴击率 +20%，持续 4 次出手', rarity: 1, buffs: [{ stat: 'crit', v: 0.2, turns: 4 }] },
  { id: 'c_bandage', name: '金创药', text: '立刻回复 22% 气血', rarity: 1, heal: 0.22 },
  { id: 'c_qi', name: '回气丹', text: '内力回满一半，并解除负面状态', rarity: 1, mp: 50, cleanse: true },
  { id: 'c_shield', name: '护心镜', text: '获得 20% 气血的护体', rarity: 1, shield: 0.2 },
  { id: 'c_taunt', name: '激将', text: '对方防御 -25%，持续 3 次出手', rarity: 1, debuff: { stat: 'def', v: -0.25, turns: 3 } },
  { id: 'c_sand', name: '扬沙', text: '对方速度 -25%，持续 3 次出手', rarity: 1, debuff: { stat: 'spd', v: -0.25, turns: 3 } },
  { id: 'c_first', name: '抢先手', text: '行动条立刻涨满七成', rarity: 1, gauge: 0.7 },
  { id: 'c_shadow', name: '如影随形', text: '闪避 +15%，持续 4 次出手', rarity: 2, buffs: [{ stat: 'dodge', v: 0.15, turns: 4 }] },
  { id: 'c_iron_will', name: '定心', text: '3 次出手内不会被定身', rarity: 2, immune: 3 },
  { id: 'c_comeback', name: '绝境', text: '气血首次低于 30% 时回复 30%', rarity: 2, lastStand: 0.3 },
  { id: 'c_ultimate', name: '倾囊相授', text: '下一招必出最强技能，且不耗内力', rarity: 2, nextSkill: 'strongest' },
  { id: 'c_ambush', name: '暗手', text: '立刻造成 1.5 倍攻击的伤害，必中', rarity: 2, dmg: 1.5 },
  { id: 'c_poison', name: '淬毒', text: '对方流血，每次出手掉攻击 20% 的血', rarity: 2, bleed: 0.2 },
  { id: 'c_mirror', name: '借力打力', text: '4 次出手内反弹 25% 受到的伤害', rarity: 2, reflect: 0.25 },
  { id: 'c_weaken', name: '卸力', text: '对方攻击 -20%，持续 3 次出手', rarity: 2, debuff: { stat: 'atk', v: -0.2, turns: 3 } },
  { id: 'c_frenzy', name: '狂歌', text: '攻击 +35%、防御 -15%，持续 4 次出手', rarity: 3, buffs: [{ stat: 'atk', v: 0.35, turns: 4 }, { stat: 'def', v: -0.15, turns: 4 }] },
  { id: 'c_rebirth', name: '回光', text: '立刻回复 40% 气血并解除负面状态', rarity: 3, heal: 0.4, cleanse: true },
  { id: 'c_storm', name: '风雷', text: '速度 +35%、暴击 +15%，持续 3 次出手', rarity: 3, buffs: [{ stat: 'spd', v: 0.35, turns: 3 }, { stat: 'crit', v: 0.15, turns: 3 }] },
  { id: 'c_heaven', name: '天时', text: '立刻造成 2.4 倍攻击的伤害，必中', rarity: 3, dmg: 2.4 },
]
export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]))
// 新角色送的卡
export const STARTER_CARDS = ['c_fierce', 'c_wall', 'c_swift', 'c_focus', 'c_bandage', 'c_qi', 'c_shield', 'c_taunt']
// 卡组上限随等级解锁：1 级 3 张，之后每 8 级 +1，最多 8 张
export const deckSize = (level: number) => Math.min(8, 3 + Math.floor((Math.max(1, level) - 1) / 8))
// 一场里最多三选一的次数，以及触发时机
export const PICK_TRIGGERS = ['start', 'half', 'turn20'] as const
export const PICK_ACTION = 20
export const MAX_ACTIONS = 80

// ---------- 装扮 ----------
export const OUTFIT_SLOTS = ['head', 'face', 'body', 'back', 'weapon', 'aura'] as const
export type OutfitSlot = typeof OUTFIT_SLOTS[number]
export const OUTFIT_SLOT_NAMES: Record<OutfitSlot, string> = { head: '头饰', face: '面饰', body: '衣服', back: '背饰', weapon: '武器外观', aura: '光环' }
export type Outfit = { id: string; name: string; slot: OutfitSlot; color: string; note: string }
export const OUTFITS: Outfit[] = [
  { id: 'o_straw_hat', name: '斗笠', slot: 'head', color: '#c9a45c', note: '入门礼' },
  { id: 'o_headband', name: '红抹额', slot: 'head', color: '#c8383a', note: '首次切磋胜利' },
  { id: 'o_half_mask', name: '半面', slot: 'face', color: '#e8e2d0', note: '通关卷一' },
  { id: 'o_blue_robe', name: '青衫', slot: 'body', color: '#3f6f9a', note: '击败文心娘' },
  { id: 'o_black_robe', name: '夜行衣', slot: 'body', color: '#2b2b38', note: '击败 Kimi 娘' },
  { id: 'o_cape', name: '旧披风', slot: 'back', color: '#7a4b2a', note: '击败混元娘' },
  { id: 'o_sword_box', name: '剑匣', slot: 'back', color: '#5a5048', note: '切磋胜利 10 次' },
  { id: 'o_gold_skin', name: '鎏金', slot: 'weapon', color: '#e8c04a', note: '击败 Grok 娘' },
  { id: 'o_leaf_aura', name: '落叶', slot: 'aura', color: '#d98b3a', note: '通关卷三' },
  { id: 'o_cloud_aura', name: '云气', slot: 'aura', color: '#cfe3f0', note: '击败 Claude 娘' },
]
export const OUTFIT_BY_ID = new Map(OUTFITS.map((o) => [o.id, o]))

// ---------- 关卡 ----------
export type Foe = { name: string; kind: WeaponKind; skills: Skill[]; passive?: string; hpMul: number; atkMul: number; defMul?: number; spdMul?: number; cards: string[] }
export type Chapter = { n: number; vol: string; name: string; scene: string; mooks: [string, WeaponKind][]; boss: Foe; weapon: string; outfit?: string; firstCards: string[] }
const boss = (name: string, kind: WeaponKind, skills: Skill[], passive: string, hpMul: number, atkMul: number, cards: string[]): Foe => ({ name, kind, skills, passive, hpMul, atkMul, cards })
export const CHAPTERS: Chapter[] = [
  { n: 1, vol: '新手村', name: '新手村', scene: 'village', mooks: [['乱码小妖', 'dart'], ['验证码怪', 'fist'], ['弹窗广告', 'fan']], weapon: 'w_selfie_staff', firstCards: ['c_sand', 'c_first', 'c_shadow'],
    boss: boss('复读机精', 'staff', [S('b1a', '复读', 1.5, 25, 2, { hits: 3, anim: 'repeat' })], 'iron', 1.78, 0.75, ['c_wall', 'c_bandage']) },
  { n: 2, vol: '新手村', name: '弹窗山谷', scene: 'popup_valley', mooks: [['水军号', 'fist'], ['标题党', 'fan'], ['营销号', 'dart']], weapon: 'w_emoji_darts', firstCards: ['c_taunt', 'c_iron_will', 'c_poison'],
    boss: boss('关键词机器人', 'fan', [S('b2a', '关键词旋风', 1.6, 25, 2, { debuff: { stat: 'atk', v: -0.15, turns: 2 }, anim: 'vortex' }), S('b2b', '答非所问', 1.9, 40, 4, { hits: 3, anim: 'tags' })], 'spring', 1.36, 0.75, ['c_focus', 'c_qi']) },
  { n: 3, vol: '新手村', name: '训练场', scene: 'training', mooks: [['刷榜脚本', 'dart'], ['调参侠', 'staff'], ['数据标注员', 'sword']], weapon: 'w_keyboard_fist', outfit: 'o_half_mask', firstCards: ['c_comeback', 'c_weaken', 'c_mirror'],
    boss: boss('过拟合师兄', 'sword', [S('b3a', '死记硬背', 1.7, 25, 2, { acc: 0.1, anim: 'slash3' }), S('b3b', '背题', 2.3, 45, 4, { pierce: 0.3, anim: 'pages' })], 'edge', 1.54, 0.75, ['c_fierce', 'c_shield', 'c_ambush']) },
  { n: 4, vol: '国产群雄', name: '书院', scene: 'academy', mooks: [['书卷精', 'fan'], ['拼音输入法', 'dart'], ['词典灵', 'staff']], weapon: 'w_scroll_fan', outfit: 'o_blue_robe', firstCards: ['c_swift', 'c_ultimate', 'c_sand'],
    boss: boss('文心娘', 'fan', [S('b4a', '翻书掌', 1.6, 25, 2, { pierce: 0.2, anim: 'windblade' }), S('b4b', '一言', 2.2, 45, 4, { stun: 0.3, anim: 'stamp' })], 'thorn', 1.52, 0.75, ['c_wall', 'c_poison', 'c_bandage']) },
  { n: 5, vol: '国产群雄', name: '问天台', scene: 'question_terrace', mooks: [['问号怪', 'spear'], ['千问分身', 'spear'], ['推荐算法', 'dart']], weapon: 'w_brush_spear', firstCards: ['c_ambush', 'c_frenzy', 'c_focus'],
    boss: boss('通义娘', 'spear', [S('b5a', '追问', 1.3, 25, 2, { hits: 4, anim: 'dragon' }), S('b5b', '千问', 1.6, 35, 3, { hits: 5, bleed: 0.15, anim: 'qrain' })], 'cat', 1.88, 0.75, ['c_shadow', 'c_qi', 'c_taunt']) },
  { n: 6, vol: '国产群雄', name: '太极湖', scene: 'taiji_lake', mooks: [['太极小人', 'fist'], ['云端服务器', 'staff'], ['深夜加班狗', 'blade']], weapon: 'w_taiji_fist', outfit: 'o_cape', firstCards: ['c_rebirth', 'c_mirror', 'c_weaken'],
    boss: boss('混元娘', 'fist', [S('b6a', '推手', 1.7, 25, 2, { debuff: { stat: 'def', v: -0.2, turns: 2 }, anim: 'punch' }), S('b6b', '太极守', 0, 35, 5, { shield: 0.2, anim: 'windmill' }), S('b6c', '混元一气', 2.6, 60, 5, { hits: 6, anim: 'taiji' })], 'iron', 1.58, 0.75, ['c_wall', 'c_comeback', 'c_fierce']) },
  { n: 7, vol: '江湖', name: '月之暗面', scene: 'dark_moon', mooks: [['月牙兔', 'dart'], ['熬夜党', 'fist'], ['长文卷轴', 'fan']], weapon: 'w_moon_darts', outfit: 'o_black_robe', firstCards: ['c_storm', 'c_heaven', 'c_iron_will'],
    boss: boss('Kimi 娘', 'dart', [S('b7a', '月牙回旋', 1.7, 25, 2, { bleed: 0.12, anim: 'volley' }), S('b7b', '月之暗面', 2.4, 50, 4, { hits: 4, debuff: { stat: 'spd', v: -0.2, turns: 3 }, anim: 'moon' })], 'fury', 1.11, 0.75, ['c_frenzy', 'c_bandage', 'c_sand']) },
  { n: 8, vol: '江湖', name: '藏书阁', scene: 'library', mooks: [['论文审稿人', 'fan'], ['学术大佬', 'staff'], ['GPU 搬运工', 'fist']], weapon: 'w_light_sword', firstCards: ['c_shadow', 'c_ultimate', 'c_rebirth'],
    boss: boss('智谱娘', 'sword', [S('b8a', '推导', 1.8, 30, 2, { debuff: { stat: 'spd', v: -0.2, turns: 2 }, anim: 'slash3' }), S('b8b', '清言', 1.5, 45, 5, { hits: 7, stun: 0.3, anim: 'light' })], 'wind', 1.89, 0.75, ['c_swift', 'c_iron_will', 'c_focus']) },
  { n: 9, vol: '江湖', name: '羊驼草原', scene: 'grassland', mooks: [['羊驼宝宝', 'staff'], ['开源贡献者', 'sword'], ['fork 分身', 'dart']], weapon: 'w_wool_staff', firstCards: ['c_poison', 'c_comeback', 'c_storm'],
    boss: boss('Llama 娘', 'staff', [S('b9a', '吐口水', 1.4, 25, 2, { stun: 0.2, anim: 'leapsmash' }), S('b9b', '羊驼冲锋', 1.8, 45, 4, { hits: 4, debuff: { stat: 'atk', v: -0.15, turns: 2 }, anim: 'alpaca' })], 'spring', 1.66, 0.75, ['c_poison', 'c_qi', 'c_weaken']) },
  { n: 10, vol: '海外巅峰', name: '火箭基地', scene: 'rocket_base', mooks: [['热搜', 'dart'], ['暴躁推文', 'fist'], ['表情包大军', 'dart']], weapon: 'w_rocket_fist', outfit: 'o_gold_skin', firstCards: ['c_heaven', 'c_frenzy', 'c_mirror'],
    boss: boss('Grok 娘', 'fist', [S('b10a', '嘴炮', 1.8, 30, 2, { pierce: 0.3, anim: 'punch' }), S('b10b', '暴走火箭', 2.6, 55, 5, { hits: 3, stun: 0.25, anim: 'rocket' })], 'thorn', 2.05, 0.75, ['c_fierce', 'c_shield', 'c_taunt']) },
  { n: 11, vol: '海外巅峰', name: '双子星空', scene: 'twin_stars', mooks: [['搜索蜘蛛', 'dart'], ['广告位', 'fan'], ['双子星', 'sword']], weapon: 'w_twin_fans', firstCards: ['c_rebirth', 'c_storm', 'c_ultimate'],
    boss: boss('Gemini 娘', 'fan', [S('b11a', '星扇', 1.9, 30, 3, { hits: 2, anim: 'windblade' }), S('b11b', '镜像', 0, 40, 5, { shield: 0.25, buff: { stat: 'dodge', v: 0.15, turns: 3 }, anim: 'windmill' }), S('b11c', '双子分身', 3.0, 70, 6, { hits: 2, pierce: 0.4, anim: 'twin' })], 'iron', 1.39, 0.75, ['c_wall', 'c_comeback', 'c_rebirth']) },
  { n: 12, vol: '海外巅峰', name: '无尽机房', scene: 'server_hall', mooks: [['付费墙', 'staff'], ['插件精灵', 'fan'], ['幻觉怪', 'dart']], weapon: 'w_cable_spear', firstCards: ['c_heaven', 'c_shadow', 'c_iron_will'],
    boss: boss('GPT 娘', 'sword', [S('b12a', '全能一击', 1.8, 30, 2, { acc: 0.2, debuff: { stat: 'atk', v: -0.2, turns: 2 }, anim: 'sheath' }), S('b12b', '多模态乱打', 2.8, 60, 5, { hits: 4, critUp: 0.2, anim: 'multi' })], 'cat', 1.85, 0.75, ['c_shadow', 'c_storm', 'c_qi']) },
  { n: 13, vol: '海外巅峰', name: '宪章峰', scene: 'charter_peak', mooks: [['安全护栏', 'staff'], ['宪章条文', 'fan'], ['拒答小盾', 'fist']], weapon: 'w_gpu_blade', outfit: 'o_cloud_aura', firstCards: ['c_frenzy', 'c_rebirth', 'c_heaven'],
    boss: boss('Claude 娘', 'fan', [S('b13a', '礼貌劝退', 2.0, 30, 2, { pierce: 0.3, anim: 'windblade' }), S('b13b', '深思熟虑', 0, 45, 5, { heal: 0.15, shield: 0.15, anim: 'think' }), S('b13c', '长上下文', 3.4, 80, 6, { hits: 7, critUp: 0.2, stun: 0.25, anim: 'scroll' })], 'fury', 1.33, 0.75, ['c_frenzy', 'c_heaven', 'c_rebirth', 'c_comeback']) },
  // 隐藏关：通关第 13 关后开放（关卡等级封顶 52）；真人二创只用外号、漫画化、不丑化
  { n: 14, vol: '隐藏', name: '深海鲸落', scene: 'whale_fall', mooks: [['量化交易员', 'dart'], ['鲸鱼宝宝', 'fist'], ['开源信徒', 'sword']], weapon: 'w_whale_sword', firstCards: ['c_storm', 'c_rebirth', 'c_heaven'],
    boss: boss('梁师父', 'sword', [S('h1a', '品茶', 0, 30, 5, { heal: 0.12, buff: { stat: 'def', v: 0.25, turns: 3 }, anim: 'qi' }), S('h1b', '低调一剑', 2.0, 30, 2, { pierce: 0.4, anim: 'sheath' }), S('h1c', '鲸落', 3.4, 80, 6, { hits: 3, pierce: 0.3, anim: 'whale' })], 'wind', 1.43, 0.82, ['c_wall', 'c_heaven', 'c_rebirth', 'c_comeback']) },
  { n: 15, vol: '隐藏', name: '黄金庄园', scene: 'golf_manor', mooks: [['关税单', 'fan'], ['推文风暴', 'dart'], ['高尔夫球童', 'staff']], weapon: 'w_tariff_seal', firstCards: ['c_frenzy', 'c_mirror', 'c_ultimate'],
    boss: boss('关税大魔王', 'staff', [S('h2a', '挥杆', 1.8, 25, 2, { anim: 'leapsmash' }), S('h2b', '退群', 0, 35, 5, { shield: 0.22, anim: 'firewall' }), S('h2c', '加征关税', 2.6, 60, 4, { hits: 2, debuff: { stat: 'def', v: -0.25, turns: 3 }, anim: 'tariff' })], 'thorn', 2.05, 0.85, ['c_taunt', 'c_weaken', 'c_frenzy', 'c_wall']) },
]
// Boss 的 hpMul 按「推荐等级 + 上一关掉的武器 + 初始卡组、自动选卡、两位主角各半」胜率约 55%（隐藏关约 40%）校准过（tests/unit/dou.test.mjs 有检查）
// 关卡编号：c{章}s{场}，场 1–3 是小战，4 是 Boss
export const STAGES = CHAPTERS.flatMap((ch) => [1, 2, 3, 4].map((k) => ({ id: `c${ch.n}s${k}`, ch, k, level: Math.min(MAX_LEVEL, k === 4 ? ch.n * 4 : Math.max(1, ch.n * 4 - 4 + k)) })))
export const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]))

// ---------- 成就 ----------
export const ACHIEVEMENTS: Record<string, { name: string; text: string; outfit?: string }> = {
  join: { name: '出山', text: '踏入大模型江湖', outfit: 'o_straw_hat' },
  pvp1: { name: '初出茅庐', text: '第一次在切磋中获胜', outfit: 'o_headband' },
  pvp10: { name: '小有名气', text: '切磋胜利 10 次', outfit: 'o_sword_box' },
  vol1: { name: '毕业', text: '通关卷一·新手村', outfit: 'o_half_mask' },
  vol2: { name: '国产之光', text: '通关卷二·国产群雄' },
  vol3: { name: '行走江湖', text: '通关卷三·江湖', outfit: 'o_leaf_aura' },
  vol4: { name: '算力之巅', text: '通关卷四·海外巅峰' },
  hidden: { name: '隐藏结局', text: '通关全部隐藏关' },
  lv52: { name: '满参数', text: '达到 52 级，可以上武林大会' },
  board1: { name: '天下第一', text: '武林大会排名第一' },
  ...Object.fromEntries(CHAPTERS.map((ch) => [`boss${ch.n}`, { name: `破${ch.name}`, text: `击败${ch.boss.name}`, outfit: ch.outfit }])),
}

// ---------- 次数 ----------
export const DAILY = { pve: 30, pvp: 10, board: 5, auto: 3 }
export const BOARD_LEVEL = MAX_LEVEL
export const BOARD_REACH = 10 // 只能挑战排名比自己高、且差距不超过 10 名的人
