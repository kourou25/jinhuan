-- 2026-11-26 漂流瓶：站内瓶子可选是否公开到 L 站小程序；小程序显示 L 站昵称、头像；小程序里的互动提醒。
-- 站内已有的瓶子发出时还没有小程序：默认不公开到小程序（作者没同意过更大的读者范围）。小程序里扔的照旧两边都能看到。
ALTER TABLE bottles ADD COLUMN mini INTEGER NOT NULL DEFAULT 1;
UPDATE bottles SET mini = 0 WHERE author_id > -5000000000000;
CREATE INDEX IF NOT EXISTS idx_bottles_mini_sea ON bottles(expires_at) WHERE deleted = 0 AND hidden = 0 AND mini = 1;

-- 没有站内账号的论坛用户：小程序平台给的用户名、昵称（平台不签名，服务器核对不了，所以名字旁边一直带论坛编号）
ALTER TABLE bottle_mini_users ADD COLUMN username TEXT;
ALTER TABLE bottle_mini_users ADD COLUMN name TEXT;
ALTER TABLE bottle_mini_users ADD COLUMN avatar TEXT;
ALTER TABLE bottle_mini_users ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- 小程序不能直接显示网络图片：头像由服务器转成数据。给小程序的是 key（地址的哈希），看不出是谁
CREATE TABLE IF NOT EXISTS bottle_avatars (
  key        TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

-- 小程序里的提醒：每人一个「看到哪里了」
CREATE TABLE IF NOT EXISTS bottle_notif_reads (
  user_id INTEGER PRIMARY KEY,
  read_at INTEGER NOT NULL
);
