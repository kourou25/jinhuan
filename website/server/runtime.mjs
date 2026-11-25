// Cloudflare 运行时里除 D1 / R2 之外的东西：静态资源（ASSETS）、边缘缓存（caches.default）、限流、HTMLRewriter。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

// ---------- 静态资源：模拟 [assets] binding（not_found_handling = single-page-application） ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.atlas': 'text/plain; charset=utf-8', '.skel': 'application/octet-stream' }
export const contentType = (file) => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
export class Assets {
  constructor(root) { this.root = path.resolve(root) }
  async _file(p) {
    const full = path.join(this.root, p)
    if (!full.startsWith(this.root)) return null
    try { const st = await fsp.stat(full); return st.isFile() ? full : null } catch { return null }
  }
  async fetch(input) {
    // 业务代码会传 Request、URL 对象或字符串
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url)
    let p = decodeURIComponent(url.pathname)
    if (p.endsWith('/')) p += 'index.html'
    // /foo 找 foo.html。不把 /foo.html 307 到 /foo：业务代码会用 ASSETS.fetch('/app.html') 取页面壳再原样返回，
    // 跳转会把浏览器从 /login 带到 /app，前端路由没有 /app 于是显示 404。浏览器直接请求的 .html 由 nginx try_files 处理。
    const file = await this._file(p) || (!path.extname(p) && await this._file(p + '.html')) || await this._file('/index.html') // 与线上一致：找不到的路径一律回落到 index.html
    if (!file) return new Response('Not Found', { status: 404 })
    const body = fs.createReadStream(file)
    return new Response(ReadableStreamFrom(body), { headers: { 'content-type': contentType(file), 'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=0, must-revalidate' } })
  }
}
const ReadableStreamFrom = (nodeStream) => new ReadableStream({
  start(c) { nodeStream.on('data', (d) => c.enqueue(new Uint8Array(d))); nodeStream.on('end', () => c.close()); nodeStream.on('error', (e) => c.error(e)) },
  cancel() { nodeStream.destroy() },
})

// ---------- 边缘缓存：caches.default，存在磁盘上，按 cache-control 的 max-age 过期 ----------
export class DiskCache {
  constructor(root, { maxBytes = 25 * 1024 * 1024 } = {}) { this.root = path.resolve(root); this.maxBytes = maxBytes; fs.mkdirSync(this.root, { recursive: true }) }
  _key(req) { const url = typeof req === 'string' ? req : req.url; const h = crypto.createHash('sha256').update(url).digest('hex'); return path.join(this.root, h.slice(0, 2), h) }
  async match(req) {
    const base = this._key(req)
    try {
      const meta = JSON.parse(await fsp.readFile(base + '.json', 'utf8'))
      if (meta.expires && meta.expires < Date.now()) { this.delete(req); return undefined }
      return new Response(await fsp.readFile(base + '.bin'), { status: meta.status, headers: meta.headers })
    } catch { return undefined }
  }
  async put(req, res) {
    const cc = res.headers.get('cache-control') || '', m = /s-maxage=(\d+)/.exec(cc) || /max-age=(\d+)/.exec(cc)
    if (/no-store|private/.test(cc) || res.status !== 200) return
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length > this.maxBytes) return
    const base = this._key(req)
    await fsp.mkdir(path.dirname(base), { recursive: true })
    const headers = [...res.headers].filter(([k]) => !['set-cookie', 'content-length'].includes(k))
    await fsp.writeFile(base + '.bin', body)
    await fsp.writeFile(base + '.json', JSON.stringify({ status: res.status, headers, expires: m ? Date.now() + Number(m[1]) * 1000 : Date.now() + 3600e3 }))
  }
  async delete(req) { const base = this._key(req); await fsp.rm(base + '.bin', { force: true }); await fsp.rm(base + '.json', { force: true }); return true }
}

// ---------- 限流：[[ratelimits]] simple = { limit, period } ----------
export class RateLimiter {
  constructor({ limit = 10, period = 60 } = {}) { this.max = limit; this.period = period * 1000; this.hits = new Map() } // 字段别叫 limit，会盖住 limit() 方法
  async limit({ key }) {
    const now = Date.now(), list = (this.hits.get(key) || []).filter((t) => now - t < this.period)
    const success = list.length < this.max
    if (success) list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > 50000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.period)) this.hits.delete(k)
    return { success }
  }
}

// ---------- HTMLRewriter：只实现业务用到的部分（title / meta / head 选择器；getAttribute、setAttribute、setInnerContent、append） ----------
const parseAttrs = (tag) => { const a = {}; for (const m of tag.matchAll(/([^\s=<>\/"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) if (m.index > 0) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''; return a }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const matchSel = (sel) => { const m = /^([a-z]+)(?:\[([a-z-]+)(?:=\"?([^\"\]]*)\"?)?\])?$/i.exec(sel.trim()); return m ? { tag: m[1].toLowerCase(), attr: m[2]?.toLowerCase(), val: m[3] } : null }
export class HTMLRewriter {
  constructor() { this.handlers = [] }
  on(selector, handler) { const s = matchSel(selector); if (s) this.handlers.push({ s, handler }); return this }
  transform(response) {
    const handlers = this.handlers
    const promise = (async () => {
      let html = await response.text()
      for (const { s, handler } of handlers) {
        if (!handler.element) continue
        if (s.tag === 'head' || s.tag === 'title') {
          const re = new RegExp(`<${s.tag}(\\s[^>]*)?>([\\s\\S]*?)</${s.tag}>`, 'i')
          html = html.replace(re, (all, attrs = '', inner) => {
            let content = inner, appended = ''
            const el = { tagName: s.tag, getAttribute: (k) => parseAttrs(`<x${attrs}>`)[k.toLowerCase()] ?? null, setAttribute() {}, setInnerContent: (t, o) => { content = o?.html ? t : esc(t) }, append: (t, o) => { appended += o?.html ? t : esc(t) }, prepend: (t, o) => { content = (o?.html ? t : esc(t)) + content } }
            handler.element(el)
            return `<${s.tag}${attrs}>${content}${appended}</${s.tag}>`
          })
          continue
        }
        html = html.replace(new RegExp(`<${s.tag}\\b[^>]*>`, 'gi'), (tag) => {
          const attrs = parseAttrs(tag)
          if (s.attr && (s.val === undefined ? !(s.attr in attrs) : attrs[s.attr] !== s.val)) return tag
          let changed = false
          const el = { tagName: s.tag, getAttribute: (k) => attrs[k.toLowerCase()] ?? null, hasAttribute: (k) => k.toLowerCase() in attrs, setAttribute: (k, v) => { attrs[k.toLowerCase()] = v; changed = true }, removeAttribute: (k) => { delete attrs[k.toLowerCase()]; changed = true } }
          handler.element(el)
          return changed ? `<${s.tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>` : tag
        })
      }
      return html
    })()
    const headers = new Headers(response.headers); headers.delete('content-length')
    return new Response(new ReadableStream({ async start(c) { try { c.enqueue(new TextEncoder().encode(await promise)); c.close() } catch (e) { c.error(e) } } }), { status: response.status, headers })
  }
}
