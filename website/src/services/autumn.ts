// 「死如秋叶」：访问权限、「好久不见」名单、图片元数据清理
import { now } from '../lib/time'

type Db = { prepare(q: string): any; batch(x: any[]): Promise<any> }
type Env = { DB: any; ADMIN_USER_IDS?: string }

// ---------- 好久不见（表名沿用 autumn_memorial） ----------
const DAY = 86400
export type MemorialConfig = { peak: number; score: number }
export const MEMORIAL_IDLE_DAYS = 15
export const MEMORIAL_DEFAULT: MemorialConfig = { peak: 3, score: 30 }
// 1 群从这一天起匿名：之后的 1 群发言不参与统计，避免和这里的真实身份对应起来
const ANON_SINCE = '2026-11-23'
export const bjDay = (t: number) => new Date((t + 28800) * 1000).toISOString().slice(0, 10)

export async function memorialConfig(db: Db): Promise<MemorialConfig> {
  const row = await db.prepare("SELECT v FROM site_settings WHERE k='autumn_memorial'").first() as { v: string } | null
  try { return { ...MEMORIAL_DEFAULT, ...JSON.parse(row?.v || '{}') } } catch { return MEMORIAL_DEFAULT }
}

let building: Promise<void> | null = null
// 每天算一次（定时任务北京时间 09:00；当天第一次访问也会补算）。只扫每日统计表，不扫消息表。
export function buildMemorial(db: Db, t = now()) {
  building ??= build(db, t).finally(() => { building = null })
  return building
}
async function build(db: Db, t: number) {
  const cut = t - MEMORIAL_IDLE_DAYS * DAY
  const { results: users } = await db.prepare(`SELECT id,last_seen FROM users u WHERE kind='user' AND disabled=0 AND silenced=0 AND last_seen<?
    AND NOT EXISTS(SELECT 1 FROM account_retirements r WHERE r.source_id=u.id)`).bind(cut).all() as { results: { id: number; last_seen: number }[] }
  const people = new Map(users.map((u) => [u.id, { days: new Set<string>(), score: 0, last: u.last_seen || 0 }]))
  const add = (rows: { u: number; day: string; n: number; last: number | null }[], weight: number) => {
    for (const r of rows) { const p = people.get(r.u); if (!p) continue; p.days.add(r.day); p.score += r.n * weight; p.last = Math.max(p.last, r.last || 0) }
  }
  const ids = JSON.stringify([...people.keys()])
  add((await db.prepare(`SELECT user_id u,day,SUM(messages) n,MAX(last_at) last FROM chat_activity_stats WHERE day<>'*' AND NOT(group_id=1 AND day>=?) GROUP BY 1,2`).bind(ANON_SINCE).all()).results, 1)
  add((await db.prepare(`SELECT author_id u,date(created_at,'unixepoch','+8 hours') day,COUNT(*) n,MAX(created_at) last FROM memes WHERE author_id IN (SELECT value FROM json_each(?)) AND hidden=0 AND ld_post_id IS NULL GROUP BY 1,2`).bind(ids).all()).results, 5)
  add((await db.prepare(`SELECT user_id u,date(created_at,'unixepoch','+8 hours') day,COUNT(*) n,MAX(created_at) last FROM comments WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY 1,2`).bind(ids).all()).results, 1)
  const rows: number[][] = []
  for (const [id, p] of people) {
    if (!p.days.size || !p.last || p.last >= cut) continue
    const d = [...p.days].map((x) => Date.parse(x) / 864e5).sort((a, b) => a - b)
    let peak = 0 // 任意 30 天内最多活跃了几天
    for (let i = 0, j = 0; j < d.length; j++) { while (d[j] - d[i] >= 30) i++; peak = Math.max(peak, j - i + 1) }
    rows.push([id, p.score, d.length, peak, p.last])
  }
  await db.batch([
    db.prepare('DELETE FROM autumn_memorial'),
    db.prepare(`INSERT INTO autumn_memorial(user_id,score,days,peak,last_at) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]') FROM json_each(?)`).bind(JSON.stringify(rows)),
    db.prepare('INSERT INTO autumn_memorial_state(id,day,built_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,built_at=excluded.built_at').bind(bjDay(t), t),
  ])
}
export async function ensureMemorial(db: Db, t = now()) {
  const s = await db.prepare('SELECT day FROM autumn_memorial_state WHERE id=1').first() as { day: string } | null
  if (s?.day !== bjDay(t)) await buildMemorial(db, t)
}
// 读取时再核对一次最近上线时间（主键点查）：本人一上线就不在名单里。?1 = 15 天前
export const MEMORIAL_WHERE = `u.last_seen<?1 AND m.last_at<?1 AND u.kind='user' AND u.disabled=0 AND u.silenced=0
  AND NOT EXISTS(SELECT 1 FROM autumn_opt_out o WHERE o.user_id=u.id)`

// ---------- 图片：识别类型并去掉拍摄信息（GPS、设备等），匿名帖不能靠图片暴露作者 ----------
export function sniffAutumnImage(b: Uint8Array): [mime: string, ext: string] | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', 'jpg']
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ['image/png', 'png']
  const s = String.fromCharCode(...b.subarray(0, 12))
  if (s.startsWith('GIF87a') || s.startsWith('GIF89a')) return ['image/gif', 'gif']
  if (s.startsWith('RIFF') && s.slice(8) === 'WEBP') return ['image/webp', 'webp']
  return null
}
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
export function stripMetadata(b: Uint8Array, mime: string): Uint8Array {
  const keep: Uint8Array[] = []
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (mime === 'image/jpeg') {
    keep.push(b.subarray(0, 2))
    let o = 2
    while (o + 4 <= b.length && b[o] === 0xff) {
      const m = b[o + 1]
      if (m === 0xff) { o++; continue } // 填充字节
      if (m === 0xda) { keep.push(b.subarray(o)); return concat(keep) } // 图像数据开始
      const len = dv.getUint16(o + 2)
      // 丢掉 APP1（EXIF/XMP）、APP3–13（含 IPTC）、APP15 和注释；保留 JFIF、色彩配置、Adobe 标记
      if (!(m === 0xe1 || (m >= 0xe3 && m <= 0xed) || m === 0xef || m === 0xfe)) keep.push(b.subarray(o, o + 2 + len))
      o += 2 + len
    }
    throw Error('bad_image')
  }
  if (mime === 'image/png') {
    keep.push(b.subarray(0, 8))
    let o = 8
    while (o + 12 <= b.length) {
      const len = dv.getUint32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7])
      if (o + 12 + len > b.length) throw Error('bad_image')
      if (!['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(type)) keep.push(b.subarray(o, o + 12 + len))
      o += 12 + len
      if (type === 'IEND') break
    }
    return concat(keep)
  }
  if (mime === 'image/webp') {
    let o = 12
    while (o + 8 <= b.length) {
      const type = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), len = dv.getUint32(o + 4, true), end = o + 8 + len + (len & 1)
      if (o + 8 + len > b.length) throw Error('bad_image')
      if (type !== 'EXIF' && type !== 'XMP ') {
        const chunk = b.slice(o, Math.min(end, b.length))
        if (type === 'VP8X') chunk[8] &= ~0x0c // 清掉 EXIF / XMP 标志位
        keep.push(chunk)
      }
      o = end
    }
    const out = concat([b.slice(0, 12), ...keep])
    new DataView(out.buffer).setUint32(4, out.length - 8, true)
    return out
  }
  // GIF 没有标准的拍摄信息字段
  return b
}
