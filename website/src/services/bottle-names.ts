// 漂流瓶的昵称与徽章。都只和「这一个瓶子」有关，不能把同一个作者的几个瓶子串起来：
// 随机昵称由瓶子的随机编号生成（和作者无关）；徽章只看这个瓶子收到的喜欢、回信和不喜欢，档位很粗。
import { fail } from '../lib/http'
import { now } from '../lib/time'
import { assertClean, soften } from './bottle-words'
import AVATARS from '../anon/avatar-manifest.json'

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
  const nick = soften((typeof raw === 'string' ? raw : '').normalize('NFKC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim())
  if (!nick) return ''
  const f = fold(nick)
  if ([...nick].length > NICK_MAX || [...f].length < 2) fail(400, `昵称需要 2 到 ${NICK_MAX} 个字`)
  if (RESERVED.some((w) => f.includes(w))) fail(400, '这个昵称容易被误认成官方身份，换一个吧')
  if ((await takenNames(db)).has(f)) fail(400, '这个昵称和别人重名了，换一个吧')
  await assertClean(db, nick, '昵称')
  return nick
}

// ---------- 匿名身份：昵称最长 10 个字，多种随机组合；头像取自 1 群匿名系统的像素头像 ----------
const WHEN = ['凌晨三点', '午夜', '黄昏', '清晨', '雨夜', '雪夜', '周五晚上', '下班路上', '失眠的', '早春', '盛夏', '深秋', '冬至', '月下', '云上', '海边', '山间', '旧城', '小镇', '屋顶', '天台', '巷口', '站台', '江南', '北方的']
const DO = ['听雨', '看海', '煮茶', '读诗', '吹风', '等风', '种花', '发呆', '摸鱼', '追光', '折纸', '写信', '数星星', '晒太阳', '散步', '捡贝壳', '喂猫', '唱歌', '画画', '赶路', '放风筝', '泡面', '熬夜', '做梦', '钓鱼']
const WHO = ['鲸', '猫', '鹤', '鹿', '狐狸', '小舟', '路灯', '云朵', '萤火虫', '大雁', '少年', '旅人', '路人', '信使', '守夜人', '拾荒者', '邮差', '水手', '诗人', '咸鱼', '橘子', '海獭', '刺猬', '松鼠', '企鹅', '月亮', '石头', '蒲公英', '灯塔', '纸飞机']
const LOOK = ['安静的', '迷路的', '快乐的', '温柔的', '倔强的', '慢吞吞的', '会发光的', '不睡觉的', '爱哭的', '勇敢的']
const pick = <T>(list: T[]) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length]
// 几种句式随机挑一种，结果不超过 10 个字
export function rollNick(): string {
  for (let i = 0; i < 20; i++) {
    const n = [
      () => pick(DO) + '的' + pick(WHO),
      () => pick(WHEN) + pick(DO) + '的' + pick(WHO),
      () => pick(WHEN) + '的' + pick(WHO),
      () => pick(LOOK) + pick(WHO),
      () => pick(WHEN) + pick(LOOK) + pick(WHO),
      () => '在' + pick(WHEN.filter((w) => !w.endsWith('的'))) + pick(DO) + '的' + pick(WHO),
    ][crypto.getRandomValues(new Uint32Array(1))[0] % 6]().replace('的的', '的')
    if ([...n].length <= 10) return n
  }
  return pick(DO) + '的' + pick(WHO)
}
export const NICK_MAX = 10
// 1 群匿名系统的像素头像（public/assets/anon，随发布上传）
const AVATAR_LIST: string[] = Object.entries(AVATARS as Record<string, number[]>).flatMap(([series, items]) => items.map((n) => `/assets/anon/${series}/${String(n).padStart(3, '0')}.webp`))
export const isAnonAvatar = (path: unknown): path is string => typeof path === 'string' && /^\/assets\/anon\/[a-z0-9]{1,20}\/\d{3}\.webp$/.test(path) && AVATAR_SET.has(path)
const AVATAR_SET = new Set(AVATAR_LIST)
export const rollAvatar = (avoid: Iterable<string> = []) => {
  const skip = new Set(avoid)
  for (let i = 0; i < 50; i++) { const a = pick(AVATAR_LIST); if (!skip.has(a)) return a }
  return AVATAR_LIST.find((a) => !skip.has(a)) ?? AVATAR_LIST[0]
}
// 旧瓶子没有存头像：按瓶子的随机编号选一张（和作者无关）
export const legacyAvatar = (id: number) => AVATAR_LIST[id % AVATAR_LIST.length]
