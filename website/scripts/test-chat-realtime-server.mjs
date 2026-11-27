// 使用实际 Node 入口、SQLite、HTTP 和 WebSocket 验证群聊。先执行 npm run build:server。
import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { initializeChatRealtimeTestDb } from './chat-realtime-test-db.mjs'

const temp = resolve(process.env.TMPDIR || '.tmp')
mkdirSync(temp, { recursive: true })
const root = mkdtempSync(join(temp, 'chat-realtime-'))
for (const dir of ['config', 'data/db', 'logs', 'cache']) mkdirSync(join(root, dir), { recursive: true })
// 以发布包的目录结构启动，测试期间不从源码目录导入服务模块。
const stage = join(root, 'release/server')
mkdirSync(join(stage, 'dist'), { recursive: true })
for (const file of ['main.mjs', 'd1.mjs', 'r2.mjs', 'runtime.mjs', 'vars.json', 'dist/app.mjs']) {
  copyFileSync(join('server', file), join(stage, file))
}
const key = randomUUID()
const fixtureSuffix = randomUUID().slice(0, 8)
const ownerName = `rt_owner_${fixtureSuffix}`
const projectionGroups = [7, 1]
const realtimeGroups = projectionGroups.join(',')
writeFileSync(join(root, 'config/.env'), `DEV_LOGIN_KEY=${key}\nADMIN_USER_IDS=${devUserId(ownerName)}\nCHAT_REALTIME_GROUPS=${realtimeGroups}\nRATE_LIMIT=off\n`, { mode: 0o600 })
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
    HOST: '127.0.0.1', PORT: String(port), DISABLE_CRON: '1', CHAT_REALTIME_GROUPS: realtimeGroups,
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
async function login(username, admin = false) {
  const r = await fetch(origin + '/auth/dev', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ key, username, admin: admin ? '1' : '0' }) })
  assert.equal(r.status, 302, '本地测试账号登录失败')
  return r.headers.getSetCookie().find(c => c.startsWith('sid=')).split(';')[0]
}
async function api(cookie, url, method = 'GET', body) {
  const r = await fetch(origin + url, { method, headers: { cookie, origin, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  return { status: r.status, data: await r.json() }
}
async function connect(cookie, cursor, generation, group = 7) {
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
  ws.send(JSON.stringify({ type: 'subscribe', group, cursor, generation }))
  return { ws, async next(match) {
    for (let i = 0; i < 200; i++) {
      const index = frames.findIndex(match)
      if (index >= 0) return frames.splice(index, 1)[0]
      await delay(40)
    }
    throw Error('没有收到预期帧，已收到的帧类型 ' + frames.map(x => x.type).join(', '))
  } }
}
function devUserId(name) {
  const prefix = createHash('sha256').update('dev:' + name).digest('hex').slice(0, 12)
  return -(parseInt(prefix, 16) % 1e12) - 1
}
function seedUser(name, { displayName = name, createdAt = 1, groups = [7], avatar = null, deco = null } = {}) {
  const uid = devUserId(name)
  db.prepare('INSERT INTO users(id,username,name,avatar,deco,created_at,updated_at,main_activated_at) VALUES(?,?,?,?,?,?,?,1)')
    .run(uid, name, displayName, avatar, deco && JSON.stringify(deco), createdAt, createdAt)
  const addMember = db.prepare('INSERT INTO chat_members(group_id,user_id,joined_at) VALUES(?,?,?)')
  for (const group of groups) addMember.run(group, uid, createdAt)
  return uid
}

function assertMessageView(item, expected, owner, label) {
  const assertPerson = (person, { author, role }, reference) => {
    assert.ok(person, `${label}应包含${reference ? '引文' : '消息'}作者`)
    const showReal = !role || owner
    const name = showReal ? author.displayName : role.name
    assert.equal(person.name, name, `${label}的展示名称`)
    assert.equal(person.username, showReal ? author.username : role.name, `${label}的用户名`)
    assert.equal(person.avatar, showReal ? author.avatar : role.avatar, `${label}的头像`)
    assert.deepEqual(person.anon ?? null, role && (owner ? { ...role.anon, owner: true } : role.anon), `${label}的角色标记`)
    if (showReal) assert.deepEqual(person.deco, author.deco, `${label}的公开装扮`)
    if (!reference) {
      if (showReal) assert.equal(person.id, author.id, `${label}的作者编号`)
      else assert.equal(person.id, role.aliasId, `${label}应使用发言时的角色编号`)
    }
  }
  const assertRedacted = (value, { author }) => {
    const payload = JSON.stringify(value)
    for (const marker of [author.username, author.displayName, author.avatar, author.deco.t]) {
      assert.equal(payload.includes(marker), false, `${label}的匿名内容应只包含可见身份`)
    }
    assert.doesNotMatch(payload, new RegExp(`(?<!\\d)${author.id}(?!\\d)`), `${label}的匿名内容应隐藏作者编号`)
  }
  assert.ok(item, `${label}应包含预期消息`)
  const notice = expected.notice
  const hideNotice = !!notice?.publicBody && !owner
  assert.equal(item.body, hideNotice ? notice.publicBody : expected.body, `${label}的消息正文`)
  if (notice) {
    assert.equal(item.system_kind, notice.kind, `${label}的系统播报类型`)
    assert.equal(item.system_ref, hideNotice ? null : notice.ref, `${label}应按权限提供系统播报引用`)
  }
  if (hideNotice) {
    assert.equal(item.user?.anon?.generic, true, `${label}的系统播报应使用通用身份`)
    assertRedacted(item, expected)
  } else assertPerson(item.user, expected, false)
  if (expected.quote && (!expected.quote.ownerOnly || owner)) {
    assert.equal(item.reply_to?.id, expected.quote.id, `${label}应能跳转到引文原消息`)
    assert.equal(item.reply_to.text, expected.quote.body, `${label}的引用摘要`)
    assertPerson(item.reply_to, expected.quote, true)
    if (expected.quote.role && !owner) assertRedacted(item.reply_to, expected.quote)
  } else assert.equal(item.reply_to, null, `${label}只应包含当前视角可见的引用`)
  if (expected.role && !owner) assertRedacted(item, expected)
}

function assertOwnerNotification(frame, label) {
  const { type, item_ids, changed_ids, ...envelope } = frame
  const fields = ['group', 'subscription', 'from', 'cursor', 'state_cursor', 'now', 'receivedAt']
  assert.equal(type, 'notify')
  assert.ok(Object.entries(envelope).every(([key, value]) => fields.includes(key) && Number.isFinite(value)), `${label}只能包含数值通知元数据`)
  for (const ids of [item_ids, changed_ids]) {
    assert.ok(Array.isArray(ids) && ids.every(id => Number.isSafeInteger(id) && id > 0), `${label}应只携带消息编号`)
  }
}

async function recipientScenario(group, recipients) {
  const messagesPath = `/api/chat/groups/${group}/messages`
  const readbackPath = (ids, generation) => `/api/chat/groups/${group}/realtime-messages?${new URLSearchParams({ ids: ids.join(','), generation })}`
  const history = async ({ label, cookie }) => {
    const { status, data } = await api(cookie, messagesPath)
    assert.equal(status, 200, `群 ${group} 的${label}应能读取消息列表`)
    return data
  }
  const baselines = await Promise.all(recipients.map(history))
  const subscribe = () => Promise.all(recipients.map(({ label, cookie }, i) => {
    const { realtime_cursor, realtime_generation } = baselines[i]
    assert.ok(Number.isSafeInteger(realtime_cursor), `群 ${group} 的${label}应有实时游标`)
    assert.ok(realtime_generation, `群 ${group} 的${label}应有实时订阅代次`)
    return connect(cookie, realtime_cursor, realtime_generation, group)
  }))
  const live = await subscribe()
  await Promise.all(live.map((sub, i) => sub.next(f => f.type === 'ready' && f.cursor === baselines[i].realtime_cursor)))

  async function send(author, body, role = null, quote = null) {
    const sent = await api(author.cookie, messagesPath, 'POST', { body, command_id: randomUUID(), ...(quote && { reply_to: quote.id }) })
    assert.equal(sent.status, 200, `群 ${group} 应允许发送本地测试消息`)
    return { id: sent.data.message.id, author, body, role, quote }
  }

  async function verify(expected, transport, subscriptions, field = 'items') {
    await Promise.all(recipients.map(async (viewer, i) => {
      const { label, owner } = viewer
      const { items } = await history(viewer)
      const groupViewer = `群 ${group} 的${label}`
      const received = new Map()
      const notify = group === 1 && owner
      if (subscriptions) {
        const pending = new Set(expected.map(m => m.id))
        const notified = []
        const idsIn = notify ? f => f[field === 'items' ? 'item_ids' : 'changed_ids'] : f => f[field]?.map(m => m.id)
        while (pending.size) {
          const frame = await subscriptions[i].next(f => f.type === (notify ? 'notify' : 'batch') && idsIn(f)?.some(id => pending.has(id)))
          assert.equal(frame.group, group)
          if (notify) {
            assertOwnerNotification(frame, `${groupViewer}的${transport}`)
            for (const id of idsIn(frame)) if (pending.delete(id)) notified.push(id)
          } else {
            for (const item of frame[field]) if (pending.delete(item.id)) received.set(item.id, item)
          }
        }
        if (notify) {
          const { status, data } = await api(viewer.cookie, readbackPath(notified, baselines[i].realtime_generation))
          assert.equal(status, 200, `${groupViewer}应能用有效代次回读通知中的消息`)
          assert.deepEqual(data.items.map(m => m.id), notified, `${groupViewer}应按请求顺序回读消息`)
          for (const item of data.items) received.set(item.id, item)
        }
      }
      for (const spec of expected) {
        const http = items.find(m => m.id === spec.id)
        assertMessageView(http, spec, owner, `${groupViewer} HTTP`)
        assert.equal(http.can_delete, viewer.admin || spec.author.id === viewer.id, `${groupViewer}的删除权限`)
        if (!subscriptions) continue
        const actual = received.get(spec.id)
        const channel = notify ? `${transport}后的站长回读` : transport
        assertMessageView(actual, spec, owner, `${groupViewer} ${channel}`)
        assert.deepEqual({ user: actual.user, reply_to: actual.reply_to, can_delete: actual.can_delete },
          { user: http.user, reply_to: http.reply_to, can_delete: http.can_delete }, `${groupViewer} ${channel}应与 HTTP 一致`)
      }
    }))
  }

  async function verifyReplay(expected) {
    for (const { ws } of live) ws.terminate()
    // 重用发送前的游标，验证接收者在开关变更后补发到原来的消息身份。
    const replay = await subscribe()
    try { await verify(expected, '重连补发', replay) }
    finally { for (const { ws } of replay) ws.terminate() }
  }
  async function verifyReadbackAccess(id, otherGroupId) {
    const admin = recipients.findIndex(viewer => viewer.admin && !viewer.owner)
    const ownerIndex = recipients.findIndex(viewer => viewer.owner)
    const { cookie: ownerCookie } = recipients[ownerIndex]
    const otherGeneration = baselines[admin].realtime_generation
    const url = readbackPath([id], otherGeneration)
    const adminResult = await api(recipients[admin].cookie, url)
    assert.equal(adminResult.status, 403, '站点管理员不能使用站长的回读入口')
    assert.equal(adminResult.data.items, undefined, '未获授权的回读不应返回消息')
    const ownerResult = await api(ownerCookie, url)
    assert.equal(ownerResult.status, 409, '站长回读应要求当前会话的订阅代次')
    assert.equal(ownerResult.data.items, undefined, '代次不匹配的回读不应返回消息')
    const groupResult = await api(ownerCookie, readbackPath([id, otherGroupId], baselines[ownerIndex].realtime_generation))
    assert.equal(groupResult.status, 404, '回读只能请求本群的消息')
    assert.equal(groupResult.data.items, undefined, '包含群外消息的回读不应返回部分结果')
  }
  return { send, verify, verifyReplay, verifyReadbackAccess, live }
}

async function verifyRecipientProjections() {
  const recent = Math.floor(Date.now() / 1000) - 86400
  const localProfile = (part, displayName, title) => ({
    username: `rt_${part}_${fixtureSuffix}`, displayName: `${displayName}${fixtureSuffix}`,
    avatar: `/local-${part}-${fixtureSuffix}.svg`, deco: { t: title },
  })
  const authorProfile = localProfile('author', '本地发言作者', '发言装扮')
  const memberProfile = localProfile('member', '本地引用作者', '引用装扮')
  const ownerProfile = localProfile('owner', '本地测试站长', '站长装扮')
  const id = seedUser(authorProfile.username, { ...authorProfile, groups: projectionGroups })
  const author = { ...authorProfile, id, cookie: await login(authorProfile.username) }
  // 这些系统消息由数据库触发器生成，在隔离库直接写入相同形态的播报。
  const insertNotice = db.prepare(`INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
    VALUES(?,?,?,unixepoch(),unixepoch(),?,?) RETURNING id`)
  const notices = [
    { kind: 'guess_level', refPrefix: `${author.id}`, publicBody: '有群友解锁了新的猜词称号' },
    { kind: 'luck_level', refPrefix: `luck_king:${author.id}`, publicBody: '有群友解锁了新的手气称号' },
  ]
  const seedNotices = (group) => notices.map(({ kind, refPrefix, publicBody }) => {
    const ref = `${refPrefix}:${group === 1 ? 1 : 2}`
    const body = `${author.displayName}解锁了测试称号`
    const { id } = insertNotice.get(group, author.id, body, kind, ref)
    return { id, author, body, role: null, notice: { kind, ref, ...(group === 1 && { publicBody }) } }
  })
  const recipients = await Promise.all([
    { label: '普通成员', ...memberProfile },
    { label: '受限新用户', username: `rt_new_${fixtureSuffix}`, createdAt: recent, newbie: true },
    { label: '站点管理员', username: `rt_admin_${fixtureSuffix}`, createdAt: recent, admin: true },
    { label: '站长', ...ownerProfile, owner: true },
  ].map(async ({ label, newbie = false, admin = false, owner = false, ...profile }) => {
    const id = seedUser(profile.username, { ...profile, groups: projectionGroups })
    const cookie = await login(profile.username, admin)
    const me = await api(cookie, '/api/me')
    assert.equal(me.status, 200, `${label}应能读取本人的会话资料`)
    assert.equal(me.data.user?.id, id, `${label}应使用对应的测试账号`)
    assert.equal(me.data.newbie, newbie, `${label}的新用户状态`)
    assert.equal(me.data.user.chat_admin, admin, `${label}的群聊管理状态`)
    assert.equal(me.data.user.owner, owner, `${label}的站长状态`)
    return { ...profile, label, id, cookie, admin, owner }
  }))

  const regular = await recipientScenario(7, recipients)
  const original = await regular.send(recipients[0], '本地测试引用原文')
  const reply = await regular.send(author, '本地测试公开回复', null, original)
  const regularMessages = [original, reply, ...seedNotices(7)]
  await regular.verify(regularMessages, '实时推送', regular.live)
  await regular.verifyReplay(regularMessages)

  // 模拟自然经过两天的历史消息，再由有权限的站长通过正常发送入口引用它。
  const oldBody = '两天前的本地历史消息'
  const oldId = db.prepare(`INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at)
    VALUES(1,?,?,unixepoch()-172800,unixepoch()-172800) RETURNING id`).get(author.id, oldBody).id
  const old = { id: oldId, author, body: oldBody, role: null, ownerOnly: true }
  const group = await recipientScenario(1, recipients)
  const oldReply = await group.send(recipients.find(viewer => viewer.owner), '站长引用早期历史', null, old)
  await group.verify([oldReply], '实时推送', group.live)
  const settingsPath = '/api/chat/groups/1/anon'
  const settings = async (path = settingsPath, method = 'GET', body) => {
    const result = await api(author.cookie, path, method, body)
    assert.equal(result.status, 200, `应能使用本地群的匿名设置，${method} ${path}`)
    return result.data
  }
  assert.equal((await settings()).enabled, false, '作者的匿名开关应默认关闭')
  const before = await group.send(author, '开启匿名前的公开发言')
  await group.verify([before], '实时推送', group.live)

  const { pending } = await settings(`${settingsPath}/draw`, 'POST', {})
  assert.ok(pending?.name && pending.series && pending.item > 0, '作者应能抽到可用角色')
  const { identity } = await settings(`${settingsPath}/claim`, 'POST', { action: 'take' })
  assert.ok(identity?.avatar, '作者应能换上角色并取得其头像')
  const { name, series, series_name, item } = pending
  assert.deepEqual(identity.anon, { name, series, series_name, item }, '应换上刚抽到的角色')
  const aliasId = db.prepare('SELECT alias_id FROM anon_identities WHERE group_id=1 AND user_id=?').get(author.id)?.alias_id
  assert.ok(Number.isSafeInteger(aliasId) && aliasId !== author.id, '匿名角色应有独立的编号')
  const role = { ...identity, aliasId }
  const enabled = await settings(settingsPath, 'PUT', { enabled: true })
  assert.equal(enabled.enabled, true)
  assert.equal(enabled.active, true, '已满足群龄要求的作者应能匿名发言')
  await group.verify([before])

  const hidden = await group.send(author, '匿名开启时的发言', role)
  const hiddenReply = await group.send(author, '匿名开启时的引用回复', role, hidden)
  await group.verify([hidden, hiddenReply], '实时推送', group.live)
  await group.verifyReadbackAccess(hidden.id, reply.id)

  const disabled = await settings(settingsPath, 'PUT', { enabled: false })
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.active, false)
  const after = await group.send(author, '关闭匿名后的公开回复', null, hidden)
  await group.verify([after], '实时推送', group.live)

  const edited = { ...hiddenReply, body: '关闭匿名后编辑此前的匿名回复' }
  assert.equal((await api(author.cookie, `/api/chat/messages/${edited.id}`, 'PATCH', { body: edited.body })).status, 200)
  await group.verify([edited], '实时编辑', group.live, 'changed')
  const anonymousNotices = seedNotices(1)
  await group.verify(anonymousNotices, '实时推送', group.live)
  await group.verifyReplay([oldReply, before, hidden, edited, after, ...anonymousNotices])
  return { author, memberName: memberProfile.username }
}
try {
  initializeChatRealtimeTestDb(db)
  const addGroup = db.prepare('INSERT INTO chat_groups(id,name,created_at) VALUES(?,?,1)')
  for (const group of projectionGroups) addGroup.run(group, '本地验收群 ' + group)
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
  const anonBrowser = await verifyRecipientProjections()
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
    const browserUsers = ['vps_browser_a', 'vps_browser_b'].map(name => seedUser(name))
    const insert = db.prepare('INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at) VALUES(7,?,?,unixepoch(),unixepoch())')
    db.exec('BEGIN')
    for (let i = 1; i <= 110; i++) insert.run(writer, '浏览器验收历史 ' + i)
    // 升级前的本人消息没有发送命令编号，两位成员都要能恢复历史窗口。
    for (const uid of browserUsers) insert.run(uid, '升级前的本人消息')
    db.exec('UPDATE chat_members SET last_read=(SELECT MAX(id) FROM chat_messages WHERE group_id=7) WHERE group_id=7; COMMIT')
    const { author, memberName } = anonBrowser
    const browser = spawn(process.env.PYTHON || 'python3', [
      'scripts/test-chat-realtime-browser.py', '--origin', origin, '--db', join(root, 'data/db/meme-hall.sqlite'),
      '--key-file', join(root, 'config/.env'), '--anon-owner', ownerName, '--anon-member', memberName,
      '--anon-author', author.username, '--anon-author-id', String(author.id),
      '--anon-author-name', author.displayName, '--anon-author-avatar', author.avatar,
    ], { stdio: 'inherit', env: { ...process.env, TMPDIR: temp } })
    assert.equal((await once(browser, 'exit'))[0], 0, '浏览器验收失败')
  }
  const restartClose = once(own.ws, 'close')
  await stop()
  assert.equal((await restartClose)[0], 1012, '优雅退出应通知客户端重连')
  console.log('已验证并发幂等、同文独立发送、实时收取、进程重启补发、编辑撤回、撤权及接收者消息视图。')
} finally {
  for (const ws of sockets) ws.terminate()
  await stop()
  db.close()
  rmSync(root, { recursive: true, force: true })
}
