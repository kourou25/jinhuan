-- 2026-11-25 漂流瓶：匿名发布、实名互动。author_id 只用于「我的瓶子」、提醒和站长处理违规，任何公开接口都不返回。
-- id 是随机整数（不自增），从编号看不出先后；对外只给日期。
CREATE TABLE IF NOT EXISTS bottles (
  id         INTEGER PRIMARY KEY,
  author_id  INTEGER NOT NULL,
  body       TEXT NOT NULL,
  mood       TEXT NOT NULL DEFAULT '',
  hidden     INTEGER NOT NULL DEFAULT 0, -- 举报人数够了自动隐藏，等管理员处理
  deleted    INTEGER NOT NULL DEFAULT 0, -- 1 瓶主删除，2 管理员删除
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bottles_author ON bottles(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bottles_sea ON bottles(created_at) WHERE deleted = 0 AND hidden = 0;

-- 谁捞到过哪个瓶子：每天的次数、不重复捞
CREATE TABLE IF NOT EXISTS bottle_draws (
  user_id   INTEGER NOT NULL,
  bottle_id INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (user_id, bottle_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_bottle_draws_day ON bottle_draws(user_id, at);

CREATE TABLE IF NOT EXISTS bottle_likes (
  bottle_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, user_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS bottle_keeps (
  user_id    INTEGER NOT NULL,
  bottle_id  INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, bottle_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_bottle_keeps_recent ON bottle_keeps(user_id, created_at DESC);

-- is_host=1：瓶主的回信，对外只显示「瓶主」，user_id 不返回
CREATE TABLE IF NOT EXISTS bottle_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id  INTEGER NOT NULL REFERENCES bottles(id),
  user_id    INTEGER NOT NULL,
  is_host    INTEGER NOT NULL DEFAULT 0,
  reply_to   INTEGER,
  body       TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bottle_replies_bottle ON bottle_replies(bottle_id, id);
CREATE INDEX IF NOT EXISTS idx_bottle_replies_user ON bottle_replies(user_id, bottle_id);
CREATE INDEX IF NOT EXISTS idx_bottle_replies_to ON bottle_replies(reply_to) WHERE reply_to IS NOT NULL;

-- 举报：kind = bottle / reply；resolved：0 待处理，1 保留，2 已删除
CREATE TABLE IF NOT EXISTS bottle_reports (
  kind       TEXT NOT NULL,
  target_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, target_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_bottle_reports_open ON bottle_reports(kind, target_id) WHERE resolved = 0;

-- 站长每次查看作者都留一条记录
CREATE TABLE IF NOT EXISTS bottle_author_views (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id INTEGER NOT NULL,
  viewer_id INTEGER NOT NULL,
  at        INTEGER NOT NULL
);
