-- 好久不见：送给想念的人的礼物。钱从送礼人扣，进站长账户（流水 miss-gift-send / miss-gift-income）。
CREATE TABLE autumn_gifts(
 id TEXT PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id), recipient_id INTEGER NOT NULL REFERENCES users(id),
 gift TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>=10000), note TEXT NOT NULL DEFAULT '', attempt TEXT NOT NULL UNIQUE,
 hidden INTEGER NOT NULL DEFAULT 0, seen_at INTEGER, created_at INTEGER NOT NULL, CHECK(sender_id<>recipient_id)
);
CREATE INDEX idx_autumn_gifts_recipient ON autumn_gifts(recipient_id,created_at);
CREATE INDEX idx_autumn_gifts_sender ON autumn_gifts(sender_id,created_at);
CREATE INDEX idx_autumn_gifts_unseen ON autumn_gifts(recipient_id) WHERE seen_at IS NULL AND hidden=0;
