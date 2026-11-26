import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatReadQueue } from '../public/chat-realtime.js'

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let userId = -42
  const requests = [], confirmed = []
  const reads = createChatReadQueue({
    getUser: () => userId,
    send(group, upto, options) {
      const { promise, resolve, reject } = Promise.withResolvers()
      requests.push({ group, upto, ...options, resolve, reject })
      return promise
    },
    onConfirmed: (...args) => confirmed.push(args),
  })
  return {
    reads, requests, confirmed,
    targets: () => requests.map(request => request.upto),
    advance: (ms) => t.mock.timers.tick(ms),
    setUser: (id) => { userId = id },
  }
}

function overlap({ reads, advance, targets }) {
  reads.queue(7, 100)
  advance(800)
  reads.queue(7, 101)
  void reads.flush(7)
  assert.deepEqual(targets(), [100, 101])
}

const denied = (status) => Object.assign(new Error('访问权限不足'), { status })

test('同群合并从首个游标推进开始计时，失败后提交最新游标', async (t) => {
  const f = fixture(t)
  f.reads.queue(7, 100)
  f.advance(700)
  f.reads.queue(7, 101)
  f.reads.queue(7, 99)
  f.advance(99)
  assert.deepEqual(f.targets(), [])
  f.advance(1)
  assert.deepEqual(f.targets(), [101])
  f.requests[0].reject(new Error('网络中断'))
  await Promise.resolve()
  f.reads.queue(7, 102)
  f.advance(999)
  assert.deepEqual(f.targets(), [101])
  f.advance(1)
  assert.deepEqual(f.targets(), [101, 102])
  f.requests[1].resolve()
  await Promise.resolve()
  assert.deepEqual(f.confirmed, [[7, 102, -42]])
})

test('较旧请求先被拒后，较新成功恢复提交其间读到的游标', async (t) => {
  const f = fixture(t)
  overlap(f)
  f.requests[0].reject(denied(401))
  await Promise.resolve()
  f.reads.queue(7, 102)
  f.requests[1].resolve()
  await Promise.resolve()
  f.advance(800)
  assert.deepEqual(f.targets(), [100, 101, 102])
  f.requests[2].resolve()
  await Promise.resolve()
  assert.deepEqual(f.confirmed, [[7, 101, -42], [7, 102, -42]])
})

test('较旧请求迟到的拒绝不覆盖较新请求的成功', async (t) => {
  const f = fixture(t)
  overlap(f)
  f.reads.queue(7, 102)
  f.requests[1].resolve()
  await Promise.resolve()
  f.requests[0].reject(denied(403))
  await Promise.resolve()
  f.advance(800)
  assert.deepEqual(f.targets(), [100, 101, 102])
  f.requests[2].resolve()
})

for (const [name, order] of [
  ['较旧成功先返回', [0, 1]],
  ['较旧成功后返回', [1, 0]],
]) {
  test(`${name}时仍尊重较新请求的拒绝，授权快照恢复后提交未发游标`, async (t) => {
    const f = fixture(t)
    overlap(f)
    f.reads.queue(7, 102)
    for (const index of order) {
      const request = f.requests[index]
      if (index === 0) request.resolve()
      else request.reject(denied(403))
      await Promise.resolve()
    }
    f.advance(60000)
    await f.reads.flush(7, { departing: true })
    assert.deepEqual(f.targets(), [100, 101])
    assert.equal(f.reads.confirmed(7), 100)
    f.reads.observe(7, 100)
    f.advance(800)
    assert.deepEqual(f.targets(), [100, 101, 102])
    f.requests[2].resolve()
  })
}

test('授权快照已生效时，先前在途请求的拒绝不再阻塞新游标', async (t) => {
  const f = fixture(t)
  f.reads.queue(7, 100)
  f.advance(800)
  f.reads.queue(7, 101)
  f.reads.observe(7, 99)
  f.requests[0].reject(denied(403))
  await Promise.resolve()
  f.advance(800)
  assert.deepEqual(f.targets(), [100, 101])
  f.requests[1].resolve()
})

test('退出补交超过两个在途请求的最新游标，并合并重复退出信号', async (t) => {
  const f = fixture(t)
  overlap(f)
  f.reads.queue(7, 102)
  void f.reads.flush(7)
  assert.deepEqual(f.targets(), [100, 101])
  const first = f.reads.flush(undefined, { departing: true })
  const second = f.reads.flush(7, { departing: true })
  assert.deepEqual(f.targets(), [100, 101, 102])
  assert.ok(f.requests.every(request => request.keepalive))
  f.requests[2].resolve()
  f.requests[1].reject(denied(403))
  f.requests[0].resolve()
  await Promise.all([first, second])
  assert.deepEqual(f.confirmed, [[7, 102, -42]])
})

test('切换负数账号或重置群后忽略旧请求回包，并取消旧账号已排定的请求', async (t) => {
  const f = fixture(t)
  overlap(f)
  f.reads.queue(8, 200)
  f.setUser(-43)
  f.reads.queue(7, 10)
  f.requests[0].resolve()
  f.requests[1].reject(denied(401))
  await Promise.resolve()
  f.advance(800)
  assert.deepEqual(f.requests.map(({ group, upto, userId }) => [group, upto, userId]), [
    [7, 100, -42], [7, 101, -42], [7, 10, -43],
  ])
  assert.deepEqual(f.confirmed, [])
  f.reads.reset(7)
  f.reads.queue(7, 9)
  f.requests[2].reject(denied(403))
  await Promise.resolve()
  f.advance(800)
  assert.deepEqual(f.targets(), [100, 101, 10, 9])
  f.requests[3].resolve()
  await Promise.resolve()
  assert.deepEqual(f.confirmed, [[7, 9, -43]])
})
