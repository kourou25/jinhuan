-- 2026-11-24 群聊侧边图廊分栏：精华帖 + 侧边栏「已阅」
-- 精华：featured_at>0 即为精华；featured_by 记录加精的管理员；featured_note 是可选的一句加精理由（通知作者时显示）
ALTER TABLE memes ADD COLUMN featured_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memes ADD COLUMN featured_by INTEGER;
ALTER TABLE memes ADD COLUMN featured_note TEXT;
CREATE INDEX IF NOT EXISTS idx_memes_featured ON memes(featured_at DESC, id DESC) WHERE featured_at > 0;
-- 精华通知按作者查（author_id 已有索引，这里给通知查询加一个覆盖范围更小的部分索引）
CREATE INDEX IF NOT EXISTS idx_memes_featured_author ON memes(author_id, featured_at) WHERE featured_at > 0;

-- 侧边栏「已阅」：和图廊原有的「看过」（views）分开记，点了已阅或在侧边栏里打开详情才写入
CREATE TABLE IF NOT EXISTS meme_feed_reads (
  user_id INTEGER NOT NULL,
  meme_id INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id)
) WITHOUT ROWID;
