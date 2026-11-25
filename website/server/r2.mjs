// R2 兼容层：对象存到本地磁盘（/meme/data/storage/<key>），元数据存到 /meme/data/storage-meta/<key>.json。
// 实现业务代码用到的 get / put / delete / head / list，以及对象上的 body、range、httpMetadata、writeHttpMetadata 等。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { contentType } from './runtime.mjs'

const safeKey = (key) => {
  const k = String(key)
  if (!k || k.length > 1024 || k.startsWith('/') || k.includes('\0') || k.split('/').some((p) => p === '..' || p === '.')) throw Error('invalid object key')
  return k
}
const toBuffer = async (value) => {
  if (value == null) return Buffer.alloc(0)
  if (typeof value === 'string') return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value.arrayBuffer === 'function') return Buffer.from(await value.arrayBuffer()) // Blob / Response
  if (typeof value.getReader === 'function') return Buffer.from(await new Response(value).arrayBuffer()) // ReadableStream
  throw Error('unsupported R2 value')
}
// Range：D1 代码会传入请求头（Headers）或 {offset,length,suffix}
const parseRange = (range, size) => {
  if (!range) return null
  let spec = range
  if (typeof range.get === 'function') {
    const h = range.get('range'); if (!h) return null
    const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim()); if (!m) return null
    if (m[1] === '' && m[2] !== '') spec = { suffix: Number(m[2]) }
    else spec = { offset: Number(m[1] || 0), ...(m[2] !== '' ? { length: Number(m[2]) - Number(m[1] || 0) + 1 } : {}) }
  }
  if (spec.suffix != null) { const len = Math.min(size, spec.suffix); return { offset: size - len, length: len } }
  const offset = Math.min(size, Math.max(0, spec.offset ?? 0))
  const length = Math.max(0, Math.min(size - offset, spec.length ?? size - offset))
  return { offset, length }
}

class R2Object {
  constructor(key, meta) {
    this.key = key; this.size = meta.size; this.etag = meta.etag; this.httpEtag = `"${meta.etag}"`
    this.uploaded = new Date(meta.uploaded); this.httpMetadata = meta.httpMetadata || {}; this.customMetadata = meta.customMetadata || {}
    this.version = meta.etag; this.checksums = {}; this.storageClass = 'Standard'
  }
  writeHttpMetadata(headers) {
    const h = this.httpMetadata
    if (h.contentType) headers.set('content-type', h.contentType)
    if (h.contentLanguage) headers.set('content-language', h.contentLanguage)
    if (h.contentDisposition) headers.set('content-disposition', h.contentDisposition)
    if (h.contentEncoding) headers.set('content-encoding', h.contentEncoding)
    if (h.cacheControl) headers.set('cache-control', h.cacheControl)
    if (h.cacheExpiry) headers.set('expires', new Date(h.cacheExpiry).toUTCString())
  }
}
class R2ObjectBody extends R2Object {
  constructor(key, meta, file, range) {
    super(key, meta)
    this.file = file
    this.range = range ? { offset: range.offset, length: range.length } : undefined
    const opts = range ? { start: range.offset, end: range.offset + range.length - 1 } : {}
    this._stream = range && range.length === 0 ? null : fs.createReadStream(file, opts)
    this.body = this._stream ? Readable.toWeb(this._stream) : new ReadableStream({ start(c) { c.close() } })
    this.bodyUsed = false
  }
  async arrayBuffer() { this.bodyUsed = true; const b = await new Response(this.body).arrayBuffer(); return b }
  async text() { return new TextDecoder().decode(await this.arrayBuffer()) }
  async json() { return JSON.parse(await this.text()) }
  async blob() { return new Blob([await this.arrayBuffer()], { type: this.httpMetadata.contentType || '' }) }
}

export class R2Bucket {
  constructor(root) { this.root = path.resolve(root); this.metaRoot = this.root + '-meta'; fs.mkdirSync(this.root, { recursive: true }); fs.mkdirSync(this.metaRoot, { recursive: true }) }
  _paths(key) { const k = safeKey(key); return { file: path.join(this.root, k), meta: path.join(this.metaRoot, k + '.json') } }
  async _meta(key) {
    const { file, meta } = this._paths(key)
    try { return JSON.parse(await fsp.readFile(meta, 'utf8')) } catch {}
    // 没有元数据（例如直接拷进来的文件）：按文件本身补一份
    // 没有元数据文件（例如从 R2 直接同步过来的对象）：按扩展名给类型，用大小和修改时间做 etag
    try { const st = await fsp.stat(file); if (!st.isFile()) return null; const ct = contentType(file); return { size: st.size, etag: st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16), uploaded: st.mtimeMs, httpMetadata: ct === 'application/octet-stream' ? {} : { contentType: ct }, customMetadata: {} } } catch { return null }
  }
  async head(key) { const m = await this._meta(key); return m ? new R2Object(String(key), m) : null }
  async get(key, opts = {}) {
    const m = await this._meta(key); if (!m) return null
    const { file } = this._paths(key)
    return new R2ObjectBody(String(key), m, file, parseRange(opts.range, m.size))
  }
  async put(key, value, opts = {}) {
    const { file, meta } = this._paths(key), data = await toBuffer(value)
    const httpMetadata = opts.httpMetadata instanceof Headers ? { contentType: opts.httpMetadata.get('content-type') || undefined } : { ...(opts.httpMetadata || {}) }
    const record = { size: data.length, etag: crypto.createHash('md5').update(data).digest('hex'), uploaded: Date.now(), httpMetadata, customMetadata: { ...(opts.customMetadata || {}) } }
    await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.mkdir(path.dirname(meta), { recursive: true })
    const tmp = file + '.tmp-' + crypto.randomUUID()
    await fsp.writeFile(tmp, data); await fsp.rename(tmp, file)
    await fsp.writeFile(meta, JSON.stringify(record))
    return new R2Object(String(key), record)
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const { file, meta } = this._paths(key)
      await fsp.rm(file, { force: true }); await fsp.rm(meta, { force: true })
    }
  }
  async list(opts = {}) {
    const prefix = opts.prefix || '', limit = Math.min(1000, opts.limit || 1000), out = []
    const walk = async (dir, rel) => {
      let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
        const k = rel ? rel + '/' + e.name : e.name
        if (e.isDirectory()) { if (k.startsWith(prefix) || prefix.startsWith(k + '/')) await walk(path.join(dir, e.name), k) }
        else if (k.startsWith(prefix) && !e.name.includes('.tmp-')) out.push(k)
      }
    }
    await walk(this.root, '')
    const start = opts.cursor ? out.indexOf(opts.cursor) + 1 : 0, page = out.slice(start, start + limit)
    return { objects: await Promise.all(page.map(async (k) => new R2Object(k, await this._meta(k)))), truncated: start + limit < out.length, cursor: page.at(-1), delimitedPrefixes: [] }
  }
}
