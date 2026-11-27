-- 1 群匿名改版（站长 2026-11-26）：默认实名，自己开启；角色自己抽（免费 3 次，之后 10 万 D币一次），可花 52 万 D币侵占别人正在用的角色
-- 现在持有的角色：同一时间一个角色只属于一个人
CREATE TABLE anon_identities (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  series TEXT NOT NULL,
  item INTEGER NOT NULL,
  alias_id INTEGER NOT NULL UNIQUE,  -- 给前端的随机编号；换人持有时重新生成
  since INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id),
  UNIQUE (group_id, series, item)
);
-- 抽取次数和当前候选（抽到后要本人选择换上、放弃或侵占）
CREATE TABLE anon_draw_state (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  free_used INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,  -- 被侵占补的免费次数
  pending_series TEXT,
  pending_item INTEGER,
  pending_at INTEGER,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE anon_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  series TEXT NOT NULL,
  item INTEGER NOT NULL,
  name TEXT NOT NULL,
  cost INTEGER NOT NULL,
  result TEXT NOT NULL,              -- drawn / taken / seized
  victim_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_anon_draws_victim ON anon_draws(victim_id, created_at) WHERE victim_id IS NOT NULL;
-- 消息发出时用的角色
ALTER TABLE anon_messages ADD COLUMN series TEXT;
ALTER TABLE anon_messages ADD COLUMN item INTEGER;
ALTER TABLE anon_messages ADD COLUMN alias_id INTEGER;
-- 「@角色名」当时指的是哪个角色（角色以后可能换人，正文里的名字要按当时的角色标出来）
CREATE TABLE anon_mention_names (
  message_id INTEGER NOT NULL,
  series TEXT NOT NULL,
  item INTEGER NOT NULL,
  PRIMARY KEY (message_id, series, item)
);
-- 默认改成实名；进群不满 3 天也是实名；匿名时记下当时的角色（没抽角色就是空，显示「鱼友」）
DROP TRIGGER IF EXISTS trg_anon_message;
CREATE TRIGGER trg_anon_message AFTER INSERT ON chat_messages WHEN NEW.group_id = 1 BEGIN
  INSERT OR IGNORE INTO anon_messages(message_id, user_id, anon, series, item, alias_id)
  SELECT NEW.id, NEW.user_id, a.anon, CASE WHEN a.anon = 1 THEN i.series END, CASE WHEN a.anon = 1 THEN i.item END, CASE WHEN a.anon = 1 THEN i.alias_id END
  FROM (SELECT CASE WHEN EXISTS(SELECT 1 FROM users WHERE id = NEW.user_id AND kind = 'bot') THEN 0
    WHEN EXISTS(SELECT 1 FROM chat_members WHERE group_id = NEW.group_id AND user_id = NEW.user_id AND joined_at > NEW.created_at - 259200) THEN 0
    ELSE COALESCE((SELECT anon FROM anon_members WHERE group_id = NEW.group_id AND user_id = NEW.user_id), 0) END AS anon) a
  LEFT JOIN anon_identities i ON i.group_id = NEW.group_id AND i.user_id = NEW.user_id;
END;
-- 改版前大家默认匿名，改版后默认实名：上线即全员实名，想匿名的自己再开（旧消息按当时的状态保留）
DELETE FROM anon_members WHERE group_id = 1;
