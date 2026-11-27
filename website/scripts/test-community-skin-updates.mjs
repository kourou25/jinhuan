import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publishedSkinUpdates, refreshSkinUpdateTimes, skinUpdatesReader, withKnownSkinUpdateTimes,
} from '../src/services/community-skin-updates.mjs'

const ticket = {
  id: 'ticket', name: '星光票根', author: '白鳥', github: 'shiratori3', license: '可随目录发布',
  components: { bubble: { type: 'text/css', sha256: 'a'.repeat(64) } },
}
const installed = { source: '1'.repeat(40), revision: 10, entries: [ticket] }
const release = (entries) => ({ source: '2'.repeat(40), revision: 11, entries })

test('原始目录含额外的文件元数据；同一套装同样式不重复记录', async () => {
  const catalog = release([{ ...ticket, components: { bubble: { ...ticket.components.bubble, file: 'assets/bubble.css', bytes: 1024 } } }])
  const read = skinUpdatesReader(async () => catalog)
  assert.deepEqual((await read(installed)).pending, [])
  assert.deepEqual((await read({ source: '', entries: [] })).pending.map(item => item.kind), ['added'])
  assert.deepEqual(publishedSkinUpdates(null, installed, 1), [])
})

test('改名、外观更新、上新和下架按套装 ID 关联，发布时间只来自本次成功同步', async () => {
  const other = { ...ticket, id: 'another', name: '另一套' }
  const old = { ...installed, entries: [ticket, other, { ...ticket, id: 'retired' }] }
  const catalog = release([{ ...ticket, name: '新名称' }, { ...other, components: {} }, { ...ticket, id: 'new' }])
  let fetches = 0
  const read = skinUpdatesReader(async () => { fetches++; return catalog })
  const [left, right] = await Promise.all([read(old), read(old)])
  assert.equal(fetches, 1)
  assert.deepEqual(left, right)
  assert.deepEqual(left.pending.map(e => e.kind), ['renamed', 'updated', 'added', 'removed'])
  assert.equal(left.pending[0].previous_name, '星光票根')
  assert.equal(left.pending[0].published_at, undefined)
  const recentUpdates = publishedSkinUpdates(old, catalog, 100)
  assert.deepEqual(recentUpdates, left.pending.map(change => ({ ...change, published_at: 100 })))
  const published = await read({ ...catalog, recentUpdates })
  assert.deepEqual(published.updates, recentUpdates)
  assert.deepEqual(published.pending, [])
  const offline = skinUpdatesReader(async () => { throw Error('上游不可用') })
  assert.deepEqual(await offline({ ...catalog, recentUpdates }), { updates: recentUpdates, pending: [], pending_source_available: false })
})

test('目前线上目录按固定投稿版本回填，保留已写入的时间和已有变更记录', async () => {
  const source = 'ba0d7554ae222540e728218f4e95e7d0701e7258'
  const entries = [
    { ...ticket, id: 'shiratori-starlight' },
    { ...ticket, id: 'electroboy-armor' },
    { ...ticket, id: 'deep-think', updated_at: 123 },
    ticket,
  ]
  const recentUpdates = [{ id: ticket.id }]
  const catalog = { source, revision: 66, entries, recentUpdates }
  const enriched = withKnownSkinUpdateTimes(catalog)
  assert.equal(enriched.recentUpdates, recentUpdates)
  assert.deepEqual(enriched.entries.map(entry => entry.updated_at), [1795678238, 1795707128, 123, undefined])
  assert.equal(catalog.entries[0].updated_at, undefined)
  assert.equal(withKnownSkinUpdateTimes(enriched), enriched)
  assert.equal(withKnownSkinUpdateTimes(installed), installed)
  const known = { ...catalog, entries: entries.slice(0, 3) }
  let fetches = 0
  const refreshed = await refreshSkinUpdateTimes(null, known, () => { fetches++ })
  assert.equal(fetches, 0)
  assert.deepEqual(refreshed.entries.map(entry => entry.updated_at), [1795678238, 1795707128, 123])
})

function commitTime(date) {
  return Response.json([{ commit: { author: { date: '2026-11-01T00:00:00Z' }, committer: { date } } }])
}

test('新目录沿用未改作品的时间，仅按固定来源查询上新或变更的作品', async () => {
  const old = {
    ...installed,
    entries: [
      { ...ticket, updated_at: 100 },
      { ...ticket, id: 'rename', updated_at: 200 },
      { ...ticket, id: 'restyle', updated_at: 300 },
      { ...ticket, id: 'retired', updated_at: 400 },
    ],
  }
  const next = release([
    ticket,
    { ...ticket, id: 'rename', name: '新名称' },
    { ...ticket, id: 'restyle', components: {} },
    { ...ticket, id: 'new-skin' },
    { ...ticket, id: 'from-catalog', updated_at: 500 },
  ])
  const dates = {
    rename: '2026-11-27T09:00:00Z',
    restyle: '2026-11-27T08:00:00Z',
    'new-skin': '2026-11-27T07:00:00Z',
  }
  const requested = []
  const refreshed = await refreshSkinUpdateTimes(old, next, href => {
    const url = new URL(href)
    assert.equal(url.origin + url.pathname, 'https://api.github.com/repos/kourou25/meme-hall-skins/commits')
    assert.equal(url.searchParams.get('sha'), next.source)
    assert.equal(url.searchParams.get('per_page'), '1')
    const path = url.searchParams.get('path')
    assert.match(path, /^submissions\//)
    const id = path.slice('submissions/'.length)
    requested.push(id)
    return commitTime(dates[id])
  })
  assert.deepEqual(requested, ['rename', 'restyle', 'new-skin'])
  assert.deepEqual(refreshed.entries.map(entry => entry.updated_at), [
    100, Date.parse(dates.rename) / 1000, Date.parse(dates.restyle) / 1000,
    Date.parse(dates['new-skin']) / 1000, 500,
  ])
  assert.deepEqual(publishedSkinUpdates(old, refreshed, 900).map(event => [event.kind, event.published_at]), [
    ['renamed', 900], ['updated', 900], ['added', 900], ['added', 900], ['removed', 900],
  ])
})

test('限制每次历史补查的数量，上游异常时保持已安装目录可用并允许继续补查', async t => {
  t.mock.method(Date, 'now', () => 0)
  const entries = ['one', 'two', 'three', 'four', 'five'].map(id => ({ ...ticket, id }))
  const catalog = { ...release(entries), recentUpdates: [{ id: 'one' }] }
  const called = []
  const healthy = '2026-11-26T15:32:08Z'
  const partial = await refreshSkinUpdateTimes(null, catalog, href => {
    const id = new URL(href).searchParams.get('path').split('/').at(-1)
    called.push(id)
    if (id === 'two') throw Error('暂时无法访问')
    if (id === 'three') return new Response(null, { status: 403 })
    if (id === 'four') return commitTime('2026')
    return commitTime(healthy)
  })
  assert.deepEqual(called, ['one', 'two', 'three', 'four'])
  assert.deepEqual(partial.entries.map(entry => entry.updated_at), [1795707128, undefined, undefined, undefined, undefined])
  assert.equal(partial.recentUpdates, catalog.recentUpdates)
  called.length = 0
  const complete = await refreshSkinUpdateTimes(null, partial, href => {
    called.push(new URL(href).searchParams.get('path').split('/').at(-1))
    return commitTime(healthy)
  })
  assert.deepEqual(called, ['two', 'three', 'four', 'five'])
  assert.deepEqual(complete.entries.map(entry => entry.updated_at), Array(5).fill(1795707128))
  const offline = await refreshSkinUpdateTimes(null, catalog, () => new Response(null, { status: 503 }))
  assert.equal(offline, catalog)
})

test('持续查不到前四件作品的时间时，后续同步仍会补查队尾', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const ids = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
  let catalog = release(ids.map(id => ({ ...ticket, id })))
  const calls = []
  const fetcher = href => {
    const id = new URL(href).searchParams.get('path').split('/').at(-1)
    calls.push(id)
    if (id === 'nine') return commitTime('2026-11-26T15:32:08Z')
    return Response.json([])
  }
  for (const [round, from, to] of [[0, 0, 4], [1, 4, 8], [2, 8, 9]]) {
    now = round * 5 * 60_000
    calls.length = 0
    catalog = await refreshSkinUpdateTimes(null, catalog, fetcher)
    assert.deepEqual(calls, ids.slice(from, to))
  }
  assert.deepEqual(catalog.entries.map(entry => entry.updated_at), [...Array(8).fill(undefined), 1795707128])
})
