ALTER TABLE chat_members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));
CREATE UNIQUE INDEX idx_chat_members_pinned_user ON chat_members(user_id) WHERE pinned=1;
