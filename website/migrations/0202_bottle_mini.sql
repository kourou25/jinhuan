-- 2026-11-25 漂流瓶 linux.do 小程序：没有站内账号的论坛用户。只记论坛编号，不建站内账号、没有钱包。
-- id = -(5000000000000 + 论坛编号)，不会和任何站内用户、化名编号重复；在漂流瓶各表里当作 user_id / author_id 用。
CREATE TABLE IF NOT EXISTS bottle_mini_users (
  id         INTEGER PRIMARY KEY CHECK(id < -5000000000000),
  sub        TEXT NOT NULL UNIQUE,
  blocked    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
