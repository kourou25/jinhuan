-- 尽欢作为 OAuth 2.0 / OpenID Connect 登录提供方（2026-11-23）
-- 第三方应用：登录用户申请，站长审核后才能使用；client_secret 只存 SHA-256 哈希
CREATE TABLE oauth_clients (
 client_id TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
 icon_url TEXT,
 homepage TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 redirect_uris TEXT NOT NULL CHECK(json_valid(redirect_uris) AND json_type(redirect_uris)='array'),
 client_type TEXT NOT NULL CHECK(client_type IN('confidential','public')),
 secret_hash TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','rejected','disabled')),
 email_allowed INTEGER NOT NULL DEFAULT 0 CHECK(email_allowed IN(0,1)),
 review_note TEXT,
 reviewed_by INTEGER,
 reviewed_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK(client_type='public' OR secret_hash IS NOT NULL)
) WITHOUT ROWID;
CREATE INDEX idx_oauth_clients_owner ON oauth_clients(owner_id,created_at);
CREATE INDEX idx_oauth_clients_status ON oauth_clients(status,created_at);

-- 对外 subject：按「应用 + 用户」随机生成后固定，不暴露内部用户 ID；撤销授权后重新授权仍是同一个
CREATE TABLE oauth_subjects (
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sub TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(client_id,user_id)
) WITHOUT ROWID;

-- 已记住的同意：用户 + 应用 + 权限（空格分隔，已排序）
CREATE TABLE oauth_grants (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 scope TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,client_id)
) WITHOUT ROWID;
CREATE INDEX idx_oauth_grants_client ON oauth_grants(client_id);

-- 进行中的授权请求（未登录时先存下来，登录后凭短编号继续）和一次性授权码
CREATE TABLE oauth_requests (
 id_hash TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 params TEXT NOT NULL CHECK(json_valid(params)),
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_oauth_requests_expiry ON oauth_requests(expires_at);

CREATE TABLE oauth_codes (
 code_hash TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 redirect_uri TEXT NOT NULL,
 scope TEXT NOT NULL,
 code_challenge TEXT,
 nonce TEXT,
 auth_time INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_oauth_codes_expiry ON oauth_codes(expires_at);

-- 访问令牌与刷新令牌（只存哈希）。family_id：同一次授权码换出的所有令牌，刷新令牌被重复使用时整族作废
CREATE TABLE oauth_tokens (
 token_hash TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN('access','refresh')),
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope TEXT NOT NULL,
 family_id TEXT NOT NULL,
 auth_time INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 revoked_at INTEGER,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_oauth_tokens_user_client ON oauth_tokens(user_id,client_id);
CREATE INDEX idx_oauth_tokens_family ON oauth_tokens(family_id);
CREATE INDEX idx_oauth_tokens_expiry ON oauth_tokens(expires_at);
