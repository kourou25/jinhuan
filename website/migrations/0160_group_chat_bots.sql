-- 社区 PR #9：群机器人（安装、推送令牌、指令回调投递记录）
CREATE TABLE chat_bot_installations (
 id TEXT PRIMARY KEY,
 group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
 bot_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
 created_by INTEGER NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE,
 key_version TEXT NOT NULL,
 callback_url TEXT,
 commands TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(commands) AND json_type(commands)='array'),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_chat_bot_installations_group ON chat_bot_installations(group_id,created_at);

CREATE TABLE chat_bot_events (
 id TEXT PRIMARY KEY,
 installation_id TEXT NOT NULL REFERENCES chat_bot_installations(id) ON DELETE CASCADE,
 message_id INTEGER NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
 command TEXT NOT NULL,
 args TEXT NOT NULL,
 source_body TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','delivering','delivered','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL,
 lease TEXT,
 error TEXT,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_chat_bot_events_due ON chat_bot_events(next_at,id) WHERE state IN('pending','delivering');
CREATE INDEX idx_chat_bot_events_history ON chat_bot_events(installation_id,created_at DESC,id DESC);
CREATE INDEX idx_chat_bot_events_cleanup ON chat_bot_events(created_at,id);
