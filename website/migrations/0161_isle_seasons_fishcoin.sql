-- 鱼鱼谷重做 · 第 1 阶段「地基」（2026-11-23，见 docs/yuyugu-redesign.md）
-- 赛季：每季 7 天，最后 3 天为末日；末日每天 D币 贬值 15%（兑换 1 鱼币要的 D币 = 基础汇率 / 0.85^末日第几天）。
-- 第 1 赛季按站长要求开局即末日：2026-11-23 00:00 至 11-26 00:00（北京时间），之后按 isle_season_config 自动续季。
-- 鱼币只能由 D币 单向兑入，按赛季归档（新赛季钱包从 0 开始）；流水与 coin52_ledger 一样用 attempt 做幂等。
-- 旧鱼鱼谷（pet_world 等表）不动。

CREATE TABLE isle_season_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 length_s INTEGER NOT NULL CHECK(length_s BETWEEN 86400 AND 8640000),
 doomsday_s INTEGER NOT NULL CHECK(doomsday_s BETWEEN 0 AND length_s),
 exchange_dcoin INTEGER NOT NULL CHECK(exchange_dcoin BETWEEN 1 AND 1000000000),
 devalue_bp INTEGER NOT NULL CHECK(devalue_bp BETWEEN 0 AND 9000),
 updated_at INTEGER NOT NULL
);
INSERT INTO isle_season_config(id,length_s,doomsday_s,exchange_dcoin,devalue_bp,updated_at)
VALUES(1,604800,259200,100,1500,1795363200);

CREATE TABLE isle_seasons (
 id INTEGER PRIMARY KEY CHECK(id>0),
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
 doomsday_at INTEGER NOT NULL CHECK(doomsday_at BETWEEN starts_at AND ends_at),
 exchange_dcoin INTEGER NOT NULL CHECK(exchange_dcoin BETWEEN 1 AND 1000000000),
 devalue_bp INTEGER NOT NULL CHECK(devalue_bp BETWEEN 0 AND 9000),
 created_at INTEGER NOT NULL,
 UNIQUE(starts_at)
);
CREATE INDEX idx_isle_seasons_end ON isle_seasons(ends_at);
INSERT INTO isle_seasons(id,starts_at,ends_at,doomsday_at,exchange_dcoin,devalue_bp,created_at)
VALUES(1,1795363200,1795622400,1795363200,100,1500,1795363200);

CREATE TABLE isle_wallets (
 season_id INTEGER NOT NULL REFERENCES isle_seasons(id),
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9007199254740991),
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(season_id,user_id)
) WITHOUT ROWID;

CREATE TABLE isle_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 season_id INTEGER NOT NULL REFERENCES isle_seasons(id),
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 ref TEXT NOT NULL,
 attempt TEXT NOT NULL,
 delta INTEGER NOT NULL,
 balance_after INTEGER NOT NULL CHECK(balance_after BETWEEN 0 AND 9007199254740991),
 dcoin INTEGER NOT NULL DEFAULT 0 CHECK(dcoin>=0),
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,kind,ref),
 UNIQUE(user_id,attempt)
);
CREATE INDEX idx_isle_ledger_user ON isle_ledger(user_id,season_id,id DESC);
