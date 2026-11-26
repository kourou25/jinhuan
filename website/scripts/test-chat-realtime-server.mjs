// 使用实际 Node 入口、SQLite、HTTP 和 WebSocket 验证群聊。先执行 npm run build:server。
import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'

const temp = resolve(process.env.TMPDIR || '.tmp')
mkdirSync(temp, { recursive: true })
const root = mkdtempSync(join(temp, 'chat-realtime-'))
for (const dir of ['config', 'data/db', 'logs', 'cache']) mkdirSync(join(root, dir), { recursive: true })
// 以发布包的目录结构启动，测试期间不从源码目录导入服务模块。
const stage = join(root, 'release/server')
mkdirSync(join(stage, 'dist'), { recursive: true })
for (const file of ['main.mjs', 'd1.mjs', 'r2.mjs', 'runtime.mjs', 'vars.json', 'dist/app.mjs', 'dist/chat-realtime.mjs']) {
  copyFileSync(join('server', file), join(stage, file))
}
const key = randomUUID()
writeFileSync(join(root, 'config/.env'), 'DEV_LOGIN_KEY=' + key + '\nCHAT_REALTIME_GROUPS=7\nRATE_LIMIT=off\n', { mode: 0o600 })
const db = new DatabaseSync(join(root, 'data/db/meme-hall.sqlite'))
const portProbe = createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const port = portProbe.address().port
await new Promise(resolve => portProbe.close(resolve))
const origin = 'http://127.0.0.1:' + port
let child, serverLog = ''
const sockets = new Set()
const path = '/api/chat/groups/7/messages'
async function start() {
  child = fork(join(stage, 'main.mjs'), [], { cwd: stage, silent: true, env: {
    ...process.env, ENV_FILE: join(root, 'config/.env'), MEME_ROOT: root, CLIENT_DIR: resolve(process.argv.includes('--browser') ? 'web/dist/client' : 'public'),
    HOST: '127.0.0.1', PORT: String(port), DISABLE_CRON: '1'
  } })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { serverLog = (serverLog + part).slice(-8000) })
  for (let attempt = 0; attempt < 150 && child.exitCode == null; attempt++) {
    if (await fetch(origin + '/api/me').then(r => r.ok).catch(() => false)) return
    await delay(50)
  }
  throw Error('本地服务启动失败 ' + serverLog)
}
async function stop(signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode) return
  const ended = once(child, 'exit')
  child.kill(signal)
  await ended
}
async function login(username) {
  const r = await fetch(origin + '/auth/dev', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ key, username }) })
  assert.equal(r.status, 302, '本地测试账号登录失败')
  return r.headers.getSetCookie().find(c => c.startsWith('sid=')).split(';')[0]
}
async function api(cookie, url, method = 'GET', body) {
  const r = await fetch(origin + url, { method, headers: { cookie, origin, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  return { status: r.status, data: await r.json() }
}
async function connect(cookie, cursor, generation) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/chat/ws', { origin, headers: { cookie } })
  sockets.add(ws)
  ws.on('close', () => sockets.delete(ws))
  const frames = []
  ws.on('message', raw => {
    const frame = JSON.parse(raw)
    frame.receivedAt = performance.now()
    frames.push(frame)
  })
  await once(ws, 'open', { signal: AbortSignal.timeout(5000) })
  ws.send(JSON.stringify({ type: 'subscribe', group: 7, cursor, generation }))
  return { ws, async next(match) {
    for (let i = 0; i < 200; i++) {
      const index = frames.findIndex(match)
      if (index >= 0) return frames.splice(index, 1)[0]
      await delay(40)
    }
    throw Error('没有收到预期帧，已收到的帧类型 ' + frames.map(x => x.type).join(', '))
  } }
}
function seedUser(name) {
  const prefix = createHash('sha256').update('dev:' + name).digest('hex').slice(0, 12)
  const uid = -(parseInt(prefix, 16) % 1e12) - 1
  db.prepare('INSERT INTO users(id,username,name,created_at,updated_at,main_activated_at) VALUES(?,?,?,1,1,1)').run(uid, name, name)
  db.prepare('INSERT INTO chat_members(group_id,user_id,joined_at) VALUES(7,?,1)').run(uid)
  return uid
}
try {
  db.exec(readFileSync('schema.sql', 'utf8'))
  db.exec("INSERT INTO chat_groups(id,name,created_at) VALUES(7,'本地验收群',1)")
  const writer = seedUser('rt_sender')
  const reader = seedUser('rt_reader')
  await start()
  const sender = await login('rt_sender'), receiver = await login('rt_reader')
  const first = await api(receiver, path)
  assert.equal(first.status, 200)
  const cursor = first.data.realtime_cursor
  assert.ok(Number.isSafeInteger(cursor), '测试群应声明实时高水位')
  const stream = await connect(receiver, cursor, first.data.realtime_generation)
  await stream.next(f => f.type === 'ready')
  const cmd = { body: '两条相同的普通消息', command_id: randomUUID() }
  const pair = await Promise.all([api(sender, path, 'POST', cmd), api(sender, path, 'POST', cmd)])
  assert.deepEqual(pair.map(r => r.status), [200, 200], JSON.stringify(pair))
  const mid = pair[0].data.message.id
  assert.equal(pair[1].data.message.id, mid)
  const delivery = await stream.next(f => f.items?.some(m => m.id === mid && m.body === cmd.body))
  assert.equal(delivery.items.find(m => m.id === mid).mine, false)
  assert.equal((await api(sender, path, 'POST', { ...cmd, body: '修改了命令内容' })).status, 409)
  const deliberate = await api(sender, path, 'POST', { ...cmd, command_id: randomUUID() })
  assert.equal(deliberate.status, 200)
  assert.notEqual(deliberate.data.message.id, mid)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE body=?').get(cmd.body).n, 2)
  const readPath = '/api/chat/groups/7/read'
  const readProgress = db.prepare('SELECT last_read FROM chat_members WHERE group_id=7 AND user_id=?')
  const readBeforeSwitch = readProgress.get(reader).last_read
  assert.equal((await api(receiver, readPath, 'POST', { id: mid, reader_id: writer })).status, 403)
  assert.equal(readProgress.get(reader).last_read, readBeforeSwitch)
  assert.equal((await api(receiver, readPath, 'POST', { id: deliberate.data.message.id, reader_id: reader })).status, 200)
  assert.equal((await api(receiver, readPath, 'POST', { id: mid })).status, 200)
  assert.equal(readProgress.get(reader).last_read, deliberate.data.message.id)
  await stop('SIGKILL')
  await start()
  const restored = await connect(receiver, delivery.cursor, first.data.realtime_generation)
  await restored.next(f => f.items?.some(m => m.id === deliberate.data.message.id))
  await restored.next(f => f.type === 'ready')
  assert.equal((await api(sender, path, 'POST', cmd)).data.message.id, mid, '重启后必须仍能识别已提交的命令')
  assert.equal((await api(sender, '/api/chat/messages/' + mid, 'PATCH', { body: '编辑后的消息' })).status, 200)
  await restored.next(f => f.changed?.some(m => m.id === mid && m.body === '编辑后的消息'))
  assert.equal((await api(sender, '/api/chat/messages/' + mid, 'DELETE')).status, 200)
  await restored.next(f => f.changed?.some(m => m.id === mid && m.deleted && !m.body))
  // 同一红包向两个订阅者提供不同的个人状态。全程仅写隔离库，不触发外部领奖。
  const senderBase = (await api(sender, path)).data
  const own = await connect(sender, senderBase.realtime_cursor, senderBase.realtime_generation)
  await own.next(f => f.type === 'ready')
  const packetId = 'local-packet'
  db.exec('BEGIN')
  const packetMessage = db.prepare(`INSERT INTO chat_messages(group_id,user_id,body,redpack_id,created_at,updated_at)
    VALUES(7,?,'测试红包',?,unixepoch(),unixepoch()) RETURNING id`).get(reader, packetId).id
  db.prepare("INSERT INTO chat_redpacks(id,message_id,secret,mode) VALUES(?,?,'','open')").run(packetId, packetMessage)
  db.prepare("INSERT INTO chat_redpack_opens(packet_id,user_id,solved_at) VALUES(?,?,unixepoch())").run(packetId, reader)
  db.prepare('INSERT INTO chat_redpack_external_views(packet_id,user_id,data,synced_at) VALUES(?,?,?,unixepoch())')
    .run(packetId, reader, JSON.stringify({ state: 'active', claimed: true }))
  db.exec('COMMIT')
  for (const [subscription, solved] of [[restored, true], [own, false]]) {
    const frame = await subscription.next(f => f.items?.some(m => m.id === packetMessage))
    const packet = frame.items.find(m => m.id === packetMessage).redpack
    assert.equal(packet.solved, solved)
    assert.equal(!!packet.snapshot?.claimed, solved)
  }
  // 单独更新领取者的同步时间，双方都要追平，但只有本人收到红包内容。
  const syncedAt = Math.floor(Date.now() / 1000) + 1
  db.prepare('UPDATE chat_redpack_external_views SET synced_at=? WHERE packet_id=? AND user_id=?')
    .run(syncedAt, packetId, reader)
  const privateCursor = db.prepare('SELECT MAX(seq) AS seq FROM chat_realtime_events WHERE group_id=7').get().seq
  const mine = await restored.next(f => f.type === 'batch' && f.cursor === privateCursor)
  assert.equal(mine.changed.find(m => m.id === packetMessage)?.redpack.synced_at, syncedAt)
  const other = await own.next(f => f.type === 'batch' && f.cursor === privateCursor)
  assert.deepEqual(other.items, [])
  assert.deepEqual(other.changed, [])
  db.prepare('DELETE FROM chat_members WHERE group_id=7 AND user_id=?').run(reader)
  await restored.next(f => f.type === 'revoked')
  assert.ok([403, 404].includes((await api(receiver, path)).status))
  if (process.argv.includes('--measure')) {
    const names = Array.from({ length: 12 }, (_, i) => 'rt_measure_' + i)
    for (const name of names) seedUser(name)
    const listeners = await Promise.all(names.map(async name => {
      const cookie = await login(name)
      const base = (await api(cookie, path)).data
      const listener = await connect(cookie, base.realtime_cursor, base.realtime_generation)
      await listener.next(f => f.type === 'ready')
      return listener
    }))
    const latency = []
    for (let i = 0; i < 20; i++) {
      const started = performance.now()
      const response = await api(sender, path, 'POST', { body: '本机测量 ' + i, command_id: randomUUID() })
      assert.equal(response.status, 200)
      const id = response.data.message.id
      const received = await Promise.all(listeners.map(sub => sub.next(f => f.items?.some(m => m.id === id))))
      latency.push(...received.map(f => f.receivedAt - started))
    }
    latency.sort((a,b) => a-b)
    console.log('本机 12 位订阅者、20 条顺序发送，POST 开始至 WS 帧到达共 %d 份，p50=%d ms，p95=%d ms',
      latency.length, Math.round(latency[Math.ceil(latency.length * 0.5)-1]), Math.round(latency[Math.ceil(latency.length * 0.95)-1]))
  }
  if (process.argv.includes('--browser')) {
    const browserUsers = ['vps_browser_a', 'vps_browser_b'].map(seedUser)
    const insert = db.prepare('INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at) VALUES(7,?,?,unixepoch(),unixepoch())')
    db.exec('BEGIN')
    for (let i = 1; i <= 110; i++) insert.run(writer, '浏览器验收历史 ' + i)
    // 升级前的本人消息没有发送命令编号，两位成员都要能恢复历史窗口。
    for (const uid of browserUsers) insert.run(uid, '升级前的本人消息')
    db.exec('UPDATE chat_members SET last_read=(SELECT MAX(id) FROM chat_messages WHERE group_id=7) WHERE group_id=7; COMMIT')
    const browser = spawn(process.env.PYTHON || 'python3',
      ['scripts/test-chat-realtime-browser.py', '--origin', origin, '--db', join(root, 'data/db/meme-hall.sqlite'), '--key-file', join(root, 'config/.env')],
      { stdio: 'inherit', env: { ...process.env, TMPDIR: temp } })
    assert.equal((await once(browser, 'exit'))[0], 0, '浏览器验收失败')
  }
  const restartClose = once(own.ws, 'close')
  await stop()
  assert.equal((await restartClose)[0], 1012, '优雅退出应通知客户端重连')
  console.log('已验证并发幂等、同文独立发送、实时收取、进程重启补发、编辑撤回和撤权。')
} finally {
  for (const ws of sockets) ws.terminate()
  await stop()
  db.close()
  rmSync(root, { recursive: true, force: true })
}
