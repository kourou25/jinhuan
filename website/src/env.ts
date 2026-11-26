export interface Env {
  DB: D1Database
  CHAT_BOT_WEBHOOK_KEY?: string
  MUSIC_ORIGIN?: string
  MUSIC_TOKEN?: string
  PUSH_VAPID_PUBLIC_KEY?: string
  PUSH_VAPID_PRIVATE_KEY?: string
  BUCKET: R2Bucket
  ASSETS: Fetcher
  LINUXDO_CLIENT_ID: string
  LINUXDO_CLIENT_SECRET: string
  ADMIN_USERNAMES?: string
  ADMIN_USER_IDS?: string
  GUESS_FISH_ENABLED?: string
  GUESS_FISH_CUSTODIAN_ID?: string // 指定 ADMIN_USER_IDS 中的站长用户 ID
  GAME_SERVICE_SECRET?: string // 仅游戏服务间使用，不传入浏览器
  GAME_HUB?: Fetcher // 共用 meme-guess 的既有实时房间
  GUESS_SIMULATED_LDC?: string // 仅隔离测试夹具
  PASSWORD_PEPPER?: string
  REGISTER_MODE?: string
  MAIN_ACTIVATION?: string // "required" 时主站要邀请码激活；默认不需要（2026-11-04 起）
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string // GitHub OAuth App（回调 /auth/github/callback）
  GITHUB_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  EMAIL_DAILY_MAX?: string
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  AUTH_RL?: RateLimit
  AI_BASE_URL?: string
  AI_MODEL?: string
  AI_API_KEY?: string
  JEV_RELAY?: Fetcher
  AI_VISION_BASE_URL?: string
  AI_VISION_MODEL?: string
  AI_VISION_API_KEY?: string
  AI_FALLBACK_BASE_URL?: string
  AI_FALLBACK_MODEL?: string
  AI_FALLBACK_API_KEY?: string
  LDC_ENCRYPTION_KEY?: string // 独立32字节Base64 AES-GCM主密钥；仅Worker secret
  MIN_POST_TRUST_LEVEL?: string
  EXT_HOSTS?: string
  DEV_LOGIN_KEY?: string // 测试登录口令（secret），不配就没有测试登录
  BLOCK_COUNTRIES?: string // 拒绝访问的国家/地区代码，逗号分隔，比如 CN；不填或填 none 不限制
  OAUTH_ISSUER?: string // OIDC 签发方，如 https://52dmeme.com；不填按请求域名
  OAUTH_SIGNING_KEY?: string // ID Token 签名私钥（ES256，一行 P-256 JWK JSON，只放 /meme/config/.env），生成方法见 docs/oauth.md
  OAUTH_SIGNING_KEY_PREVIOUS?: string // 轮换时的旧私钥：只在 JWKS 里继续公布公钥
  RATE_LIMIT?: string // 频率限制（发帖 / 评论 / 回应 / 群聊发太快）：填 on 才打开；人少的时候先关着
}

