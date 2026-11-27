import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { attachChatRealtime, createChatRealtime } from '../server/chat-realtime.mjs'
import { D1Database } from '../server/d1.mjs'

const settings = { timeout: 15000 }
const sleepWord = new Int32Array(new SharedArrayBuffer(4))

async function gateway(t) {
  const temp = resolve(process.env.TMPDIR || '../.tmp')
  mkdirSync(temp, { recursive: true })
  const dir = mkdtempSync(resolve(temp, 'chat-gateway-'))
  const path = resolve(dir, 'db.sqlite')
  const db = new D1Database(path)
  const external = new D1Database(path)
  await db.exec(`
    CREATE TABLE chat_realtime_pruned(group_id INTEGER PRIMARY KEY,seq INTEGER);
    CREATE TABLE chat_realtime_controls(group_id INTEGER PRIMARY KEY,disabled INTEGER,shadow INTEGER);
    CREATE TABLE chat_realtime_events(
      seq INTEGER PRIMARY KEY,group_id INTEGER NOT NULL,message_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('create','update','delete')),
      audience_user_id INTEGER CHECK(audience_user_id IS NULL OR kind='update')
    );
    CREATE TABLE revoked(user_id INTEGER PRIMARY KEY);
  `)
  const trace = { auth: [], pages: [], projected: [], messages: [] }
  const hook = { project() {} }
  const api = {
    async authenticateChatRealtime(request) {
      const userId = Number(request.headers.get('cookie'))
      return userId ? { userId } : null
    },
    chatRealtimeAuthKey: auth => auth.userId,
    async getChatRealtimeAccessBatch(auths, group, { DB }) {
      trace.auth.push({ group, uids: auths.map(auth => auth.userId) })
      const banned = new Set((await DB.prepare('SELECT user_id FROM revoked').all()).results.map(row => row.user_id))
      return new Map(auths.filter(auth => !banned.has(auth.userId)).map(auth => [auth.userId, { generation: String(auth.userId) }]))
    },
    async hydrateChatRealtimeBatch(_env, group, ids) {
      trace.pages.push({ group, ids })
      return ids
    },
    async projectChatRealtimeBatch({ userId }, _access, group, ids, events) {
      trace.projected.push({ userId, group, seqs: events.map(e => e.seq) })
      assert.ok(events.every(e => ids.includes(e.message_id)))
      await hook.project(userId, events)
      const visible = events.filter(e => e.audience_user_id == null || e.audience_user_id === userId)
      return {
        items: visible.filter(e => e.kind === 'create').map(e => ({ id: e.message_id })),
        changed: visible.filter(e => e.kind !== 'create').map(e => ({ id: e.message_id })),
      }
    },
  }
  const server = createServer()
  const clients = new Set()
  const stop = attachChatRealtime(server, { DB: db, CHAT_REALTIME: createChatRealtime('7,9', () => new D1Database(path, { readonly: true })) },
    api, () => ({}), req => new Request('http://' + req.headers.host + req.url, { headers: req.headers }))
  t.after(async () => {
    for (const ws of clients) ws.terminate()
    await stop()
    if (server.listening) await new Promise(resolve => server.close(resolve))
    external.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const host = '127.0.0.1:' + server.address().port
  async function connect(userId, group, cursor) {
    const ws = new WebSocket('ws://' + host + '/api/chat/ws', { origin: 'http://' + host, headers: { cookie: String(userId) } })
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
    const inbox = []
    ws.on('message', raw => {
      const frame = JSON.parse(raw)
      inbox.push(frame)
      trace.messages.push({ userId, ...frame })
    })
    await once(ws, 'open')
    ws.send(JSON.stringify({ type: 'subscribe', group, cursor, generation: String(userId) }))
    return async (type, atLeast = 0) => {
      for (let i = 0; i < 600; i++) {
        const frame = inbox.find(frame => frame.type === type && (frame.cursor ?? 0) >= atLeast)
        if (frame) return frame
        await delay(10)
      }
      throw Error('未收到订阅帧 ' + [userId, group, type, atLeast].join(' '))
    }
  }
  const append = (seq, group = 7, audience = null, message = seq) => db.prepare('INSERT INTO chat_realtime_events VALUES(?,?,?,?,?)')
    .bind(seq, group, message, audience === null ? 'create' : 'update', audience).run()
  return { db, external, trace, hook, connect, append }
}

test('持续提交时轮转同群订阅，切片间复用公共页', settings, async t => {
  const { trace, hook, connect, append } = await gateway(t)
  const clients = await Promise.all(Array.from({ length: 72 }, (_, i) => connect(i + 1, 7, 0)))
  await Promise.all(clients.map(next => next('ready')))
  trace.auth.length = 0
  let first
  hook.project = (userId, events) => {
    // 给每位订阅者一个稳定的投影成本，确保时间预算会在帧数上限之前触发。
    Atomics.wait(sleepWord, 0, 0, 1)
    if (first !== undefined || events[0].seq !== 1) return
    first = userId
    setTimeout(() => { void append(2) }, 0)
  }
  await append(1)
  await Promise.all(clients.map(next => next('batch', 2)))
  const firstNew = trace.projected.find(call => call.seqs.includes(2))
  assert.notEqual(firstNew.userId, first)
  assert.equal(new Set(trace.projected.filter(call => call.seqs.includes(2)).map(call => call.userId)).size, clients.length)
  assert.ok(trace.auth.every(call => call.uids.length <= 8))
  assert.equal(trace.pages.length, 2)
})

test('断线补拉期间，已追平订阅和其他群可以先收到新消息', settings, async t => {
  const { db, trace, hook, connect, append } = await gateway(t)
  await db.exec(`WITH RECURSIVE history(seq) AS (VALUES(1) UNION ALL SELECT seq+1 FROM history WHERE seq<192)
    INSERT INTO chat_realtime_events SELECT seq,7,seq,'create',NULL FROM history`)
  const live = await connect(1, 7, 192)
  const other = await connect(2, 9, 0)
  await Promise.all([live('ready'), other('ready')])
  let posted = false
  hook.project = userId => {
    if (userId !== 3 || posted) return
    posted = true
    setTimeout(async () => {
      await append(193, 7, 1, 192)
      await append(194, 9)
    }, 0)
  }
  const replay = await connect(3, 7, 0)
  const [liveFrame] = await Promise.all([live('batch', 193), other('batch', 194), replay('ready', 193)])
  const replayFrame = await replay('batch', 193)
  assert.deepEqual(liveFrame.changed.map(m => m.id), [192])
  assert.deepEqual(replayFrame.changed, [], '其他订阅者推进序号而不收到个人事件')
  const replayFinished = trace.projected.findIndex(call => call.userId === 3 && call.seqs.includes(193))
  assert.ok(trace.projected.findIndex(call => call.userId === 1) < replayFinished)
  assert.ok(trace.projected.findIndex(call => call.userId === 2) < replayFinished)
})

test('投影过程中撤权时丢弃旧帧', settings, async t => {
  const { external, trace, hook, connect, append } = await gateway(t)
  const next = await connect(7, 7, 0)
  await next('ready')
  hook.project = async () => { await external.exec('INSERT INTO revoked VALUES(7)') }
  await append(1)
  await next('revoked')
  assert.ok(!trace.messages.some(frame => frame.type === 'batch'))
})
