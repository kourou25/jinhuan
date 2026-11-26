export const isChatCursor = (value) => Number.isSafeInteger(value) && value >= 0

export function createChatRealtime(getUser) {
  const groups = new Map()
  let socket, user, retryTimer, openTimer, attempts = 0, subscription = 0, paused = false

  function close() {
    const old = socket
    socket = null
    clearTimeout(openTimer)
    old?.close()
    for (const group of groups.values()) {
      clearTimeout(group.timer)
      group.subscription = 0
      group.ready = false
    }
  }

  function remove(group, notify) {
    clearTimeout(group.timer)
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
      for (const { listener } of group.members) listener[notify]?.()
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
    group.ready = false
    group.subscription = ++subscription
    waitForProgress(group)
    send({ type: 'subscribe', group: group.id, cursor: group.cursor, subscription: group.subscription, mode: group.mode, generation: group.generation })
  }

  function receive(event) {
    let frame
    try { frame = JSON.parse(event.data) } catch { return }
    const group = groups.get(frame?.group)
    if (!group || group.subscription !== frame.subscription) return
    if (frame.type === 'reset' || frame.type === 'disabled' || frame.type === 'revoked') {
      remove(group, frame.type)
    } else if (frame.type === 'batch') {
      if (isChatCursor(frame.cursor) && frame.cursor <= group.cursor) return
      if (frame.from !== group.cursor || !isChatCursor(frame.cursor) || !Array.isArray(frame.items) || !Array.isArray(frame.changed)) {
        remove(group, 'reset')
        return
      }
      try {
        for (const member of group.members) {
          if (member.cursor >= frame.cursor) continue
          member.listener.batch(structuredClone(frame))
          member.cursor = frame.cursor
        }
      } catch {
        remove(group, 'reset')
        return
      }
      group.cursor = frame.cursor
      if (!group.ready) waitForProgress(group)
    } else if (frame.type === 'ready') {
      if (frame.cursor !== group.cursor) { remove(group, 'reset'); return }
      clearTimeout(group.timer)
      group.ready = true
      group.now = frame.now
      attempts = 0
      for (const { listener } of group.members) listener.ready(frame.now)
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
      group = { id, cursor, mode, generation, members: new Set(), subscription: 0, ready: false }
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
