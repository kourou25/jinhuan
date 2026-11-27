ALTER TABLE chat_bot_installations ADD COLUMN gallery_access INTEGER NOT NULL DEFAULT 0 CHECK(gallery_access IN(0,1));
ALTER TABLE chat_bot_installations ADD COLUMN command_descriptions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(command_descriptions) AND json_type(command_descriptions)='object');
ALTER TABLE chat_bot_installations ADD COLUMN chat_name TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX idx_chat_bot_group_persona ON chat_bot_installations(group_id,chat_name) WHERE chat_name IS NOT NULL;

CREATE TABLE chat_bot_persona_choices (
 group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 installation_id TEXT REFERENCES chat_bot_installations(id) ON DELETE SET NULL,
 pending_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
 pending_text TEXT,
 PRIMARY KEY(group_id,user_id)
) WITHOUT ROWID;

CREATE TABLE chat_group_bot_identity (
 group_id INTEGER PRIMARY KEY REFERENCES chat_groups(id) ON DELETE CASCADE,
 bot_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
 doc_post_id INTEGER REFERENCES memes(id) ON DELETE SET NULL
);

INSERT INTO chat_group_bot_identity(group_id,bot_id)
SELECT group_id,bot_id FROM (
 SELECT group_id,bot_id,ROW_NUMBER() OVER(PARTITION BY group_id ORDER BY created_at,id) AS position
 FROM chat_bot_installations
) WHERE position=1;
