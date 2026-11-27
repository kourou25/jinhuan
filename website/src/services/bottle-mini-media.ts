// 小程序里的图片、视频、表情（2026-11-26）。
// 图片：按原始字节给（平台把字节转成 Blob 显示）。只给这个人看得到的瓶子 / 回信里的文件。
// 视频：平台播放器只认分片 MP4，第一次有人看时把原视频重新封装（不重新编码），存成 bv/<原 key>/{vi,vs,ai,as}，
// 再给一份节目单（每段带 SHA-256 和大小，平台会核对）。重新封装不了的（如 WebM）返回 playable:false，只显示封面。
import type { Env } from '../env'
import { fail } from '../lib/http'
import * as S from './bottles'
import { fragment } from './bottle-video'

const KEY = /^m\/\d{4}\/\d{2}\/[A-Za-z0-9._-]{4,120}$/
const IMAGE_MAX = 15 * 1024 * 1024, VIDEO_MAX = 21 * 1024 * 1024, STICKER_MAX = 40_000
const PIECES = ['vi', 'vs', 'ai', 'as'] as const
type Piece = typeof PIECES[number]
type Viewer = { id: number; is_admin: 0; mini: true }
const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s) }
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
const pieceKey = (key: string, p: Piece) => `bv/${key}/${p}`
const pieceMime = (p: Piece) => (p[0] === 'v' ? 'video/mp4' : 'audio/mp4')

// 文件在不在这个人看得到的瓶子里
async function visible(db: D1Database, a: Viewer, key: string) {
  if (!KEY.test(key)) return fail(400, '参数不正确')
  const row = await db.prepare('SELECT m.bottle_id,COALESCE(u.mime,x.mime) AS mime FROM bottle_media m LEFT JOIN uploads u ON u.key=m.key LEFT JOIN bottle_mini_uploads x ON x.key=m.key WHERE m.key=?').bind(key).first<{ bottle_id: number; mime: string | null }>()
  if (!row?.mime) return fail(404, '文件不可用')
  await S.needBottle(db, row.bottle_id, a)
  return row.mime
}

// 图片原图 / 缩略图 / 视频封面；p 是视频分片
export async function mediaFile(env: Env, db: D1Database, a: Viewer, key: string, p: string | null): Promise<{ bytes: Uint8Array; mime: string }> {
  const mime = await visible(db, a, key)
  if (!p) {
    if (!mime.startsWith('image/')) return fail(404, '文件不可用')
    const obj = await env.BUCKET.get(key)
    if (!obj) return fail(404, '文件不可用')
    if (obj.size > IMAGE_MAX) { await obj.body?.cancel?.(); return fail(413, '图片太大') }
    return { bytes: new Uint8Array(await obj.arrayBuffer()), mime }
  }
  if (!mime.startsWith('video/') || !PIECES.includes(p as Piece)) return fail(404, '文件不可用')
  const obj = await env.BUCKET.get(pieceKey(key, p as Piece))
  if (!obj) return fail(404, '视频还没准备好')
  return { bytes: new Uint8Array(await obj.arrayBuffer()), mime: pieceMime(p as Piece) }
}

type Program = Record<string, unknown>
// 节目单：第一次请求时生成并存起来
export async function videoProgram(env: Env, db: D1Database, a: Viewer, key: string): Promise<{ playable: boolean; program?: Program }> {
  const mime = await visible(db, a, key)
  if (!mime.startsWith('video/')) return fail(404, '文件不可用')
  const cached = await env.BUCKET.get(`bv/${key}/program.json`)
  if (cached) return JSON.parse(new TextDecoder().decode(await cached.arrayBuffer()))
  const out = await buildProgram(env, key)
  await env.BUCKET.put(`bv/${key}/program.json`, JSON.stringify(out), { httpMetadata: { contentType: 'application/json' } })
  return out
}
async function buildProgram(env: Env, key: string): Promise<{ playable: boolean; program?: Program }> {
  const obj = await env.BUCKET.get(key)
  if (!obj) return fail(404, '文件不可用')
  if (obj.size > VIDEO_MAX) { await obj.body?.cancel?.(); return { playable: false } }
  const tracks = fragment(new Uint8Array(await obj.arrayBuffer()))
  if (!tracks) return { playable: false }
  const video = tracks.find((t) => t.kind === 'video')!, audio = tracks.find((t) => t.kind === 'audio')
  const source = async (p: Piece, bytes: Uint8Array) => {
    await env.BUCKET.put(pieceKey(key, p), bytes, { httpMetadata: { contentType: pieceMime(p) } })
    return { endpoint: 'file', query: { k: key, p }, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)), size: bytes.length, mime: pieceMime(p) }
  }
  const track = async (t: typeof video, id: string, ip: Piece, sp: Piece) => ({
    id, mime: `${t.kind}/mp4; codecs="${t.codec}"`, init: await source(ip, t.init),
    segments: [{ id: id + '0', start: 0, duration: t.duration, source: await source(sp, t.seg) }],
  })
  // 音轨要覆盖整段可播放时间：节目时长取两者较短的
  const duration = audio ? Math.min(video.duration, audio.duration) : video.duration
  const program: Program = {
    variants: [{ id: 'src', bandwidth: Math.max(1, Math.round((video.seg.length * 8) / Math.max(video.duration, 0.1))), video: await track(video, 'v', 'vi', 'vs') }],
    ...(audio ? { audioTracks: [await track(audio, 'a', 'ai', 'as')] } : {}),
    duration,
  }
  return { playable: true, program }
}

// k 形如 bb:doge；文件在 /stickers/包/名.后缀（后缀不固定，挨个试）
export async function stickerData(env: Env, k: string) {
  const m = /^([a-z]{1,20}):([a-z0-9_]{1,60})$/.exec(k)
  if (!m) return null
  for (const ext of ['png', 'gif', 'webp']) {
    const res = await env.ASSETS.fetch(new Request(`https://52dmeme.com/stickers/${m[1]}/${m[2]}.${ext}`))
    const type = res.headers.get('content-type') || ''
    // 找不到文件时会回退成首页 HTML，按内容类型确认
    if (!res.ok || !type.startsWith('image/')) { await res.body?.cancel(); continue }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytes.length <= STICKER_MAX ? { mime: type.split(';')[0], b64: b64(bytes) } : null
  }
  return null
}
