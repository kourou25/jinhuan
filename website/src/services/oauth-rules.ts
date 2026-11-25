// OAuth 规则：纯函数，不依赖数据库和运行时，便于单元测试（tests/unit/oauth-rules.test.mjs）。
export const SCOPES = ['openid', 'profile', 'email'] as const
export type Scope = typeof SCOPES[number]
export const SCOPE_LABELS: Record<Scope, string> = {
  openid: '确认你的尽欢账号身份（应用专属的匿名编号，不含站内用户 ID）',
  profile: '读取你的昵称和头像',
  email: '读取你的邮箱地址',
}
export const CODE_TTL = 120
export const REQUEST_TTL = 600
export const ACCESS_TTL = 3600
export const REFRESH_TTL = 30 * 86400
export const ID_TOKEN_TTL = 3600
export const MAX_REDIRECT_URIS = 5

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
// 回调地址：必须是绝对 URL，https（本机 localhost / 127.0.0.1 / [::1] 可以用 http），不能带 # 片段和账号密码
export function redirectUriProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 300) return '回调地址长度应在 1–300 个字符'
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return '回调地址不能包含空白或控制字符'
  let u: URL
  try { u = new URL(raw) } catch { return '回调地址不是合法的网址' }
  if (u.hash || raw.includes('#')) return '回调地址不能带 # 片段'
  if (u.username || u.password) return '回调地址不能带账号密码'
  if (u.protocol === 'https:') return null
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return null
  return '回调地址只能是 https（本机调试可用 http://localhost）'
}
export function httpsUrlProblem(raw: unknown, label: string, optional = false): string | null {
  if ((raw === undefined || raw === null || raw === '') && optional) return null
  if (typeof raw !== 'string' || raw.length > 300) return label + '长度不能超过 300 个字符'
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password) return label + '必须是 https 网址'
  } catch { return label + '不是合法的网址' }
  return null
}

export type ClientInput = { name: string; icon_url: string | null; homepage: string; description: string; redirect_uris: string[]; client_type: 'confidential' | 'public' }
export function clientInput(body: Record<string, unknown>, partial = false): ClientInput | string {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || [...name].length > 40) return '应用名称应为 1–40 个字'
  const homepage = typeof body.homepage === 'string' ? body.homepage.trim() : ''
  const hp = httpsUrlProblem(homepage, '主页')
  if (hp) return hp
  const icon = typeof body.icon_url === 'string' ? body.icon_url.trim() : ''
  const ip = httpsUrlProblem(icon, '图标地址', true)
  if (ip) return ip
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if ([...description].length > 200) return '应用简介不能超过 200 个字'
  const list = Array.isArray(body.redirect_uris) ? body.redirect_uris : typeof body.redirect_uris === 'string' ? body.redirect_uris.split(/\r?\n/) : []
  const redirect_uris = [...new Set(list.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== ''))] as unknown[]
  if (!redirect_uris.length) return '至少填写一个回调地址'
  if (redirect_uris.length > MAX_REDIRECT_URIS) return `回调地址最多 ${MAX_REDIRECT_URIS} 个`
  for (const uri of redirect_uris) { const p = redirectUriProblem(uri); if (p) return p + '：' + String(uri).slice(0, 80) }
  const type = partial && body.client_type === undefined ? 'confidential' : body.client_type
  if (type !== 'confidential' && type !== 'public') return '应用类型只能是 confidential（有服务端）或 public（纯前端 / 移动端）'
  return { name, icon_url: icon || null, homepage, description, redirect_uris: redirect_uris as string[], client_type: type }
}

// 申请的权限：openid / profile 总是可用；email 需要站长打开总开关且批准了这个应用，否则悄悄去掉（令牌响应里的 scope 会如实返回）
export function grantScope(requested: unknown, emailAllowed: boolean): { scope: string } | { error: string } {
  const raw = typeof requested === 'string' ? requested.trim() : ''
  if (!raw) return { error: '缺少 scope' }
  if (raw.length > 200) return { error: 'scope 太长' }
  const parts = [...new Set(raw.split(/ +/))]
  const unknown = parts.filter((s) => !(SCOPES as readonly string[]).includes(s))
  if (unknown.length) return { error: '不支持的权限：' + unknown.join(' ').slice(0, 60) }
  const kept = SCOPES.filter((s) => parts.includes(s) && (s !== 'email' || emailAllowed))
  if (!kept.length) return { error: '没有可授予的权限' }
  return { scope: kept.join(' ') }
}
export const scopeList = (scope: string) => scope.split(' ').filter(Boolean) as Scope[]
export const scopeCovers = (granted: string, wanted: string) => { const g = new Set(scopeList(granted)); return scopeList(wanted).every((s) => g.has(s)) }
export const mergeScopes = (a: string, b: string) => SCOPES.filter((s) => scopeList(a).includes(s) || scopeList(b).includes(s)).join(' ')

// PKCE：code_verifier 43–128 位不保留字符；challenge 是 43 位 base64url
export const validVerifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(v)
export const validChallenge = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)
export const validState = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.length <= 500 && !/[\u0000-\u001f\u007f]/.test(v))
export const validNonce = validState

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
// 头像：站内相对路径换成绝对地址，只接受 http(s)
export function absolutePicture(avatar: unknown, issuer: string): string | undefined {
  if (typeof avatar !== 'string' || !avatar) return undefined
  try { const u = new URL(avatar, issuer); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined } catch { return undefined }
}
export const displayName = (u: { nick?: string | null; name?: string | null; username: string }) => (u.nick || u.name || u.username || '').slice(0, 60)
