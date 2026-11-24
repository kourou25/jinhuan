import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import bot from './chat-bot-example.mjs'

const host = process.env.BIND_HOST || '127.0.0.1'
const port = Number(process.env.PORT || 8789)

for (const name of ['PUSH_URL', 'PUSH_TOKEN', 'SIGNING_SECRET']) {
  if (!process.env[name]) throw new Error('Missing environment variable: ' + name)
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')

createServer({ requestTimeout: 10_000 }, async (req, res) => {
  try {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const request = new Request(new URL(req.url, 'http://localhost'), {
      method: req.method,
      headers: req.headers,
      ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
    })
    const reply = await bot.fetch(request, process.env)
    res.writeHead(reply.status, Object.fromEntries(reply.headers))
    res.end(reply.body ? await reply.text() : undefined)
  } catch {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }
}).listen(port, host, () => console.log(`Listening on http://${host}:${port}/webhook/jinhuan`))
