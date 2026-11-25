-- 2026-11-24 群聊侧边图廊「不喜欢 / 不再出现」：点了之后这帖不再在侧边栏（未读、全部、精华、随机）出现，
-- 自己可以在「我不喜欢的」里看到全部并恢复。和「已阅」（meme_feed_reads）分开记。
CREATE TABLE IF NOT EXISTS meme_feed_hides (
  user_id INTEGER NOT NULL,
  meme_id INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_meme_feed_hides_recent ON meme_feed_hides(user_id, at DESC);
