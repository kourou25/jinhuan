// 漂流瓶 AI 审核（2026-11-26）。发布前审一次；AI 没回应时先放行、记成 pending，后台每分钟补审；被举报时再审一次。
// 允许倾诉悲伤、低落、抑郁；只拦：极端消极（鼓动轻生、厌世到伤害自己或他人）、愤世嫉俗的攻击、报复社会、政治敏感、人身攻击、辱骂。
import type { Env } from '../env'
import { chat } from '../ai/gateway'
import { now } from '../lib/time'

export const CATEGORIES: Record<string, string> = {
  extreme: '极端消极', cynical: '愤世嫉俗的攻击', revenge: '报复社会', politics: '政治敏感', attack: '人身攻击', abuse: '辱骂',
}
const PROMPT = `你是中文社区「漂流瓶」的内容审核员。用户在这里匿名写心情、句子、想法。判断这段文字能不能发布，只回 JSON：{"violation":true或false,"category":"类别"}。
可以发布（violation=false）：倾诉悲伤、孤独、焦虑、低落、抑郁、失眠、哭泣、对生活的抱怨和吐槽、轻度粗口、玩笑、文学化的阴郁表达。不要因为情绪低落就拦。
必须拦下（violation=true），category 取下面之一：
- extreme：鼓动或详细描述自杀、自残的方法，或宣扬伤害自己、伤害他人
- cynical：以仇恨、敌意攻击某个群体或整个社会的愤世嫉俗言论
- revenge：报复社会、扬言伤害无辜者
- politics：涉及国家领导人、政治制度、政治事件的敏感内容
- attack：针对具体个人或群体的人身攻击、人肉、威胁
- abuse：辱骂、侮辱性脏话骂人
拿不准时选 violation=false。`

export type Verdict = { violation: boolean; category: string | null } | null // null = AI 没回应
export async function aiReview(env: Env, uid: number, text: string): Promise<Verdict> {
  try {
    const r = await chat(env, { feature: 'report', uid: uid > 0 ? uid : 0, json: true, temperature: 0, maxTokens: 60, timeoutMs: 6000, totalTimeoutMs: 7000,
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text.slice(0, 1200) }] })
    if (r instanceof Response) return null
    const m = /\{[\s\S]*\}/.exec(r.text)
    const x = m ? JSON.parse(m[0]) : null
    if (!x || typeof x.violation !== 'boolean') return null
    return { violation: x.violation, category: x.violation && typeof x.category === 'string' && x.category in CATEGORIES ? x.category : x.violation ? 'abuse' : null }
  } catch { return null }
}
export const blockedText = (v: NonNullable<Verdict>) => `经 AI 自动审核，内容可能存在「${CATEGORIES[v.category ?? 'abuse']}」，不符合漂流瓶的规范，无法发送。请修改后再发`

// AI 判定违规：隐藏，并以系统名义记一条举报（user_id=0），进管理员的举报列表
const flag = (db: D1Database, kind: 'bottle' | 'reply', id: number, category: string | null) => db.batch([
  db.prepare(`UPDATE ${kind === 'bottle' ? 'bottles' : 'bottle_replies'} SET ai='flag',hidden=1 WHERE id=? AND deleted=0`).bind(id),
  db.prepare("INSERT OR IGNORE INTO bottle_reports(kind,target_id,user_id,reason,created_at) VALUES(?,?,0,?,?)").bind(kind, id, 'AI 判定：' + CATEGORIES[category ?? 'abuse'], now()),
])
// 被举报后再审一次；AI 没回应就留给管理员
export async function reviewReported(env: Env, db: D1Database, kind: 'bottle' | 'reply', id: number) {
  const row = await db.prepare(`SELECT body,${kind === 'bottle' ? 'author_id' : 'user_id'} AS uid FROM ${kind === 'bottle' ? 'bottles' : 'bottle_replies'} WHERE id=? AND deleted=0`).bind(id).first<{ body: string; uid: number }>()
  if (!row?.body) return null
  const v = await aiReview(env, row.uid, row.body)
  if (v?.violation) await flag(db, kind, id, v.category)
  return v
}
// 后台补审：发布时 AI 没回应的
export async function sweepPending(env: Env, db: D1Database = env.DB) {
  let done = 0
  for (const kind of ['bottle', 'reply'] as const) {
    const table = kind === 'bottle' ? 'bottles' : 'bottle_replies'
    const { results } = await db.prepare(`SELECT id,body,${kind === 'bottle' ? 'author_id' : 'user_id'} AS uid FROM ${table} WHERE ai='pending' AND deleted=0 ORDER BY created_at LIMIT 5`).all<{ id: number; body: string; uid: number }>()
    for (const r of results) {
      const v = await aiReview(env, r.uid, r.body)
      if (!v) return done // AI 还是不通，下次再来
      if (v.violation) await flag(db, kind, r.id, v.category)
      else await db.prepare(`UPDATE ${table} SET ai='ok' WHERE id=?`).bind(r.id).run()
      done++
    }
  }
  return done
}
