ALTER TABLE chat_bot_installations ADD COLUMN gallery_access INTEGER NOT NULL DEFAULT 0 CHECK(gallery_access IN(0,1));
ALTER TABLE chat_bot_installations ADD COLUMN command_descriptions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(command_descriptions) AND json_type(command_descriptions)='object');
ALTER TABLE chat_bot_installations ADD COLUMN accept_mentions INTEGER NOT NULL DEFAULT 0 CHECK(accept_mentions IN(0,1));
CREATE UNIQUE INDEX idx_chat_bot_group_mentions ON chat_bot_installations(group_id) WHERE accept_mentions=1;

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
