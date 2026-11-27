// 漂流瓶小程序的头像：小程序不能加载网络图片，由服务器取来转成 base64。
// 只取 L 站 / 站内存储 / 常见登录头像的地址，每一跳都检查主机；小程序拿到的是 key（地址哈希），看不出是谁。
import type { Env } from '../env'
import { sha256 } from '../lib/crypto'
import { now } from '../lib/time'

const HOSTS = /^(?:cdn\.ldstatic\.com|linux\.do|lh3\.googleusercontent\.com|avatars\.githubusercontent\.com)$/
const MAX = 40_000 // base64 后约 53 KB，小程序单次响应上限 64 KB
const safe = (u: URL) => u.protocol === 'https:' && !u.port && !u.username && !u.password && HOSTS.test(u.hostname)
// L 站头像统一取 48 像素
const small = (url: string) => url.replace(/(\/user_avatar\/[^/]+\/[^/]+\/)\d+\//, '$148/')
export const ldAvatar = (username: string) => `https://linux.do/user_avatar/linux.do/${encodeURIComponent(username)}/48/1_2.png`

export function usable(url: string | null | undefined): url is string {
  if (!url) return false
  if (/^\/img\/[A-Za-z0-9/_.-]{1,300}$/.test(url) && !url.includes('..')) return true
  if (/^\/assets\/anon\/[a-z0-9]{1,20}\/\d{3}\.webp$/.test(url)) return true // 1 群匿名系统的像素头像
  try { return safe(new URL(url)) } catch { return false }
}
const memo = new Map<string, string>()
export async function avatarKey(db: D1Database, url: string | null | undefined) {
  if (!usable(url)) return null
  const hit = memo.get(url)
  if (hit) return hit
  const key = (await sha256('bottle-avatar|' + url)).slice(0, 24)
  await db.prepare('INSERT OR IGNORE INTO bottle_avatars(key,url,created_at) VALUES(?,?,?)').bind(key, url, now()).run()
  if (memo.size > 5000) memo.clear()
  memo.set(url, key)
  return key
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s) }
export async function avatarData(env: Env, db: D1Database, key: string): Promise<{ mime: string; b64: string } | null> {
  if (!/^[0-9a-f]{24}$/.test(key)) return null
  const row = await db.prepare('SELECT url FROM bottle_avatars WHERE key=?').bind(key).first<{ url: string }>()
  if (!row || !usable(row.url)) return null
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null
  const cacheKey = new Request('https://52dmeme.com/__bottle-avatar/' + key)
  const hit = await cache?.match(cacheKey)
  if (hit) return { mime: hit.headers.get('content-type') || 'image/png', b64: b64(new Uint8Array(await hit.arrayBuffer())) }
  let bytes: Uint8Array | null = null, mime = ''
  try {
    if (row.url.startsWith('/assets/anon/')) {
      const res = await env.ASSETS.fetch(new Request('https://52dmeme.com' + row.url))
      // 找不到文件时会回退成首页 HTML（状态码仍是 200），按内容类型确认是图片
      const buf = res.ok && /^image\/webp/.test(res.headers.get('content-type') || '') ? new Uint8Array(await res.arrayBuffer()) : (await res.body?.cancel(), null)
      if (buf && buf.length <= MAX) { bytes = buf; mime = 'image/webp' }
    } else if (row.url.startsWith('/img/')) {
      const obj = await env.BUCKET.get(row.url.slice(5))
      if (obj && obj.size <= MAX) { bytes = new Uint8Array(await obj.arrayBuffer()); mime = obj.httpMetadata?.contentType || 'image/png' }
    } else {
      let url = new URL(small(row.url)), res: Response | null = null
      for (let hop = 0; hop < 3; hop++) {
        res = await fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(3000), headers: { accept: 'image/*' } })
        if (res.status < 300 || res.status >= 400) break
        const next = new URL(res.headers.get('location') || '', url)
        await res.body?.cancel()
        if (!safe(next)) return null
        url = next; res = null
      }
      mime = res?.headers.get('content-type')?.split(';')[0] || ''
      if (res?.ok && /^image\/(png|jpeg|webp|gif)$/.test(mime)) {
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.length <= MAX) bytes = buf
      } else await res?.body?.cancel()
    }
  } catch { return null }
  if (!bytes || !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(mime) || mime === 'image/svg+xml') return null
  await cache?.put(cacheKey, new Response(bytes, { headers: { 'content-type': mime, 'cache-control': 'public, max-age=604800' } })).catch(() => {})
  return { mime, b64: b64(bytes) }
}
