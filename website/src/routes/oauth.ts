// 「用尽欢账号登录」：OAuth 2.0 授权码模式 + PKCE，OpenID Connect（ID Token 用 ES256 签名）。接入文档 docs/oauth.md。
// 挂在识别用户的中间件之后、主站激活闸门之前（live-app.js）。令牌、用户信息、撤销、发现文档允许跨域（不带 Cookie）。
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { C, Ctx, User } from '../types'
import { now } from '../lib/time'
import { boundedJson, fail, sameOrigin } from '../lib/http'
import { hmacHex, sha256, verifyHmac } from '../lib/crypto'
import { isOwner, needUser } from '../services/auth'
import { getSetting, setSetting } from '../services/settings'
import { TRUSTED_GROUP_IDS, isNewbie } from '../services/identity-mask'
import { jwks, signer } from '../services/oauth-keys'
import { ACCESS_TTL, SCOPE_LABELS, clientInput, grantScope, mergeScopes, scopeCovers, scopeList, validChallenge, validNonce, validState, absolutePicture, displayName } from '../services/oauth-rules'
import {
  type AuthParams, type OAuthClient, accessToken, activeUser, checkSecret, clientRedirects, createClient, dropRequest, getClient, grantOf, idToken,
  issueCode, issueTokens, listGrants, loadRequest, publicClient, redeemCode, revokeClientTokens, revokeGrant, revokeToken, rotateSecret, saveGrant,
  saveRequest, updateClient, useRefreshToken, userClaims,
} from '../services/oauth'

export const oauth = new Hono<Ctx>()
// 这些路径给第三方网站的前端 / 服务端调用：允许跨域，不读 Cookie（live-app.js 的同源检查放行它们）
export const OAUTH_CORS_PATHS = /^\/(?:oauth\/(?:token|userinfo|revoke|jwks\.json)|\.well-known\/(?:openid-configuration|oauth-authorization-server))$/
const MAX_APPS_PER_USER = 10
// 授权相关的响应一律不缓存（发现文档和公钥自己设置缓存）
for (const path of ['/api/oauth/*', '/oauth/*']) oauth.use(path, async (c, next) => { await next(); if (!c.res.headers.get('cache-control')) c.header('cache-control', 'no-store') })

const issuer = (c: C) => (c.env.OAUTH_ISSUER || new URL(c.req.url).origin).replace(/\/+$/, '')
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
const emailOpen = async (c: C, client: Pick<OAuthClient, 'email_allowed'>) => !!client.email_allowed && (await getSetting(c.env.DB, 'oauth.email_scope', 'off')) === 'on'

function cors(c: C) {
  c.header('access-control-allow-origin', '*')
  c.header('access-control-allow-methods', 'GET, POST, OPTIONS')
  c.header('access-control-allow-headers', 'authorization, content-type')
  c.header('access-control-max-age', '600')
}
const noStore = (c: C) => { c.header('cache-control', 'no-store'); c.header('pragma', 'no-cache') }
const oauthError = (c: C, error: string, description: string, status: 400 | 401 | 403 | 429 | 500 | 503 = 400) => { noStore(c); return c.json({ error, error_description: description }, status) }

// 限流：沿用 AUTH_RL（每个键每分钟 10 次）。键里带上 IP，令牌接口再带上应用
async function limited(c: C, bucket: string) {
  if (!c.env.AUTH_RL) return false
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  const key = c.env.PASSWORD_PEPPER ? await hmacHex(c.env.PASSWORD_PEPPER, `oauth-rate|${bucket}|${ip}`) : await sha256(`oauth-rate|${bucket}|${ip}`)
  return !(await c.env.AUTH_RL.limit({ key })).success
}
async function formBody(c: C): Promise<Record<string, string> | null> {
  const type = c.req.header('content-type') ?? ''
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(type)) return null
  const text = await c.req.text()
  if (text.length > 8192) return null
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(text)) { if (k in out) return null; out[k] = v } // 参数不能重复（RFC 6749 §3.2）
  return out
}

// 新用户（注册不满 30 天、不在受信群）只开放图廊、群聊、鱼鱼谷，也不能用尽欢账号登录其他应用 / 注册应用
async function newbie(c: C, u: User & { created_at?: number }) {
  if (!isNewbie(c.env, u)) return false
  const trusted = await c.env.DB.prepare('SELECT 1 FROM chat_members WHERE user_id=? AND group_id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(u.id, JSON.stringify([...TRUSTED_GROUP_IDS])).first()
  return !trusted
}

// ---------- 页面 ----------
function page(c: C, title: string, body: string, status: 200 | 400 | 403 | 503 = 200) {
  noStore(c)
  c.header('x-frame-options', 'DENY')
  c.header('content-security-policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self'; form-action 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*; frame-ancestors 'none'; base-uri 'none'")
  c.header('referrer-policy', 'no-referrer')
  return c.html(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)} · 尽欢</title><link rel="stylesheet" href="/oauth.css"></head><body><main class="oauth-card">${body}</main></body></html>`, status)
}
const errorPage = (c: C, message: string, status: 400 | 403 | 503 = 400) =>
  page(c, '无法继续授权', `<h1>无法继续授权</h1><p class="oauth-muted">${esc(message)}</p><div class="oauth-actions"><a class="oauth-btn oauth-secondary" href="/">回到尽欢</a></div>`, status)

// 授权结果回到应用：带上 state 和 iss（RFC 9207）
function back(c: C, p: Pick<AuthParams, 'redirect_uri' | 'state'>, params: Record<string, string>) {
  const url = new URL(p.redirect_uri)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  if (p.state) url.searchParams.set('state', p.state)
  url.searchParams.set('iss', issuer(c))
  noStore(c)
  return c.redirect(url.toString(), 302)
}

type Checked = { client: OAuthClient; params: AuthParams } | Response
// 校验授权请求。client_id / redirect_uri 不对时不能跳回去，只显示错误页；其余错误按规范跳回应用
async function checkAuthorize(c: C, q: Record<string, string | undefined>): Promise<Checked> {
  const client = await getClient(c.env.DB, q.client_id)
  if (!client) return errorPage(c, '应用不存在（client_id 无效）。')
  if (client.status !== 'active') return errorPage(c, client.status === 'pending' ? '这个应用还在等待尽欢站长审核。' : '这个应用已被停用。', 403)
  const redirect_uri = q.redirect_uri ?? ''
  if (!clientRedirects(client).includes(redirect_uri)) return errorPage(c, '回调地址（redirect_uri）与应用登记的不一致。')
  if (!validState(q.state)) return errorPage(c, 'state 参数无效。')
  const state = q.state || undefined
  const to = (error: string, description: string) => back(c, { redirect_uri, state }, { error, error_description: description })
  if (q.request || q.request_uri) return to('request_not_supported', '不支持 request 参数')
  if (q.response_type !== 'code') return to('unsupported_response_type', '只支持 response_type=code')
  if (q.response_mode && q.response_mode !== 'query') return to('invalid_request', '只支持 response_mode=query')
  const granted = grantScope(q.scope, await emailOpen(c, client))
  if ('error' in granted) return to('invalid_scope', granted.error)
  if (scopeList(granted.scope).includes('openid') && !(await signer(c.env).catch(() => null))) return to('server_error', 'OIDC 签名密钥尚未配置')
  if (q.code_challenge !== undefined || q.code_challenge_method !== undefined) {
    if (q.code_challenge_method !== 'S256') return to('invalid_request', 'code_challenge_method 只支持 S256')
    if (!validChallenge(q.code_challenge)) return to('invalid_request', 'code_challenge 格式不对')
  } else if (client.client_type === 'public') return to('invalid_request', '公开客户端必须使用 PKCE（S256）')
  if (!validNonce(q.nonce)) return to('invalid_request', 'nonce 参数无效')
  const prompt = (q.prompt ?? '').split(' ').filter(Boolean)
  if (prompt.includes('none') && prompt.length > 1) return to('invalid_request', 'prompt=none 不能和其他值同时使用')
  return { client, params: { client_id: client.client_id, redirect_uri, scope: granted.scope, state, nonce: q.nonce || undefined, code_challenge: q.code_challenge || undefined, prompt: prompt.join(' ') || undefined } }
}

const sessionHash = (c: C) => sha256(getCookie(c, 'sid') ?? '')
async function authTime(c: C) {
  const row = await c.env.DB.prepare('SELECT created_at FROM sessions WHERE id=?').bind(await sessionHash(c)).first<{ created_at: number }>()
  return row?.created_at || now()
}
const consentToken = async (c: C, reqId: string) => hmacHex(c.env.PASSWORD_PEPPER || '', `oauth-consent|${reqId}|${await sessionHash(c)}`)

function consentPage(c: C, client: OAuthClient, p: AuthParams, user: User, reqId: string, csrf: string) {
  const host = new URL(p.redirect_uri).host, homeHost = (() => { try { return new URL(client.homepage).host } catch { return '' } })()
  const scopes = scopeList(p.scope).map((s) => `<li>${esc(SCOPE_LABELS[s])}</li>`).join('')
  const avatar = absolutePicture(user.avatar, issuer(c))
  const icon = client.icon_url ? `<img class="oauth-app-icon" src="${esc(client.icon_url)}" alt="" referrerpolicy="no-referrer">` : `<div class="oauth-app-icon oauth-app-letter">${esc([...client.name][0] ?? '?')}</div>`
  return page(c, '授权 ' + client.name, `
<div class="oauth-head">${icon}<div><h1>${esc(client.name)}</h1><a class="oauth-muted" href="${esc(client.homepage)}" target="_blank" rel="noopener noreferrer">${esc(homeHost)}</a></div></div>
${client.description ? `<p class="oauth-desc">${esc(client.description)}</p>` : ''}
<p>这个应用想使用你的尽欢账号登录，并申请：</p>
<ul class="oauth-scopes">${scopes}</ul>
<div class="oauth-me">${avatar ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : ''}<span>当前账号：<strong>${esc(displayName(user))}</strong></span></div>
<form method="post" action="/oauth/authorize" class="oauth-actions">
<input type="hidden" name="req" value="${esc(reqId)}"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button class="oauth-btn" name="decision" value="allow" type="submit">允许</button>
<button class="oauth-btn oauth-secondary" name="decision" value="deny" type="submit">拒绝</button>
</form>
<p class="oauth-small">授权后会跳转到 <strong>${esc(host)}</strong>。尽欢不会把你的密码、站内用户 ID 或其他资料交给这个应用。随时可以在 <a href="/oauth-apps#grants">账号设置 · 已授权的应用</a> 撤销。</p>`)
}

// 已登录用户：检查账号状态 → 已记住同意就直接发授权码，否则显示同意页
async function proceed(c: C, client: OAuthClient, p: AuthParams, reqId: string | null): Promise<Response> {
  const user = c.get('user')
  const none = p.prompt?.split(' ').includes('none')
  if (!user) {
    if (none) return back(c, p, { error: 'login_required', error_description: '用户未登录' })
    const id = reqId ?? await saveRequest(c.env.DB, p, now())
    noStore(c)
    return c.redirect('/login?next=' + encodeURIComponent('/oauth/authorize?req=' + id), 302)
  }
  const t = now()
  if (!(await activeUser(c.env.DB, user.id))) return errorPage(c, '账号已停用或已注销，不能授权其他应用。', 403)
  if (await newbie(c, user)) return none ? back(c, p, { error: 'access_denied', error_description: '账号注册未满 30 天' }) : errorPage(c, '注册满 30 天后才能用尽欢账号登录其他应用。', 403)
  if (c.env.MAIN_ACTIVATION === 'required' && !user.main_activated_at) return none ? back(c, p, { error: 'access_denied', error_description: '账号未激活' }) : errorPage(c, '请先用邀请码激活主站账号。', 403)
  const grant = await grantOf(c.env.DB, user.id, client.client_id)
  const remembered = !!grant && scopeCovers(grant.scope, p.scope)
  if (remembered && !p.prompt?.split(' ').includes('consent')) {
    if (reqId) await dropRequest(c.env.DB, reqId)
    return back(c, p, { code: await issueCode(c.env.DB, p, user.id, await authTime(c), t) })
  }
  if (none) return back(c, p, { error: 'consent_required', error_description: '需要用户同意授权' })
  const id = reqId ?? await saveRequest(c.env.DB, p, t)
  return consentPage(c, client, p, user, id, await consentToken(c, id))
}

oauth.get('/oauth/authorize', async (c) => {
  if (await limited(c, 'authorize')) return errorPage(c, '操作太频繁，请稍后重试。')
  const q = c.req.query()
  if (q.req) {
    const p = await loadRequest(c.env.DB, q.req, now())
    if (!p) return errorPage(c, '授权请求已过期，请回到应用重新登录。')
    const checked = await checkAuthorize(c, { ...p, response_type: 'code', code_challenge_method: p.code_challenge ? 'S256' : undefined })
    if (checked instanceof Response) return checked
    return proceed(c, checked.client, checked.params, q.req)
  }
  const checked = await checkAuthorize(c, q)
  if (checked instanceof Response) return checked
  return proceed(c, checked.client, checked.params, null)
})

oauth.post('/oauth/authorize', async (c) => {
  sameOrigin(c)
  if (await limited(c, 'consent')) return errorPage(c, '操作太频繁，请稍后重试。')
  const form = await formBody(c)
  if (!form) return errorPage(c, '请求格式不对。')
  const user = c.get('user')
  if (!user) return errorPage(c, '登录状态已失效，请回到应用重新登录。', 403)
  const p = await loadRequest(c.env.DB, form.req, now())
  if (!p) return errorPage(c, '授权请求已过期，请回到应用重新登录。')
  if (!c.env.PASSWORD_PEPPER || !(await verifyHmac(c.env.PASSWORD_PEPPER, `oauth-consent|${form.req}|${await sessionHash(c)}`, form.csrf ?? ''))) return errorPage(c, '页面已失效，请回到应用重新登录。', 403)
  const checked = await checkAuthorize(c, { ...p, response_type: 'code', code_challenge_method: p.code_challenge ? 'S256' : undefined })
  if (checked instanceof Response) return checked
  const { client, params } = checked
  await dropRequest(c.env.DB, form.req)
  if (form.decision !== 'allow') return back(c, params, { error: 'access_denied', error_description: '用户拒绝了授权' })
  const t = now()
  if (!(await activeUser(c.env.DB, user.id)) || (await newbie(c, user))) return errorPage(c, '当前账号不能授权其他应用。', 403)
  const old = await grantOf(c.env.DB, user.id, client.client_id)
  await saveGrant(c.env.DB, user.id, client.client_id, old ? mergeScopes(old.scope, params.scope) : params.scope, t)
  return back(c, params, { code: await issueCode(c.env.DB, params, user.id, await authTime(c), t) })
})

// ---------- 令牌接口 ----------
type ClientAuth = { client: OAuthClient } | { error: string; description: string; status: 400 | 401 }
async function authenticateClient(c: C, form: Record<string, string>): Promise<ClientAuth> {
  let id = form.client_id, secret = form.client_secret
  const header = c.req.header('authorization')
  if (header?.startsWith('Basic ')) {
    let decoded = ''
    try { decoded = atob(header.slice(6).trim()) } catch { return { error: 'invalid_client', description: 'Authorization 头格式不对', status: 401 } }
    const i = decoded.indexOf(':')
    if (i < 0) return { error: 'invalid_client', description: 'Authorization 头格式不对', status: 401 }
    try { id = decodeURIComponent(decoded.slice(0, i)); secret = decodeURIComponent(decoded.slice(i + 1)) } catch { return { error: 'invalid_client', description: 'Authorization 头格式不对', status: 401 } }
    if (form.client_secret) return { error: 'invalid_request', description: '只能用一种方式提供客户端凭据', status: 400 }
    if (form.client_id && form.client_id !== id) return { error: 'invalid_request', description: 'client_id 不一致', status: 400 }
  }
  const client = await getClient(c.env.DB, id)
  if (!client || client.status !== 'active') return { error: 'invalid_client', description: '应用不存在或未启用', status: 401 }
  if (client.client_type === 'confidential') {
    if (!secret || !(await checkSecret(client, secret))) return { error: 'invalid_client', description: '客户端密钥错误', status: 401 }
  } else if (secret) return { error: 'invalid_client', description: '公开客户端不应提供密钥', status: 401 }
  return { client }
}

for (const path of ['/oauth/token', '/oauth/userinfo', '/oauth/revoke', '/oauth/jwks.json', '/.well-known/openid-configuration', '/.well-known/oauth-authorization-server'])
  oauth.options(path, (c) => { cors(c); return c.body(null, 204) })

oauth.post('/oauth/token', async (c) => {
  cors(c)
  const form = await formBody(c)
  if (!form) return oauthError(c, 'invalid_request', '请用 application/x-www-form-urlencoded 提交，且参数不能重复')
  const auth = await authenticateClient(c, form)
  if ('error' in auth) { if (auth.status === 401) c.header('www-authenticate', 'Basic realm="oauth"'); return oauthError(c, auth.error, auth.description, auth.status) }
  const { client } = auth
  if (await limited(c, 'token|' + client.client_id)) return oauthError(c, 'slow_down', '请求太频繁，请稍后重试', 429)
  const t = now(), iss = issuer(c)
  let row: { user_id: number; scope: string; auth_time: number; nonce?: string | null }, family: string
  if (form.grant_type === 'authorization_code') {
    if (!form.code || !form.redirect_uri) return oauthError(c, 'invalid_request', '缺少 code 或 redirect_uri')
    const r = await redeemCode(c.env.DB, form.code, client, form.redirect_uri, form.code_verifier, t)
    if ('error' in r) return oauthError(c, r.error, r.description)
    row = r; family = r.code_hash
  } else if (form.grant_type === 'refresh_token') {
    if (!form.refresh_token) return oauthError(c, 'invalid_request', '缺少 refresh_token')
    const r = await useRefreshToken(c.env.DB, form.refresh_token, client, t)
    if ('error' in r) return oauthError(c, r.error, r.description)
    row = r; family = r.family_id
    if (form.scope) {
      if (!scopeCovers(r.scope, form.scope)) return oauthError(c, 'invalid_scope', '不能超出原来授权的范围')
      row = { ...r, scope: scopeList(r.scope).filter((s) => scopeList(form.scope).includes(s)).join(' ') }
    }
  } else return oauthError(c, 'unsupported_grant_type', '只支持 authorization_code 和 refresh_token')
  const user = await activeUser(c.env.DB, row.user_id)
  if (!user) return oauthError(c, 'invalid_grant', '账号已停用或已注销')
  if (!(await grantOf(c.env.DB, row.user_id, client.client_id))) return oauthError(c, 'invalid_grant', '用户已撤销授权')
  if (!(await emailOpen(c, client)) && scopeList(row.scope).includes('email')) row = { ...row, scope: scopeList(row.scope).filter((s) => s !== 'email').join(' ') }
  const tokens = await issueTokens(c.env.DB, { clientId: client.client_id, uid: user.id, scope: row.scope, family, authTime: row.auth_time, t })
  const body: Record<string, unknown> = { access_token: tokens.access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: tokens.refresh, scope: row.scope }
  if (scopeList(row.scope).includes('openid')) {
    try {
      body.id_token = await idToken(c.env, { issuer: iss, clientId: client.client_id, claims: await userClaims(c.env.DB, user, client.client_id, row.scope, iss, t), authTime: row.auth_time, nonce: row.nonce, t })
    } catch (e) {
      console.error('oauth_id_token_failed', (e as Error)?.message)
      return oauthError(c, 'server_error', 'OIDC 签名密钥未配置或无效', 500)
    }
  }
  noStore(c)
  return c.json(body)
})

async function userinfo(c: C) {
  cors(c)
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const deny = (error: string, description: string, status: 400 | 401 | 403 = 401) => { c.header('www-authenticate', `Bearer error="${error}", error_description="${description}"`); return oauthError(c, error, description, status) }
  if (!token) return deny('invalid_request', 'missing bearer token', 400)
  const t = now(), row = await accessToken(c.env.DB, token, t)
  if (!row) return deny('invalid_token', 'token is invalid or expired')
  const user = await activeUser(c.env.DB, row.user_id)
  if (!user) return deny('invalid_token', 'account disabled')
  if (!scopeList(row.scope).some((s) => s === 'openid' || s === 'profile')) return deny('insufficient_scope', 'openid or profile scope required', 403)
  noStore(c)
  return c.json(await userClaims(c.env.DB, user, row.client_id, row.scope, issuer(c), t))
}
oauth.get('/oauth/userinfo', userinfo)
oauth.post('/oauth/userinfo', userinfo)

oauth.post('/oauth/revoke', async (c) => {
  cors(c)
  const form = await formBody(c)
  if (!form) return oauthError(c, 'invalid_request', '请用 application/x-www-form-urlencoded 提交')
  const auth = await authenticateClient(c, form)
  if ('error' in auth) return oauthError(c, auth.error, auth.description, auth.status)
  if (await limited(c, 'revoke|' + auth.client.client_id)) return oauthError(c, 'slow_down', '请求太频繁，请稍后重试', 429)
  if (form.token) await revokeToken(c.env.DB, form.token, auth.client, now())
  noStore(c)
  return c.body(null, 200)
})

// ---------- 发现文档与公钥 ----------
async function discovery(c: C) {
  cors(c)
  const iss = issuer(c), email = (await getSetting(c.env.DB, 'oauth.email_scope', 'off')) === 'on'
  c.header('cache-control', 'public, max-age=3600')
  return c.json({
    issuer: iss,
    authorization_endpoint: iss + '/oauth/authorize',
    token_endpoint: iss + '/oauth/token',
    userinfo_endpoint: iss + '/oauth/userinfo',
    revocation_endpoint: iss + '/oauth/revoke',
    jwks_uri: iss + '/oauth/jwks.json',
    service_documentation: iss + '/oauth-apps',
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['pairwise'],
    id_token_signing_alg_values_supported: ['ES256'],
    scopes_supported: email ? ['openid', 'profile', 'email'] : ['openid', 'profile'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'azp', 'name', 'nickname', 'picture', ...(email ? ['email', 'email_verified'] : [])],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    prompt_values_supported: ['none', 'consent'],
    authorization_response_iss_parameter_supported: true,
    request_parameter_supported: false,
    claims_parameter_supported: false,
  })
}
oauth.get('/.well-known/openid-configuration', discovery)
oauth.get('/.well-known/oauth-authorization-server', discovery)
oauth.get('/oauth/jwks.json', async (c) => {
  cors(c)
  try {
    const set = await jwks(c.env)
    c.header('cache-control', 'public, max-age=3600')
    return c.json(set)
  } catch (e) {
    console.error('oauth_jwks_failed', (e as Error)?.message)
    return oauthError(c, 'server_error', 'OIDC 签名密钥无效', 500)
  }
})

// ---------- 开发者：管理自己的应用 ----------
async function writer(c: C) {
  sameOrigin(c)
  const user = needUser(c)
  if (await limited(c, 'apps|' + user.id)) fail(429, '操作太频繁，请稍后重试')
  return user
}
async function ownApp(c: C, user: User) {
  const client = await getClient(c.env.DB, c.req.param('id'))
  if (!client || (client.owner_id !== user.id && !isOwner(c, user))) fail(404, '应用不存在')
  return client!
}
oauth.get('/api/oauth/me', async (c) => {
  const user = needUser(c)
  return c.json({ owner: isOwner(c, user), newbie: await newbie(c, user), issuer: issuer(c), email_scope: (await getSetting(c.env.DB, 'oauth.email_scope', 'off')) === 'on' })
})
oauth.get('/api/oauth/apps', async (c) => {
  const user = needUser(c)
  const { results } = await c.env.DB.prepare('SELECT * FROM oauth_clients WHERE owner_id=? ORDER BY created_at DESC').bind(user.id).all<OAuthClient>()
  return c.json({ apps: results.map(publicClient) })
})
oauth.post('/api/oauth/apps', async (c) => {
  const user = await writer(c)
  if (await newbie(c, user)) fail(403, '注册满 30 天后才能申请应用')
  if (!(await activeUser(c.env.DB, user.id))) fail(403, '账号已停用')
  const input = clientInput(await boundedJson(c))
  if (typeof input === 'string') fail(400, input)
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients WHERE owner_id=?').bind(user.id).first<{ n: number }>()
  if ((count?.n ?? 0) >= MAX_APPS_PER_USER) fail(409, `每人最多 ${MAX_APPS_PER_USER} 个应用`)
  const created = await createClient(c.env.DB, user.id, input as Exclude<typeof input, string>, now())
  return c.json({ ...created, status: 'pending' })
})
oauth.put('/api/oauth/apps/:id', async (c) => {
  const user = await writer(c), client = await ownApp(c, user)
  const input = clientInput(await boundedJson(c))
  if (typeof input === 'string') fail(400, input)
  return c.json(await updateClient(c.env.DB, client, input as Exclude<typeof input, string>, now()))
})
oauth.post('/api/oauth/apps/:id/secret', async (c) => {
  const user = await writer(c), client = await ownApp(c, user)
  const secret = await rotateSecret(c.env.DB, client, now())
  if (!secret) fail(409, '公开客户端没有密钥')
  return c.json({ client_secret: secret })
})
oauth.delete('/api/oauth/apps/:id', async (c) => {
  const user = await writer(c), client = await ownApp(c, user), t = now()
  await revokeClientTokens(c.env.DB, client.client_id, t)
  await c.env.DB.prepare('DELETE FROM oauth_clients WHERE client_id=?').bind(client.client_id).run()
  return c.json({ ok: true })
})

// ---------- 用户：已授权的应用 ----------
oauth.get('/api/oauth/grants', async (c) => {
  const user = needUser(c)
  const { results } = await listGrants(c.env.DB, user.id)
  return c.json({ grants: results })
})
oauth.delete('/api/oauth/grants/:id', async (c) => {
  const user = await writer(c)
  const id = c.req.param('id')
  if (!/^jh_[a-f0-9]{24}$/.test(id)) fail(404, '授权不存在')
  await revokeGrant(c.env.DB, user.id, id, now())
  return c.json({ ok: true })
})

// ---------- 站长：审核 / 停用 ----------
function needSiteOwner(c: C) {
  const user = needUser(c)
  if (!isOwner(c, user)) fail(403, '只有站长可以审核应用')
  return user
}
oauth.get('/api/oauth/admin/apps', async (c) => {
  needSiteOwner(c)
  const status = c.req.query('status')
  const filter = status && ['pending', 'active', 'rejected', 'disabled'].includes(status) ? status : null
  const { results } = await c.env.DB.prepare(`SELECT c.*,u.username AS owner_username,
   (SELECT COUNT(*) FROM oauth_grants g WHERE g.client_id=c.client_id) AS grant_count
   FROM oauth_clients c LEFT JOIN users u ON u.id=c.owner_id WHERE ?1 IS NULL OR c.status=?1 ORDER BY c.status='pending' DESC, c.updated_at DESC LIMIT 200`).bind(filter).all<OAuthClient & { owner_username: string | null; grant_count: number }>()
  return c.json({ apps: results.map((r) => ({ ...publicClient(r), owner_id: r.owner_id, owner_username: r.owner_username, grant_count: r.grant_count })) })
})
oauth.post('/api/oauth/admin/apps/:id', async (c) => {
  sameOrigin(c)
  const admin = needSiteOwner(c)
  const client = await getClient(c.env.DB, c.req.param('id'))
  if (!client) fail(404, '应用不存在')
  const body = await boundedJson(c), t = now()
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null
  const next = ({ approve: 'active', enable: 'active', reject: 'rejected', disable: 'disabled' } as Record<string, string>)[String(body.action)]
  if (!next && body.email_allowed === undefined) fail(400, '未知操作')
  const email = body.email_allowed === undefined ? client!.email_allowed : body.email_allowed ? 1 : 0
  await c.env.DB.prepare('UPDATE oauth_clients SET status=?,email_allowed=?,review_note=COALESCE(?,review_note),reviewed_by=?,reviewed_at=?,updated_at=? WHERE client_id=?')
    .bind(next ?? client!.status, email, note, admin.id, t, t, client!.client_id).run()
  if (next === 'disabled' || next === 'rejected') await revokeClientTokens(c.env.DB, client!.client_id, t)
  return c.json({ ok: true, status: next ?? client!.status, email_allowed: !!email })
})
oauth.put('/api/oauth/admin/settings', async (c) => {
  sameOrigin(c)
  needSiteOwner(c)
  const body = await boundedJson(c)
  if (body.email_scope !== 'on' && body.email_scope !== 'off') fail(400, 'email_scope 只能是 on 或 off')
  await setSetting(c.env.DB, 'oauth.email_scope', String(body.email_scope))
  return c.json({ ok: true, email_scope: body.email_scope })
})
