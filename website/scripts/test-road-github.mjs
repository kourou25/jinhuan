import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Hono } from 'hono'
import { D1Database } from '../server/d1.mjs'

const origin = 'https://road.test'
const github = 'https://api.github.com/repos/kourou25/jinhuan/issues'
const draft = { title: '公开标题', body: '我选择公开这段文本。\n![附件](https://example.test/image.png) @example' }
const { outputFiles: [appBundle] } = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/road-github.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
const { handleRoadGithub, roadGithubView, roadSkinSource } = await import(
  'data:text/javascript;base64,' + Buffer.from(appBundle.contents).toString('base64')
)
const migration = name => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8')

async function fixture(t, mockGithub, token = 'test-issue-token') {
  const db = new D1Database(':memory:')
  t.after(() => db.close())
  for (const name of ['0008_roadmap.sql', '0011_road_media.sql', '0013_chat_road_source.sql']) {
    await db.exec(migration(name))
  }
  await db.exec('CREATE TABLE site_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);')
  await db.prepare('INSERT INTO road_items (id, user_id, kind, title, body, media, source_msg_id, source_group_id, created_at, updated_at) ' +
    "VALUES (1, 101, 'bug', '站内标题', '内部群聊原文', ?, 204, 300, 1, 1), " +
    "(2, 101, 'idea', '另一条反馈', '', NULL, NULL, NULL, 1, 1)").bind('[{"u":"/img/private"}]').run()
  await db.exec(migration('0221_community_road.sql'))
  const fetchMock = t.mock.method(globalThis, 'fetch', mockGithub)
  const app = new Hono()
  app.use('*', async (c, next) => {
    const id = Number(c.req.header('x-test-user')) || 0
    c.set('user', id ? { id, is_admin: Number(id === 102), silenced: Number(id === 103) } : null)
    await next()
  })
  app.post('/api/road/:id/github', c => handleRoadGithub(c, async user => {
    if (user.id === 104) throw Object.assign(new Error('禁止发帖'), { status: 403 })
  }))
  app.onError((error, c) => c.json({ error: error.message }, error.status ?? 500))
  const env = { DB: db, COMMUNITY_GITHUB_TOKEN: token }

  function request(body, { id = 1, user = 101, from = origin } = {}) {
    return app.request(origin + '/api/road/' + id + '/github', {
      method: 'POST',
      headers: { 'origin': from, 'content-type': 'application/json', 'x-test-user': String(user) },
      body: JSON.stringify(body),
    }, env)
  }

  return { db, env, request, fetchMock }
}

test('升级保留旧鞭打和群聊来源，省略或无效版本不妨碍站内反馈', async t => {
  const { db, fetchMock } = await fixture(t, () => assert.fail('不应请求 GitHub'))
  const row = await db.prepare('SELECT * FROM road_items WHERE id = 1').first()
  assert.equal(row.title, '站内标题')
  assert.equal(row.body, '内部群聊原文')
  assert.equal(row.source_msg_id, 204)
  assert.equal(row.skin_id, null)
  assert.equal(row.skin_source, null)
  assert.deepEqual(roadGithubView(row), { github_issue: null, github_sync_status: 'none' })
  assert.deepEqual(roadSkinSource({}), { skinId: null, skinSource: null })
  assert.deepEqual(roadSkinSource({ skin_id: 'one-skin', skin_source: 'a'.repeat(40) }), {
    skinId: 'one-skin', skinSource: 'a'.repeat(40),
  })
  assert.deepEqual(roadSkinSource({ skin_id: 'one-skin', skin_source: 'main' }), { skinId: 'one-skin', skinSource: null })
  assert.deepEqual(roadSkinSource({ skin_id: '../skin', skin_source: 'a'.repeat(40) }), { skinId: null, skinSource: null })
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('无写凭据可关联，匿名、跨站、受限用户和无权限用户请求被拒绝', async t => {
  const { db, request, fetchMock } = await fixture(t, async (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.github.com')
    assert.equal(init.method, 'GET')
    assert.equal(init.headers.authorization, undefined)
    assert.equal(init.redirect, 'manual')
    if (url === github + '/9') return Response.json({ number: 9, pull_request: {} })
    if (url === github + '/10') return Response.json({ number: 10, repository_url: 'https://api.github.com/repos/other/jinhuan' })
    if (url === github + '/11') return new Response(null, { status: 301, headers: { location: 'https://example.test' } })
    return Response.json({ number: 12 })
  }, '')
  assert.equal((await request(draft, { user: 0 })).status, 401)
  assert.equal((await request(draft, { user: 201 })).status, 403)
  assert.equal((await request(draft, { from: 'https://cross-site.test' })).status, 403)
  assert.equal((await request(draft, { id: 3 })).status, 404)
  await db.exec("INSERT INTO road_items (id,user_id,kind,title,created_at,updated_at) VALUES (3,103,'bug','禁言',1,1),(4,104,'bug','受限',1,1)")
  assert.equal((await request({ issue: 12 }, { id: 3, user: 103 })).status, 403)
  assert.equal((await request({ issue: 12 }, { id: 4, user: 104 })).status, 403)
  assert.equal((await request({ issue: '12' })).status, 400)
  assert.equal((await request({ issue: 12, body: '' })).status, 400)
  assert.equal((await request({ ...draft, media: [] })).status, 400)
  assert.equal((await request({ reconcile: true })).status, 409)
  const disabled = await request(draft)
  assert.equal(disabled.status, 503)
  assert.equal((await disabled.json()).github_sync_status, 'none')
  assert.equal(fetchMock.mock.callCount(), 0)
  for (const issue of [9, 10, 11]) assert.equal((await request({ issue })).status, 404)
  const linked = await request({ issue: 12 }, { user: 102 })
  assert.equal(linked.status, 200)
  assert.deepEqual(await linked.json(), { github_issue: 12, github_sync_status: 'linked' })
  assert.equal(fetchMock.mock.callCount(), 4)
  assert.equal((await request({ issue: 13 })).status, 409)
  assert.equal(fetchMock.mock.callCount(), 4)
})

test('并发创建只发出一个请求，公开内容来自用户确认表单', async t => {
  const started = Promise.withResolvers()
  const release = Promise.withResolvers()
  t.after(() => release.resolve())
  const { request, fetchMock } = await fixture(t, async (url, init) => {
    started.resolve()
    await release.promise
    assert.equal(url, github)
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.authorization, 'Bearer test-issue-token')
    const payload = JSON.parse(init.body)
    assert.equal(payload.title, draft.title)
    assert.match(payload.body, /^ {4}我选择公开这段文本。\n {4}!\[附件\]/)
    assert.match(payload.body, /<!-- jinhuan-road:[0-9a-f-]{36} -->$/)
    for (const internal of ['内部群聊原文', '/img/private', '站内标题', 'source_msg_id', 'source_group_id']) {
      assert.ok(!init.body.includes(internal))
    }
    assert.deepEqual(Object.keys(payload).sort(), ['body', 'title'])
    return Response.json({ number: 19 }, { status: 201 })
  })
  const first = request(draft)
  await started.promise
  const concurrent = await request(draft)
  assert.equal(concurrent.status, 409)
  assert.equal((await concurrent.json()).github_sync_status, 'pending')
  release.resolve()
  assert.deepEqual(await (await first).json(), { github_issue: 19, github_sync_status: 'linked' })
  assert.deepEqual(await (await request(draft)).json(), { github_issue: 19, github_sync_status: 'linked' })
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('创建响应丢失后仅做只读核对，匹配标记才恢复关联', async t => {
  let recorded
  let matches = 0
  const { db, request, fetchMock } = await fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      recorded = JSON.parse(init.body).body
      throw new TypeError('模拟网络在 GitHub 已提交后中断')
    }
    assert.ok(url.startsWith(github + '?'))
    assert.equal(new URL(url).searchParams.get('state'), 'all')
    return Response.json([
      { number: 72, body: '无关联标记' },
      ...Array.from({ length: matches }, (_, i) => ({ number: 73 + i, body: recorded })),
    ])
  })
  const first = await request(draft)
  assert.equal(first.status, 503)
  assert.equal((await first.json()).github_sync_status, 'pending')
  const inFlight = await request(draft)
  assert.equal(inFlight.status, 409)
  assert.equal(fetchMock.mock.callCount(), 1)
  await db.exec('UPDATE road_items SET github_sync_started_at = github_sync_started_at - 31 WHERE id = 1')
  const notFound = await request({ reconcile: true })
  assert.equal(notFound.status, 409)
  assert.equal((await notFound.json()).github_sync_status, 'pending')
  matches = 2
  const duplicate = await request({ reconcile: true })
  assert.equal(duplicate.status, 409)
  assert.equal((await duplicate.json()).github_sync_status, 'pending')
  matches = 1
  const recovered = await request({ reconcile: true })
  assert.equal(recovered.status, 200)
  assert.deepEqual(await recovered.json(), { github_issue: 73, github_sync_status: 'linked' })
  assert.equal(fetchMock.mock.calls.filter(call => call.arguments[1].method === 'POST').length, 1)
})

test('明确拒绝可重试，站点限流和 GitHub 冷却不会再次外发', async t => {
  let blocked = true
  const { db, request, env, fetchMock } = await fixture(t, async () => {
    if (blocked) return Response.json({ message: 'secondary rate limit' }, { status: 403, headers: { 'retry-after': '90' } })
    return Response.json({ number: 27 }, { status: 201 })
  })
  env.AUTH_RL = { limit: async () => ({ success: false }) }
  const local = await request(draft)
  assert.equal(local.status, 429)
  assert.equal(fetchMock.mock.callCount(), 0)
  delete env.AUTH_RL
  const limit = await request(draft)
  assert.equal(limit.status, 429)
  assert.equal(limit.headers.get('retry-after'), '90')
  assert.equal((await limit.json()).github_sync_status, 'failed')
  assert.equal((await request(draft, { id: 2 })).status, 429)
  assert.equal(fetchMock.mock.callCount(), 1)
  await db.exec("UPDATE site_settings SET v = '0'")
  blocked = false
  assert.deepEqual(await (await request(draft)).json(), { github_issue: 27, github_sync_status: 'linked' })
  const row = await db.prepare('SELECT title, body FROM road_items WHERE id = 1').first()
  assert.deepEqual(row, { title: '站内标题', body: '内部群聊原文' })
  assert.equal(fetchMock.mock.callCount(), 2)
})
