export const isChatCursor = (value) => Number.isSafeInteger(value) && value >= 0

function orderedJson(_key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
}

function shadowMessageHash(message) {
  // 已读进度可独立变化，回执里的用户名仍参与身份遮罩比对。
  const projection = { ...message, at_read: Object.keys(message.at_read ?? {}).sort() }
  // HTTP 更新批次可能省略 floor，command_id 用于发送命令对账。
  delete projection.floor
  delete projection.command_id
  const value = JSON.stringify(projection, orderedJson)
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return hash
}

export function createChatShadowSampler() {
  const samples = new Map()
  const stats = { batches: 0, compared: 0, mismatch: 0 }
  return {
    sample(data, cursor, source) {
      if (!isChatCursor(cursor)) return
      if (source === 'socket') stats.batches++
      // 只比对同一群快照下的同一条消息，待配对的数据在内存中只存摘要。
      for (const m of [...data.items, ...data.changed]) {
        const key = cursor + ':' + m.id
        const previous = samples.get(key)
        if (previous?.source === source || previous?.compared) continue
        const hash = shadowMessageHash(m)
        if (previous) {
          stats.compared++
          if (previous.hash !== hash) stats.mismatch++
          samples.set(key, { compared: true })
        } else {
          samples.set(key, { source, hash })
          if (samples.size > 1200) samples.delete(samples.keys().next().value)
        }
      }
      return { ...stats }
    },
    clear() { samples.clear() },
  }
}

export function createChatReadQueue({ getUser, send, onConfirmed, delay = 800, retryDelay = 1000 }) {
  const groups = new Map()
  let userId

  function syncUser() {
    const current = getUser()
    if (current === userId) return
    for (const group of groups.values()) clearTimeout(group.timer)
    groups.clear()
    userId = current
  }

  function state(id) {
    syncUser()
    if (!userId) return null
    let group = groups.get(id)
    if (!group) {
      group = { id, userId, pending: 0, confirmed: 0, failures: 0, order: 0, authority: 0, flights: new Set() }
      groups.set(id, group)
    }
    return group
  }

  function schedule(group) {
    if (group.timer || group.flights.size || group.blocked || group.pending <= group.confirmed) return
    const wait = group.failures ? Math.min(30000, retryDelay * 2 ** (group.failures - 1)) : delay
    // 以第一次推进作为发送期限，持续收消息也会定期提交。
    group.timer = setTimeout(() => {
      group.timer = null
      syncUser()
      if (groups.get(group.id) === group) submit(group)
    }, wait)
  }

  function finish(group, flight, ok, error) {
    syncUser()
    if (groups.get(group.id) !== group) return
    group.flights.delete(flight)
    const denied = !ok && [401, 403, 404].includes(error?.status)
    // 退出时请求可能重叠。按发出顺序处理授权结果，保留已读到但尚未提交的游标。
    if ((ok || denied) && flight.order > group.authority) {
      group.authority = flight.order
      group.blocked = denied
      group.failures = 0
    }
    if (ok && flight.upto > group.confirmed) {
      group.confirmed = flight.upto
      if (group.confirmed >= group.pending) group.failures = 0
      onConfirmed?.(group.id, group.confirmed, group.userId)
    } else if (!ok && !denied && flight.upto > group.confirmed) group.failures++
    schedule(group)
  }

  function submit(group) {
    if (group.blocked || group.pending <= group.confirmed) return
    clearTimeout(group.timer)
    group.timer = null
    const flight = { upto: group.pending, order: ++group.order }
    group.flights.add(flight)
    let request
    try { request = send(group.id, flight.upto, { userId: group.userId, keepalive: true }) }
    catch (error) { request = Promise.reject(error) }
    flight.promise = Promise.resolve(request).then(
      () => finish(group, flight, true), error => finish(group, flight, false, error),
    )
    return flight.promise
  }

  return {
    queue(id, upto) {
      if (!isChatCursor(upto) || !upto) return
      const group = state(id)
      if (!group || upto <= Math.max(group.pending, group.confirmed)) return
      group.pending = upto
      schedule(group)
    },
    observe(id, upto) {
      if (!isChatCursor(upto)) return
      const group = state(id)
      if (!group) return
      group.confirmed = Math.max(group.confirmed, upto)
      group.authority = group.order
      if (group.blocked) group.failures = 0
      group.blocked = false
      if (group.confirmed >= group.pending) {
        clearTimeout(group.timer)
        group.timer = null
        group.failures = 0
      }
      schedule(group)
    },
    confirmed(id) {
      syncUser()
      return groups.get(id)?.confirmed || 0
    },
    flush(id, { departing = false } = {}) {
      syncUser()
      const waits = []
      for (const group of groups.values()) {
        if (id !== undefined && group.id !== id) continue
        // 页面退出时必须发出最新游标。重复退出事件共用已发出的请求。
        const covered = [...group.flights].some(flight => flight.upto >= group.pending)
        if (!covered && (departing || group.flights.size < 2)) submit(group)
        waits.push(...[...group.flights].map(flight => flight.promise))
      }
      return Promise.all(waits)
    },
    reset(id) {
      syncUser()
      clearTimeout(groups.get(id)?.timer)
      groups.delete(id)
    },
  }
}

const MAX_PENDING_FRAMES = 32
// 服务端单页最多读取 32 个事件。
const MAX_NOTIFY_IDS = 32

export function createChatRealtime(getUser, loadMessages) {
  const groups = new Map()
  let socket, user, retryTimer, openTimer, attempts = 0, subscription = 0, paused = false

  function cancelFrames(group) {
    const pending = group.pending
    group.pending = null
    group.frames.length = 0
    if (pending) {
      clearTimeout(pending.timer)
      pending.controller.abort()
    }
  }

  function close() {
    const old = socket
    socket = null
    clearTimeout(openTimer)
    old?.close()
    for (const group of groups.values()) {
      clearTimeout(group.timer)
      cancelFrames(group)
      group.subscription = 0
      group.ready = false
    }
  }

  function remove(group, notify) {
    clearTimeout(group.timer)
    cancelFrames(group)
    groups.delete(group.id)
    if (socket?.readyState === WebSocket.OPEN && group.subscription) {
      send({ type: 'unsubscribe', group: group.id, subscription: group.subscription })
    }
    if (!groups.size) {
      close()
      clearTimeout(retryTimer)
      retryTimer = null
      attempts = 0
    }
    if (notify) {
      for (const { listener } of group.members) {
        if (notify === 'fallback') listener.fallback?.(true)
        else listener[notify]?.()
      }
    }
    group.members.clear()
  }

  function retry() {
    if (!groups.size || paused || navigator.onLine === false || retryTimer) return
    const delay = Math.min(30000, 1000 * 2 ** attempts) * (0.8 + Math.random() * 0.2)
    attempts++
    retryTimer = setTimeout(() => { retryTimer = null; connect() }, delay)
  }

  function disconnected() {
    close()
    for (const group of groups.values()) {
      for (const { listener } of group.members) listener.fallback?.()
    }
    retry()
  }

  function send(frame) {
    try { socket.send(JSON.stringify(frame)) }
    catch { disconnected() }
  }

  function waitForProgress(group) {
    clearTimeout(group.timer)
    group.timer = setTimeout(disconnected, 10000)
  }

  function subscribe(group) {
    cancelFrames(group)
    group.ready = false
    group.readyCursor = null
    group.receivedCursor = group.cursor
    group.subscription = ++subscription
    waitForProgress(group)
    send({ type: 'subscribe', group: group.id, cursor: group.cursor, subscription: group.subscription, mode: group.mode, generation: group.generation })
  }

  const currentFrame = (group, frame) => groups.get(group.id) === group && group.subscription === frame.subscription

  function deliver(group, frame) {
    if (frame.type === 'ready') {
      clearTimeout(group.timer)
      group.ready = true
      group.now = frame.now
      attempts = 0
      for (const { listener } of group.members) {
        if (!currentFrame(group, frame)) return
        listener.ready(frame.now)
      }
      return
    }
    if (frame.type === 'notify') {
      const { item_ids, changed_ids, ...batch } = frame
      batch.type = 'batch'
      const ids = [...item_ids, ...changed_ids]
      if (ids.length) void hydrate(group, frame, batch, ids)
      else deliver(group, { ...batch, items: [], changed: [] })
      return
    }
    try {
      for (const member of group.members) {
        if (!currentFrame(group, frame)) return
        if (member.cursor >= frame.cursor) continue
        member.listener.batch(structuredClone(frame))
        member.cursor = frame.cursor
      }
    } catch {
      if (currentFrame(group, frame)) remove(group, 'reset')
      return
    }
    if (!currentFrame(group, frame)) return
    group.cursor = frame.cursor
    if (!group.ready) waitForProgress(group)
  }

  async function hydrate(group, frame, batch, ids) {
    // 每群同时只补取一批，断开或失效时取消请求并清空该订阅的待处理帧。
    clearTimeout(group.timer)
    const controller = new AbortController()
    const pending = group.pending = { controller, timer: null }
    const current = () => group.pending === pending && currentFrame(group, frame)
    pending.timer = setTimeout(() => {
      if (!current()) return
      if (user !== getUser()) clear()
      else remove(group, 'fallback')
    }, 10000)
    let data
    try {
      data = await loadMessages(group.id, ids, group.generation, controller.signal)
    } catch (error) {
      if (!current()) return
      if (user !== getUser()) { clear(); return }
      const status = error?.status
      if (status === 401 || status === 403) remove(group, 'revoked')
      else if (status === 400 || status === 409 || error?.code === 'chat_realtime_message_unavailable') remove(group, 'reset')
      else remove(group, 'fallback')
      return
    }
    if (!current()) return
    if (user !== getUser()) { clear(); return }
    const items = data?.items
    const expected = new Set(ids)
    if (!Array.isArray(items) || items.length !== expected.size ||
      items.some(m => m?.group_id !== group.id || !expected.delete(m.id))) {
      remove(group, 'reset')
      return
    }
    const messages = new Map(items.map(m => [m.id, m]))
    clearTimeout(pending.timer)
    group.pending = null
    deliver(group, { ...batch, items: frame.item_ids.map(id => messages.get(id)), changed: frame.changed_ids.map(id => messages.get(id)) })
    while (currentFrame(group, frame) && !group.pending && group.frames.length) deliver(group, group.frames.shift())
  }

  function validNotify(frame, group) {
    if (typeof loadMessages !== 'function' || typeof group.generation !== 'string' || !group.generation || !isChatCursor(frame.state_cursor) || frame.state_cursor < frame.cursor ||
      !Array.isArray(frame.item_ids) || !Array.isArray(frame.changed_ids) || frame.item_ids.length + frame.changed_ids.length > MAX_NOTIFY_IDS) return false
    const ids = [...frame.item_ids, ...frame.changed_ids]
    return ids.every(id => isChatCursor(id) && id > 0) && new Set(ids).size === ids.length
  }

  function receive(event) {
    let frame
    try { frame = JSON.parse(event.data) } catch { return }
    const group = groups.get(frame?.group)
    if (!group || !currentFrame(group, frame)) return
    if (frame.type === 'reset' || frame.type === 'disabled' || frame.type === 'revoked') {
      remove(group, frame.type)
      return
    }
    if (frame.type === 'ready') {
      if (isChatCursor(frame.cursor) && frame.cursor === group.readyCursor) return
      if (frame.cursor !== group.receivedCursor) { remove(group, 'reset'); return }
      group.readyCursor = frame.cursor
    } else if (frame.type === 'batch' || frame.type === 'notify') {
      if (isChatCursor(frame.cursor) && frame.cursor <= group.receivedCursor) return
      const payload = frame.type === 'notify' ? validNotify(frame, group) : Array.isArray(frame.items) && Array.isArray(frame.changed)
      if (frame.from !== group.receivedCursor || !isChatCursor(frame.cursor) || !payload) { remove(group, 'reset'); return }
      group.receivedCursor = frame.cursor
    } else return
    if (group.pending) {
      if (group.frames.length >= MAX_PENDING_FRAMES) remove(group, 'fallback')
      else group.frames.push(frame)
    } else {
      deliver(group, frame)
    }
  }

  function connect() {
    if (!groups.size || socket || retryTimer || paused || navigator.onLine === false || typeof WebSocket !== 'function') return
    const url = new URL('/api/chat/ws', location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let connection
    try { connection = new WebSocket(url) } catch { retry(); return }
    socket = connection
    openTimer = setTimeout(disconnected, 10000)
    connection.addEventListener('open', () => {
      if (socket !== connection) return
      clearTimeout(openTimer)
      for (const group of groups.values()) {
        if (socket !== connection) break
        subscribe(group)
      }
    })
    connection.addEventListener('message', (event) => {
      if (socket !== connection) return
      if (user !== getUser()) { clear(); return }
      receive(event)
    })
    connection.addEventListener('close', () => { if (socket === connection) disconnected() })
  }

  function clear() {
    close()
    groups.clear()
    clearTimeout(retryTimer)
    retryTimer = null
    attempts = 0
  }

  function watch(id, cursor, mode, generation, listener) {
    if (typeof WebSocket !== 'function' || !isChatCursor(cursor)) return
    if (user !== getUser()) { clear(); user = getUser() }
    if (!user) return
    let group = groups.get(id)
    if (group && (group.mode !== mode || group.generation !== generation)) {
      remove(group, 'reset')
      group = null
    }
    if (!group) {
      group = { id, cursor, mode, generation, members: new Set(), frames: [], subscription: 0, ready: false }
      groups.set(id, group)
    }
    const member = { cursor, listener }
    group.members.add(member)
    const rewind = cursor < group.cursor
    if (rewind) group.cursor = cursor
    if (socket?.readyState === WebSocket.OPEN) {
      // 新面板的首屏可能较早。共享订阅从它的游标补拉，其他面板跳过已消费的帧。
      if (rewind || !group.subscription) subscribe(group)
      else if (group.ready) queueMicrotask(() => { if (group.ready && group.members.has(member)) listener.ready(group.now) })
    } else connect()
    return () => {
      if (groups.get(id) !== group) return
      group.members.delete(member)
      if (!group.members.size) remove(group)
    }
  }

  return {
    watch,
    pause() { paused = true; disconnected() },
    resume() { paused = false; clearTimeout(retryTimer); retryTimer = null; connect() },
  }
}
