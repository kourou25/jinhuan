-- 1 群匿名：抽角色可以选主题（系列），每个主题一次性付 52 万 D币解锁，之后在这个主题里抽按原价（站长 2026-11-27）
CREATE TABLE anon_theme_unlocks (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  series TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id, series)
);
