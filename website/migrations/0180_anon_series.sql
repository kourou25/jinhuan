-- 1 群匿名：每周一个系列，群友随机获得其中一个角色（services/anon-identity.ts）
CREATE TABLE anon_weeks (
  group_id INTEGER NOT NULL,
  week TEXT NOT NULL,               -- 北京时间周一，YYYY-MM-DD
  series TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, week)
);
-- 角色由服务端随机数抽出后落库，和用户编号没有可推算的关系；alias_id 是给前端用的随机负数
CREATE TABLE anon_assignments (
  group_id INTEGER NOT NULL,
  week TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  series TEXT NOT NULL,
  item INTEGER NOT NULL,            -- 系列内编号，从 1 开始
  suffix INTEGER NOT NULL DEFAULT 1,-- 超过系列人数时的重名序号（·贰、·叁）
  alias_id INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, week, user_id),
  UNIQUE (group_id, week, item, suffix)
);
-- 当前开关（没有记录 = 开启匿名）
CREATE TABLE anon_members (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  anon INTEGER NOT NULL DEFAULT 1,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
-- 开关历史：一句回应、表情、红包领取等没有快照的记录，按发生时间查当时的状态
CREATE TABLE anon_member_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  anon INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_anon_member_log ON anon_member_log(group_id, user_id, at);
-- 每条消息发出时的匿名状态。用触发器写，所有发消息的入口（含定时任务）都不会漏
CREATE TABLE anon_messages (
  message_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  anon INTEGER NOT NULL
);
CREATE TRIGGER trg_anon_message AFTER INSERT ON chat_messages WHEN NEW.group_id = 1 BEGIN
  INSERT OR IGNORE INTO anon_messages(message_id, user_id, anon) VALUES (NEW.id, NEW.user_id,
    CASE WHEN EXISTS(SELECT 1 FROM users WHERE id = NEW.user_id AND kind = 'bot') THEN 0
    ELSE COALESCE((SELECT anon FROM anon_members WHERE group_id = NEW.group_id AND user_id = NEW.user_id), 1) END);
END;
CREATE TRIGGER trg_anon_message_del AFTER DELETE ON chat_messages WHEN OLD.group_id = 1 BEGIN
  DELETE FROM anon_messages WHERE message_id = OLD.id;
END;
-- 本周谁以哪种身份发过言（成员列表用，免得每次扫一周的消息）
CREATE TABLE anon_active (
  group_id INTEGER NOT NULL,
  week TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  anon INTEGER NOT NULL,
  PRIMARY KEY (group_id, week, user_id, anon)
) WITHOUT ROWID;
CREATE TRIGGER trg_anon_active AFTER INSERT ON anon_messages BEGIN
  INSERT OR IGNORE INTO anon_active(group_id, week, user_id, anon)
    SELECT m.group_id, date(m.created_at + 28800, 'unixepoch', 'weekday 0', '-6 days'), NEW.user_id, NEW.anon
    FROM chat_messages m WHERE m.id = NEW.message_id AND m.system_kind IS NULL;
END;
-- 补上线前一周消息的快照：当时人人匿名，机器人除外
INSERT OR IGNORE INTO anon_messages(message_id, user_id, anon)
  SELECT m.id, m.user_id, CASE WHEN u.kind = 'bot' THEN 0 ELSE 1 END FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
  WHERE m.group_id = 1 AND m.created_at > unixepoch() - 8 * 86400;
-- 「@角色名」在发送时解析成真实成员
CREATE TABLE anon_mentions (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX idx_anon_mentions_user ON anon_mentions(user_id, message_id);
