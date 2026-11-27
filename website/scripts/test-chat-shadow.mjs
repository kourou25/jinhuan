import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatShadowSampler } from '../public/chat-realtime.js'

const maskedAuthor = {
  id: -1000000000123, username: '围观鱼友·A123', name: '围观鱼友·A123', avatar: null,
  trust_level: 0, is_admin: false, fancy: false, deco: null,
}
const visibleAuthor = {
  id: 42, username: 'synthetic-author', name: '合成作者', avatar: '/img/synthetic-avatar',
  trust_level: 2, is_admin: true, fancy: true, deco: { pt: 'test', community: { a: true, b: false } },
}
const message = {
  id: 123, group_id: 1, deleted: false, system_kind: null, system_ref: null, body: '合成消息正文',
  image: null, width: null, height: null, media: null, media_expired: false,
  created_at: 1700000010, updated_at: 1700000010, edited_at: null,
  user: maskedAuthor,
  reply_to: {
    id: 122, username: '鱼友', name: '鱼友', avatar: null, deleted: false, fancy: false, deco: null,
    image: true, thumb: '/img/synthetic-thumb', file: null, media_expired: false, text: '合成引用摘要',
  },
  reply_count: 0, reactions: [], boosts: [], at_read: null, mine: false, can_delete: false, can_edit: false,
  redpack: null, meme_id: null, road_id: null,
}

test('同一快照忽略 HTTP 与 WebSocket 的投递字段差异、对象键顺序和已读进度', () => {
  const shadow = createChatShadowSampler()
  const http = {
    ...message, user: visibleAuthor, mine: true, can_edit: true, can_delete: true,
    at_read: { 'synthetic-mention': false }, reactions: [{ emoji: '鱼', count: 1, mine: false, who: [visibleAuthor] }],
  }
  const ws = {
    ...http, floor: 15, command_id: 'synthetic-command', at_read: { 'synthetic-mention': true },
    user: { ...visibleAuthor, deco: { community: { b: false, a: true }, pt: 'test' } },
    reply_to: Object.fromEntries(Object.entries(http.reply_to).reverse()),
    reactions: [{ who: [visibleAuthor], mine: false, count: 1, emoji: '鱼' }],
  }
  const reordered = Object.fromEntries(Object.entries(ws).reverse())
  // 同一条消息可出现在一端的新增批次和另一端的更新批次。
  assert.deepEqual(shadow.sample({ items: [], changed: [http], realtime_cursor: 100 }, 100, 'http'),
    { batches: 0, compared: 0, mismatch: 0 })
  assert.deepEqual(shadow.sample({ items: [reordered], changed: [], cursor: 99, state_cursor: 100 }, 100, 'socket'),
    { batches: 1, compared: 1, mismatch: 0 })
})

for (const [label, change] of [
  ['单侧多带的顶层作者编号', { author_id: visibleAuthor.id }],
  ['作者编号', { user: { ...maskedAuthor, id: visibleAuthor.id } }],
  ['作者用户名', { user: { ...maskedAuthor, username: visibleAuthor.username } }],
  ['作者显示名称', { user: { ...maskedAuthor, name: visibleAuthor.name } }],
  ['作者头像', { user: { ...maskedAuthor, avatar: visibleAuthor.avatar } }],
  ['作者角色标记', { user: { ...maskedAuthor, is_admin: true } }],
  ['作者特效', { user: { ...maskedAuthor, fancy: true } }],
  ['作者装扮', { user: { ...maskedAuthor, deco: visibleAuthor.deco } }],
  ['引用权限', { reply_to: null }],
  ['引用作者', { reply_to: { ...message.reply_to, username: visibleAuthor.username } }],
  ['引用头像', { reply_to: { ...message.reply_to, avatar: visibleAuthor.avatar } }],
  ['引用装扮', { reply_to: { ...message.reply_to, deco: visibleAuthor.deco } }],
  ['引用摘要正文', { reply_to: { ...message.reply_to, text: '另一段合成摘要' } }],
  ['引用缩略图', { reply_to: { ...message.reply_to, thumb: '/img/other-synthetic-thumb' } }],
  ['引用跳转目标', { reply_to: { ...message.reply_to, id: 121 } }],
  ['回执用户名', { at_read: { 'synthetic-mention': false } }],
  ['消息正文', { body: '另一段合成正文' }],
]) {
  test(`${label}变化只通过差异计数报告`, () => {
    const shadow = createChatShadowSampler()
    shadow.sample({ items: [message], changed: [] }, 100, 'socket')
    assert.deepEqual(shadow.sample({ items: [], changed: [{ ...message, ...change }] }, 100, 'http'),
      { batches: 1, compared: 1, mismatch: 1 })
  })
}

test('匹配要求同一游标和消息，重复投递只计一次，清空后重新配对', () => {
  const shadow = createChatShadowSampler()
  const batch = { items: [message], changed: [] }
  shadow.sample(batch, 100, 'socket')
  assert.deepEqual(shadow.sample(batch, 101, 'http'), { batches: 1, compared: 0, mismatch: 0 })
  assert.deepEqual(shadow.sample({ items: [{ ...message, id: 124 }], changed: [] }, 100, 'http'),
    { batches: 1, compared: 0, mismatch: 0 })
  assert.deepEqual(shadow.sample(batch, 100, 'http'), { batches: 1, compared: 1, mismatch: 0 })
  assert.deepEqual(shadow.sample(batch, 100, 'http'), { batches: 1, compared: 1, mismatch: 0 })
  shadow.clear()
  assert.deepEqual(shadow.sample(batch, 101, 'socket'), { batches: 2, compared: 1, mismatch: 0 })
  assert.deepEqual(shadow.sample(batch, 101, 'http'), { batches: 2, compared: 2, mismatch: 0 })
})
