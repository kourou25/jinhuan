-- 社区 PR #20：每个账号可置顶一个群，打开群聊时默认进入（原编号 0202 与漂流瓶冲突，改为 0220）
ALTER TABLE chat_members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));
CREATE UNIQUE INDEX idx_chat_members_pinned_user ON chat_members(user_id) WHERE pinned=1;
