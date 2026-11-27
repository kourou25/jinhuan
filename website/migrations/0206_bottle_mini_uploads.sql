-- 漂流瓶小程序里没有网站账号的人上传的文件（2026-11-26）。
-- 他们没有 users 记录，不能进 uploads / upload_operations（外键）；单独记账，发瓶子 / 回信时认领，没用上的一天后清掉。
CREATE TABLE IF NOT EXISTS bottle_mini_uploads (
  key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_bottle_mini_uploads_user ON bottle_mini_uploads(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bottle_mini_uploads_unused ON bottle_mini_uploads(used, created_at);
