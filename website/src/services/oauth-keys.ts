// OIDC 签名密钥：ES256（ECDSA P-256）。私钥是一行 JWK JSON，放在 /meme/config/.env 的 OAUTH_SIGNING_KEY。
// 轮换时把旧私钥挪到 OAUTH_SIGNING_KEY_PREVIOUS：只用来在 JWKS 里继续公布旧公钥，不再签名。
// 生成方法见 docs/oauth.md。
type KeyEnv = { OAUTH_SIGNING_KEY?: string; OAUTH_SIGNING_KEY_PREVIOUS?: string }
export type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string; kid: string; use: 'sig'; alg: 'ES256' }
type Signer = { kid: string; key: CryptoKey; pub: PublicJwk }

export const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function parseJwk(raw: string | undefined): JsonWebKey | null {
  if (!raw || !raw.trim()) return null
  let jwk: JsonWebKey
  try { jwk = JSON.parse(raw.trim()) } catch { throw new Error('OAUTH_SIGNING_KEY 不是合法的 JSON') }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('OAUTH_SIGNING_KEY 必须是 P-256 的 EC JWK')
  return jwk
}
// RFC 7638 指纹作为 kid
async function thumbprint(jwk: JsonWebKey) {
  const canon = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon)))
}
async function publicOf(jwk: JsonWebKey): Promise<PublicJwk> {
  return { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y!, kid: await thumbprint(jwk), use: 'sig', alg: 'ES256' }
}

const cache = new Map<string, Promise<Signer | null>>()
export function signer(env: KeyEnv): Promise<Signer | null> {
  const raw = env.OAUTH_SIGNING_KEY ?? ''
  let hit = cache.get(raw)
  if (!hit) {
    hit = (async () => {
      const jwk = parseJwk(raw)
      if (!jwk) return null
      if (!jwk.d) throw new Error('OAUTH_SIGNING_KEY 缺少私钥部分 d')
      const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
      const pub = await publicOf(jwk)
      return { kid: pub.kid, key, pub }
    })()
    if (cache.size > 4) cache.clear()
    cache.set(raw, hit)
  }
  return hit
}

export async function jwks(env: KeyEnv): Promise<{ keys: PublicJwk[] }> {
  const keys: PublicJwk[] = []
  const current = await signer(env)
  if (current) keys.push(current.pub)
  const prev = parseJwk(env.OAUTH_SIGNING_KEY_PREVIOUS)
  if (prev) { const p = await publicOf(prev); if (!keys.some((k) => k.kid === p.kid)) keys.push(p) }
  return { keys }
}

export async function signJwt(env: KeyEnv, claims: Record<string, unknown>): Promise<string> {
  const s = await signer(env)
  if (!s) throw new Error('OAUTH_SIGNING_KEY 未配置')
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: s.kid }))
  const body = b64url(JSON.stringify(claims))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, s.key, new TextEncoder().encode(head + '.' + body))
  return head + '.' + body + '.' + b64url(sig)
}

// 测试与接入方自查用：按 JWKS 验证 ES256 JWT，返回载荷
export async function verifyJwt(token: string, keys: PublicJwk[]): Promise<Record<string, unknown> | null> {
  const [h, b, s, ...rest] = token.split('.')
  if (!h || !b || !s || rest.length) return null
  const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((x.length + 3) % 4)), (ch) => ch.charCodeAt(0))
  let head: { alg?: string; kid?: string }
  try { head = JSON.parse(new TextDecoder().decode(dec(h))) } catch { return null }
  const jwk = keys.find((k) => k.kid === head.kid)
  if (head.alg !== 'ES256' || !jwk) return null
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, dec(s), new TextEncoder().encode(h + '.' + b))
  if (!ok) return null
  try { return JSON.parse(new TextDecoder().decode(dec(b))) } catch { return null }
}
