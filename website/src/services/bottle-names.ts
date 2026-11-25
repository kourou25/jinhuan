// 漂流瓶的昵称与徽章。都只和「这一个瓶子」有关，不能把同一个作者的几个瓶子串起来：
// 随机昵称由瓶子的随机编号生成（和作者无关）；徽章只看这个瓶子收到的喜欢、回信和不喜欢，档位很粗。
import { fail } from '../lib/http'
import { now } from '../lib/time'
import { assertClean } from './bottle-words'

const HEAD = ['听雨', '枕云', '渡月', '拾星', '观潮', '折柳', '煮雪', '临风', '问渠', '采薇', '泊舟', '踏莎', '倚楼', '望舒', '吹笛', '扫花', '洗砚', '看山', '闻钟', '坐忘', '逐鹿', '归田', '饮露', '藏锋']
const TAIL = ['的鹤', '的鲤', '的客', '的舟', '的雁', '的樵', '的渔', '的僧', '的萤', '的砚', '的灯', '的燕', '的鹿', '的蝉', '的松', '的竹']
export const randomNick = (id: number) => HEAD[id % HEAD.length] + TAIL[Math.floor(id / HEAD.length) % TAIL.length]

// 命名取自诗词、神话、典故
export const BADGES = {
  bird: { name: '青鸟', from: '青鸟殷勤为探看 —— 有人把你的话捎到了' },
  brocade: { name: '锦书', from: '云中谁寄锦书来 —— 这封信被许多人收下' },
  luoyang: { name: '洛阳纸贵', from: '左思作《三都赋》，洛阳为之纸贵' },
  jingwei: { name: '精卫', from: '衔微木以填沧海 —— 风浪不小，仍在往前飞' },
  upstream: { name: '逆水舟', from: '逆水行舟，不进则退' },
  sunken: { name: '沉璧', from: '静影沉璧 —— 这个瓶子已经沉到海底' },
} as const
export type BadgeKey = keyof typeof BADGES
export const SINK_AT = 10
// 喜欢 + 回信人数 算「好」，不喜欢算「坏」；坏的多于好的才给后一类
export function badgeOf(likes: number, replies: number, poops: number): BadgeKey | null {
  const good = likes + replies
  if (poops >= SINK_AT) return 'sunken'
  if (poops > good) return poops >= 6 ? 'upstream' : poops >= 3 ? 'jingwei' : null
  return good >= 30 ? 'luoyang' : good >= 10 ? 'brocade' : good >= 3 ? 'bird' : null
}

// ---------- 自定义昵称：不能冒用站内用户 ----------
const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}\p{M}]/gu, '')
const RESERVED = ['站长', '管理员', '官方', '客服', '系统', '瓶主', '尽欢', '鱼友', '群主', '版主', 'admin', 'system', 'official']
let taken: { at: number; set: Set<string> } | null = null
async function takenNames(db: D1Database) {
  if (taken && now() - taken.at < 300) return taken.set
  const { results } = await db.prepare('SELECT username,name,nick FROM users').all<{ username: string | null; name: string | null; nick: string | null }>()
  const set = new Set<string>()
  for (const u of results) for (const n of [u.username, u.name, u.nick]) { const f = n ? fold(n) : ''; if (f) set.add(f) }
  taken = { at: now(), set }
  return set
}
export async function cleanNick(db: D1Database, raw: unknown): Promise<string> {
  const nick = (typeof raw === 'string' ? raw : '').normalize('NFKC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim()
  if (!nick) return ''
  const f = fold(nick)
  if ([...nick].length > 12 || [...f].length < 2) fail(400, '昵称需要 2 到 12 个字')
  if (RESERVED.some((w) => f.includes(w))) fail(400, '这个昵称容易被误认成站内身份，换一个吧')
  if ((await takenNames(db)).has(f)) fail(400, '这个昵称和站内用户重名，换一个吧')
  await assertClean(db, nick, '昵称')
  return nick
}
