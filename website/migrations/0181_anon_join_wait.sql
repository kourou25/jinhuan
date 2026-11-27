-- 1 群匿名：进群满 3 天才匿名（站长 2026-11-26）。之前发的消息按当时的状态保留，不回改
DROP TRIGGER IF EXISTS trg_anon_message;
CREATE TRIGGER trg_anon_message AFTER INSERT ON chat_messages WHEN NEW.group_id = 1 BEGIN
  INSERT OR IGNORE INTO anon_messages(message_id, user_id, anon) VALUES (NEW.id, NEW.user_id,
    CASE WHEN EXISTS(SELECT 1 FROM users WHERE id = NEW.user_id AND kind = 'bot') THEN 0
    WHEN EXISTS(SELECT 1 FROM chat_members WHERE group_id = NEW.group_id AND user_id = NEW.user_id AND joined_at > NEW.created_at - 259200) THEN 0
    ELSE COALESCE((SELECT anon FROM anon_members WHERE group_id = NEW.group_id AND user_id = NEW.user_id), 1) END);
END;
