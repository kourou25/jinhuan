import { WebSocket, WebSocketServer } from 'ws'

const ENDPOINT = '/api/chat/ws'
const PAGE_SIZE = 32
const SWEEP_MS = 1000
const WAKE_MS = 25
const PING_MS = 30000
const MAX_CONNECTIONS = 1024
const MAX_SUBSCRIPTIONS = 8
const MAX_READERS = 8
const MAX_QUEUE_BYTES = 512 * 1024
const MAX_FRAMES_PER_SWEEP = 64
const isCursor = (n) => Number.isSafeInteger(n) && n >= 0
const isId = (n) => isCursor(n) && n > 0

export function createChatRealtime(groupsConfig, openReader) {
  const groups = new Set(String(groupsConfig ?? '').split(',').map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s)).map(Number).filter(isId))
  const available = []
  const waiting = []
  let readers = 0
  let closed = false

  async function acquire() {
    if (closed) throw new Error('实时群聊已停止')
    const idle = available.pop()
    if (idle) return idle
    if (readers < MAX_READERS) {
      const db = openReader()
      readers++
      return db
    }
    const ready = await new Promise((resolve, reject) => waiting.push({ resolve, reject }))
    return ready ?? acquire()
  }

  async function withSnapshot(read) {
    const db = await acquire()
    let reusable = true
    try {
      db.beginReadSnapshot()
      const result = await read(db)
      db.endReadSnapshot(true)
      return result
    } catch (error) {
      try { db.endReadSnapshot(false) } catch { reusable = false }
      throw error
    } finally {
      if (closed || !reusable) {
        db.close()
        readers--
        // 失效连接由等待中的调用重新申请。
        const next = waiting.shift()
        if (next) next.resolve(undefined)
      } else {
        const next = waiting.shift()
        if (next) next.resolve(db)
        else available.push(db)
      }
    }
  }

  return {
    groups,
    withSnapshot,
    close() {
      closed = true
      for (const db of available.splice(0)) db.close()
      for (const waiter of waiting.splice(0)) waiter.reject(new Error('实时群聊已停止'))
    },
  }
}

export function attachChatRealtime(server, env, api, context, makeRequest) {
  const realtime = env.CHAT_REALTIME
  const { DB } = env
  const wss = new WebSocketServer({
    noServer: true, clientTracking: false, perMessageDeflate: false,
    maxPayload: 2048, maxFragments: 16, maxBufferedChunks: 64,
  })
  const clients = new Set()
  const handshakes = new Set()
  const streams = new Map()
  let closed = false
  let busy = false
  let pending = false
  let timer

  function wake() {
    if (closed || !streams.size) return
    pending = true
    if (busy || timer) return
    timer = setTimeout(sweep, WAKE_MS)
  }

  function remove(client, group) {
    const sub = client.groups.get(group)
    if (!sub) return
    client.groups.delete(group)
    const stream = streams.get(group)
    stream.subs.delete(sub)
    if (!stream.subs.size) streams.delete(group)
  }

  function send(sub, data) {
    const { client, group, subscription } = sub
    const { ws } = client
    if (ws.readyState !== WebSocket.OPEN) return false
    const text = JSON.stringify({ ...data, group, subscription })
    const bytes = Buffer.byteLength(text)
    if (bytes > MAX_QUEUE_BYTES) {
      stop(sub, 'reset')
      return false
    }
    if (ws.bufferedAmount + bytes > MAX_QUEUE_BYTES) {
      ws.terminate()
      return false
    }
    ws.send(text)
    return true
  }

  function stop(sub, type) {
    // 关闭慢连接时丢掉尚未写完的帧，防止旧权限范围的数据继续出队。
    if ((type === 'revoked' || type === 'disabled') && sub.client.ws.bufferedAmount) sub.client.ws.terminate()
    else send(sub, { type })
    remove(sub.client, sub.group)
  }

  function receive(client, bytes, binary) {
    const now = Date.now()
    if (now >= client.commandWindow) {
      client.commandWindow = now + 5000
      client.commands = 0
    }
    if (binary || ++client.commands > 64) return client.ws.terminate()
    let command
    try { command = JSON.parse(bytes.toString()) } catch {}
    if (!command || !isId(command.group) || (command.subscription !== undefined && !isId(command.subscription))) {
      return client.ws.close(1008, '无效的订阅请求')
    }
    const { group, cursor, subscription, type, mode = 'live', generation } = command
    const existing = client.groups.get(group)
    if (type === 'unsubscribe') {
      if (subscription === undefined || existing?.subscription === subscription) remove(client, group)
      return
    }
    if (type !== 'subscribe' || !isCursor(cursor) || (mode !== 'live' && mode !== 'shadow')
      || (generation !== undefined && (typeof generation !== 'string' || !generation.length || generation.length > 256))
      || (!existing && client.groups.size >= MAX_SUBSCRIPTIONS)) return client.ws.close(1008, '无效的订阅请求')
    const sub = { client, group, cursor, subscription, mode, ready: false, generation }
    if (!realtime.groups.has(group)) return send(sub, { type: 'disabled' })
    remove(client, group)
    if (!streams.has(group)) streams.set(group, { subs: new Set(), checkAccessAt: 0 })
    streams.get(group).subs.add(sub)
    client.groups.set(group, sub)
    wake()
  }

  function connect(ws, auth) {
    const client = { ws, auth, groups: new Map(), alive: true, commandWindow: 0, commands: 0 }
    clients.add(client)
    ws.on('error', () => ws.terminate())
    ws.on('pong', () => { client.alive = true })
    ws.on('message', (bytes, binary) => receive(client, bytes, binary))
    ws.on('close', () => {
      for (const group of client.groups.keys()) remove(client, group)
      clients.delete(client)
    })
  }

  function reject(socket, code, reason) {
    if (socket.destroyed) return
    socket.once('error', () => socket.destroy())
    socket.end('HTTP/1.1 ' + code + ' ' + reason + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  }

  async function upgrade(req, socket, head) {
    if (closed || req.url !== ENDPOINT || req.method !== 'GET') return reject(socket, 404, 'Not Found')
    if (handshakes.size + clients.size >= MAX_CONNECTIONS) return reject(socket, 503, 'Service Unavailable')
    const onError = () => socket.destroy()
    socket.on('error', onError)
    socket.pause()
    handshakes.add(socket)
    const deadline = setTimeout(() => socket.destroy(), 5000)
    try {
      const request = makeRequest(req)
      if (request.headers.get('origin') !== new URL(request.url).origin) return reject(socket, 403, 'Forbidden')
      const auth = await api.authenticateChatRealtime(request, env, context())
      if (closed || socket.destroyed) return
      if (!auth) return reject(socket, 401, 'Unauthorized')
      wss.handleUpgrade(req, socket, head, (ws) => {
        connect(ws, auth)
        socket.resume()
      })
    } catch (error) {
      console.error('群聊实时握手失败', error?.message)
      reject(socket, 503, 'Service Unavailable')
    } finally {
      clearTimeout(deadline)
      handshakes.delete(socket)
      socket.removeListener('error', onError)
    }
  }

  async function scan(group, stream) {
    const initial = DB.revision()
    const current = () => !closed && DB.revision() === initial
    const subscribers = [...stream.subs]

    return realtime.withSnapshot(async (db) => {
      const readEnv = { ...env, DB: db }
      const now = Math.floor(Date.now() / 1000)
      const status = await db.prepare(
        'SELECT COALESCE((SELECT seq FROM chat_realtime_pruned WHERE group_id=?1),0) floor, '
        + 'COALESCE((SELECT MAX(seq) FROM chat_realtime_events WHERE group_id=?1),0) latest, '
        + 'COALESCE((SELECT disabled FROM chat_realtime_controls WHERE group_id=?1),0) disabled, '
        + 'COALESCE((SELECT shadow FROM chat_realtime_controls WHERE group_id=?1),0) shadow',
      ).bind(group).first()
      if (!current()) return true
      const cursor = Math.max(status.floor, status.latest)
      const mode = status.shadow ? 'shadow' : 'live'
      const needed = subscribers.filter((sub) => status.disabled || sub.mode !== mode || !sub.ready || sub.cursor !== cursor)
      const checkAll = Date.now() >= stream.checkAccessAt
      if (!checkAll && !needed.length) return false

      const eligible = []
      for (const sub of checkAll ? subscribers : needed) {
        if (!stream.subs.has(sub)) continue
        if (status.disabled) stop(sub, 'disabled')
        else if (sub.mode !== mode) stop(sub, 'reset')
        else eligible.push(sub)
      }
      if (!eligible.length) return false
      const ctx = context()
      const auths = [...new Map(eligible.map(({ client }) => [api.chatRealtimeAuthKey(client.auth), client.auth])).values()]
      const permissions = await api.getChatRealtimeAccessBatch(auths, group, readEnv, ctx)
      if (!current()) return true
      const pending = []
      for (const sub of eligible) {
        if (!stream.subs.has(sub)) continue
        const access = permissions.get(api.chatRealtimeAuthKey(sub.client.auth))
        if (!access || (sub.generation !== undefined && sub.generation !== access.generation)) stop(sub, 'revoked')
        else if (sub.cursor < status.floor || sub.cursor > cursor) stop(sub, 'reset')
        else {
          sub.generation = access.generation
          if (sub.cursor < cursor) pending.push({ sub, access })
          else if (!sub.ready) sub.ready = send(sub, { type: 'ready', cursor, now })
        }
      }
      if (checkAll) stream.checkAccessAt = Date.now() + SWEEP_MS
      if (!pending.length) return false

      // 活跃订阅和积压订阅轮流优先。同一页的公共字段只查一次。
      const after = (stream.replayFirst = !stream.replayFirst)
        ? Math.min(...pending.map(({ sub }) => sub.cursor))
        : Math.max(...pending.map(({ sub }) => sub.cursor))
      const { results: events } = await db.prepare(
        'SELECT seq,group_id,message_id,kind FROM chat_realtime_events WHERE group_id=? AND seq>? ORDER BY seq LIMIT ?',
      ).bind(group, after, PAGE_SIZE).all()
      const last = events.at(-1).seq
      const rows = await api.hydrateChatRealtimeBatch(readEnv, group, [...new Set(events.map((event) => event.message_id))])
      let remaining = false
      let frames = 0
      for (const { sub, access } of pending) {
        if (!stream.subs.has(sub)) continue
        if (sub.cursor < after || sub.cursor >= last || frames >= MAX_FRAMES_PER_SWEEP) {
          remaining = true
          continue
        }
        const page = sub.cursor === after ? events : events.filter((event) => event.seq > sub.cursor)
        const { items, changed, resync } = await api.projectChatRealtimeBatch(sub.client.auth, access, group, rows, page, readEnv, ctx)
        // 所有数据和权限来自同一读快照。发现并发提交时，丢掉尚未发送的帧并重读。
        if (!current()) return true
        if (!stream.subs.has(sub)) continue
        if (resync) stop(sub, 'reset')
        // 只有追到快照末尾后，客户端才可据此推进 HTTP 回退的时间游标。
        else if (send(sub, {
          type: 'batch', from: sub.cursor, cursor: last, state_cursor: cursor,
          now: last === cursor ? now : undefined, items, changed,
        })) {
          sub.cursor = last
          if (last === cursor) {
            if (!sub.ready) sub.ready = send(sub, { type: 'ready', cursor, now })
          } else remaining = true
        }
        frames++
      }
      return remaining
    })
  }

  async function sweep() {
    timer = undefined
    pending = false
    busy = true
    try {
      for (const [group, stream] of [...streams]) {
        if (closed) return
        try {
          if (await scan(group, stream)) pending = true
        } catch (error) {
          if (closed) return
          console.error('群聊实时扫描失败', group, error?.message)
          for (const sub of stream.subs) stop(sub, 'disabled')
        }
      }
    } finally {
      busy = false
      if (pending) wake()
    }
  }

  const periodic = setInterval(wake, SWEEP_MS)
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive || client.ws.bufferedAmount > MAX_QUEUE_BYTES) client.ws.terminate()
      else if (client.ws.readyState === WebSocket.OPEN) {
        client.alive = false
        client.ws.ping()
      }
    }
  }, PING_MS)
  DB.onCommit(wake)
  server.on('upgrade', upgrade)
  return async () => {
    closed = true
    server.off('upgrade', upgrade)
    DB.onCommit(undefined)
    clearTimeout(timer)
    clearInterval(periodic)
    clearInterval(heartbeat)
    for (const socket of handshakes) socket.destroy()
    const closing = [...clients].map(({ ws }) => new Promise(resolve => {
      ws.once('close', resolve)
      ws.close(1012, '服务器重启')
    }))
    const deadline = setTimeout(() => {
      for (const client of clients) client.ws.terminate()
    }, 1000)
    await Promise.all(closing)
    clearTimeout(deadline)
    wss.close()
    realtime.close()
  }
}
