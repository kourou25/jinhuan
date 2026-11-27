-- 2026-11-26 漂流瓶：瓶子和回信可以带图片、实况、视频。
-- media 是 JSON 数组：[{k:文件, p:封面/实况静图, t:小缩略图, w, h, kind:'g'|'v'|'l'}]
ALTER TABLE bottles ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bottle_replies ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
-- 文件属于哪个瓶子 / 回信：小程序取图时据此判断能不能看
CREATE TABLE IF NOT EXISTS bottle_media (
  key       TEXT PRIMARY KEY,
  bottle_id INTEGER NOT NULL,
  reply_id  INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_bottle_media_bottle ON bottle_media(bottle_id);
