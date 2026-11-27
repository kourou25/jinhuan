import assert from 'node:assert/strict'
import test from 'node:test'
import { publishedSkinUpdates, skinUpdatesReader } from '../src/services/community-skin-updates.mjs'

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
