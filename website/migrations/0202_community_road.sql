-- 装扮来源为可选元数据；旧鞭打和群聊同步继续使用默认值。
ALTER TABLE road_items ADD COLUMN skin_id TEXT;
ALTER TABLE road_items ADD COLUMN skin_source TEXT;

ALTER TABLE road_items ADD COLUMN github_issue INTEGER CHECK(typeof(github_issue) = 'integer' AND github_issue > 0 OR github_issue IS NULL);
ALTER TABLE road_items ADD COLUMN github_sync_status TEXT NOT NULL DEFAULT 'none'
  CHECK(github_sync_status IN ('none','pending','failed','linked'));
-- 外部请求前落库，供并发互斥和超时后只读核对。公开标记为随机值。
ALTER TABLE road_items ADD COLUMN github_sync_key TEXT;
ALTER TABLE road_items ADD COLUMN github_sync_started_at INTEGER;
CREATE INDEX idx_road_github_issue ON road_items(github_issue) WHERE github_issue IS NOT NULL;
