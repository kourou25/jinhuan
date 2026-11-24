ALTER TABLE chat_messages ADD COLUMN rem_form INTEGER CHECK (rem_form IN (0, 1));

CREATE INDEX idx_chat_msg_rem_form ON chat_messages(group_id, user_id, id DESC)
WHERE rem_form IS NOT NULL;
