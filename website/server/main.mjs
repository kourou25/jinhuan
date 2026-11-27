// 尽欢服务器入口：在 Node.js 上运行原 Cloudflare Worker（2026-11-23 起迁移到自有服务器）。
// Nginx 直接发静态文件，其余请求转发到这里（默认 127.0.0.1:8080）。
//   MEME_ROOT=/meme node server/main.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { D1Database, dumpSlowQueries } from './d1.mjs'
import { R2Bucket } from './r2.mjs'
import { Assets, DiskCache, RateLimiter, HTMLRewriter } from './runtime.mjs'
import { fetchPublicHttp } from './public-http.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.MEME_ROOT || '/meme'
const PORT = Number(process.env.PORT || 8080), HOST = process.env.HOST || '127.0.0.1'
const CLIENT = process.env.CLIENT_DIR || path.join(here, '..', 'client')

// ---------- 配置：公开变量（构建时从 wrangler.toml 导出）+ 机密（/meme/config/.env） ----------
const readEnvFile = (file) => {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m) continue
    let v = m[2]; if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const vars = JSON.parse(fs.readFileSync(path.join(here, 'vars.json'), 'utf8'))
const secrets = readEnvFile(process.env.ENV_FILE || path.join(ROOT, 'config', '.env'))

// ---------- Cloudflare 运行时的替代品 ----------
globalThis.HTMLRewriter = HTMLRewriter
const cache = new DiskCache(path.join(ROOT, 'cache', 'http'))
globalThis.caches = { default: cache, open: async () => cache }

const db = new D1Database(path.join(ROOT, 'data', 'db', 'meme-hall.sqlite'))
const sandboxFile = path.join(ROOT, 'data', 'db', 'miniapp-sandbox.sqlite')
const env = {
  ...vars, ...secrets,
  COMMUNITY_GITHUB_TOKEN: process.env.COMMUNITY_GITHUB_TOKEN ?? secrets.COMMUNITY_GITHUB_TOKEN,
  PUBLIC_BOT_CALLBACK: fetchPublicHttp,
  DB: db, MINIAPP_DB: db,
  MINIAPP_SANDBOX_DB: fs.existsSync(sandboxFile) ? new D1Database(sandboxFile) : undefined,
  BUCKET: new R2Bucket(path.join(ROOT, 'data', 'storage')),
  ASSETS: new Assets(CLIENT),
  AUTH_RL: new RateLimiter({ limit: 10, period: 60 }),
  // GAME_HUB（猜词服务 cc.52dmeme.com）已下线；JEV_RELAY 是 AI 网关的可选中转，不配置时直连
}

const { default: worker } = await import(pathToApp())
function pathToApp() { return new URL('./dist/app.mjs', import.meta.url).href }

// ---------- 后台任务（ctx.waitUntil） ----------
const pending = new Set()
const ctx = () => ({
  waitUntil(p) { const t = Promise.resolve(p).catch((e) => console.error('waitUntil', e?.stack || e)).finally(() => pending.delete(t)); pending.add(t) },
  passThroughOnException() {},
  props: {},
})

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  try {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
    const url = new URL(req.url, `${proto}://${host}`)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (v != null && !k.startsWith(':')) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
    const hasBody = !['GET', 'HEAD'].includes(req.method)
    const request = new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: hasBody ? 'half' : undefined, redirect: 'manual' })
    // request.cf：经 Cloudflare 代理时国家代码在 CF-IPCountry 里
    Object.defineProperty(request, 'cf', { value: { country: headers.get('cf-ipcountry') || undefined, colo: 'self' } })
    const response = await worker.fetch(request, env, ctx())
    const out = {}
    // content-length 不透传：中间件改写响应体后旧长度可能还留在头里（Hono 会抄回旧头），交给 Node 自己分块
    for (const [k, v] of response.headers) if (k !== 'set-cookie' && k !== 'content-length') out[k] = v
    const cookies = response.headers.getSetCookie?.() || []
    if (cookies.length) out['set-cookie'] = cookies
    res.writeHead(response.status, out)
    if (!response.body || req.method === 'HEAD') return res.end()
    Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res)
  } catch (error) {
    console.error('request_failed', req.method, req.url, error?.stack || error)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '服务器开小差了' }))
  }
})
server.keepAliveTimeout = 65000
server.listen(PORT, HOST, () => console.info(`meme-hall listening on ${HOST}:${PORT}`))

// ---------- 定时任务（原 wrangler.toml 的 triggers.crons） ----------
let cronBusy = false
async function tick() {
  if (cronBusy) return console.warn('cron_skipped_busy')
  cronBusy = true
  const now = new Date(), crons = ['* * * * *']
  if (now.getUTCMinutes() % 5 === 0) crons.push('*/5 * * * *')
  if (now.getUTCHours() === 1 && now.getUTCMinutes() === 0) crons.push('0 1 * * *')
  try {
    for (const cron of crons) {
      const c = ctx()
      try { await worker.scheduled({ cron, scheduledTime: Math.floor(now.getTime() / 60000) * 60000, type: 'scheduled' }, env, c) } catch (e) { console.error('cron_failed', cron, e?.stack || e) }
    }
  } finally { cronBusy = false }
}
let cronTimer = null
if (process.env.DISABLE_CRON !== '1') {
  const align = () => { cronTimer = setTimeout(() => { tick(); align() }, 60000 - (Date.now() % 60000) + 500) }
  align()
}

// 慢查询每分钟写一次日志；统计信息每 6 小时刷新一次
const SLOW_FILE = path.join(ROOT, 'logs', 'slow-sql.json')
const slowTimer = setInterval(() => { try { dumpSlowQueries(SLOW_FILE) } catch (e) { console.error('slow_dump_failed', e?.message) } }, 60000)
const optimizeTimer = setInterval(() => db.optimize(), 6 * 3600e3)

// ---------- 退出 ----------
const shutdown = async (sig) => {
  console.info('shutdown', sig)
  clearTimeout(cronTimer); clearInterval(slowTimer); clearInterval(optimizeTimer)
  try { dumpSlowQueries(SLOW_FILE) } catch {}
  server.close()
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 10000))])
  db.close(); env.MINIAPP_SANDBOX_DB?.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
