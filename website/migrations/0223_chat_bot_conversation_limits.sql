ALTER TABLE chat_group_bot_identity ADD COLUMN chat_round_limit INTEGER NOT NULL DEFAULT 0 CHECK(chat_round_limit>=0);
ALTER TABLE chat_group_bot_identity ADD COLUMN chat_end_marker TEXT NOT NULL DEFAULT '结束会话';
ALTER TABLE chat_group_bot_identity ADD COLUMN chat_end_mode TEXT NOT NULL DEFAULT 'system' CHECK(chat_end_mode IN('system','callback'));
ALTER TABLE chat_group_bot_identity ADD COLUMN chat_end_text TEXT NOT NULL DEFAULT '本次会话已结束。再次艾特机器人可以重新选择身份。';

ALTER TABLE chat_bot_persona_choices ADD COLUMN session_id TEXT;
ALTER TABLE chat_bot_persona_choices ADD COLUMN completed_rounds INTEGER NOT NULL DEFAULT 0 CHECK(completed_rounds>=0);
ALTER TABLE chat_bot_persona_choices ADD COLUMN needs_selection INTEGER NOT NULL DEFAULT 0 CHECK(needs_selection IN(0,1));

ALTER TABLE chat_bot_events ADD COLUMN chat_session_id TEXT;
ALTER TABLE chat_bot_events ADD COLUMN chat_end_requested INTEGER NOT NULL DEFAULT 0 CHECK(chat_end_requested IN(0,1));
ALTER TABLE chat_bot_events ADD COLUMN chat_replied_at INTEGER;
CREATE INDEX idx_chat_bot_session_pending ON chat_bot_events(chat_session_id,created_at)
 WHERE chat_session_id IS NOT NULL AND chat_replied_at IS NULL;
