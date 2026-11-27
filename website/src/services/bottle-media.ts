// 漂流瓶的图片、实况、视频（2026-11-26）。
// 匿名：图片在浏览器里重新绘制后再上传（丢掉拍摄信息），服务器上传时再擦一遍（media-meta.ts）；文件路径是 m/年/月/随机串，不带上传者。
import { fail } from '../lib/http'
import { commitUploadContent } from './upload-operations'
import { scrubMedia } from './media-meta'

export const MAX_BOTTLE_MEDIA = 9
export const MAX_REPLY_MEDIA = 3
export type BottleMedia = { k: string; p?: string; t?: string; w: number | null; h: number | null; kind?: 'g' | 'v' | 'l' }
type In = { key?: unknown; poster?: unknown; thumb?: unknown; w?: unknown; h?: unknown; kind?: unknown }
const size = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 && n <= 20000 ? n : null }
const KEY = /^m\/\d{4}\/\d{2}\/[A-Za-z0-9._-]{4,120}$/

// 校验：文件都是本人刚传、还没用过的；视频 / 实况必须带一张静图
export async function checkMedia(db: D1Database, uid: number, raw: unknown, max: number): Promise<BottleMedia[]> {
  const list = (Array.isArray(raw) ? raw : []) as In[]
  if (list.length > max) fail(400, `最多 ${max} 个图片或视频`)
  const items: BottleMedia[] = [], keys: string[] = []
  for (const r of list) {
    const k = String(r?.key ?? ''), p = r?.poster ? String(r.poster) : '', t = r?.thumb ? String(r.thumb) : ''
    if (![k, p, t].filter(Boolean).every((x) => KEY.test(x)) || !k) fail(400, '附件无效，请重新上传')
    keys.push(k, ...(p ? [p] : []), ...(t ? [t] : []))
    items.push({ k, p: p || undefined, t: t || undefined, w: size(r?.w), h: size(r?.h), kind: r?.kind === 'l' ? 'l' : undefined })
  }
  if (!items.length) return items
  if (new Set(keys).size !== keys.length) fail(400, '附件重复了')
  const { results } = await db.prepare(`SELECT key,mime FROM ${tableOf(uid)} WHERE user_id=? AND used=0 AND key IN (SELECT value FROM json_each(?))`).bind(uid, JSON.stringify(keys)).all<{ key: string; mime: string }>()
  const mime = new Map(results.map((r) => [r.key, r.mime]))
  for (const it of items) {
    const m = mime.get(it.k) ?? fail(400, '文件已失效，请重新上传')
    const still = (key?: string) => !key || mime.get(key)?.startsWith('image/') || fail(400, '文件已失效，请重新上传')
    still(it.p); still(it.t)
    if (m.startsWith('video/')) {
      if (!it.p) fail(400, '视频缺少封面')
      if (it.kind !== 'l') it.kind = 'v'
    } else if (m.startsWith('image/')) {
      it.p = undefined
      it.kind = m === 'image/gif' ? 'g' : undefined
    } else fail(400, '只能发图片和视频')
  }
  return items
}
export const mediaKeysOf = (items: BottleMedia[]) => items.flatMap((m) => [m.k, ...(m.p ? [m.p] : []), ...(m.t ? [m.t] : [])])
// 先认领文件（原子：有一个被别处用掉就整批不成），再建瓶子 / 回信；建失败就放回去，不留半成品
export async function claimMedia<T>(db: D1Database, uid: number, items: BottleMedia[], create: () => Promise<T>): Promise<T> {
  if (!items.length) return create()
  const keys = mediaKeysOf(items), table = tableOf(uid)
  if (table === 'uploads') await commitUploadContent(db, uid, keys, [])
  else {
    // 和 commitUploadContent 一样：数量对不上就让 json() 报错，整批回滚
    const n = new Set(keys).size, list = JSON.stringify(keys)
    try {
      await db.batch([
        db.prepare(`UPDATE bottle_mini_uploads SET used=1 WHERE user_id=? AND used=0 AND key IN (SELECT value FROM json_each(?))
          AND (SELECT COUNT(*) FROM bottle_mini_uploads WHERE user_id=? AND used=0 AND key IN (SELECT value FROM json_each(?)))=?`).bind(uid, list, uid, list, n),
        db.prepare("SELECT json(CASE WHEN changes()=? THEN 'true' ELSE 'upload_claim_conflict' END)").bind(n),
      ])
    } catch { fail(400, '文件已失效或已使用，请重新上传') }
  }
  try { return await create() } catch (e) {
    await db.prepare(`UPDATE ${table} SET used=0 WHERE user_id=? AND key IN (SELECT value FROM json_each(?)) AND key NOT IN (SELECT key FROM bottle_media)`).bind(uid, JSON.stringify(keys)).run().catch(() => {})
    throw e
  }
}
// 小程序里没有网站账号的人（编号是负数）用 bottle_mini_uploads
const tableOf = (uid: number) => (uid < 0 ? 'bottle_mini_uploads' : 'uploads')
const randHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('')
export async function storeMiniUpload(db: D1Database, bucket: R2Bucket, uid: number, bytes: Uint8Array, mime: string, ext: string, t: number) {
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM bottle_mini_uploads WHERE user_id=? AND created_at>?').bind(uid, t - 3600).first<{ n: number }>()
  if ((recent?.n ?? 0) >= 300) fail(429, '传得太多了，过一会儿再来')
  const d = new Date(t * 1000), key = `m/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randHex(12)}.${ext}`
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } })
  await db.prepare('INSERT INTO bottle_mini_uploads(key,user_id,mime,size,used,created_at) VALUES(?,?,?,?,0,?)').bind(key, uid, mime, bytes.length, t).run()
  return { key, mime }
}
// 一天还没用上的删掉（文件和记录）
export async function cleanMiniUploads(db: D1Database, bucket: R2Bucket, t: number) {
  const { results } = await db.prepare('SELECT key FROM bottle_mini_uploads WHERE used=0 AND created_at<? ORDER BY created_at LIMIT 50').bind(t - 86400).all<{ key: string }>()
  if (!results.length) return 0
  const keys = results.map((r) => r.key)
  await bucket.delete(keys)
  await db.prepare('DELETE FROM bottle_mini_uploads WHERE used=0 AND key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).run()
  return keys.length
}
// 写进瓶子 / 回信（文件已认领）
export async function attachMedia(db: D1Database, items: BottleMedia[], target: { bottle: number; reply?: number }) {
  if (!items.length) return
  const keys = mediaKeysOf(items), json = JSON.stringify(items)
  await db.batch([
    target.reply ? db.prepare('UPDATE bottle_replies SET media=? WHERE id=?').bind(json, target.reply) : db.prepare('UPDATE bottles SET media=? WHERE id=?').bind(json, target.bottle),
    db.prepare("INSERT OR IGNORE INTO bottle_media(key,bottle_id,reply_id) SELECT value,?,? FROM json_each(?)").bind(target.bottle, target.reply ?? null, JSON.stringify(keys)),
  ])
}
// 给网站看的：站内图片地址
export function mediaView(raw: string | null | undefined) {
  let list: BottleMedia[] = []
  try { const x = JSON.parse(raw || '[]'); if (Array.isArray(x)) list = x } catch { /* 坏数据当没有 */ }
  return list.map((m) => ({ u: '/img/' + (m.p ?? m.k), ...(m.p ? { v: '/img/' + m.k } : {}), t: '/img/' + (m.t ?? m.p ?? m.k), w: m.w, h: m.h, ...(m.kind ? { k: m.kind } : {}) }))
}

// ---------- 擦掉文件里的个人信息：统一实现见 services/media-meta.ts ----------
export const stripMeta = (bytes: Uint8Array, mime: string): Uint8Array => scrubMedia(bytes, mime)

// 按文件头认类型（和网站上传一致）；HEIC 浏览器看不了，不收
export function sniffMedia(b: Uint8Array): [string, string] | 'heic' | null {
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return ['image/png', 'png']
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return ['image/jpeg', 'jpg']
  if (b[0] === 71 && b[1] === 73 && b[2] === 70) return ['image/gif', 'gif']
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return ['image/webp', 'webp']
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    if (/^(heic|heix|hevc|mif1|msf1|avif)$/.test(brand)) return 'heic'
    return brand === 'qt  ' ? ['video/quicktime', 'mov'] : ['video/mp4', 'mp4']
  }
  if (b[0] === 26 && b[1] === 69 && b[2] === 223 && b[3] === 163) return ['video/webm', 'webm']
  return null
}
