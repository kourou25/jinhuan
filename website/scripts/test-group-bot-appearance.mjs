// Run after npm run build:server. Uses an isolated local SQLite database and object store.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const website = fileURLToPath(new URL('../', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'group-bot-appearance-'))
const key = 'group-bot-appearance-local-fixture'
mkdirSync(join(root, 'data/db'), { recursive: true })
mkdirSync(join(root, 'config'))
writeFileSync(join(root, 'config/.env'), `DEV_LOGIN_KEY=${key}\nRATE_LIMIT=off\nMAIN_ACTIVATION=off\n`, { mode: 0o600 })
const db = new DatabaseSync(join(root, 'data/db/meme-hall.sqlite'))
const listener = createServer().listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const origin = `http://127.0.0.1:${port}`
let child, logs = ''
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZioAAAAASUVORK5CYII=', 'base64')

async function login(username, admin) {
  const result = await fetch(origin + '/auth/dev', { method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ key, username, admin: admin ? '1' : '0', tl: '2' }) })
  assert.equal(result.status, 302)
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(username).id
  for (const gid of [8, 9]) db.prepare('INSERT INTO chat_members(group_id,user_id,joined_at) VALUES(?,?,unixepoch()-60)').run(gid, id)
  return result.headers.getSetCookie().find(cookie => cookie.startsWith('sid=')).split(';')[0]
}

async function api(path, expected, { cookie, token, method = 'GET', body, from = origin } = {}) {
  const headers = { origin: from }
  if (cookie) headers.cookie = cookie
  if (token) headers.authorization = 'Bearer ' + token
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(body)
  }
  const result = await fetch(origin + '/api' + path, { method, headers, body })
  const data = await result.json()
  assert.equal(result.status, expected, `${method} ${path}: ${data.error || 'unexpected success'}`)
  return data
}

function form({ nickname = '看图助手', title = '今日值班', bubble = 'aurora', image, remove = false } = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ nickname, title, bubble })) data.set(key, value)
  if (image) data.set('avatar', new Blob([image], { type:'image/png' }), 'bot.png')
  if (remove) data.set('remove_avatar', '1')
  return data
}

try {
  db.exec(readFileSync(join(website, 'schema.sql'), 'utf8'))
  db.exec("INSERT INTO chat_groups(id,name,created_at) VALUES (8,'外观测试',unixepoch()-60),(9,'另一测试群',unixepoch()-60)")
  child = spawn(process.execPath, ['server/main.mjs'], { cwd:website, stdio:['ignore','pipe','pipe'],
    env: { ...process.env, HOST:'127.0.0.1', PORT:String(port), MEME_ROOT:root, ENV_FILE:join(root, 'config/.env'), CLIENT_DIR:join(website,'public'), DISABLE_CRON:'1' } })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-12000) })
  let ready = false
  for (let i=0; i<150 && child.exitCode===null; i++) {
    if (await fetch(origin + '/api/me').then(result => result.ok).catch(() => false)) { ready = true; break }
    await delay(50)
  }
  assert.ok(ready, 'local server did not start')

  const admin = await login('appearance-admin', true)
  const otherAdmin = await login('appearance-admin-2', true)
  const member = await login('appearance-member', false)
  const path = '/chat/groups/8/bots'
  const install = await api(path, 201, { cookie:admin, method:'POST', body:{ name:'图片回调' } })
  await api('/chat/groups/9/bots', 201, { cookie:admin, method:'POST', body:{ name:'另一个回调' } })
  const original = (await api(path, 200, { cookie:admin })).identity
  assert.equal(original.name, '图片回调')
  const save = (cookie, body, expected = 200, from = origin) => api(path + '/appearance', expected, { cookie, method:'PUT', body, from })
  await save(member, form({ image:png }), 403)
  await save(admin, form(), 403, 'https://example.net')
  await save(admin, form({ title:'太'.repeat(9) }), 400)
  await save(admin, form({ image:Buffer.from('<svg>unexpected format</svg>') }), 415)
  await save(admin, form({ image:png }))

  const { identity, bots } = await api(path, 200, { cookie:member })
  assert.equal(identity.username, original.username)
  assert.equal(identity.nick, '看图助手')
  assert.equal(bots[0].name, '图片回调')
  assert.deepEqual(identity.deco, { t:'今日值班', bb:'aurora', sc:'chat' })
  const image = await fetch(origin + identity.avatar, { headers:{ cookie:member } })
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/png')
  const storedKey = identity.avatar.slice('/img/'.length)
  assert.equal(db.prepare('SELECT used FROM uploads WHERE key=?').get(storedKey).used, 1)
  assert.equal((await api('/chat/groups/9/bots', 200, { cookie:member })).identity.nick, null)

  const { message_id } = await api(new URL(install.push_url).pathname.slice('/api'.length), 201,
    { token:install.push_token, method:'POST', body:{ text:'外观测试消息' } })
  const msgPath = `/chat/groups/8/messages/${message_id}`
  const { message:{ user } } = await api(msgPath, 200, { cookie:member })
  assert.equal(user.name, identity.nick)
  assert.equal(user.avatar, identity.avatar)
  assert.deepEqual(user.deco, identity.deco)
  const { members } = await api('/chat/groups/8/members?view=mention', 200, { cookie:member })
  assert.equal(members.find(item => item.username === identity.username).name, identity.nick)

  await save(otherAdmin, form({ nickname:'', title:'', bubble:'', remove:true }))
  const { message:{ user:reset } } = await api(msgPath, 200, { cookie:member })
  assert.equal(reset.name, original.name)
  assert.equal(reset.avatar, null)
  assert.equal(reset.deco, null)
  assert.equal(db.prepare('SELECT used FROM uploads WHERE key=?').get(storedKey).used, 0)
  console.log('群机器人外观：权限、头像上传与清理、群隔离、旧凭证推送、聊天与 @ 列表显示均通过')
} catch (error) {
  if (logs) console.error(logs)
  throw error
} finally {
  if (child && child.exitCode === null && !child.signalCode) {
    const stopped = once(child, 'exit')
    child.kill('SIGTERM')
    await stopped
  }
  db.close()
  rmSync(root, { recursive:true, force:true })
}
