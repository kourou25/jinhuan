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
const TURN_BUDGET_MS = 8
const AUTH_CHUNK_SIZE = 8
const REPLAY_FRAMES_WITH_LIVE = 8
const MAX_CACHED_PAGES = 8
const SWEEP_LANES = ['live', 'live', 'live', 'replay', 'audit']
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
  const queued = new Set()
  const pages = new Map()
  let closed = false
  let busy = false
  let mergeTimer
  let continuation

  function wake() {
    if (closed || !streams.size || mergeTimer) return
    // 首次工作合并新提交，已经排队的工作独立续发，避免每片再等一次。
    mergeTimer = setTimeout(() => {
      mergeTimer = undefined
      for (const stream of streams.values()) queued.add(stream)
      continueSweep()
    }, WAKE_MS)
  }

  function continueSweep() {
    if (!closed && !busy && !continuation && queued.size) continuation = setTimeout(sweep, 0)
  }

  function remove(client, group) {
    const sub = client.groups.get(group)
    if (!sub) return
    client.groups.delete(group)
    const stream = streams.get(group)
    stream.subs.delete(sub)
    if (!stream.subs.size) {
      streams.delete(group)
      queued.delete(stream)
      pages.delete(group + ':live')
      pages.delete(group + ':replay')
    }
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
    const sub = { client, group, cursor, subscription, mode, ready: false, generation, checkAccessAt: 0 }
    if (!realtime.groups.has(group)) return send(sub, { type: 'disabled' })
    remove(client, group)
    if (!streams.has(group)) streams.set(group, { group, subs: new Set(), nextLane: 0 })
    streams.get(group).subs.add(sub)
    client.groups.set(group, sub)
    wake()
  }

  function connect(ws, auth) {
    const authKey = api.chatRealtimeAuthKey(auth)
    const client = { ws, auth, authKey, groups: new Map(), alive: true, commandWindow: 0, commands: 0 }
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

  async function eventPage(db, group, lane, after, initial) {
    const key = group + ':' + lane
    const cached = pages.get(key)
    if (cached?.revision === initial && cached.after <= after && after < cached.last) return cached

    const { results: events } = await db.prepare(
      'SELECT seq,group_id,message_id,kind,audience_user_id FROM chat_realtime_events WHERE group_id=? AND seq>? ORDER BY seq LIMIT ?',
    ).bind(group, after, PAGE_SIZE).all()
    const page = { revision: initial, after, events, last: events.at(-1).seq }
    // 只在数据库版本一致时复用公共页，权限和个人字段每次从当前读快照查询。
    pages.delete(key)
    pages.set(key, page)
    if (pages.size > MAX_CACHED_PAGES) pages.delete(pages.keys().next().value)
    return page
  }

  async function scan(stream, deadline) {
    const { group, subs } = stream
    const initial = DB.revision()
    const current = () => !closed && DB.revision() === initial

    return realtime.withSnapshot(async (db) => {
      const readEnv = { ...env, DB: db }
      const checkedAt = Date.now()
      const now = Math.floor(checkedAt / 1000)
      const status = await db.prepare(
        'SELECT COALESCE((SELECT seq FROM chat_realtime_pruned WHERE group_id=?1),0) floor, '
        + 'COALESCE((SELECT MAX(seq) FROM chat_realtime_events WHERE group_id=?1),0) latest, '
        + 'COALESCE((SELECT disabled FROM chat_realtime_controls WHERE group_id=?1),0) disabled, '
        + 'COALESCE((SELECT shadow FROM chat_realtime_controls WHERE group_id=?1),0) shadow',
      ).bind(group).first()
      if (!current()) return true
      const head = Math.max(status.floor, status.latest)
      const mode = status.shadow ? 'shadow' : 'live'
      const controls = [], lanes = { live: [], replay: [], audit: [] }
      for (const sub of subs) {
        if (status.disabled || sub.mode !== mode) controls.push(sub)
        else if (!sub.ready || sub.cursor !== head) lanes[sub.ready ? 'live' : 'replay'].push(sub)
        else if (checkedAt >= sub.checkAccessAt) lanes.audit.push(sub)
      }
      if (controls.length) {
        let processed = 0
        for (const sub of controls) {
          if (processed >= MAX_FRAMES_PER_SWEEP || (processed && performance.now() >= deadline)) return true
          if (!current()) return true
          stop(sub, status.disabled ? 'disabled' : 'reset')
          processed++
        }
        return !!(lanes.live.length || lanes.replay.length || lanes.audit.length)
      }

      // 有实时待发时限制补拉份额，空闲时让补拉使用整个切片。
      let lane
      for (let i = 0; i < SWEEP_LANES.length; i++) {
        lane = SWEEP_LANES[stream.nextLane]
        if (lanes[lane].length) break
        stream.nextLane = (stream.nextLane + 1) % SWEEP_LANES.length
      }
      const candidates = lanes[lane]
      if (!candidates.length) return false
      stream.nextLane = (stream.nextLane + 1) % SWEEP_LANES.length
      const limit = lane === 'replay' && lanes.live.length ? REPLAY_FRAMES_WITH_LIVE : MAX_FRAMES_PER_SWEEP
      const needsPage = sub => sub.cursor >= status.floor && sub.cursor < head
      const anchor = candidates.slice(0, limit).find(needsPage)
      const page = anchor ? await eventPage(db, group, lane, anchor.cursor, initial) : null
      const targets = candidates.filter(sub => !needsPage(sub) || (page && page.after <= sub.cursor && sub.cursor < page.last)).slice(0, limit)
      const ctx = context()
      let more = targets.length < candidates.length ||
        Object.entries(lanes).some(([name, waiting]) => name !== lane && waiting.length)
      let processed = 0

      for (let start = 0; start < targets.length; start += AUTH_CHUNK_SIZE) {
        if (processed && performance.now() >= deadline) return true
        const cohort = targets.slice(start, start + AUTH_CHUNK_SIZE).filter(sub => subs.has(sub))
        if (!cohort.length) continue
        const auths = [...new Map(cohort.map(({ client }) => [client.authKey, client.auth])).values()]
        const permissions = await api.getChatRealtimeAccessBatch(auths, group, readEnv, ctx)
        if (!current()) return true
        for (const sub of cohort) {
          if (processed && performance.now() >= deadline) return true
          if (!subs.has(sub)) continue
          const access = permissions.get(sub.client.authKey)
          if (!access || (sub.generation !== undefined && sub.generation !== access.generation)) stop(sub, 'revoked')
          else if (sub.cursor < status.floor || sub.cursor > head) stop(sub, 'reset')
          else {
            sub.generation = access.generation
            sub.checkAccessAt = checkedAt + SWEEP_MS
            if (sub.cursor < head) {
              page.rows ??= await api.hydrateChatRealtimeBatch(readEnv, group, [...new Set(page.events.map(event => event.message_id))])
              const events = sub.cursor === page.after ? page.events : page.events.filter(event => event.seq > sub.cursor)
              const { items, changed, resync } = await api.projectChatRealtimeBatch(sub.client.auth, access, group, page.rows, events, readEnv, ctx)
              // 投影中的并发提交使剩余帧重新取数，已经撤销的订阅不会继续发送。
              if (!current()) return true
              if (!subs.has(sub)) continue
              if (resync) stop(sub, 'reset')
              else if (send(sub, {
                type: 'batch', from: sub.cursor, cursor: page.last, state_cursor: head,
                now: page.last === head ? now : undefined, items, changed,
              })) sub.cursor = page.last
              else if (subs.has(sub)) remove(sub.client, group)
            }
            if (subs.has(sub)) {
              if (!sub.ready && sub.cursor === head) sub.ready = send(sub, { type: 'ready', cursor: head, now })
              more ||= !sub.ready || sub.cursor < head
              // 已处理的订阅放回队尾，下一片先服务前面仍待发的订阅。
              subs.delete(sub)
              subs.add(sub)
            }
          }
          processed++
        }
      }
      return more
    })
  }

  async function sweep() {
    continuation = undefined
    busy = true
    const deadline = performance.now() + TURN_BUDGET_MS
    const queuedAtStart = queued.size
    try {
      for (let i = 0; i < queuedAtStart && queued.size && (i === 0 || performance.now() < deadline); i++) {
        if (closed) return
        const stream = queued.values().next().value
        queued.delete(stream)
        if (!stream.subs.size) continue
        try {
          if (await scan(stream, deadline) && stream.subs.size) queued.add(stream)
        } catch (error) {
          if (closed) return
          console.error('群聊实时扫描失败', stream.group, error?.message)
          for (const sub of stream.subs) stop(sub, 'disabled')
        }
      }
    } finally {
      busy = false
      continueSweep()
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
    clearTimeout(mergeTimer)
    clearTimeout(continuation)
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
