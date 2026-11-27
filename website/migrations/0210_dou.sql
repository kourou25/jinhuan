-- 「斗」：武侠自动回合制对战（2026-11-26）
-- 只给自己开启的人建角色；战斗结果由种子 + 快照 + 选卡决定，dou_battles 只存这些，逐帧事件随时重算。
CREATE TABLE IF NOT EXISTS dou_heroes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  weapon TEXT,
  deck TEXT NOT NULL DEFAULT '[]',
  outfit TEXT NOT NULL DEFAULT '{}',
  daily TEXT NOT NULL DEFAULT '{}',
  pvp_points INTEGER NOT NULL DEFAULT 0,
  pvp_wins INTEGER NOT NULL DEFAULT 0,
  pvp_losses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dou_heroes_level ON dou_heroes(active, level);
CREATE TABLE IF NOT EXISTS dou_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weapon','outfit','card')),
  got_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS dou_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  tries INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER,
  PRIMARY KEY (user_id, stage)
);
CREATE TABLE IF NOT EXISTS dou_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ach TEXT NOT NULL,
  got_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ach)
);
CREATE TABLE IF NOT EXISTS dou_battles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('pve','pvp','board','auto')),
  attacker INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  defender INTEGER,
  stage TEXT,
  seed TEXT NOT NULL,
  snap TEXT NOT NULL,
  picks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  winner INTEGER,
  reward TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dou_battles_attacker ON dou_battles(attacker, created_at);
CREATE INDEX IF NOT EXISTS dou_battles_defender ON dou_battles(defender, created_at);
CREATE INDEX IF NOT EXISTS dou_battles_pending ON dou_battles(attacker, status);
-- 角色形象和单独配置：avatar_kind 由站长标注（pending / person / other）；config 见 services/dou-battle.ts RoleConfig
CREATE TABLE IF NOT EXISTS dou_roles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_kind TEXT NOT NULL DEFAULT 'pending' CHECK (avatar_kind IN ('pending','person','other')),
  config TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
-- 武林大会：rank 越小越靠前
CREATE TABLE IF NOT EXISTS dou_board (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  auto_day TEXT
);
CREATE INDEX IF NOT EXISTS dou_board_rank ON dou_board(rank);
