// 本地验收的出站隔离。只有环回测试服务可以继续使用真实网络。
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const issuePath = '/repos/kourou25/jinhuan/issues'
export const token = 'community-hub-e2e-fixture-token'
export const fix = { issue: 41, kind: 'fix', title: '本地夹具修复', body: '修复条目用于验收旧链接。' }
export const feature = { issue: 43, kind: 'feature', title: '本地夹具新功能', body: '功能条目用于验收分类筛选。' }
export const updates = { version: 1, updates: [fix, feature] }
export const deniedTitle = '公开同步本地拒绝夹具'
export const interruptedTitle = '公开同步本地断线夹具'

const root = process.env.COMMUNITY_HUB_E2E_ROOT
if (root) {
  const fetchLocal = globalThis.fetch
  let nextIssue = 70
  const createdIssues = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin === process.env.COMMUNITY_HUB_E2E_ORIGIN) return fetchLocal(request)
    if (request.method === 'GET' && request.url === 'https://raw.githubusercontent.com/kourou25/jinhuan/main/contributions/site-updates.json') {
      return Response.json(updates)
    }
    if (request.method === 'GET' && request.url === 'https://raw.githubusercontent.com/kourou25/meme-hall-skins/main/catalog.json') {
      return Response.json(JSON.parse(readFileSync(join(root, 'pending-catalog.json'), 'utf8')))
    }
    if (url.origin !== 'https://api.github.com') throw Error(`本地测试未配置出站请求 ${request.method} ${url.origin}${url.pathname}`)
    const path = url.pathname
    if (path === issuePath && request.method === 'POST') {
      const { title, body } = await request.json()
      const authorized = request.headers.get('authorization') === `Bearer ${token}`
      appendFileSync(join(root, 'github.ndjson'), JSON.stringify({ method: request.method, path, title, body, authorized }) + '\n')
      if (!authorized) return Response.json({ message: '本地夹具凭据不匹配' }, { status: 401 })
      if (title === deniedTitle) return Response.json({ message: '本地夹具拒绝提交' }, { status: 422 })
      const created = { number: ++nextIssue, title, body }
      createdIssues.unshift(created)
      if (title === interruptedTitle) throw new TypeError('本地夹具模拟 GitHub 连接中断')
      return Response.json(created, { status: 201 })
    }
    if (request.method === 'GET' && path.startsWith(issuePath)) {
      appendFileSync(join(root, 'github.ndjson'), JSON.stringify({ method: request.method, path }) + '\n')
      if (path === issuePath) return Response.json(createdIssues)
      if (path === issuePath + '/' + fix.issue) return Response.json({ number: fix.issue, title: fix.title, body: fix.body })
      if (path === issuePath + '/' + feature.issue) return Response.json({ number: feature.issue, title: feature.title, body: feature.body })
      if (path === issuePath + '/42') return Response.json({ number: 42, pull_request: {} })
      return Response.json({ message: '本地夹具 Issue 不存在' }, { status: 404 })
    }
    throw Error(`本地测试未配置出站请求 ${request.method} ${url.origin}${path}`)
  }
}
