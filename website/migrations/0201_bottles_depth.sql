-- 2026-11-25 漂流瓶改版：匿名可选、随机 / 自定义昵称、有效期、热度、付费捞扔、不喜欢、互动奖励。
-- 已有瓶子：保持匿名，有效期沿用原来的 30 天；昵称留空时按随机编号生成（和作者无关）。
ALTER TABLE bottles ADD COLUMN anon INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bottles ADD COLUMN nick TEXT NOT NULL DEFAULT '';
ALTER TABLE bottles ADD COLUMN show_badge INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bottles ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottles ADD COLUMN heat INTEGER NOT NULL DEFAULT 0; -- 只用于捞瓶权重，不返回给任何人
ALTER TABLE bottles ADD COLUMN poops INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottles ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottles ADD COLUMN op TEXT; -- 客户端操作编号：重试不会多扔、多扣
UPDATE bottles SET expires_at = created_at + 2592000 WHERE expires_at = 0;
UPDATE bottles SET heat = 4 * (SELECT COUNT(*) FROM bottle_likes l WHERE l.bottle_id = bottles.id)
  + 6 * (SELECT COUNT(DISTINCT r.user_id) FROM bottle_replies r WHERE r.bottle_id = bottles.id AND r.is_host = 0 AND r.deleted = 0 AND r.hidden = 0);
DROP INDEX IF EXISTS idx_bottles_sea;
CREATE INDEX idx_bottles_sea ON bottles(expires_at) WHERE deleted = 0 AND hidden = 0;
CREATE UNIQUE INDEX idx_bottles_op ON bottles(author_id, op) WHERE op IS NOT NULL;

ALTER TABLE bottle_draws ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bottle_draws ADD COLUMN op TEXT;
CREATE UNIQUE INDEX idx_bottle_draws_op ON bottle_draws(user_id, op) WHERE op IS NOT NULL;

ALTER TABLE bottle_replies ADD COLUMN op TEXT;
CREATE UNIQUE INDEX idx_bottle_replies_op ON bottle_replies(user_id, op) WHERE op IS NOT NULL;
CREATE INDEX idx_bottle_likes_user ON bottle_likes(user_id, created_at DESC);

-- 不喜欢：一人一瓶一次，可取消；名单不给任何人看
CREATE TABLE bottle_poops (
  bottle_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, user_id)
) WITHOUT ROWID;

-- 互动奖励队列：同一人对同一瓶的喜欢、回信各算一次（主键保证），次日合并结算。
-- 不即时到账：财富榜公开精确余额，即时到账会让人点个赞就看出瓶主是谁。
CREATE TABLE bottle_rewards (
  bottle_id  INTEGER NOT NULL,
  actor_id   INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK(kind IN ('like','reply')),
  user_id    INTEGER NOT NULL,
  amount     INTEGER NOT NULL,
  day        TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','void','short')), -- short：站长余额不足没发，不补
  batch      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, actor_id, kind)
) WITHOUT ROWID;
CREATE INDEX idx_bottle_rewards_pending ON bottle_rewards(day, user_id) WHERE state = 'pending';
CREATE INDEX idx_bottle_rewards_user ON bottle_rewards(user_id, day);
CREATE INDEX idx_bottle_rewards_batch ON bottle_rewards(batch) WHERE batch IS NOT NULL;
CREATE INDEX idx_bottle_rewards_short ON bottle_rewards(state) WHERE state = 'short';
CREATE INDEX idx_bottle_rewards_actor ON bottle_rewards(actor_id, day);
-- 新规则上线前的互动不补发：先登记成「不计」，取消再点也换不到奖励
INSERT OR IGNORE INTO bottle_rewards(bottle_id,actor_id,kind,user_id,amount,day,state,created_at)
  SELECT l.bottle_id,l.user_id,'like',b.author_id,0,'before','void',l.created_at FROM bottle_likes l JOIN bottles b ON b.id = l.bottle_id;
INSERT OR IGNORE INTO bottle_rewards(bottle_id,actor_id,kind,user_id,amount,day,state,created_at)
  SELECT r.bottle_id,r.user_id,'reply',b.author_id,0,'before','void',r.created_at FROM bottle_replies r JOIN bottles b ON b.id = r.bottle_id WHERE r.is_host = 0;
