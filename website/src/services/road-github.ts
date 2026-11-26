import { boundedJson, fail, sameOrigin } from '../lib/http'
import { now } from '../lib/time'
import type { C, User } from '../types'
import { needUser } from './auth'

type SyncStatus = 'none' | 'pending' | 'failed' | 'linked'
type SyncFields = { github_issue: number | null; github_sync_status: SyncStatus }
type RoadSync = SyncFields & {
  id: number
  user_id: number
  github_sync_key: string | null
  github_sync_started_at: number | null
}
type Issue = { number: number; body?: string | null }
type IssueDraft = { title: string; body: string }
type ApiResult = { status: number; data: unknown; retryAfter: number }

const REPO_API = 'https://api.github.com/repos/kourou25/jinhuan'
const ISSUES_API = REPO_API + '/issues'
const REQUEST_TIMEOUT = 10_000
const CHECK_DELAY = 30
const COLUMNS = 'id, user_id, github_issue, github_sync_status, github_sync_key, github_sync_started_at'
const REJECTED_CREATION = new Set([400, 401, 403, 404, 410, 415, 422, 429])

export function roadSkinSource(input: Record<string, unknown>) {
  const { skin_id: id, skin_source: source } = input
  const skinId = typeof id === 'string' && /^[a-z0-9][a-z0-9-]{2,47}$/.test(id) ? id : null
  const skinSource = skinId && typeof source === 'string' && /^[0-9a-f]{40}$/.test(source) ? source : null
  return { skinId, skinSource }
}

export function roadGithubView(row: Partial<SyncFields>): SyncFields {
  return {
    github_issue: row.github_issue ?? null,
    github_sync_status: row.github_sync_status ?? 'none',
  }
}

function requestInput(input: Record<string, unknown>): IssueDraft | { issue: number } | { reconcile: true } {
  if (Object.keys(input).length === 1 && input.reconcile === true) return { reconcile: true }
  if (Object.hasOwn(input, 'issue')) {
    if (Object.keys(input).length === 1 && typeof input.issue === 'number' &&
        Number.isSafeInteger(input.issue) && input.issue > 0) return { issue: input.issue }
    return fail(400, '请输入正整数 Issue 编号')
  }
  if (Object.keys(input).length !== 2 || typeof input.title !== 'string' || typeof input.body !== 'string') {
    return fail(400, '请填写愿意公开的标题与正文')
  }
  const title = input.title.trim()
  const body = input.body.trim().replace(/\r\n?/g, '\n')
  if (title.length < 2 || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) {
    return fail(400, '公开标题需要 2–120 个字符，且只能填写一行')
  }
  if (body.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
    return fail(400, '公开正文最多 4000 个字符，请填写纯文本')
  }
  return { title, body }
}

function githubIssue(data: unknown): Issue | null {
  if (!data || typeof data !== 'object' || !('number' in data) ||
      typeof data.number !== 'number' || !Number.isSafeInteger(data.number) || data.number < 1 ||
      'pull_request' in data || ('repository_url' in data && data.repository_url !== REPO_API)) return null
  return { number: data.number, body: 'body' in data && typeof data.body === 'string' ? data.body : null }
}

function rateWait(response: Response, data: unknown) {
  const retryAfter = response.headers.get('retry-after')
  const exhausted = response.headers.get('x-ratelimit-remaining') === '0'
  const rateMessage = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' &&
    /rate limit|abuse detection|has been spammed/i.test(data.message)
  if (response.status !== 429 &&
      !([403, 422].includes(response.status) && (retryAfter || exhausted || rateMessage))) return 0
  const reset = Number(response.headers.get('x-ratelimit-reset')) - now()
  const retry = retryAfter && !/^\d+$/.test(retryAfter) ? Date.parse(retryAfter) / 1000 - now() : Number(retryAfter)
  return Math.min(86400, Math.ceil(Math.max(0, retry || 0, exhausted ? reset || 0 : 0) || 60))
}

async function githubRequest(token: string, path = '', draft?: IssueDraft): Promise<ApiResult> {
  try {
    const response = await fetch(ISSUES_API + path, {
      method: draft ? 'POST' : 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'jinhuan-community',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(draft ? { 'content-type': 'application/json' } : {}),
      },
      body: draft ? JSON.stringify(draft) : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    })
    const data: unknown = await response.json().catch(() => null)
    return { status: response.status, data, retryAfter: rateWait(response, data) }
  } catch {
    return { status: 0, data: null, retryAfter: 0 }
  }
}

function marker(key: string) {
  return '<!-- jinhuan-road:' + key + ' -->'
}

function issueBody(text: string, key: string) {
  // 缩进代码块使用户输入的 Markdown、图片和提及按普通文本展示。
  return (text ? text.split('\n').map(line => '    ' + line).join('\n') + '\n\n' : '') + marker(key)
}

function findRoad(db: D1Database, id: number) {
  return db.prepare('SELECT ' + COLUMNS + ' FROM road_items WHERE id = ? AND hidden = 0 AND source_hidden = 0')
    .bind(id).first<RoadSync>()
}

function syncError(c: C, row: RoadSync, status: 404 | 409 | 429 | 503, error: string, retryAfter = 0) {
  if (retryAfter > 0) c.header('retry-after', String(retryAfter))
  return c.json({ ...roadGithubView(row), error }, status)
}

function linked(c: C, row: RoadSync, expected?: number) {
  if (expected !== undefined && expected !== row.github_issue) {
    return syncError(c, row, 409, '这条鞭打已关联到另一个 Issue')
  }
  return c.json(roadGithubView(row))
}

function pending(c: C, row: RoadSync, retryAfter = 0) {
  return syncError(c, row, 409, 'Issue 创建结果待确认，请稍后在这里重新核对，或关联已找到的 Issue', retryAfter)
}

async function settle(db: D1Database, row: RoadSync, issue: number | null) {
  return await db.prepare('UPDATE road_items SET github_issue = ?, github_sync_status = ?, ' +
    'github_sync_key = NULL, github_sync_started_at = NULL ' +
    'WHERE id = ? AND github_sync_status = ? AND github_sync_key IS ? RETURNING ' + COLUMNS)
    .bind(issue, issue === null ? 'failed' : 'linked', row.id, row.github_sync_status, row.github_sync_key)
    .first<RoadSync>() ?? await findRoad(db, row.id) ?? fail(404, '这条不存在')
}

function pauseKey(token: string) {
  return token ? 'road_github_authenticated_pause_until' : 'road_github_public_pause_until'
}

async function rememberPause(db: D1Database, token: string, seconds: number) {
  const t = now()
  await db.prepare('INSERT INTO site_settings (k, v, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(k) DO UPDATE SET v = MAX(CAST(site_settings.v AS INTEGER), CAST(excluded.v AS INTEGER)), updated_at = excluded.updated_at')
    .bind(pauseKey(token), String(t + seconds), t).run()
}

async function reconcile(c: C, row: RoadSync, token: string) {
  if (!row.github_sync_key || row.github_sync_started_at === null) return pending(c, row)
  const fingerprint = marker(row.github_sync_key)
  const since = new Date((row.github_sync_started_at - 60) * 1000).toISOString()
  let candidate: number | undefined
  for (let page = 1; page <= 3; page += 1) {
    const query = new URLSearchParams({ state: 'all', sort: 'created', direction: 'desc', since, per_page: '30', page: String(page) })
    const { status, data, retryAfter } = await githubRequest(token, '?' + query)
    if (retryAfter) {
      await rememberPause(c.env.DB, token, retryAfter)
      return syncError(c, row, 429, 'GitHub 请求过于频繁，请稍后重新核对', retryAfter)
    }
    if (status !== 200 || !Array.isArray(data)) return syncError(c, row, 503, '暂时无法核对 GitHub Issue，请稍后重试')
    for (const entry of data) {
      const issue = githubIssue(entry)
      if (!issue?.body?.includes(fingerprint)) continue
      if (candidate !== undefined && candidate !== issue.number) return pending(c, row)
      candidate = issue.number
    }
    if (data.length < 30) {
      if (candidate !== undefined) return linked(c, await settle(c.env.DB, row, candidate))
      break
    }
  }
  // 查无标记、标记被复制或结果超出查找范围时，继续保留待确认状态。
  return pending(c, row)
}

async function linkExisting(c: C, row: RoadSync, token: string, number: number) {
  const { status, data, retryAfter } = await githubRequest(token, '/' + number)
  if (retryAfter) {
    await rememberPause(c.env.DB, token, retryAfter)
    return syncError(c, row, 429, 'GitHub 请求过于频繁，请稍后重试', retryAfter)
  }
  if (status === 404 || status === 410 || (status >= 300 && status < 400)) {
    return syncError(c, row, 404, '在本仓库找不到这个 Issue')
  }
  if (status !== 200) return syncError(c, row, 503, '暂时无法核对 GitHub Issue，请稍后重试')
  if (githubIssue(data)?.number !== number) return syncError(c, row, 404, '请输入本仓库的 Issue 编号')
  const updated = await settle(c.env.DB, row, number)
  return updated.github_sync_status === 'linked' ? linked(c, updated, number) : pending(c, updated)
}

async function createIssue(c: C, row: RoadSync, token: string, draft: IssueDraft) {
  const db = c.env.DB
  const key = crypto.randomUUID()
  const startedAt = now()
  const claimed = await db.prepare('UPDATE road_items SET github_sync_status = ?, github_sync_key = ?, github_sync_started_at = ? ' +
    "WHERE id = ? AND hidden = 0 AND source_hidden = 0 AND github_sync_status IN ('none', 'failed') RETURNING " + COLUMNS)
    .bind('pending', key, startedAt, row.id).first<RoadSync>()
  if (!claimed) {
    const current = await findRoad(db, row.id) ?? fail(404, '这条不存在')
    return current.github_sync_status === 'linked' ? linked(c, current) : pending(c, current, CHECK_DELAY)
  }
  if (now() >= startedAt + CHECK_DELAY - REQUEST_TIMEOUT / 1000) {
    const updated = await settle(db, claimed, null)
    return syncError(c, updated, 503, '开始创建前请求已超时，请重试')
  }

  const { status, data, retryAfter } = await githubRequest(token, '', { title: draft.title, body: issueBody(draft.body, key) })
  const issue = status === 201 ? githubIssue(data) : null
  if (issue) return linked(c, await settle(db, claimed, issue.number))
  if (REJECTED_CREATION.has(status)) {
    if (retryAfter) await rememberPause(db, token, retryAfter)
    const updated = await settle(db, claimed, null)
    if (retryAfter) {
      return syncError(c, updated, 429, 'GitHub 请求过于频繁，请稍后重试', retryAfter)
    }
    return syncError(c, updated, 503, 'GitHub 拒绝了创建请求，站内鞭打已保留')
  }
  return syncError(c, claimed, 503, '暂时无法确认 GitHub 是否已创建 Issue，请稍后在这里重新核对', CHECK_DELAY)
}

export async function handleRoadGithub(c: C, requirePosting: (user: User) => Promise<void>) {
  c.header('cache-control', 'no-store')
  const user = needUser(c)
  sameOrigin(c)
  const rawId = c.req.param('id') ?? ''
  const id = /^\d+$/.test(rawId) ? Number(rawId) : 0
  const row = Number.isSafeInteger(id) && id > 0 ? await findRoad(c.env.DB, id) : null
  if (!row) return fail(404, '这条不存在')
  if (row.user_id !== user.id && !user.is_admin) return fail(403, '只有反馈作者或站点管理员可以关联 Issue')
  if (user.silenced) return fail(403, '你在 linux.do 处于禁言状态')
  await requirePosting(user)
  const input = requestInput(await boundedJson(c, 24576))
  if (row.github_sync_status === 'linked') return linked(c, row, 'issue' in input ? input.issue : undefined)

  const token = c.env.COMMUNITY_GITHUB_TOKEN?.trim() ?? ''
  const isPending = row.github_sync_status === 'pending'
  const reconciling = 'reconcile' in input
  if (reconciling && !isPending) return syncError(c, row, 409, '这条鞭打没有待确认的 Issue')
  if (!isPending && !('issue' in input) && !token) {
    return syncError(c, row, 503, '站点尚未启用公开 Issue 创建，可关联已有 Issue')
  }
  const wait = isPending ? (row.github_sync_started_at ?? 0) + CHECK_DELAY - now() : 0
  if (wait > 0) return pending(c, row, wait)
  if (c.env.AUTH_RL && !(await c.env.AUTH_RL.limit({ key: 'road-github:' + user.id })).success) {
    return syncError(c, row, 429, '请求过于频繁，请稍后重试', 60)
  }
  const pauseUntil = await c.env.DB.prepare('SELECT v FROM site_settings WHERE k = ?').bind(pauseKey(token)).first<string>('v')
  const remaining = Number(pauseUntil) - now()
  if (remaining > 0) return syncError(c, row, 429, 'GitHub 请求过于频繁，请稍后重试', remaining)
  if ('issue' in input) return linkExisting(c, row, token, input.issue)
  return isPending || reconciling ? reconcile(c, row, token) : createIssue(c, row, token, input)
}
