// OAuth 2.0 / OIDC 提供方的数据操作：应用、授权请求、授权码、令牌、同意记录。HTTP 部分在 routes/oauth.ts。
import { randHex, sha256 } from '../lib/crypto'
import { ACCESS_TTL, CODE_TTL, ID_TOKEN_TTL, REFRESH_TTL, REQUEST_TTL, absolutePicture, displayName, safeEqual, scopeList, type ClientInput } from './oauth-rules'
import { signJwt } from './oauth-keys'
import { b64url } from './oauth-keys'

export type OAuthClient = {
  client_id: string; owner_id: number; name: string; icon_url: string | null; homepage: string; description: string
  redirect_uris: string; client_type: 'confidential' | 'public'; secret_hash: string | null
  status: 'pending' | 'active' | 'rejected' | 'disabled'; email_allowed: number; review_note: string | null
  reviewed_by: number | null; reviewed_at: number | null; created_at: number; updated_at: number
}
export type AuthParams = { client_id: string; redirect_uri: string; scope: string; state?: string; nonce?: string; code_challenge?: string; prompt?: string }
export type OAuthUser = { id: number; username: string; name: string | null; nick: string | null; avatar: string | null; created_at: number }

export const clientRedirects = (c: Pick<OAuthClient, 'redirect_uris'>): string[] => { try { const v = JSON.parse(c.redirect_uris); return Array.isArray(v) ? v : [] } catch { return [] } }
// 对外展示的应用信息（不含密钥哈希）
export const publicClient = (c: OAuthClient) => ({
  client_id: c.client_id, name: c.name, icon_url: c.icon_url, homepage: c.homepage, description: c.description,
  redirect_uris: clientRedirects(c), client_type: c.client_type, status: c.status, email_allowed: !!c.email_allowed,
  review_note: c.review_note, reviewed_at: c.reviewed_at, created_at: c.created_at, updated_at: c.updated_at,
})

export const getClient = (db: D1Database, id: unknown) =>
  typeof id === 'string' && /^jh_[a-f0-9]{24}$/.test(id) ? db.prepare('SELECT * FROM oauth_clients WHERE client_id=?').bind(id).first<OAuthClient>() : Promise.resolve(null)

// 已注销（停用）、已合并、机器人账号都不能授权，也不能继续用旧令牌
export const activeUser = (db: D1Database, uid: number) => db.prepare(`SELECT id,username,name,nick,avatar,created_at FROM users u
 WHERE id=? AND disabled=0 AND kind='user' AND NOT EXISTS(SELECT 1 FROM account_retirements r WHERE r.source_id=u.id)`).bind(uid).first<OAuthUser>()

const newSecret = () => 'jhs_' + randHex(32)
export async function createClient(db: D1Database, ownerId: number, input: ClientInput, t: number) {
  const client_id = 'jh_' + randHex(12)
  const secret = input.client_type === 'confidential' ? newSecret() : null
  await db.prepare(`INSERT INTO oauth_clients(client_id,owner_id,name,icon_url,homepage,description,redirect_uris,client_type,secret_hash,status,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)`).bind(client_id, ownerId, input.name, input.icon_url, input.homepage, input.description,
    JSON.stringify(input.redirect_uris), input.client_type, secret ? await sha256(secret) : null, t, t).run()
  return { client_id, client_secret: secret }
}
// 修改：回调地址或类型变了要重新审核（已停用 / 已拒绝的保持原状态，由站长处理）
export async function updateClient(db: D1Database, client: OAuthClient, input: ClientInput, t: number) {
  const sensitive = JSON.stringify(input.redirect_uris) !== client.redirect_uris || input.client_type !== client.client_type
  let secret: string | null = null, secretHash = client.secret_hash
  if (input.client_type === 'public') secretHash = null
  else if (!secretHash) { secret = newSecret(); secretHash = await sha256(secret) }
  const status = sensitive && client.status === 'active' ? 'pending' : client.status
  await db.prepare(`UPDATE oauth_clients SET name=?,icon_url=?,homepage=?,description=?,redirect_uris=?,client_type=?,secret_hash=?,status=?,updated_at=? WHERE client_id=?`)
    .bind(input.name, input.icon_url, input.homepage, input.description, JSON.stringify(input.redirect_uris), input.client_type, secretHash, status, t, client.client_id).run()
  return { client_secret: secret, status }
}
export async function rotateSecret(db: D1Database, client: OAuthClient, t: number) {
  if (client.client_type !== 'confidential') return null
  const secret = newSecret()
  await db.prepare('UPDATE oauth_clients SET secret_hash=?,updated_at=? WHERE client_id=?').bind(await sha256(secret), t, client.client_id).run()
  return secret
}
export async function checkSecret(client: OAuthClient, secret: string) {
  return !!client.secret_hash && safeEqual(await sha256(secret), client.secret_hash)
}
// 应用停用 / 删除时作废它的全部令牌
export const revokeClientTokens = (db: D1Database, clientId: string, t: number) => db.batch([
  db.prepare('UPDATE oauth_tokens SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL').bind(t, clientId),
  db.prepare('UPDATE oauth_codes SET used_at=? WHERE client_id=? AND used_at IS NULL').bind(t, clientId),
])

// ---------- 授权请求（未登录时先存下来） ----------
export async function saveRequest(db: D1Database, params: AuthParams, t: number) {
  const id = randHex(16)
  await db.batch([
    db.prepare('DELETE FROM oauth_requests WHERE expires_at<?').bind(t),
    db.prepare('INSERT INTO oauth_requests(id_hash,client_id,params,expires_at,created_at) VALUES(?,?,?,?,?)').bind(await sha256(id), params.client_id, JSON.stringify(params), t + REQUEST_TTL, t),
  ])
  return id
}
export async function loadRequest(db: D1Database, id: unknown, t: number): Promise<AuthParams | null> {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return null
  const row = await db.prepare('SELECT params FROM oauth_requests WHERE id_hash=? AND expires_at>?').bind(await sha256(id), t).first<{ params: string }>()
  try { return row ? JSON.parse(row.params) : null } catch { return null }
}
export const dropRequest = async (db: D1Database, id: string) => db.prepare('DELETE FROM oauth_requests WHERE id_hash=?').bind(await sha256(id)).run()

// ---------- 同意记录 ----------
export const grantOf = (db: D1Database, uid: number, clientId: string) =>
  db.prepare('SELECT scope FROM oauth_grants WHERE user_id=? AND client_id=?').bind(uid, clientId).first<{ scope: string }>()
export const saveGrant = (db: D1Database, uid: number, clientId: string, scope: string, t: number) => db.prepare(`INSERT INTO oauth_grants(user_id,client_id,scope,created_at,updated_at) VALUES(?,?,?,?,?)
 ON CONFLICT(user_id,client_id) DO UPDATE SET scope=excluded.scope,updated_at=excluded.updated_at`).bind(uid, clientId, scope, t, t).run()
export const revokeGrant = (db: D1Database, uid: number, clientId: string, t: number) => db.batch([
  db.prepare('DELETE FROM oauth_grants WHERE user_id=? AND client_id=?').bind(uid, clientId),
  db.prepare('UPDATE oauth_tokens SET revoked_at=? WHERE user_id=? AND client_id=? AND revoked_at IS NULL').bind(t, uid, clientId),
  db.prepare('UPDATE oauth_codes SET used_at=? WHERE user_id=? AND client_id=? AND used_at IS NULL').bind(t, uid, clientId),
])
export const listGrants = (db: D1Database, uid: number) => db.prepare(`SELECT g.client_id,g.scope,g.created_at,g.updated_at,c.name,c.icon_url,c.homepage,c.status,
 (SELECT MAX(created_at) FROM oauth_tokens t WHERE t.user_id=g.user_id AND t.client_id=g.client_id) AS last_used_at
 FROM oauth_grants g JOIN oauth_clients c ON c.client_id=g.client_id WHERE g.user_id=? ORDER BY g.updated_at DESC LIMIT 100`).bind(uid).all()

// ---------- 对外 subject ----------
export async function subjectFor(db: D1Database, clientId: string, uid: number, t: number) {
  await db.prepare('INSERT OR IGNORE INTO oauth_subjects(client_id,user_id,sub,created_at) VALUES(?,?,?,?)').bind(clientId, uid, b64url(crypto.getRandomValues(new Uint8Array(18))), t).run()
  return (await db.prepare('SELECT sub FROM oauth_subjects WHERE client_id=? AND user_id=?').bind(clientId, uid).first<{ sub: string }>())!.sub
}

// ---------- 授权码 ----------
export async function issueCode(db: D1Database, p: AuthParams, uid: number, authTime: number, t: number) {
  const code = randHex(32)
  await db.batch([
    db.prepare('DELETE FROM oauth_codes WHERE expires_at<?').bind(t - 86400),
    db.prepare(`INSERT INTO oauth_codes(code_hash,client_id,user_id,redirect_uri,scope,code_challenge,nonce,auth_time,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(await sha256(code), p.client_id, uid, p.redirect_uri, p.scope, p.code_challenge ?? null, p.nonce ?? null, authTime, t + CODE_TTL, t),
  ])
  return code
}
type CodeRow = { code_hash: string; client_id: string; user_id: number; redirect_uri: string; scope: string; code_challenge: string | null; nonce: string | null; auth_time: number }
export type GrantError = { error: 'invalid_grant' | 'invalid_request'; description: string }
const s256 = async (verifier: string) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))

// 一次性：先原子地占用；重复使用时作废这个授权码换出的全部令牌（RFC 6749 §4.1.2）
export async function redeemCode(db: D1Database, raw: string, client: OAuthClient, redirectUri: string, verifier: string | undefined, t: number): Promise<CodeRow | GrantError> {
  if (!/^[a-f0-9]{64}$/.test(raw)) return { error: 'invalid_grant', description: '授权码无效' }
  const hash = await sha256(raw)
  const row = await db.prepare('UPDATE oauth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>? RETURNING code_hash,client_id,user_id,redirect_uri,scope,code_challenge,nonce,auth_time').bind(t, hash, t).first<CodeRow>()
  if (!row) {
    await db.prepare('UPDATE oauth_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL').bind(t, hash).run()
    return { error: 'invalid_grant', description: '授权码无效、已使用或已过期' }
  }
  if (row.client_id !== client.client_id) return { error: 'invalid_grant', description: '授权码不属于这个应用' }
  if (row.redirect_uri !== redirectUri) return { error: 'invalid_grant', description: 'redirect_uri 与授权时不一致' }
  if (row.code_challenge) {
    if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return { error: 'invalid_grant', description: '缺少或无效的 code_verifier' }
    if (!safeEqual(await s256(verifier), row.code_challenge)) return { error: 'invalid_grant', description: 'code_verifier 校验失败' }
  } else if (verifier) return { error: 'invalid_grant', description: '授权时没有使用 PKCE' }
  return row
}

// ---------- 令牌 ----------
export async function issueTokens(db: D1Database, a: { clientId: string; uid: number; scope: string; family: string; authTime: number; t: number }) {
  const access = 'jha_' + randHex(32), refresh = 'jhr_' + randHex(32)
  await db.batch([
    db.prepare('DELETE FROM oauth_tokens WHERE expires_at<?').bind(a.t - 86400),
    db.prepare(`INSERT INTO oauth_tokens(token_hash,kind,client_id,user_id,scope,family_id,auth_time,expires_at,created_at) VALUES(?,'access',?,?,?,?,?,?,?)`)
      .bind(await sha256(access), a.clientId, a.uid, a.scope, a.family, a.authTime, a.t + ACCESS_TTL, a.t),
    db.prepare(`INSERT INTO oauth_tokens(token_hash,kind,client_id,user_id,scope,family_id,auth_time,expires_at,created_at) VALUES(?,'refresh',?,?,?,?,?,?,?)`)
      .bind(await sha256(refresh), a.clientId, a.uid, a.scope, a.family, a.authTime, a.t + REFRESH_TTL, a.t),
  ])
  return { access, refresh }
}
type TokenRow = { token_hash: string; kind: 'access' | 'refresh'; client_id: string; user_id: number; scope: string; family_id: string; auth_time: number; expires_at: number }
// 刷新令牌轮换：每个只能用一次；被重复使用说明可能泄露，整族作废
export async function useRefreshToken(db: D1Database, raw: string, client: OAuthClient, t: number): Promise<TokenRow | GrantError> {
  if (!/^jhr_[a-f0-9]{64}$/.test(raw)) return { error: 'invalid_grant', description: '刷新令牌无效' }
  const hash = await sha256(raw)
  const row = await db.prepare(`UPDATE oauth_tokens SET used_at=? WHERE token_hash=? AND kind='refresh' AND client_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?
   RETURNING token_hash,kind,client_id,user_id,scope,family_id,auth_time,expires_at`).bind(t, hash, client.client_id, t).first<TokenRow>()
  if (row) return row
  const old = await db.prepare("SELECT family_id,used_at FROM oauth_tokens WHERE token_hash=? AND kind='refresh' AND client_id=?").bind(hash, client.client_id).first<{ family_id: string; used_at: number | null }>()
  if (old?.used_at) await db.prepare('UPDATE oauth_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL').bind(t, old.family_id).run()
  return { error: 'invalid_grant', description: '刷新令牌无效、已使用或已过期' }
}
export async function accessToken(db: D1Database, raw: string, t: number) {
  if (!/^jha_[a-f0-9]{64}$/.test(raw)) return null
  return db.prepare(`SELECT t.client_id,t.user_id,t.scope FROM oauth_tokens t JOIN oauth_clients c ON c.client_id=t.client_id
   WHERE t.token_hash=? AND t.kind='access' AND t.revoked_at IS NULL AND t.expires_at>? AND c.status='active'`).bind(await sha256(raw), t).first<{ client_id: string; user_id: number; scope: string }>()
}
// RFC 7009：只能撤销自己应用的令牌；刷新令牌连同整族一起作废。不存在也算成功
export async function revokeToken(db: D1Database, raw: string, client: OAuthClient, t: number) {
  if (!/^jh[ar]_[a-f0-9]{64}$/.test(raw)) return
  const row = await db.prepare('SELECT kind,family_id FROM oauth_tokens WHERE token_hash=? AND client_id=?').bind(await sha256(raw), client.client_id).first<{ kind: string; family_id: string }>()
  if (!row) return
  if (row.kind === 'refresh') await db.prepare('UPDATE oauth_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL').bind(t, row.family_id).run()
  else await db.prepare('UPDATE oauth_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(t, await sha256(raw)).run()
}

// ---------- 用户信息 ----------
async function emailOf(db: D1Database, uid: number) {
  const row = await db.prepare(`SELECT email FROM identities WHERE user_id=? AND email IS NOT NULL AND ((provider='email' AND verified_at IS NOT NULL) OR provider='google')
   ORDER BY provider='email' DESC, created_at LIMIT 1`).bind(uid).first<{ email: string }>()
  return row?.email
}
export async function userClaims(db: D1Database, user: OAuthUser, clientId: string, scope: string, issuer: string, t: number) {
  const scopes = scopeList(scope), out: Record<string, unknown> = { sub: await subjectFor(db, clientId, user.id, t) }
  if (scopes.includes('profile')) {
    out.name = displayName(user)
    out.nickname = out.name
    const picture = absolutePicture(user.avatar, issuer)
    if (picture) out.picture = picture
  }
  if (scopes.includes('email')) {
    const email = await emailOf(db, user.id)
    if (email) { out.email = email; out.email_verified = true }
  }
  return out
}
export async function idToken(env: { OAUTH_SIGNING_KEY?: string }, a: { issuer: string; clientId: string; claims: Record<string, unknown>; authTime: number; nonce?: string | null; t: number }) {
  return signJwt(env, { iss: a.issuer, aud: a.clientId, azp: a.clientId, iat: a.t, exp: a.t + ID_TOKEN_TTL, auth_time: a.authTime, ...(a.nonce ? { nonce: a.nonce } : {}), ...a.claims })
}
