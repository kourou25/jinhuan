// 漂流瓶的内容检查：政治敏感（内置词库）+ 站长自己加的词 - 站长放行的词。
// 瓶子、回信、自定义昵称都走这里。应对：全半角、空格和符号干扰、夹英文数字、繁体、谐音、拆字、拼音。
import { fail } from '../lib/http'
import { now } from '../lib/time'

const LEADERS: string[] = [] // 开源版不含内置词库
const POLITICS: string[] = [] // 开源版不含内置词库
// 拼音 / 缩写：只在「去掉所有非字母数字」后的文本里找
const LATIN: string[] = []
// 谐音 / 形近：只用于 3 字以上的人名，替换后再比
const SAME: Record<string, string> = {}
// 繁体里会出现在词库中的字
const TRAD: Record<string, string> = {}
// 拆字：两个偏旁写成两个字
const SPLIT: [RegExp, string][] = []

const strip = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}\p{M}]/gu, '')
const simplify = (s: string) => [...s].map((c) => TRAD[c] ?? c).join('')
const alike = (s: string) => [...s].map((c) => SAME[c] ?? c).join('')
// 一段文字的几种还原形态
function forms(text: string) {
  const base = simplify(strip(text)), noAscii = base.replace(/[a-z0-9]/g, '')
  const joined = SPLIT.reduce((t, [re, to]) => t.replace(re, to), noAscii)
  return { base, plain: [base, noAscii, joined], alike: [noAscii, joined].map(alike), raw: text.normalize('NFKC'), latin: text.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '') }
}

type Config = { words: string[]; allow: string[] }
const KEY = 'bottle_words'
export async function loadWords(db: D1Database): Promise<Config> {
  const row = await db.prepare('SELECT v FROM site_settings WHERE k=?').bind(KEY).first<{ v: string }>()
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((w): w is string => typeof w === 'string') : [])
  try {
    const x = JSON.parse(row?.v ?? '{}')
    // 第一版存的是数组
    return Array.isArray(x) ? { words: list(x), allow: [] } : { words: list(x.words), allow: list(x.allow) }
  } catch { return { words: [], allow: [] } }
}
const cleanList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return fail(400, '词表格式不正确')
  const out = [...new Set(raw.map((w) => String(w ?? '').trim()).filter((w) => strip(w)))]
  if (out.length > 1000 || out.some((w) => w.length > 30)) fail(400, '最多 1000 个词，每个不超过 30 字')
  return out
}
export async function saveWords(db: D1Database, words: unknown, allow: unknown): Promise<Config> {
  const cfg = { words: cleanList(words), allow: cleanList(allow) }
  await db.prepare('INSERT INTO site_settings(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at').bind(KEY, JSON.stringify(cfg), now()).run()
  return cfg
}

// 返回命中的类别；不告诉用户具体是哪个词
export function inspect(text: string, cfg: Config): 'politics' | 'custom' | null {
  const f = forms(text), allow = new Set(cfg.allow.map((w) => simplify(strip(w))))
  // 放行的词先从文本里拿掉，避免整词误伤
  const blank = (s: string) => [...allow].reduce((t, w) => (w ? t.split(w).join('　') : t), s)
  const plain = f.plain.map(blank), same = f.alike.map(blank)
  for (const w of [...LEADERS, ...POLITICS]) {
    if (allow.has(w)) continue
    if (plain.some((t) => t.includes(w))) return 'politics'
    if (w.length >= 3 && LEADERS.includes(w) && same.some((t) => t.includes(alike(w)))) return 'politics'
  }
  if (LATIN.some((w) => !allow.has(w) && f.latin.includes(w))) return 'politics'
  for (const raw of cfg.words) {
    const w = simplify(strip(raw))
    if (w && !allow.has(w) && plain.some((t) => t.includes(w))) return 'custom'
  }
  return null
}
export async function assertClean(db: D1Database, text: string, what = '内容') {
  const hit = inspect(text, await loadWords(db))
  if (hit === 'politics') fail(400, `${what}可能涉及国家领导人或政治敏感话题，请修改后再发`, 'sensitive')
  if (hit === 'custom') fail(400, `${what}里有不能发布的词，请修改后再发`, 'sensitive')
}

// ---------- 自动改写（站长 2026-11-26 定）：轻生类说法换成「重生」，两个脏词换成 🍌 / 福 ----------
// 「想死你了」「想死我了」是想念，不换；「逼」在逼迫、逼真这类正常词里不换
const KEEP_BI = /逼(?=迫|真|近|问|供|债|宫|仄|视|退|格|人太甚|上梁山)|(?<=威|紧|倒|进|相|催|强|咄咄)逼|(?<=被)逼(?=着|得|无奈|上)/g
export function soften(text: string) {
  return text
    .replace(/想死(?!你|我了|他|她|它|人|啦你)/g, '想获得重生系统')
    .replace(/不想活了|想自杀|想轻生|活着没意思/g, '想获得重生系统')
    .replace(/自杀|轻生/g, '重生')
    .replace(/寻死/g, '寻找重生系统')
    .replace(/去死/g, '去重生')
    // 「几把伞」「好几把」这类量词不换
    .replace(/鸡[巴吧]|几[吧巴]|(?<![好这那了买有])几把(?![伞椅刀钥剪锁扇梳琴枪斧锤铲尺勺壶钳斗凳])/g, '🍌')
    .replace(KEEP_BI, '\u0000')
    .replace(/[逼屄]/g, '福')
    .replace(/\u0000/g, '逼')
}
