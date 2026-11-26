// 使用目标工作树的 Node 构建和一次性 SQLite。有共建页面时使用其前端构建验收浏览器。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { deniedTitle, feature, fix, interruptedTitle, issuePath, token } from './test-community-hub-fetch.mjs'

const { values } = parseArgs({ options: {
  'work-dir': { type: 'string' }, 'skin-root': { type: 'string' }, 'api-only': { type: 'boolean' },
  'website-root': { type: 'string' }, 'expect-backend': { type: 'string' },
  help: { type: 'boolean' },
} })
if (values.help) {
  console.log('前置构建  在目标工作树执行 npm run build:server；验收浏览器还需 npm run build')
  console.log('用法  node scripts/test-community-hub.mjs --work-dir <隔离工作目录> --skin-root <星光票根公开稿件目录> [--api-only]')
  console.log('可选  --website-root <目标仓库根目录或 website 目录> --expect-backend <legacy|sync>')
  process.exit(0)
}
assert(values['work-dir'] && values['skin-root'], '请指定一次性工作目录和星光票根公开稿件目录')
assert(values['expect-backend'] === undefined || ['legacy', 'sync'].includes(values['expect-backend']), '预期服务端能力只能是 legacy 或 sync')

const target = values['website-root'] ? resolve(values['website-root']) : fileURLToPath(new URL('..', import.meta.url))
const website = existsSync(join(target, 'website/server/main.mjs')) ? join(target, 'website') : target
const client = join(website, 'web/dist/client')
assert(existsSync(join(website, 'server/dist/app.mjs')), '请先执行 npm run build:server')
const browserAvailable = existsSync(join(website, 'public/community-hub.js'))
if (browserAvailable && !values['api-only']) {
  assert(['index.html', 'community-hub.js'].every(file => existsSync(join(client, file))), '请先执行 npm run build')
}
mkdirSync(values['work-dir'], { recursive: true })
const root = mkdtempSync(join(resolve(values['work-dir']), 'run-'))
const key = randomUUID()
const source = '1'.repeat(40)
const pendingSource = '2'.repeat(40)
const skinId = 'shiratori-starlight'
const pendingId = 'fixture-pending-skin'
const otherId = 'fixture-other-skin'
const otherSkinTitle = '本地验收另一套票根'
const database = join(root, 'data/db/meme-hall.sqlite')
const envFile = join(root, 'config/.env')
const mockFile = fileURLToPath(new URL('./test-community-hub-fetch.mjs', import.meta.url))
const postsFile = join(root, 'github.ndjson')
const browserFile = fileURLToPath(new URL('./test-community-hub-browser.py', import.meta.url))
let server, origin, db

async function seedCatalog(skinRoot, backend) {
  const manifest = JSON.parse(readFileSync(join(skinRoot, 'manifest.json'), 'utf8'))
  assert.equal(manifest.id, skinId, '预览夹具必须使用星光票根稿件')
  const compiler = pathToFileURL(join(website, '../skins/scripts/community-css.mjs'))
  const require = createRequire(pathToFileURL(join(website, 'package.json')))
  // 复用站点已有的 PostCSS；装扮编译器在同一仓库的独立包目录。
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'postcss' && context.parentURL === compiler.href) {
      return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let compile
  try { ({ compileCommunityCss: compile } = await import(compiler.href)) } finally { hook.deregister() }

  const { R2Bucket } = await import(pathToFileURL(join(website, 'server/r2.mjs')).href)
  const bucket = new R2Bucket(join(root, 'data/storage'))
  const { id, name, author, github, license } = manifest
  const entry = { id, name, author, github, license, components: {} }
  const other = { ...entry, id: otherId, name: otherSkinTitle, components: {} }
  for (const kind of ['bubble', 'title']) {
    const original = readFileSync(join(skinRoot, manifest.components[kind].file), 'utf8')
    const sha256 = createHash('sha256').update(original).digest('hex')
    for (const skin of [entry, other]) {
      const css = compile(original, skin.id, kind)
      skin.components[kind] = { sha256, type: 'text/css' }
      await bucket.put(`community-skins/css/${skin.id}/${kind}/${sha256}`, css, { httpMetadata: { contentType: 'text/css' } })
    }
  }
  const catalog = { schemaVersion: 1, revision: 1, source, entries: [entry, other], archived: [] }
  if (backend === 'sync') {
    catalog.recentUpdates = catalog.entries.map(skin => ({ source, id: skin.id, name: skin.name, kind: 'added', published_at: 1_790_000_000 }))
    writeFileSync(join(root, 'pending-catalog.json'), JSON.stringify({
      schemaVersion: catalog.schemaVersion, source: pendingSource, revision: 2,
      entries: [...catalog.entries, { ...entry, id: pendingId, name: '等待同步的夹具票根' }],
    }))
  }
  await bucket.put('community-skins/catalog.json', JSON.stringify(catalog), { httpMetadata: { contentType: 'application/json' } })
}

async function start(withToken) {
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = String(portProbe.address().port)
  await new Promise(resolve => portProbe.close(resolve))
  origin = 'http://127.0.0.1:' + port
  const credential = withToken ? token : ''
  writeFileSync(envFile, `DEV_LOGIN_KEY=${key}\nRATE_LIMIT=off\nMAIN_ACTIVATION=off\nCOMMUNITY_GITHUB_TOKEN=${credential}\n`, { mode: 0o600 })
  server = spawn(process.execPath, ['--import', mockFile, 'server/main.mjs'], { cwd: website, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, NODE_OPTIONS: '', HOST: '127.0.0.1', PORT: port, MEME_ROOT: root,
    ENV_FILE: envFile, CLIENT_DIR: client, DISABLE_CRON: '1',
    COMMUNITY_GITHUB_TOKEN: credential, COMMUNITY_HUB_E2E_ROOT: root, COMMUNITY_HUB_E2E_ORIGIN: origin,
  } })
  let log = ''
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-12000) })
  for (let i = 0; i < 160 && server.exitCode === null; ++i) {
    if (await fetch(origin + '/api/me').then(response => response.ok).catch(() => false)) return
    await delay(50)
  }
  throw Error('本地服务未启动\n' + log)
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode) return
  const finished = once(server, 'exit')
  server.kill('SIGTERM')
  await finished
}

async function login(username, admin = false) {
  const response = await fetch(origin + '/auth/dev', {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ key, username, admin: admin ? '1' : '0', tl: '2' }),
  })
  assert.equal(response.status, 302, '本地开发登录失败')
  db.prepare('UPDATE users SET created_at = unixepoch() - 31 * 86400, main_activated_at = unixepoch() WHERE username = ?').run(username)
  return response.headers.getSetCookie().find(cookie => cookie.startsWith('sid=')).split(';')[0]
}

async function api(path, { cookie, method = 'GET', body, sender = origin } = {}) {
  const response = await fetch(origin + path, { method, redirect: 'manual', headers: {
    origin: sender, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
  }, body: body && JSON.stringify(body) })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data }
}

function expectStatus(result, expected, what) {
  assert.equal(result.status, expected, `${what}，结果 ${JSON.stringify(result)}`)
  return result.data
}

const post = (path, cookie, body, sender) => api(path, { method: 'POST', cookie, body, sender })
const sync = (id, cookie, body, sender) => post(`/api/road/${id}/github`, cookie, body, sender)
const road = '/api/road'
const draft = { title: '愿意公开的夹具标题', body: '愿意公开的夹具正文' }
const privateBody = '站内反馈保留原文。site-only-e2e-feedback'
const sample = { kind: 'bug', title: '站内反馈夹具', body: privateBody, skin_id: skinId, skin_source: source }
const syncColumns = ['skin_id', 'skin_source', 'github_issue', 'github_sync_status']

function upstream() {
  if (!existsSync(postsFile)) return []
  return readFileSync(postsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
}

async function readFeedback(id, cookie) {
  const { items } = expectStatus(await api(`${road}?item=${id}`, { cookie }), 200, '读取真实鞭打')
  assert.deepEqual(items.map(item => item.id), [id], '单条反馈链接应只返回指定条目')
  assert(!Object.hasOwn(items[0], 'github_sync_key') && !Object.hasOwn(items[0], 'github_sync_started_at'), '私有同步字段不应公开')
  return items[0]
}

function syncFields(item) {
  return [item.github_issue, item.github_sync_status]
}

async function verifySyncApi() {
  const author = await login('community_e2e_author')
  const other = await login('community_e2e_other')
  const admin = await login('community_e2e_admin', true)
  const limited = await login('community_e2e_limit')
  expectStatus(await api(road), 401, '游客反馈列表仍需登录')
  expectStatus(await post(road, undefined, sample), 401, '游客不可发反馈')
  const { id } = expectStatus(await post(road, author, sample), 200, '先保存站内反馈')
  const first = await readFeedback(id, author)
  assert.deepEqual([first.skin_id, first.skin_source, ...syncFields(first)], [skinId, source, null, 'none'])

  const uid = db.prepare('SELECT id FROM users WHERE username=?').get('community_e2e_author').id
  const old = Number(db.prepare('INSERT INTO road_items(user_id, kind, title, body, created_at, updated_at, source_msg_id, source_group_id) VALUES(?, ?, ?, ?, 1, 1, 91, 7)')
    .run(uid, 'bug', '兼容历史群聊反馈', '旧群聊正文只应在站内保留').lastInsertRowid)
  const legacy = await readFeedback(old, author)
  assert.deepEqual([legacy.skin_id, legacy.skin_source, ...syncFields(legacy)], [null, null, null, 'none'])

  expectStatus(await sync(id, undefined, draft), 401, '游客不可同步 Issue')
  expectStatus(await sync(id, other, { issue: fix.issue }), 403, '其他成员不可关联 Issue')
  expectStatus(await sync(id, author, draft, 'https://not-the-fixture.invalid'), 403, '不接受非本站请求来源')
  expectStatus(await sync(id, author, draft), 503, '缺凭据时拒绝公开新建')
  assert.deepEqual(upstream(), [], '缺凭据或无权时不应尝试请求 GitHub')
  const untouched = await readFeedback(id, author)
  assert.deepEqual(syncFields(untouched), [null, 'none'])
  assert.equal(untouched.body, privateBody)
  expectStatus(await sync(old, admin, { issue: 42 }), 404, '不允许关联 PR 编号')
  const linked = expectStatus(await sync(old, admin, { issue: fix.issue }), 200, '无写入凭据也可核验并关联已有的公开 Issue')
  assert.deepEqual(syncFields(linked), [fix.issue, 'linked'])
  db.prepare("INSERT INTO road_items(user_id, kind, title, github_issue, github_sync_status, hidden, created_at, updated_at) VALUES(?, 'bug', '不可见的反馈夹具', ?, 'linked', 1, 1, 1)")
    .run(uid, fix.issue)
  const filtered = expectStatus(await api(`${road}?issue=${fix.issue}`, { cookie: author }), 200, '按 Issue 查找反馈')
  assert.deepEqual(filtered.items.map(item => item.id), [old], '只返回与指定 Issue 关联且可见的反馈')
  for (const value of [String(fix.issue + 1000), '', '41-not-an-issue']) {
    const empty = expectStatus(await api(`${road}?issue=${encodeURIComponent(value)}`, { cookie: author }), 200, '无匹配的 Issue 查询')
    assert.deepEqual(empty.items, [], '无匹配或无效筛选不能返回其他反馈')
  }

  const { id: restrictedId } = expectStatus(await post(road, limited, sample), 200, '受限测试账号旧反馈')
  db.prepare("INSERT INTO user_limits(user_id, kind, until, reason, created_at) SELECT id, 'post', 0, '本地验收', 1 FROM users WHERE username=?")
    .run('community_e2e_limit')
  expectStatus(await post(road, limited, sample), 403, '受限账号不可提交反馈')
  const beforeLimited = upstream().length
  expectStatus(await sync(restrictedId, limited, { issue: fix.issue }), 403, '受限账号不可同步旧反馈')
  assert.equal(upstream().length, beforeLimited, '受限账号不得使服务访问 GitHub')
  await stop()

  await start(true)
  const current = await login('community_e2e_author')
  const noDisclosure = expectStatus(await sync(id, current, { title: deniedTitle, body: draft.body }), 503, 'GitHub 拒绝后保留站内反馈')
  assert.deepEqual(syncFields(noDisclosure), [null, 'failed'])
  const failed = await readFeedback(id, current)
  assert.equal(failed.body, privateBody)
  assert.deepEqual(syncFields(failed), [null, 'failed'])
  const created = expectStatus(await sync(id, current, draft), 200, '可明确重试失败的 Issue 创建')
  assert.deepEqual(syncFields(created), [71, 'linked'])
  assert.deepEqual(syncFields(await readFeedback(id, current)), [71, 'linked'])
  const writes = upstream().filter(entry => entry.method === 'POST')
  assert.equal(writes.length, 2, '明确拒绝一次后，仅重试新建一次')
  for (const entry of writes) {
    assert(entry.authorized && entry.body.includes(draft.body) && !entry.body.includes(privateBody), '公开写入只可使用明确确认的内容')
  }
  const { id: interrupted } = expectStatus(await post(road, current, { ...sample, title: '模拟断线后仍存在的本地反馈' }), 200, '保存断线测试反馈')
  const pending = expectStatus(await sync(interrupted, current, { title: interruptedTitle, body: draft.body }), 503, '创建响应丢失后进入待确认')
  assert.deepEqual(syncFields(pending), [null, 'pending'])
  const beforeRetry = upstream().length
  expectStatus(await sync(interrupted, current, draft), 409, '待确认的反馈不可重复创建 Issue')
  assert.equal(upstream().length, beforeRetry, '等待窗口内不可触发重复创建')
  const pendingItem = await readFeedback(interrupted, current)
  assert.equal(pendingItem.body, privateBody)
  assert.deepEqual(syncFields(pendingItem), [null, 'pending'])
  db.prepare('UPDATE road_items SET github_sync_started_at=unixepoch()-31 WHERE id=?').run(interrupted)
  const reconciled = expectStatus(await sync(interrupted, current, { reconcile: true }), 200, '只读查证找回已创建 Issue')
  assert.deepEqual(syncFields(reconciled), [72, 'linked'])
  assert.deepEqual(syncFields(await readFeedback(interrupted, current)), [72, 'linked'])
  assert.deepEqual(upstream().slice(beforeRetry), [{ method: 'GET', path: issuePath }], '查证只能读取 GitHub 已有 Issue')

  const publicUpdates = expectStatus(await api('/api/community-updates'), 200, '游客可取公开更新')
  assert.deepEqual(publicUpdates.updates, [fix, feature])
  const skinUpdates = expectStatus(await api('/api/community-skins/updates'), 200, '游客可取装扮更新')
  assert.deepEqual(skinUpdates.updates.map(event => [event.source, event.id, event.kind]),
    [[source, skinId, 'added'], [source, otherId, 'added']])
  assert.deepEqual(skinUpdates.pending.map(event => [event.source, event.id, event.kind]), [[pendingSource, pendingId, 'added']])
  assert.equal(skinUpdates.pending_source_available, true)
  console.log('通过真实 Node 服务 API 验收，访客更新、装扮状态、权限、站内先保存、Issue 筛选和只读查证均符合预期。GitHub 写入三次均为本机替身。')
}

async function verifyLegacyApi() {
  expectStatus(await api(road), 401, '旧服务仍要求登录查看反馈')
  expectStatus(await post(road, undefined, draft), 401, '旧服务拒绝访客提交反馈')
  const author = await login('community_e2e_author')
  const { id } = expectStatus(await post(road, author, { kind: 'bug', title: draft.title, body: privateBody }), 200, '旧服务保存普通反馈')
  const item = await readFeedback(id, author)
  assert.equal(item.body, privateBody)
  assert(syncColumns.every(column => !Object.hasOwn(item, column)), '旧服务应使用原反馈响应结构')
  const legacyUpdates = expectStatus(await api('/api/community-updates'), 200, '旧服务可取公开站点更新')
  assert.deepEqual(legacyUpdates.updates, [fix, feature])
  const catalog = expectStatus(await api('/api/community-skins'), 200, '旧服务可取已发布装扮')
  assert.deepEqual(catalog.entries.map(entry => entry.id), [skinId, otherId])
  console.log('通过旧 Node 服务的公开更新、装扮目录、反馈登录及普通反馈读写验收。')
}

async function backendMode() {
  const me = expectStatus(await api('/api/me'), 200, '读取真实服务能力标志')
  const mode = me.community_hub_sync === true ? 'sync' : 'legacy'
  if (values['expect-backend']) assert.equal(mode, values['expect-backend'], '真实服务能力与预期不符')
  const columns = new Set(db.prepare('PRAGMA table_info(road_items)').all().map(column => column.name))
  assert(syncColumns.every(column => columns.has(column) === (mode === 'sync')), '服务能力与工作树提供的 SQLite schema 不一致')
  console.log(`按实际 /api/me 协商验收模式 ${mode}`)
  return mode
}

async function verifyBrowser(backend) {
  const scratch = join(root, 'browser')
  mkdirSync(scratch)
  // 在隔离目录内使用相对临时路径，避免 Chromium 的 Unix socket 地址超长。
  const browser = spawn(process.env.PYTHON || 'python3', [browserFile, '--origin', origin, '--env-file', envFile, '--backend', backend,
    '--skin-source', source, '--fix-title', fix.title, '--feature-title', feature.title, '--other-skin-title', otherSkinTitle,
    '--issue', String(fix.issue), '--denied-title', deniedTitle], {
    cwd: scratch, env: { ...process.env, TMPDIR: '.', PYTHONUNBUFFERED: '1' }, stdio: 'inherit',
  })
  const [code] = await once(browser, 'exit')
  assert.equal(code, 0, 'Chromium 社区共建验收失败')
  if (backend === 'legacy') return
  const uiWrites = upstream().filter(entry => entry.method === 'POST' && entry.title === deniedTitle)
  assert(uiWrites.some(entry => entry.body.includes('这段公开说明可同步') && !entry.body.includes('站内作品详情仅供反馈')),
    '浏览器提交的站内详情不得自动写入公开 Issue')
}

try {
  for (const dir of [dirname(database), dirname(envFile), join(root, 'logs')]) mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(database)
  db.exec(readFileSync(join(website, 'schema.sql'), 'utf8'))
  await start(false)
  const backend = await backendMode()
  await seedCatalog(values['skin-root'], backend)
  if (backend === 'sync') await verifySyncApi()
  else await verifyLegacyApi()
  if (browserAvailable && !values['api-only']) await verifyBrowser(backend)
  else if (!values['api-only']) console.log('目标工作树尚无社区共建页面，本次已完成真实 API 验收。')
  if (backend === 'legacy') assert.deepEqual(upstream(), [], '旧服务验收不得触发 Issue 网络请求')
} finally {
  await stop()
  db?.close()
  rmSync(root, { recursive: true, force: true })
}
