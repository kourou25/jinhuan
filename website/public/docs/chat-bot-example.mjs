// Use this handler directly in a Cloudflare Worker or with chat-bot-node.mjs.
// Supply PUSH_URL, PUSH_TOKEN and SIGNING_SECRET for a single bot installation.

const encoder = new TextEncoder()
const uuid = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}'
const eventIdPattern = new RegExp('^' + uuid + '$')
const pushPathPattern = new RegExp('^/api/chat-bots/(' + uuid + ')/messages$')
const bodyLimit = 8192

async function readBody(request) {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const body = new Uint8Array(bodyLimit)
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return body.subarray(0, size)
      if (size + value.byteLength > bodyLimit) {
        await reader.cancel()
        return null
      }
      body.set(value, size)
      size += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
}

async function verify(secret, timestamp, signature, body) {
  const prefix = encoder.encode(timestamp + '.')
  const signed = new Uint8Array(prefix.length + body.length)
  signed.set(prefix)
  signed.set(body, prefix.length)
  const bytes = Uint8Array.from(signature.match(/.{2}/g), byte => Number.parseInt(byte, 16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, bytes, signed)
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/webhook/jinhuan') return new Response('Not found', { status: 404 })
    if (request.method !== 'POST') return new Response('Use POST', { status: 405, headers: { Allow: 'POST' } })

    const pushUrl = URL.canParse(env.PUSH_URL) ? new URL(env.PUSH_URL) : null
    const installation = pushUrl && pushPathPattern.exec(pushUrl.pathname)?.[1]
    if (!installation || pushUrl.protocol !== 'https:' || !env.PUSH_TOKEN || !env.SIGNING_SECRET) {
      return new Response('Bot credentials are not configured', { status: 503 })
    }

    const timestamp = request.headers.get('X-Jinhuan-Timestamp') ?? ''
    const signature = /^sha256=([0-9a-f]{64})$/.exec(request.headers.get('X-Jinhuan-Signature') ?? '')
    if (!signature || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return new Response('Invalid signature or timestamp', { status: 401 })
    }

    const body = await readBody(request)
    if (!body) return new Response('Request too large', { status: 413 })
    if (!await verify(env.SIGNING_SECRET, timestamp, signature[1], body)) {
      return new Response('Invalid signature', { status: 401 })
    }

    let event
    try { event = JSON.parse(new TextDecoder().decode(body)) }
    catch { return new Response('Invalid JSON', { status: 400 }) }
    if (event?.type !== 'chat.command' || event.installation_id !== installation ||
        typeof event.event_id !== 'string' || !eventIdPattern.test(event.event_id) ||
        event.event_id !== request.headers.get('X-Jinhuan-Event')) {
      return new Response('Invalid command event', { status: 400 })
    }

    let text
    switch (event.command) {
      case 'doc': text = '群机器人接入文档：' + new URL('/docs/chat-bots', pushUrl).href; break
      case 'help': text = '可用指令：\n/doc 查看接入文档\n/help 查看指令列表\n/status 检查机器人是否在线'; break
      case 'status': text = '机器人在线，指令回调正常。'; break
      default: return new Response(null, { status: 204 })
    }

    // The push API uses reply_event_id to return the same reply on a retry.
    try {
      const reply = await fetch(pushUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.PUSH_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reply_event_id: event.event_id }),
        redirect: 'manual',
        signal: AbortSignal.timeout(3000),
      })
      await reply.body?.cancel()
      if (reply.ok) return new Response(null, { status: 204 })
    } catch {}
    return new Response('Could not post the reply', { status: 502 })
  },
}
