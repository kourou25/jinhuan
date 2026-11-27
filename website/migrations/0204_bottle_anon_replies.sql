-- 2026-11-26 漂流瓶：回信可以匿名；匿名身份用 1 群匿名系统的像素头像；AI 审核。
-- 头像存相对地址（/assets/anon/系列/编号.webp）；旧瓶子留空，显示时按瓶子的随机编号选一张（和作者无关）。
ALTER TABLE bottles ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
-- AI 审核：ok 已通过；pending 发布时 AI 没回应，等后台补审；flag 判定违规（已隐藏）
ALTER TABLE bottles ADD COLUMN ai TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE bottle_replies ADD COLUMN anon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottle_replies ADD COLUMN ai TEXT NOT NULL DEFAULT 'ok';
CREATE INDEX IF NOT EXISTS idx_bottles_ai_pending ON bottles(created_at) WHERE ai = 'pending';
CREATE INDEX IF NOT EXISTS idx_bottle_replies_ai_pending ON bottle_replies(created_at) WHERE ai = 'pending';

-- 每个瓶子里的匿名身份：一个人在同一个瓶子里固定一个；同一个瓶子里昵称、头像都不重复（瓶主的另在 bottles 上，写入时排除）
CREATE TABLE IF NOT EXISTS bottle_aliases (
  bottle_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  nick       TEXT NOT NULL,
  avatar     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, user_id),
  UNIQUE (bottle_id, nick),
  UNIQUE (bottle_id, avatar)
) WITHOUT ROWID;
