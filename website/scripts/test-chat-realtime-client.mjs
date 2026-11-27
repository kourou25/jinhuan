import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatRealtime } from '../public/chat-realtime.js'

function fixture(t) {
  const sockets = [], requests = [], stops = []
  let userId = 1
  class Socket extends EventTarget {
    static OPEN = 1
    readyState = 0
    sent = []
    constructor() { super(); sockets.push(this) }
    send(data) { this.sent.push(JSON.parse(data)) }
    open() { this.readyState = Socket.OPEN; this.dispatchEvent(new Event('open')) }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
    receive(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })) }
    subscribed(group) { return this.sent.findLast(frame => frame.type === 'subscribe' && frame.group === group).subscription }
  }
  const globals = { WebSocket: Socket, location: { href: 'https://example.test/chat/1' }, navigator: { onLine: true } }
  const descriptors = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true })
  t.after(() => {
    for (const stop of stops.reverse()) stop()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const realtime = createChatRealtime(() => userId, (group, ids, generation, signal) => {
    const { promise, resolve, reject } = Promise.withResolvers()
    requests.push({ group, ids, generation, signal, resolve, reject })
    return promise
  })
  return {
    requests, sockets, realtime,
    setUser(id) { userId = id },
    watch(group, cursor = 0, mode = 'live', generation = `generation-${group}`) {
      const events = []
      const stop = realtime.watch(group, cursor, mode, generation, {
        batch: frame => events.push(['batch', frame]),
        ready: now => events.push(['ready', now]),
        fallback: detached => events.push(['fallback', detached]),
        revoked: () => events.push(['revoked']),
        reset: () => events.push(['reset']),
        disabled: () => events.push(['disabled']),
      })
      stops.push(stop)
      return { events, stop }
    },
  }
}

const notify = (from, cursor, item_ids = [], changed_ids = []) => ({
  type: 'notify', from, cursor, state_cursor: cursor, item_ids, changed_ids,
})
const message = (id, group_id = 1) => ({ id, group_id, body: '合成消息', user: { name: '合成角色' } })
function receive(socket, group, frame, subscription = socket.subscribed(group)) {
  socket.receive({ ...frame, group, subscription })
}
async function complete(request, items) {
  request.resolve({ items })
  await Promise.resolve()
}

test('站长通知按群串行补取，按通知编号重组，共享订阅只拉一次，普通批次同步交付', async t => {
  const f = fixture(t)
  const owner = f.watch(1, 0, 'shadow'), popped = f.watch(1, 0, 'shadow'), normal = f.watch(2)
  const [ws] = f.sockets
  ws.open()
  receive(ws, 1, notify(0, 3, [3, 1], [2]))
  receive(ws, 1, notify(0, 3, [3, 1], [2]))
  receive(ws, 1, notify(3, 4, [], [2]))
  receive(ws, 1, { type: 'ready', cursor: 4, now: 20 })
  receive(ws, 1, { type: 'ready', cursor: 4, now: 20 })
  receive(ws, 1, notify(4, 5))
  receive(ws, 2, { type: 'batch', from: 0, cursor: 9, items: [message(9, 2)], changed: [] })
  assert.deepEqual(normal.events[0][1].items, [message(9, 2)])
  assert.deepEqual(owner.events, [])
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.requests[0].ids, [3, 1, 2])
  assert.equal(f.requests[0].generation, 'generation-1')
  await complete(f.requests[0], [message(1), message(2), message(3)])
  assert.equal(f.requests.length, 2)
  assert.deepEqual(f.requests[1].ids, [2])
  const first = owner.events[0][1]
  assert.equal(first.type, 'batch')
  assert.deepEqual(first.items.map(m => m.id), [3, 1])
  assert.deepEqual(first.changed.map(m => m.id), [2])
  first.items[0].user.name = '修改小窗外的副本'
  assert.equal(popped.events[0][1].items[0].user.name, '合成角色')
  await complete(f.requests[1], [message(2)])
  assert.equal(f.requests.length, 2)
  assert.deepEqual(owner.events.map(([type, data]) => [type, data?.cursor ?? data]),
    [['batch', 3], ['batch', 4], ['ready', 20], ['batch', 5]])
  assert.deepEqual(owner.events.at(-1)[1].items, [])
})

for (const type of ['revoked', 'disabled', 'reset']) {
  test(`${type} 立即生效，丢弃在途响应及群内等待通知`, async t => {
    const f = fixture(t)
    const pane = f.watch(1)
    const [ws] = f.sockets
    ws.open()
    receive(ws, 1, notify(0, 1, [1]))
    receive(ws, 1, notify(1, 2, [2]))
    receive(ws, 1, { type, cursor: 2 })
    assert.equal(f.requests[0].signal.aborted, true)
    assert.deepEqual(pane.events, [[type]])
    await complete(f.requests[0], [message(1)])
    assert.equal(f.requests.length, 1)
    assert.deepEqual(pane.events, [[type]])
  })
}

test('同群回绕重订取消旧请求和旧帧，离开后取消新的在途请求', async t => {
  const f = fixture(t)
  const first = f.watch(1, 5)
  const [ws] = f.sockets
  ws.open()
  const subscription = ws.subscribed(1)
  receive(ws, 1, notify(5, 6, [6]))
  const second = f.watch(1, 4)
  assert.notEqual(ws.subscribed(1), subscription)
  assert.equal(f.requests[0].signal.aborted, true)
  receive(ws, 1, notify(5, 6, [6]), subscription)
  receive(ws, 1, notify(4, 5, [5]))
  assert.equal(f.requests.length, 2)
  await complete(f.requests[0], [message(6)])
  assert.deepEqual(first.events, [])
  assert.deepEqual(second.events, [])
  first.stop()
  second.stop()
  assert.equal(f.requests[1].signal.aborted, true)
  await complete(f.requests[1], [message(5)])
  assert.deepEqual(second.events, [])
})

test('旧连接、切换账号的回包均不得交付给任何面板', async t => {
  const f = fixture(t)
  const previous = f.watch(1)
  const [ws] = f.sockets
  ws.open()
  receive(ws, 1, notify(0, 1, [1]))
  f.realtime.pause()
  assert.equal(f.requests[0].signal.aborted, true)
  f.setUser(2)
  const next = f.watch(1)
  f.realtime.resume()
  const replacement = f.sockets.at(-1)
  replacement.open()
  receive(ws, 1, notify(0, 1, [1]))
  await complete(f.requests[0], [message(1)])
  assert.equal(f.requests.length, 1)
  receive(replacement, 1, notify(0, 1, [1]))
  f.setUser(3)
  await complete(f.requests[1], [message(1)])
  assert.deepEqual(previous.events, [['fallback', undefined]])
  assert.deepEqual(next.events, [])
})

for (const [status, action, code] of [
  [400, 'reset'], [401, 'revoked'], [403, 'revoked'], [409, 'reset'], [503, 'fallback'],
  [404, 'reset', 'chat_realtime_message_unavailable'], [404, 'fallback', 'chat_realtime_unavailable'],
]) {
  test(`补取返回 ${code ?? status} 时只处理该群`, async t => {
    const f = fixture(t)
    const pane = f.watch(1), other = f.watch(2)
    const [ws] = f.sockets
    ws.open()
    receive(ws, 1, notify(0, 1, [1]))
    f.requests[0].reject(Object.assign(new Error('合成错误'), { status, code }))
    await Promise.resolve()
    assert.deepEqual(pane.events, [action === 'fallback' ? [action, true] : [action]])
    receive(ws, 2, { type: 'ready', cursor: 0, now: 10 })
    assert.deepEqual(other.events, [['ready', 10]])
  })
}

for (const [label, items] of [['缺少消息', []], ['消息属于其他群', [message(1, 2)]], ['消息编号不符', [message(2)]]]) {
  test(`补取结果${label}时触发重载`, async t => {
    const f = fixture(t)
    const pane = f.watch(1)
    const [ws] = f.sockets
    ws.open()
    receive(ws, 1, notify(0, 1, [1]))
    await complete(f.requests[0], items)
    assert.deepEqual(pane.events, [['reset']])
  })
}

test('等待队列超过上限时释放该群请求，其他群保持连接', t => {
  const f = fixture(t)
  const pane = f.watch(1), other = f.watch(2)
  const [ws] = f.sockets
  ws.open()
  receive(ws, 1, notify(0, 1, [1]))
  for (let cursor = 2; cursor <= 34; cursor++) receive(ws, 1, notify(cursor - 1, cursor, [cursor]))
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].signal.aborted, true)
  assert.deepEqual(pane.events, [['fallback', true]])
  receive(ws, 2, { type: 'ready', cursor: 0, now: 10 })
  assert.deepEqual(other.events, [['ready', 10]])
})

test('站长补取超时只将该群切回轮询', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t)
  const pane = f.watch(1), other = f.watch(2)
  const [ws] = f.sockets
  ws.open()
  receive(ws, 2, { type: 'ready', cursor: 0, now: 10 })
  receive(ws, 1, notify(0, 1, [1]))
  t.mock.timers.tick(10000)
  assert.equal(f.requests[0].signal.aborted, true)
  assert.deepEqual(pane.events, [['fallback', true]])
  receive(ws, 2, { type: 'batch', from: 0, cursor: 1, items: [], changed: [] })
  assert.equal(other.events[1][0], 'batch')
})
