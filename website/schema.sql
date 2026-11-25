PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,          -- linux.do 用户 ID
  username    TEXT    NOT NULL,
  name        TEXT,
  avatar      TEXT,
  trust_level INTEGER NOT NULL DEFAULT 0,
  silenced    INTEGER NOT NULL DEFAULT 0,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
, notif_read INTEGER NOT NULL DEFAULT 0, notif_prefs TEXT, nick TEXT, bio TEXT, last_seen INTEGER NOT NULL DEFAULT 0, fancy INTEGER, deco TEXT, role TEXT, kind TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, card TEXT, avatar_custom INTEGER NOT NULL DEFAULT 0, handle_at INTEGER, invited_by INTEGER, handle_setup_pending INTEGER NOT NULL DEFAULT 0, ai_prefs TEXT, main_activated_at INTEGER);

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,           -- sha256(cookie 中的 sid)
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
, created_at INTEGER NOT NULL DEFAULT 0, seen_at INTEGER NOT NULL DEFAULT 0, method TEXT, ua TEXT);

CREATE TABLE memes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL DEFAULT '',
  content        TEXT    NOT NULL DEFAULT '',
  image_url      TEXT,                      -- 外链原图（历史图，托管在 linux.do）
  thumb_url      TEXT,                      -- 外链缩略图
  image_key      TEXT,                      -- R2 对象 key（站内新上传）
  width          INTEGER,
  height         INTEGER,
  gallery        TEXT,                      -- 多图时的 JSON：[{u,t,w,h}]，第一张即封面
  spoiler        INTEGER NOT NULL DEFAULT 0, -- 慎点：默认模糊
  series         TEXT,                      -- 所属 linux.do 合集帖标题（图集）
  source_url     TEXT,                      -- linux.do 原帖链接
  ld_post_id     INTEGER UNIQUE,            -- linux.do 楼层 ID，重复导入时去重
  ld_likes       INTEGER NOT NULL DEFAULT 0, -- linux.do 上的点赞数
  author_id      INTEGER,
  author_name    TEXT,
  like_count     INTEGER NOT NULL DEFAULT 0,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  reply_count    INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  fav_count      INTEGER NOT NULL DEFAULT 0,
  hidden         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
, nsfw INTEGER NOT NULL DEFAULT 0, hot INTEGER NOT NULL DEFAULT 0, layout TEXT NOT NULL DEFAULT 'grid', kind TEXT NOT NULL DEFAULT 'image', ai_off INTEGER NOT NULL DEFAULT 0, featured_at INTEGER NOT NULL DEFAULT 0, featured_by INTEGER, featured_note TEXT);

CREATE TABLE meme_tags (
  meme_id INTEGER NOT NULL,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (meme_id, tag)
);

CREATE TABLE likes (
  user_id    INTEGER NOT NULL,
  meme_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id)
);

CREATE TABLE reactions (
  meme_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  emoji      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (meme_id, user_id, emoji)
);

CREATE TABLE short_replies (
  meme_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  text       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (meme_id, user_id)
);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meme_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
, reply_to INTEGER, ai_job_id INTEGER);

CREATE TABLE fav_folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE favorites (
  user_id    INTEGER NOT NULL,
  meme_id    INTEGER NOT NULL,
  folder_id  INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id, folder_id)
);

CREATE TABLE views (
  user_id INTEGER NOT NULL,
  meme_id INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id)
);

CREATE TABLE anchors (
  user_id    INTEGER NOT NULL,
  meme_id    INTEGER NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id)
);

CREATE TABLE chat_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
, member_count INTEGER NOT NULL DEFAULT 0, notice TEXT, notice_at INTEGER, avatar TEXT);

CREATE TABLE chat_members (
  group_id  INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  last_read INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, last_read_at INTEGER NOT NULL DEFAULT 0, away_from INTEGER NOT NULL DEFAULT 0,       -- 读到的最后一条消息 id
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  image_key  TEXT,                            -- R2 里的图（c/ 开头）
  width      INTEGER,
  height     INTEGER,
  reply_to   INTEGER,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL                 -- 撤回、表情变化时更新，轮询靠它同步
, seq INTEGER NOT NULL DEFAULT 0, media TEXT, edited_at INTEGER, meme_id INTEGER, redpack_id TEXT, system_kind TEXT, system_ref TEXT);

CREATE TABLE chat_reactions (
  message_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  emoji      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE puzzles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  meme_id         INTEGER NOT NULL UNIQUE,
  creator_id      INTEGER NOT NULL,
  hint            TEXT    NOT NULL DEFAULT '',
  answer_hash     TEXT    NOT NULL,          -- sha256(salt + 规范化答案)
  salt            TEXT    NOT NULL,
  reward_kind     TEXT    NOT NULL,          -- secret | credit | cdk（展示用）
  reward_type     TEXT    NOT NULL,          -- text | link | codes（发放方式）
  reward_text     TEXT    NOT NULL DEFAULT '',
  min_trust_level INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  max_winners     INTEGER NOT NULL DEFAULT 0, -- 0 = 不限
  winners_count   INTEGER NOT NULL DEFAULT 0,
  ends_at         INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE puzzle_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  puzzle_id  INTEGER NOT NULL,
  code       TEXT    NOT NULL,
  claimed_by INTEGER,
  claimed_at INTEGER
);

CREATE TABLE puzzle_attempts (
  puzzle_id INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0,
  solved_at INTEGER,
  code_id   INTEGER, layer INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (puzzle_id, user_id)
);

CREATE TABLE stats_cache (
  key  TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  at   INTEGER NOT NULL
);

CREATE TABLE view_days (
  user_id INTEGER NOT NULL,
  day     TEXT    NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  n_safe  INTEGER NOT NULL DEFAULT 0, -- 其中非 NSFW 的（隐藏 NSFW 时用）
  PRIMARY KEY (user_id, day)
);

CREATE TABLE uploads (
  key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE puzzle_layers (
  puzzle_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,          -- pass 口令 / cipher 密文 / quiz 答题 / image 看图 / stego 藏字图
  prompt TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',   -- 公开给解题人的内容（密文、选项、图片…）
  answers TEXT NOT NULL,       -- 可接受答案的哈希数组 JSON
  note TEXT NOT NULL DEFAULT '', -- 过关后显示的一句话
  PRIMARY KEY (puzzle_id, idx)
);

CREATE TABLE notif_reads (
  user_id  INTEGER NOT NULL,
  kind     TEXT    NOT NULL,
  meme_id  INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, meme_id, actor_id, at)
) WITHOUT ROWID;

CREATE TABLE notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,
  day        TEXT,
  body       TEXT    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE chat_bans (
  group_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'kick',
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE user_limits (
  user_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  until      INTEGER NOT NULL DEFAULT 0,
  reason     TEXT,
  by_id      INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE chat_boosts (
  message_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  text       TEXT    NOT NULL,
  created_at INTEGER NOT NULL, ai_status TEXT NOT NULL DEFAULT '', ai_score INTEGER CHECK(ai_score BETWEEN 0 AND 100),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE road_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  kind       TEXT    NOT NULL,             -- feature 需求 / bug 问题 / idea 改进意见
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'open', -- open 待评估 / planned 计划中 / doing 进行中 / done 已上线 / declined 不做
  reply      TEXT,                          -- 管理员回复
  score      INTEGER NOT NULL DEFAULT 0,    -- 赞成 - 反对
  comments   INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, media TEXT, source_msg_id INTEGER, source_group_id INTEGER, source_hidden INTEGER NOT NULL DEFAULT 0);

CREATE TABLE road_votes (
  item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  v       INTEGER NOT NULL,                 -- 1 赞成 / -1 反对
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE road_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
, media TEXT);

CREATE TABLE chat_join_reqs (
  group_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  status     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE user_badges (
  user_id  INTEGER NOT NULL,
  badge    TEXT    NOT NULL,
  n        INTEGER NOT NULL DEFAULT 1,
  first_at INTEGER NOT NULL,
  last_day TEXT    NOT NULL,
  PRIMARY KEY (user_id, badge)
);

CREATE TABLE badge_log (
  user_id INTEGER NOT NULL,
  badge   TEXT    NOT NULL,
  day     TEXT    NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge, day)
);

CREATE TABLE badge_runs (
  day TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);

CREATE TABLE chat_redpacks (
  id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('open','phrase','cipher','image')),
  game TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  phrase TEXT NOT NULL DEFAULT '',
  post_id INTEGER,
  image_index INTEGER NOT NULL DEFAULT 0,
  mask INTEGER NOT NULL DEFAULT 4
, provider TEXT NOT NULL DEFAULT 'native', external_ref TEXT NOT NULL DEFAULT '', external_kind TEXT NOT NULL DEFAULT '', notify_at INTEGER, reminded_at INTEGER, clue_key TEXT, mask_bits INTEGER CHECK(mask_bits IS NULL OR mask_bits BETWEEN 1 AND 511), external_code TEXT, draw_data TEXT, draw_synced_at INTEGER, draw_lease_until INTEGER, draw_attempts INTEGER NOT NULL DEFAULT 0, draw_announced_at INTEGER);

CREATE TABLE chat_redpack_opens (
  packet_id TEXT NOT NULL REFERENCES chat_redpacks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_at INTEGER NOT NULL DEFAULT 0,
  window_n INTEGER NOT NULL DEFAULT 0,
  solved_at INTEGER,
  PRIMARY KEY(packet_id,user_id)
);

CREATE TABLE chat_redpack_external_views (
  packet_id TEXT NOT NULL REFERENCES chat_redpacks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  data TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY(packet_id,user_id)
);

CREATE TABLE chat_redpack_successes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  packet_id TEXT NOT NULL REFERENCES chat_redpacks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(packet_id,user_id)
);

CREATE TABLE user_official_titles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  granted_by INTEGER NOT NULL REFERENCES users(id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,title)
);

CREATE TABLE official_title_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE site_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE identities (
  provider      TEXT    NOT NULL,          -- linuxdo / google / email / dev
  subject       TEXT    NOT NULL,          -- linuxdo: 数字 id；google: sub；email: 规范化的邮箱；dev: 小写用户名
  user_id       INTEGER NOT NULL,
  email         TEXT,                      -- google / email 的邮箱（展示用）
  username      TEXT,                      -- linuxdo：每次登录都写 L 站最新的用户名（认领历史图用）
  verified_at   INTEGER,                   -- email：验证时间
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  PRIMARY KEY (provider, subject)
) WITHOUT ROWID;

CREATE TABLE passwords (
  user_id      INTEGER PRIMARY KEY,
  hash         TEXT    NOT NULL,           -- pbkdf2_sha256$<iter>$<salt b64url>$<hash b64url>$p<pepper 版本>
  updated_at   INTEGER NOT NULL
);

CREATE TABLE login_fails (
  user_id      INTEGER NOT NULL,
  ip_hash      TEXT    NOT NULL,           -- HMAC-SHA256(PASSWORD_PEPPER, CF-Connecting-IP) 的前 16 个十六进制字符，不存明文 IP
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, ip_hash)
) WITHOUT ROWID;

CREATE TABLE auth_tokens (
  token_hash TEXT    PRIMARY KEY,          -- sha256(明文令牌)
  kind       TEXT    NOT NULL,
  user_id    INTEGER,
  email      TEXT,
  payload    TEXT,                         -- signup: {handle, nick, pw, invite}（pw 已经是哈希）
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  claim_id   TEXT,                         -- 随机事务凭据，后续语句只接受本次抢到的令牌
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE invite_codes (
  code       TEXT    PRIMARY KEY,          -- 8 位，字母表去掉易混字符（0O1Il）
  owner_id   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by    INTEGER,
  used_at    INTEGER,
  revoked    INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE invites (
  invitee_id   INTEGER PRIMARY KEY,
  inviter_id   INTEGER NOT NULL,
  code         TEXT    NOT NULL,
  method       TEXT    NOT NULL,           -- google / email / linuxdo
  created_at   INTEGER NOT NULL,
  qualified_at INTEGER,                    -- 满足「满 7 天且活跃」的时间
  revoked      INTEGER NOT NULL DEFAULT 0  -- 管理员判定刷号后作废，不计奖励
);

CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  prefix       TEXT    NOT NULL,           -- 明文前 8 位，列表里展示
  hash         TEXT    NOT NULL UNIQUE,    -- sha256(明文)
  scope        TEXT    NOT NULL,           -- 目前只有 'post'（上传 + 发帖）
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);

CREATE TABLE user_unlocks (
  user_id INTEGER NOT NULL,
  item    TEXT    NOT NULL,                -- 如 'title:guangjie'、'bubble:yinlu'
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, item)
) WITHOUT ROWID;

CREATE TABLE quota_usage (
  day   TEXT    NOT NULL,                  -- 北京时间 YYYY-MM-DD；唯一例外：scope = 'mail' 用 UTC 日期（与 Resend 对齐，第 7.9 节）
  scope TEXT    NOT NULL,                  -- 例如 'mail'、'ai:summary'、'ai:*'
  key   INTEGER NOT NULL,                  -- user_id；全站计数用 0
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope, key)
) WITHOUT ROWID;

CREATE TABLE ai_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('img_reply','road_review')),
  target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL,
  locked_at INTEGER,
  lease_token TEXT,
  logical_day TEXT,
  logical_receipt TEXT,
  logical_committed INTEGER NOT NULL DEFAULT 0 CHECK (logical_committed IN (0,1)),
  result TEXT,
  err TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind,target_id),
  CHECK ((state='running' AND locked_at IS NOT NULL AND lease_token IS NOT NULL)
      OR (state!='running' AND locked_at IS NULL AND lease_token IS NULL)),
  CHECK ((logical_day IS NULL AND logical_receipt IS NULL AND logical_committed=0)
      OR (logical_day IS NOT NULL AND logical_receipt IS NOT NULL))
);

CREATE TABLE account_retirements (
 source_id INTEGER PRIMARY KEY CHECK(source_id<>0),
 target_id INTEGER NOT NULL CHECK(target_id<>0 AND target_id<>source_id),
 retired_at INTEGER NOT NULL
);

CREATE TABLE dm_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_low INTEGER NOT NULL REFERENCES users(id),
  user_high INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_message_id INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL DEFAULT 0,
  read_low INTEGER NOT NULL DEFAULT 0,
  read_high INTEGER NOT NULL DEFAULT 0,
  CHECK(user_low<user_high),
  UNIQUE(user_low,user_high)
);

CREATE TABLE dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK(length(body)>0 AND length(body)<=2000),
  client_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL, media TEXT, reply_id INTEGER REFERENCES dm_messages(id), deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)), updated_at INTEGER NOT NULL DEFAULT 0, request_hash TEXT,
  UNIQUE(sender_id,client_nonce)
);

CREATE TABLE daily_post_views (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  meme_id INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,day,meme_id)
) WITHOUT ROWID;

CREATE TABLE "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE chat_sticker_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id),
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  media_index INTEGER NOT NULL CHECK(media_index BETWEEN 0 AND 11),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,message_id,media_index)
);

CREATE TABLE ldc_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), client_id TEXT NOT NULL UNIQUE,
 secret_box TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
, create_enabled INTEGER NOT NULL DEFAULT 1 CHECK(create_enabled IN (0,1)));

CREATE TABLE ldc_packets (
 packet_id TEXT PRIMARY KEY REFERENCES chat_redpacks(id), owner_id INTEGER NOT NULL REFERENCES users(id),
 client_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('fixed','random','guess','clues')),
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 100),
 ends_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
 answer_box TEXT, hints_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL,
 question_count INTEGER NOT NULL DEFAULT 0
, group_id INTEGER, game_version INTEGER NOT NULL DEFAULT 0, response_mode TEXT NOT NULL DEFAULT 'yesno' CHECK(response_mode IN ('yesno','similarity')), answer_length INTEGER NOT NULL DEFAULT 0, guess_count INTEGER NOT NULL DEFAULT 0, ai_count INTEGER NOT NULL DEFAULT 0, hints_box TEXT, hints_revealed INTEGER NOT NULL DEFAULT 0, hint_at INTEGER NOT NULL DEFAULT 0, room_revision INTEGER NOT NULL DEFAULT 0, auto_hint_every INTEGER NOT NULL DEFAULT 0 CHECK(auto_hint_every BETWEEN 0 AND 1000), extra_hints_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(extra_hints_json) AND json_type(extra_hints_json)='array'), judge_context_box TEXT, generated INTEGER NOT NULL DEFAULT 0 CHECK(generated IN (0,1)), hint_source TEXT NOT NULL DEFAULT 'legacy' CHECK(hint_source IN('legacy','ai','preset')), preset_hint_trigger TEXT NOT NULL DEFAULT 'cooldown' CHECK(preset_hint_trigger IN('cooldown','guesses')), hint_cooldown_seconds INTEGER NOT NULL DEFAULT 30 CHECK(hint_cooldown_seconds BETWEEN 1 AND 86400), auto_hint_increment INTEGER NOT NULL DEFAULT 0 CHECK(auto_hint_increment BETWEEN 0 AND 1000), escalation_every INTEGER NOT NULL DEFAULT 0, escalation_step_cents INTEGER NOT NULL DEFAULT 0, escalation_cap_cents INTEGER NOT NULL DEFAULT 0, base_total_cents INTEGER NOT NULL DEFAULT 0, added_reward_cents INTEGER NOT NULL DEFAULT 0, reward_finalized INTEGER NOT NULL DEFAULT 0, author_rule_version INTEGER NOT NULL DEFAULT 0, author_result_saved INTEGER NOT NULL DEFAULT 0, hundred_reached INTEGER NOT NULL DEFAULT 0, payment_provider TEXT NOT NULL DEFAULT 'credit' CHECK(payment_provider IN ('credit','fish','coin52')), answer_reference_box TEXT, hidden_winners INTEGER NOT NULL DEFAULT 0 CHECK(hidden_winners BETWEEN 0 AND 9), guess_weights_json TEXT NOT NULL DEFAULT '[10000]', reward_freeze_ai_count INTEGER, close_kind TEXT CHECK(close_kind IN('cancel','vote','force')), close_token TEXT, exclusive_user_id INTEGER REFERENCES users(id), total_cents INTEGER NOT NULL DEFAULT 1 CHECK(total_cents BETWEEN 1 AND CASE WHEN payment_provider='coin52' THEN 500000000 ELSE 200000 END));

CREATE TABLE ldc_awards (
 id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES ldc_packets(packet_id), slot INTEGER NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), recipient_id INTEGER REFERENCES users(id),
 recipient_subject TEXT, recipient_username TEXT,
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','reserved','sent','accepted','unknown','rejected')),
 order_no TEXT NOT NULL UNIQUE, receipt_no TEXT, sent_at INTEGER, checked_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, payment_error TEXT, purpose TEXT NOT NULL DEFAULT 'winner' CHECK(purpose IN('winner','compensation')),
 UNIQUE(packet_id,slot), UNIQUE(packet_id,recipient_id), UNIQUE(packet_id,recipient_subject)
);

CREATE TABLE ldc_questions (
 id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES ldc_packets(packet_id), user_id INTEGER NOT NULL REFERENCES users(id),
 nonce TEXT NOT NULL, question TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'question' CHECK(kind IN ('question','guess')), score INTEGER CHECK(score BETWEEN 0 AND 100), cache_key TEXT, source_message_id INTEGER, source_body TEXT, source_room_id INTEGER REFERENCES guess_room_messages(id),
 UNIQUE(packet_id,user_id,nonce)
);

CREATE TABLE ldc_question_cache (
 packet_id TEXT NOT NULL REFERENCES ldc_packets(packet_id), cache_key TEXT NOT NULL,
 lease TEXT NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','error')),
 verdict TEXT NOT NULL DEFAULT 'pending', score INTEGER CHECK(score BETWEEN 0 AND 99), budget_reserved INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(packet_id,cache_key)
);

CREATE TABLE ldc_word_history (
 group_id INTEGER NOT NULL,
 answer_hash TEXT NOT NULL,
 packet_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(group_id,answer_hash)
) WITHOUT ROWID;

CREATE TABLE ldc_word_history_progress (
 group_id INTEGER PRIMARY KEY,
 last_at INTEGER NOT NULL DEFAULT 0,
 last_id TEXT NOT NULL DEFAULT '',
 complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1))
);

CREATE TABLE guess_room_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 packet_id TEXT NOT NULL REFERENCES chat_redpacks(id),
 group_id INTEGER NOT NULL REFERENCES chat_groups(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 nonce TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 ai_text TEXT,ai_score INTEGER CHECK(ai_score BETWEEN 0 AND 100),
 ai_status TEXT CHECK(ai_status IN('pending','done','error')),
 UNIQUE(packet_id,user_id,nonce)
);

CREATE TABLE guess_free_rounds (
 packet_id TEXT PRIMARY KEY REFERENCES chat_redpacks(id),owner_id INTEGER NOT NULL REFERENCES users(id),
 group_id INTEGER NOT NULL REFERENCES chat_groups(id),mode TEXT NOT NULL CHECK(mode IN('guess','clues')),
 ends_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'open' CHECK(state IN('open','closed')),
 answer_box TEXT NOT NULL,hints_json TEXT NOT NULL DEFAULT '[]',created_at INTEGER NOT NULL,
 game_version INTEGER NOT NULL DEFAULT 1,response_mode TEXT NOT NULL CHECK(response_mode IN('yesno','similarity')),
 answer_length INTEGER NOT NULL,guess_count INTEGER NOT NULL DEFAULT 0,question_count INTEGER NOT NULL DEFAULT 0,
 ai_count INTEGER NOT NULL DEFAULT 0,hints_box TEXT,hints_revealed INTEGER NOT NULL DEFAULT 0,hint_at INTEGER NOT NULL DEFAULT 0,
 room_revision INTEGER NOT NULL DEFAULT 0,generated INTEGER NOT NULL CHECK(generated IN(0,1)),
 winner_id INTEGER REFERENCES users(id),won_at INTEGER
, auto_hint_every INTEGER NOT NULL DEFAULT 0 CHECK(auto_hint_every BETWEEN 0 AND 1000), extra_hints_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(extra_hints_json) AND json_type(extra_hints_json)='array'), owner_participates INTEGER NOT NULL DEFAULT 1 CHECK(owner_participates IN (0,1)), judge_context_box TEXT, hint_source TEXT NOT NULL DEFAULT 'legacy' CHECK(hint_source IN('legacy','ai','preset')), preset_hint_trigger TEXT NOT NULL DEFAULT 'cooldown' CHECK(preset_hint_trigger IN('cooldown','guesses')), hint_cooldown_seconds INTEGER NOT NULL DEFAULT 30 CHECK(hint_cooldown_seconds BETWEEN 1 AND 86400), auto_hint_increment INTEGER NOT NULL DEFAULT 0 CHECK(auto_hint_increment BETWEEN 0 AND 1000), author_rule_version INTEGER NOT NULL DEFAULT 0, author_result_saved INTEGER NOT NULL DEFAULT 0, hundred_reached INTEGER NOT NULL DEFAULT 0, answer_reference_box TEXT, close_kind TEXT CHECK(close_kind IN('cancel','vote')), close_token TEXT);

CREATE TABLE guess_free_questions (
 id TEXT PRIMARY KEY,packet_id TEXT NOT NULL REFERENCES guess_free_rounds(packet_id),user_id INTEGER NOT NULL REFERENCES users(id),
 nonce TEXT NOT NULL,question TEXT NOT NULL,verdict TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('question','guess')),score INTEGER CHECK(score BETWEEN 0 AND 100),cache_key TEXT,
 source_message_id INTEGER REFERENCES chat_messages(id),source_body TEXT,source_room_id INTEGER REFERENCES guess_room_messages(id),
 UNIQUE(packet_id,user_id,nonce)
);

CREATE TABLE guess_free_cache (
 packet_id TEXT NOT NULL REFERENCES guess_free_rounds(packet_id),cache_key TEXT NOT NULL,lease TEXT NOT NULL,expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','done','error')),verdict TEXT NOT NULL DEFAULT 'pending',score INTEGER CHECK(score BETWEEN 0 AND 99), budget_reserved INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(packet_id,cache_key)
);

CREATE TABLE guess_wins(packet_id TEXT PRIMARY KEY REFERENCES chat_redpacks(id),user_id INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);

CREATE TABLE guess_group_stats (group_id INTEGER NOT NULL REFERENCES chat_groups(id), day TEXT NOT NULL, rounds INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(group_id,day));

CREATE TABLE guess_group_player_stats (group_id INTEGER NOT NULL REFERENCES chat_groups(id), day TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), wins INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(group_id,day,user_id));

CREATE TABLE chat_title_raffles (
  id TEXT PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id),
  creator_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(title IN ('mona','lace','giant','worship','muscle','deepseek','maid','whalepunch','nightdevil','whalebuddy','gpt','claude','gemini','whitedragon','deepseekupgrade')),
  entry_mode TEXT NOT NULL CHECK(entry_mode IN ('optin','all')),
  packet_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closing','drawn','empty','cancelled')),
  winner_id INTEGER REFERENCES users(id),
  claim_token TEXT UNIQUE,
  drawn_at INTEGER, paid_version INTEGER NOT NULL DEFAULT 0 CHECK(paid_version IN (0,1)),
  CHECK(group_id=1),
  CHECK(closes_at>created_at),
  CHECK(packet_id IS NULL OR entry_mode='optin')
);

CREATE TABLE chat_title_raffle_entries (
  raffle_id TEXT NOT NULL REFERENCES chat_title_raffles(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL, boosts INTEGER NOT NULL DEFAULT 0 CHECK(boosts BETWEEN 0 AND 20), paid INTEGER NOT NULL DEFAULT 0 CHECK(paid BETWEEN 0 AND 2100), result INTEGER CHECK(result IN (0,1,2)), result_token TEXT, refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded IN (0,1)),
  PRIMARY KEY(raffle_id,user_id)
) WITHOUT ROWID;

CREATE TABLE packet_luck_jobs(packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id),due_at INTEGER NOT NULL);

CREATE TABLE packet_luck_settlements(packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id),settled_at INTEGER NOT NULL);

CREATE TABLE packet_luck_wins(
 packet_id TEXT NOT NULL REFERENCES packet_luck_settlements(packet_id),user_id INTEGER NOT NULL REFERENCES users(id),
 badge TEXT NOT NULL CHECK(badge IN('luck_king','luck_last')),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),created_at INTEGER NOT NULL,
 PRIMARY KEY(packet_id,user_id,badge)
);

CREATE TABLE packet_sender_stats(
 group_id INTEGER NOT NULL REFERENCES chat_groups(id),day TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),
 packets INTEGER NOT NULL DEFAULT 0,declared_cents INTEGER NOT NULL DEFAULT 0,paid_cents INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT 0,paid_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(group_id,day,user_id)
);

CREATE TABLE packet_sender_paid_events(
 award_id TEXT PRIMARY KEY REFERENCES ldc_awards(id),packet_id TEXT NOT NULL REFERENCES ldc_packets(packet_id),
 amount_cents INTEGER NOT NULL,confirmed_at INTEGER NOT NULL
);

CREATE TABLE chat_activity_stats(
 group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
 day TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),messages INTEGER NOT NULL CHECK(messages>=0),
 first_at INTEGER,last_at INTEGER,PRIMARY KEY(group_id,day,user_id)
);

CREATE TABLE rank_settlements(
 group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,board TEXT NOT NULL,
 period TEXT NOT NULL,day TEXT NOT NULL,cutoff INTEGER NOT NULL,settled_at INTEGER NOT NULL,token TEXT NOT NULL,
 PRIMARY KEY(group_id,board,period,day),CHECK(cutoff<=settled_at)
);

CREATE TABLE rank_placements(
 group_id INTEGER NOT NULL,board TEXT NOT NULL,period TEXT NOT NULL,day TEXT NOT NULL,
 place INTEGER NOT NULL CHECK(place BETWEEN 1 AND 3),user_id INTEGER NOT NULL REFERENCES users(id),
 score INTEGER NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(group_id,board,period,day,place),UNIQUE(group_id,board,period,day,user_id),
 FOREIGN KEY(group_id,board,period,day) REFERENCES rank_settlements(group_id,board,period,day) ON DELETE CASCADE
);

CREATE TABLE rank_reward_catalog(series TEXT NOT NULL,level INTEGER NOT NULL,threshold INTEGER NOT NULL,name TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(series,level));

CREATE TABLE chat_podium_totals(
 group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
 board TEXT NOT NULL CHECK(board IN('chat_early','chat_late')),
 user_id INTEGER NOT NULL REFERENCES users(id),n INTEGER NOT NULL CHECK(n>0),
 PRIMARY KEY(group_id,board,user_id)
);

CREATE TABLE web_push_subscriptions (
 id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,
 next_check_at INTEGER NOT NULL,
 last_message_id INTEGER NOT NULL DEFAULT 0,
 failures INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);

CREATE TABLE farm_saves (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(json_valid(state)),
 updated_at INTEGER NOT NULL
, owner_operated_at INTEGER NOT NULL DEFAULT 0);

CREATE TABLE upload_operations (
 user_id INTEGER NOT NULL REFERENCES users(id),
 nonce TEXT NOT NULL,
 key TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','ready','deleting')),
 lease_token TEXT NOT NULL DEFAULT '',
 lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 cleanup_after INTEGER NOT NULL,
 PRIMARY KEY(user_id,nonce)
);

CREATE TABLE guess_answer_explanations (
 packet_id TEXT PRIMARY KEY REFERENCES chat_redpacks(id) ON DELETE CASCADE,
 notice_id INTEGER NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','running','done')),
 text TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL, lease TEXT NOT NULL DEFAULT ''
);

CREATE TABLE rank_digest_queue (
 group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
 day TEXT NOT NULL, next_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','done')),
 PRIMARY KEY(group_id,day)
);

CREATE TABLE dm_media_access (
 key TEXT PRIMARY KEY REFERENCES uploads(key),
 message_id INTEGER NOT NULL REFERENCES dm_messages(id)
) WITHOUT ROWID;

CREATE TABLE guess_queue (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 group_id INTEGER NOT NULL REFERENCES chat_groups(id),
 owner_id INTEGER NOT NULL REFERENCES users(id),
 state TEXT NOT NULL CHECK(state IN('draft','queued','starting','started','failed','cancelled')),
 ticket INTEGER,
 config_box TEXT NOT NULL,
 reward_type TEXT NOT NULL CHECK(reward_type IN('ldc','none')),
 amount_cents INTEGER NOT NULL DEFAULT 0,
 automatic INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 lease TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 message_id INTEGER REFERENCES chat_messages(id)
, payment_provider TEXT NOT NULL DEFAULT 'credit' CHECK(payment_provider IN ('credit','fish','coin52')));

CREATE TABLE guess_reward_increases (
 packet_id TEXT NOT NULL REFERENCES ldc_packets(packet_id),stage INTEGER NOT NULL,
 added_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(packet_id,stage)
) WITHOUT ROWID;

CREATE TABLE guess_author_policies (
 owner_id INTEGER PRIMARY KEY REFERENCES users(id),bad_streak INTEGER NOT NULL DEFAULT 0,
 good_streak INTEGER NOT NULL DEFAULT 0,restricted INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL
);

CREATE TABLE guess_author_results (
 packet_id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),
 hundred_reached INTEGER NOT NULL,early_win INTEGER NOT NULL,created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE guess_rate_participants(packet_id TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(packet_id,user_id));

CREATE TABLE guess_rate_rounds(packet_id TEXT PRIMARY KEY,group_id INTEGER NOT NULL REFERENCES chat_groups(id),day TEXT NOT NULL,ended_at INTEGER NOT NULL,winner_id INTEGER REFERENCES users(id),origin TEXT NOT NULL CHECK(origin IN('history','live')));

CREATE TABLE guess_rate_stats(group_id INTEGER NOT NULL REFERENCES chat_groups(id),day TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),rounds INTEGER NOT NULL CHECK(rounds>0),wins INTEGER NOT NULL CHECK(wins>=0 AND wins<=rounds),rate REAL GENERATED ALWAYS AS (1.0*wins/rounds) STORED,PRIMARY KEY(group_id,day,user_id));

CREATE TABLE guess_rate_exclusions(packet_id TEXT PRIMARY KEY,group_id INTEGER NOT NULL,reason TEXT NOT NULL);

CREATE TABLE guess_rate_coverage(group_id INTEGER PRIMARY KEY,since INTEGER,rounds INTEGER NOT NULL DEFAULT 0,excluded INTEGER NOT NULL DEFAULT 0);

CREATE TABLE "rank_settlement_jobs"(
 group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
 board TEXT NOT NULL CHECK(board IN('guess','guess_winrate','sender_count','sender_paid','chat_count','chat_early','chat_late')),
 period TEXT NOT NULL CHECK(period IN('day','all')),next_at INTEGER NOT NULL,
 PRIMARY KEY(group_id,board,period)
);

CREATE TABLE guess_review_batches (
 id TEXT PRIMARY KEY,
 packet_id TEXT NOT NULL REFERENCES chat_redpacks(id) ON DELETE CASCADE,
 reward_type TEXT NOT NULL CHECK(reward_type IN ('ldc','none')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','failed')),
 lease TEXT, locked_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL, completed_at INTEGER,
 model TEXT, error_code TEXT
);

CREATE TABLE guess_review_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 packet_id TEXT NOT NULL REFERENCES chat_redpacks(id) ON DELETE CASCADE,
 reward_type TEXT NOT NULL CHECK(reward_type IN ('ldc','none')),
 cache_key TEXT NOT NULL, question_id TEXT NOT NULL, question TEXT NOT NULL, kind TEXT NOT NULL,
 original_verdict TEXT NOT NULL, original_score INTEGER,
 batch_id TEXT REFERENCES guess_review_batches(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','verified','corrected','uncertain','stale')),
 verdict TEXT, score INTEGER, created_at INTEGER NOT NULL, reviewed_at INTEGER,
 UNIQUE(packet_id,reward_type,cache_key)
);

CREATE TABLE coin52_wallets (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9007199254740991),
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);

CREATE TABLE coin52_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 ref TEXT NOT NULL,
 attempt TEXT NOT NULL,
 delta INTEGER NOT NULL,
 balance_after INTEGER NOT NULL CHECK(balance_after BETWEEN 0 AND 9007199254740991),
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,kind,ref),
 UNIQUE(user_id,attempt)
);

CREATE TABLE farm_migrations (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 version TEXT NOT NULL,
 original_revision INTEGER NOT NULL,
 original_state TEXT NOT NULL CHECK(json_valid(original_state)),
 imported_coins INTEGER NOT NULL,
 compensation INTEGER NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);

CREATE TABLE title_awards (
 user_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 source TEXT NOT NULL,
 created_at INTEGER NOT NULL, levels INTEGER NOT NULL DEFAULT 1 CHECK(levels BETWEEN 1 AND 5200),
 PRIMARY KEY(user_id,title,source)
) WITHOUT ROWID;

CREATE TABLE instant_card_pools (
 title TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL REFERENCES users(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE instant_card_fingers (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
 updated_at INTEGER NOT NULL
);

CREATE TABLE fish_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), client_id TEXT NOT NULL UNIQUE,
 secret_box TEXT NOT NULL, subject TEXT NOT NULL, username TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE packet_draws(packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id),draw_at INTEGER NOT NULL,settled_at INTEGER);

CREATE TABLE packet_draw_entries(packet_id TEXT NOT NULL REFERENCES packet_draws(packet_id),user_id INTEGER NOT NULL REFERENCES users(id),subject TEXT NOT NULL,username TEXT NOT NULL,priority TEXT NOT NULL,entered_at INTEGER NOT NULL,PRIMARY KEY(packet_id,user_id),UNIQUE(packet_id,subject));

CREATE TABLE packet_events(id INTEGER PRIMARY KEY AUTOINCREMENT,packet_id TEXT NOT NULL REFERENCES ldc_packets(packet_id),user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('joined','result')),body TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(packet_id,user_id,kind));

CREATE TABLE packet_notice_jobs(packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id),due_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0);

CREATE TABLE packet_coin_escrows(packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id),owner_id INTEGER NOT NULL REFERENCES users(id),reserved INTEGER NOT NULL CHECK(reserved>0),remaining INTEGER NOT NULL CHECK(remaining>=0 AND remaining<=reserved),created_at INTEGER NOT NULL,refunded_at INTEGER);

CREATE TABLE chat_message_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id),
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,message_id)
);

CREATE TABLE farm_guest_visits (
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 visited_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,actor_id)
);

CREATE TABLE guess_reference_preparations (
 packet_id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 lease TEXT NOT NULL,
 lease_until INTEGER NOT NULL,
 result_box TEXT,
 expires_at INTEGER NOT NULL
);

CREATE TABLE activity_honor_events(
 event_key TEXT NOT NULL,
 user_id INTEGER NOT NULL REFERENCES users(id),
 series TEXT NOT NULL CHECK(series IN('guess_pressure','guess_tormentor','guess_firstshot','guess_easy')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(event_key,user_id,series)
);

CREATE TABLE content_coin_rewards(
 source TEXT NOT NULL CHECK(source IN('post','road')),
 content_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL REFERENCES users(id),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','paid','skipped')),
 amount INTEGER NOT NULL DEFAULT 0 CHECK(amount IN(0,20,52,100)),
 available_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 granted_at INTEGER,
 batch_key TEXT,
 PRIMARY KEY(source,content_id)
);

CREATE TABLE guess_close_votes (
 packet_id TEXT PRIMARY KEY REFERENCES chat_redpacks(id),
 created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','passed','expired','superseded'))
);

CREATE TABLE guess_close_electors (
 packet_id TEXT NOT NULL REFERENCES guess_close_votes(packet_id), user_id INTEGER NOT NULL REFERENCES users(id),
 choice INTEGER CHECK(choice IN(0,1)), voted_at INTEGER,
 PRIMARY KEY(packet_id,user_id)
) WITHOUT ROWID;

CREATE TABLE fish_capacity_versions(owner_id INTEGER PRIMARY KEY REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 0);

CREATE TABLE fish_capacity_checks(owner_id INTEGER NOT NULL,expected_revision INTEGER NOT NULL);

CREATE TABLE fish_packet_capacity(
 packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id) ON DELETE CASCADE,
 owner_id INTEGER NOT NULL,client_id TEXT NOT NULL,ends_at INTEGER NOT NULL,
 reserved_cents INTEGER NOT NULL CHECK(reserved_cents>=0),unpaid_cents INTEGER NOT NULL CHECK(unpaid_cents>=0)
);

CREATE TABLE guess_tips (
 id TEXT PRIMARY KEY,
 packet_id TEXT NOT NULL REFERENCES chat_redpacks(id),
 sender_id INTEGER NOT NULL REFERENCES users(id),
 recipient_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 10000),
 attempt TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 CHECK(sender_id<>recipient_id)
);

CREATE TABLE farm_loss_totals(user_id INTEGER PRIMARY KEY REFERENCES users(id),crops INTEGER NOT NULL DEFAULT 0,products INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0);

CREATE TABLE instant_card_progress (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 pity INTEGER NOT NULL DEFAULT 0 CHECK(pity BETWEEN 0 AND 119),
 draws INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE huancai_rounds (
 day TEXT PRIMARY KEY, closes_at INTEGER NOT NULL, special INTEGER NOT NULL CHECK(special IN(0,1)),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN('open','drawing','paid')),
 tickets INTEGER NOT NULL DEFAULT 0, sales INTEGER NOT NULL DEFAULT 0,
 front TEXT, back TEXT, weight_total INTEGER, pool INTEGER, token TEXT, settled_at INTEGER
, rules_version INTEGER NOT NULL DEFAULT 1, prize_counts TEXT, pool_paid INTEGER NOT NULL DEFAULT 0 CHECK(pool_paid>=0 AND (pool IS NULL OR pool_paid<=pool)), pool_returned INTEGER NOT NULL DEFAULT 0 CHECK(pool_returned>=0)) WITHOUT ROWID;

CREATE TABLE huancai_usage (
 user_id INTEGER NOT NULL REFERENCES users(id),day TEXT NOT NULL,
 lotto_count INTEGER NOT NULL DEFAULT 0,scratch_spent INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day)
) WITHOUT ROWID;

CREATE TABLE huancai_orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('lotto','scratch')),signature TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),
 payload TEXT NOT NULL CHECK(json_valid(payload)),attempt TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,
 UNIQUE(user_id,request_id)
);

CREATE TABLE huancai_tickets (
 id TEXT PRIMARY KEY,day TEXT NOT NULL REFERENCES huancai_rounds(day),user_id INTEGER NOT NULL REFERENCES users(id),
 front TEXT NOT NULL,back TEXT NOT NULL,created_at INTEGER NOT NULL,
 weight INTEGER,payout INTEGER,settled_at INTEGER,attempt TEXT UNIQUE
) WITHOUT ROWID;

CREATE TABLE "farm_visits" (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 cycle TEXT NOT NULL,
 plot INTEGER NOT NULL CHECK(plot BETWEEN 0 AND 59),
 kind TEXT NOT NULL CHECK(kind IN ('steal','water')),
 crop TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount IN (0,1)),
 created_at INTEGER NOT NULL,
 CHECK(actor_id<>owner_id),
 UNIQUE(actor_id,request_id),
 UNIQUE(owner_id,cycle,kind)
);

CREATE TABLE "farm_ranch_visits" (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 cycle TEXT NOT NULL,
 plot INTEGER NOT NULL CHECK(plot BETWEEN 0 AND 23),
 kind TEXT NOT NULL CHECK(kind IN ('animal_steal')),
 crop TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount = 1),
 created_at INTEGER NOT NULL,
 CHECK(actor_id<>owner_id),
 UNIQUE(actor_id,request_id),
 UNIQUE(owner_id,cycle,kind)
);

CREATE TABLE "farm_lease_offers" (
 owner_id INTEGER NOT NULL REFERENCES users(id),
 plot INTEGER NOT NULL CHECK(plot BETWEEN 0 AND 59),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 10000),
 days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 7),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,plot)
);

CREATE TABLE "farm_leases" (
 id TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL REFERENCES users(id),
 tenant_id INTEGER NOT NULL REFERENCES users(id),
 plot INTEGER NOT NULL CHECK(plot BETWEEN 0 AND 59),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 10000),
 started_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 forced INTEGER NOT NULL CHECK(forced IN(0,1)),
 state TEXT NOT NULL CHECK(state IN('active','ended')),
 crop_state TEXT NOT NULL CHECK(json_valid(crop_state)),
 revision INTEGER NOT NULL DEFAULT 0,
 attempt TEXT NOT NULL UNIQUE,
 CHECK(owner_id<>tenant_id)
);

CREATE TABLE "farm_lease_actions" (
 lease_id TEXT NOT NULL REFERENCES "farm_leases"(id),
 request_id TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id),
 attempt TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(lease_id,request_id)
);

CREATE TABLE farm_action_limits (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 minute INTEGER NOT NULL,
 units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 360)
);

CREATE TABLE farm_market_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 remainder_cents INTEGER NOT NULL DEFAULT 0 CHECK(remainder_cents BETWEEN 0 AND 99),
 revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);

CREATE TABLE farm_market_goods (
 item TEXT PRIMARY KEY,
 base_cents INTEGER NOT NULL CHECK(base_cents>0),
 price_cents INTEGER NOT NULL CHECK(price_cents>0),
 fresh_qty INTEGER NOT NULL DEFAULT 0 CHECK(fresh_qty>=0),
 sold_flow INTEGER NOT NULL DEFAULT 0 CHECK(sold_flow>=0),
 bought_flow INTEGER NOT NULL DEFAULT 0 CHECK(bought_flow>=0),
 split_carry INTEGER NOT NULL DEFAULT 0 CHECK(split_carry BETWEEN 0 AND 9),
 tick_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0
, fresh_seconds INTEGER NOT NULL DEFAULT 0, fresh_at INTEGER NOT NULL DEFAULT 0, effective_qty INTEGER);

CREATE TABLE farm_market_lots (
 id TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL CHECK(owner_id>=0), -- 0 is the public shop
 item TEXT NOT NULL REFERENCES farm_market_goods(item),
 source TEXT NOT NULL CHECK(source IN ('grown','stolen','market')),
 quantity INTEGER NOT NULL CHECK(quantity>=0),
 locked_quantity INTEGER NOT NULL DEFAULT 0 CHECK(locked_quantity>=0 AND locked_quantity<=quantity),
 born_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>born_at),
 cooldown_until INTEGER NOT NULL DEFAULT 0,
 expired INTEGER NOT NULL DEFAULT 0 CHECK(expired IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(owner_id,item,source,born_at,expires_at,cooldown_until,expired)
);

CREATE TABLE farm_market_receipts (
 user_id INTEGER NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL,
 item TEXT,
 quantity INTEGER NOT NULL DEFAULT 0,
 total_cents INTEGER NOT NULL DEFAULT 0,
 result TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id)
);

CREATE TABLE farm_market_ticks (
 item TEXT NOT NULL,
 tick_at INTEGER NOT NULL,
 price_cents INTEGER NOT NULL,
 fresh_qty INTEGER NOT NULL,
 sold INTEGER NOT NULL,
 bought INTEGER NOT NULL, effective_qty INTEGER,
 PRIMARY KEY(item,tick_at)
);

CREATE TABLE farm_conflict_members (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 stance TEXT NOT NULL DEFAULT 'patrol' CHECK(stance IN ('patrol','barrier','decoy')),
 joined_at INTEGER NOT NULL,
 protected_until INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE farm_conflict_stakes (
 lot_id TEXT PRIMARY KEY REFERENCES farm_market_lots(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 quantity INTEGER NOT NULL CHECK(quantity>0),
 revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE farm_conflict_budgets (
 user_id INTEGER NOT NULL REFERENCES users(id),
 day INTEGER NOT NULL,
 limit_cents INTEGER NOT NULL CHECK(limit_cents>=0),
 reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents>=0 AND reserved_cents<=limit_cents),
 PRIMARY KEY(user_id,day)
);

CREATE TABLE farm_conflicts (
 id TEXT PRIMARY KEY,
 attacker_id INTEGER NOT NULL REFERENCES users(id),
 defender_id INTEGER NOT NULL REFERENCES users(id),
 lot_id TEXT NOT NULL,
 item TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 loot_cents INTEGER NOT NULL CHECK(loot_cents>0 AND loot_cents<=5000),
 bond INTEGER NOT NULL CHECK(bond>0),
 attack_tools INTEGER NOT NULL CHECK(attack_tools BETWEEN 0 AND 5),
 defense_tools INTEGER NOT NULL DEFAULT 0 CHECK(defense_tools BETWEEN 0 AND 5),
 tactic TEXT NOT NULL CHECK(tactic IN ('sneak','rush','lure')),
 stance TEXT NOT NULL CHECK(stance IN ('patrol','barrier','decoy')),
 guardian INTEGER NOT NULL DEFAULT 0 CHECK(guardian IN (0,1)),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
 roll INTEGER NOT NULL CHECK(roll BETWEEN 0 AND 999999),
 roll_nonce TEXT NOT NULL,
 commitment TEXT NOT NULL,
 chance REAL,
 status TEXT NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','failed','escrow','uprising','claimable','claimed','recovered')),
 starts_at INTEGER NOT NULL,
 resolves_at INTEGER NOT NULL,
 release_at INTEGER NOT NULL DEFAULT 0,
 settled_at INTEGER,
 revision INTEGER NOT NULL DEFAULT 0,
 CHECK(attacker_id<>defender_id)
);

CREATE TABLE farm_uprisings (
 battle_id TEXT PRIMARY KEY REFERENCES farm_conflicts(id),
 closes_at INTEGER NOT NULL,
 roll INTEGER NOT NULL CHECK(roll BETWEEN 0 AND 999999),
 roll_nonce TEXT NOT NULL,
 commitment TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'forming' CHECK(status IN ('forming','won','lost','insufficient')),
 chance REAL,
 revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE farm_uprising_members (
 battle_id TEXT NOT NULL REFERENCES farm_uprisings(battle_id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 joined_at INTEGER NOT NULL,
 PRIMARY KEY(battle_id,user_id)
);

CREATE TABLE farm_conflict_receipts (
 user_id INTEGER NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 result TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id)
);

CREATE TABLE farm_conflict_events (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id),
 actor_id INTEGER NOT NULL REFERENCES users(id),
 battle_id TEXT NOT NULL REFERENCES farm_conflicts(id),
 phase TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,battle_id,phase)
);

CREATE TABLE title_trials (
 user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5200), expires_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,title)
) WITHOUT ROWID;

CREATE TABLE instant_card_limited_progress (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), pity INTEGER NOT NULL DEFAULT 0 CHECK(pity BETWEEN 0 AND 119),
 draws INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE community_progress (
 user_id INTEGER NOT NULL REFERENCES users(id), metric TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,metric)
) WITHOUT ROWID;

CREATE TABLE huancai_jackpot (
 id INTEGER PRIMARY KEY CHECK(id=1),
 seed INTEGER NOT NULL DEFAULT 500000000 CHECK(seed=500000000),
 available INTEGER NOT NULL DEFAULT 500000000 CHECK(available BETWEEN 0 AND 9007199254740991),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND 9007199254740991),
 contributed INTEGER NOT NULL DEFAULT 0 CHECK(contributed BETWEEN 0 AND 9007198754740991),
 paid INTEGER NOT NULL DEFAULT 0 CHECK(paid BETWEEN 0 AND 9007199254740991),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, topups INTEGER NOT NULL DEFAULT 0 CHECK(topups>=0),
 CHECK(available+reserved+paid=seed+contributed)
);

CREATE TABLE farm_market_imports(
 user_id INTEGER PRIMARY KEY,
 original_state TEXT NOT NULL,
 migrated_state TEXT NOT NULL,
 source_revision INTEGER NOT NULL,
 quantities TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);

CREATE TABLE farm_market_supply_grants(
 id TEXT PRIMARY KEY,
 item TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 base_cents INTEGER NOT NULL CHECK(base_cents>0),
 born_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>born_at)
);

CREATE TABLE guess_prediction_pools (
 packet_id TEXT PRIMARY KEY, currency TEXT NOT NULL CHECK(currency IN('coin52','ldc')),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN('open','settled','refunded')),
 winner_id INTEGER, created_at INTEGER NOT NULL, settled_at INTEGER, revision INTEGER NOT NULL DEFAULT 0, settlement_token TEXT
, ldc_mode TEXT CHECK(ldc_mode IN ('simulated','fish')), next_check_at INTEGER NOT NULL DEFAULT 0);

CREATE TABLE guess_prediction_bets (
 id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES guess_prediction_pools(packet_id),
 user_id INTEGER NOT NULL REFERENCES users(id), target_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount>0), created_at INTEGER NOT NULL,
 result_amount INTEGER, result_kind TEXT, settled_at INTEGER,
 UNIQUE(packet_id,user_id), CHECK(user_id<>target_id)
);

CREATE TABLE guess_simulated_ldc_wallets(user_id INTEGER PRIMARY KEY REFERENCES users(id),balance INTEGER NOT NULL CHECK(balance>=0));

CREATE TABLE guess_prediction_ledger(
 ref TEXT PRIMARY KEY,user_id INTEGER NOT NULL,currency TEXT NOT NULL,delta INTEGER NOT NULL,created_at INTEGER NOT NULL
);

CREATE TABLE guess_fish_pools (
 packet_id TEXT PRIMARY KEY REFERENCES guess_prediction_pools(packet_id),
 custodian_id INTEGER NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
 subject TEXT NOT NULL, username TEXT NOT NULL, allocated_at INTEGER, refund INTEGER
);

CREATE TABLE guess_fish_orders (
 order_no TEXT PRIMARY KEY, bet_id TEXT NOT NULL REFERENCES guess_prediction_bets(id),
 kind TEXT NOT NULL CHECK(kind IN ('collect','return')),
 payer_id INTEGER NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
 payer_subject TEXT NOT NULL, payer_username TEXT NOT NULL,
 recipient_subject TEXT NOT NULL, recipient_username TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','sending','unknown','accepted','rejected')),
 receipt TEXT, error TEXT, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(bet_id,kind)
);

CREATE TABLE guess_login_codes(code_hash TEXT PRIMARY KEY,state_hash TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,claim TEXT);

CREATE TABLE guess_sidebar_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,nonce TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0, system_kind TEXT, system_ref TEXT, system_data TEXT,UNIQUE(user_id,nonce));

CREATE TABLE user_ai_configs (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), revision TEXT NOT NULL,
 name TEXT NOT NULL, base TEXT NOT NULL, model TEXT NOT NULL, key_box TEXT NOT NULL,
 prompt TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), updated_at INTEGER NOT NULL
);

CREATE TABLE user_ai_consents (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 room_id TEXT NOT NULL, config_revision TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('host','player')),
 max_calls INTEGER NOT NULL CHECK(max_calls BETWEEN 1 AND 300), used_calls INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE user_ai_calls (
 id TEXT PRIMARY KEY, consent_id TEXT NOT NULL REFERENCES user_ai_consents(id),
 task TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','done','error')),
 result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE game_word_pairs (
 id TEXT PRIMARY KEY, ordinary TEXT NOT NULL, undercover TEXT NOT NULL,
 source TEXT NOT NULL, source_url TEXT, license TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);

CREATE TABLE game_ai_samples (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 model TEXT NOT NULL, prompt_hash TEXT NOT NULL, task TEXT NOT NULL, body TEXT NOT NULL,
 features TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE game_word_candidates (
 id TEXT PRIMARY KEY, word TEXT NOT NULL, packet_id TEXT NOT NULL, source_kind TEXT NOT NULL,
 created_at INTEGER NOT NULL
);

CREATE TABLE game_room_directory(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),mode TEXT NOT NULL CHECK(mode IN ('drawing','arena')),ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),created_at INTEGER NOT NULL);

CREATE TABLE game_style_rules(pattern TEXT PRIMARY KEY,added_by INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);

CREATE TABLE guess_meme_draws(user_id INTEGER NOT NULL REFERENCES users(id),meme_id INTEGER NOT NULL REFERENCES memes(id),created_at INTEGER NOT NULL,PRIMARY KEY(user_id,meme_id));

CREATE TABLE novel_reading_progress (
 user_id INTEGER NOT NULL REFERENCES users(id), book_id TEXT NOT NULL,
 chapter INTEGER NOT NULL, paragraph INTEGER NOT NULL DEFAULT 0, offset REAL NOT NULL DEFAULT 0,
 settings TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,book_id)
);

CREATE TABLE novel_works (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 premise TEXT NOT NULL DEFAULT '', characters TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'write',
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE novel_draft_chapters (
 work_id TEXT NOT NULL REFERENCES novel_works(id) ON DELETE CASCADE, id INTEGER NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
 PRIMARY KEY(work_id,id)
);

CREATE TABLE novel_ai_calls (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), state TEXT NOT NULL,
 result TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE farm_outings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER NOT NULL REFERENCES users(id), owner_id INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, attempt TEXT NOT NULL UNIQUE,
 mode TEXT NOT NULL CHECK(mode IN ('normal','sneak')), place TEXT NOT NULL CHECK(place IN ('home','ranch')),
 fee INTEGER NOT NULL CHECK(fee>=0), result TEXT NOT NULL CHECK(json_valid(result)), created_at INTEGER NOT NULL,
 CHECK(actor_id<>owner_id), UNIQUE(actor_id,request_id)
);

CREATE TABLE guess_word_archive_jobs(
 store TEXT NOT NULL CHECK(store IN ('ldc','none')), packet_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','skipped','error','failed')),
 next_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 PRIMARY KEY(store,packet_id)
);

CREATE TABLE resource_posts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('project','film','link')),
 title TEXT NOT NULL, body TEXT NOT NULL, share_url TEXT NOT NULL DEFAULT '', film_code TEXT NOT NULL DEFAULT '',
 media TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media)), cover_url TEXT NOT NULL DEFAULT '',
 hidden INTEGER NOT NULL DEFAULT 0, approvals INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(user_id,request_id)
);

CREATE TABLE resource_marks (
 user_id INTEGER NOT NULL REFERENCES users(id), post_id INTEGER NOT NULL REFERENCES resource_posts(id),
 checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN(0,1)), favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN(0,1)),
 approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN(0,1)), reaction TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,post_id)
);

CREATE TABLE resource_recognition (
 post_id INTEGER NOT NULL REFERENCES resource_posts(id), user_id INTEGER NOT NULL REFERENCES users(id),
 author_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY(post_id,user_id)
);

CREATE TABLE resource_comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES resource_posts(id),
 user_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, body TEXT NOT NULL,
 hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(user_id,request_id)
);

CREATE TABLE resource_metadata_cache(code TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE resource_metadata_limits(user_id INTEGER PRIMARY KEY, minute INTEGER NOT NULL, calls INTEGER NOT NULL);

CREATE TABLE huancai_weekly (
 week TEXT PRIMARY KEY, closes_at INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN('natural','ticket','free')),
 user_id INTEGER REFERENCES users(id), ticket_id TEXT, payout INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, CHECK((mode='natural' AND payout=0) OR (user_id IS NOT NULL AND payout>0))
);

CREATE TABLE coin52_grant_batches(id TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount=100000), created_at INTEGER NOT NULL);

CREATE TABLE coin52_grant_recipients(batch_id TEXT NOT NULL REFERENCES coin52_grant_batches(id),user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(batch_id,user_id));

CREATE TABLE guess_luckybag_config (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 sponsor_id INTEGER NOT NULL REFERENCES users(id), probability_bps INTEGER NOT NULL CHECK(probability_bps BETWEEN 0 AND 10000),
 min_total INTEGER NOT NULL CHECK(min_total BETWEEN 1 AND 1000), max_total INTEGER NOT NULL CHECK(max_total BETWEEN min_total AND 1000),
 activated_at INTEGER NOT NULL
);

CREATE TABLE guess_luckybags (
 packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id), sponsor_id INTEGER NOT NULL REFERENCES users(id),
 probability_bps INTEGER NOT NULL, min_total INTEGER NOT NULL, max_total INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','scheduled','skipped','open','closing','allocating','settled','refunded')),
 total INTEGER NOT NULL DEFAULT 0 CHECK(total BETWEEN 0 AND 1000), remaining INTEGER NOT NULL DEFAULT 0 CHECK(remaining BETWEEN 0 AND total),
 due_at INTEGER, funded_at INTEGER, ended_at INTEGER, settled_at INTEGER, reason TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE guess_luckybag_candidates (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, packet_id TEXT NOT NULL REFERENCES guess_luckybags(packet_id),
 user_id INTEGER NOT NULL REFERENCES users(id), qualified_at INTEGER NOT NULL, UNIQUE(packet_id,user_id)
);

CREATE TABLE guess_luckybag_allocations (
 packet_id TEXT NOT NULL REFERENCES guess_luckybags(packet_id), user_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000), paid_at INTEGER, PRIMARY KEY(packet_id,user_id)
);

CREATE TABLE site_release_notices (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 release_key TEXT NOT NULL UNIQUE,
 worker_version TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at INTEGER NOT NULL
);

CREATE TABLE farm_lease_batches (
 user_id INTEGER NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 result TEXT NOT NULL CHECK(json_valid(result)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id)
);

CREATE TABLE farm_lease_buybacks (
 lease_id TEXT PRIMARY KEY REFERENCES farm_leases(id),
 owner_id INTEGER NOT NULL REFERENCES users(id),tenant_id INTEGER NOT NULL REFERENCES users(id),
 plot INTEGER NOT NULL,request_id TEXT NOT NULL,attempt TEXT NOT NULL UNIQUE,
 penalty INTEGER NOT NULL CHECK(penalty>0),reward INTEGER NOT NULL CHECK(reward>=0),
 crop_state TEXT NOT NULL,created_at INTEGER NOT NULL,cooldown_until INTEGER NOT NULL,
 UNIQUE(owner_id,request_id)
);

CREATE TABLE farm_farewell_batches (
 id TEXT PRIMARY KEY,closes_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'settling' CHECK(status IN('settling','complete')),completed_at INTEGER
);

CREATE TABLE farm_farewell_recipients (
 batch_id TEXT NOT NULL REFERENCES farm_farewell_batches(id),user_id INTEGER NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','paid','skipped')),
 asset_coins INTEGER NOT NULL DEFAULT 0,bonus INTEGER NOT NULL DEFAULT 100000,
 details TEXT,state_snapshot TEXT,save_revision INTEGER,wallet_revision INTEGER,
 attempt TEXT UNIQUE,paid_at INTEGER,retry_at INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(batch_id,user_id)
);

CREATE TABLE farm_farewell_prices (
 batch_id TEXT NOT NULL REFERENCES farm_farewell_batches(id),item TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>0),
 PRIMARY KEY(batch_id,item)
);

CREATE TABLE main_activation_receipts(user_id INTEGER PRIMARY KEY REFERENCES users(id),code TEXT NOT NULL UNIQUE,activated_at INTEGER NOT NULL);

CREATE TABLE farm_lease_recoveries (
 lease_id TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL,
 tenant_id INTEGER NOT NULL,
 plot INTEGER NOT NULL,
 rent_refund INTEGER NOT NULL CHECK(rent_refund>=0),
 crop_coins INTEGER NOT NULL CHECK(crop_coins>=0),
 crop_state TEXT NOT NULL CHECK(json_valid(crop_state)),
 created_at INTEGER NOT NULL,
 CHECK(owner_id<>tenant_id),
 CHECK(plot>=0 AND plot<60),
 CHECK(typeof(rent_refund)='integer' AND typeof(crop_coins)='integer')
);

CREATE TABLE music_playlist_tracks (
 list TEXT NOT NULL CHECK(list IN ('owner','friends')),
 track_key TEXT NOT NULL,
 metadata TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(list,track_key)
);

CREATE TABLE music_recommendations (
 list TEXT NOT NULL,
 track_key TEXT NOT NULL,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(list,track_key,user_id),
 FOREIGN KEY(list,track_key) REFERENCES music_playlist_tracks(list,track_key) ON DELETE CASCADE
);

CREATE TABLE slime_saves (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(json_valid(state)),
 state_hash TEXT NOT NULL,
 operation TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);

CREATE TABLE random_image_gate (
 id INTEGER PRIMARY KEY CHECK(id=1),
 window_start INTEGER NOT NULL DEFAULT 0,
 requests INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0,
 paused_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE coin52_wealth (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 earned INTEGER NOT NULL DEFAULT 0 CHECK(earned>=0),
 updated_at INTEGER NOT NULL
);

CREATE TABLE huancai_award_corrections (
 week TEXT PRIMARY KEY REFERENCES huancai_weekly(week),
 original_amount INTEGER NOT NULL CHECK(original_amount>0),
 replacement_amount INTEGER NOT NULL CHECK(replacement_amount>0 AND replacement_amount<original_amount),
 created_at INTEGER NOT NULL
);

CREATE TABLE arcade_saves (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 game_id TEXT NOT NULL CHECK(game_id IN ('mole','rift')),
 revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(json_valid(state)),
 state_hash TEXT NOT NULL,
 operation TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 authority_version INTEGER NOT NULL DEFAULT 0 CHECK(authority_version IN (0,1)),
 rank_level INTEGER NOT NULL DEFAULT 1,
 rank_depth INTEGER NOT NULL DEFAULT 1,
 rank_actions INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,game_id)
);

CREATE TABLE arcade_operations (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 game_id TEXT NOT NULL CHECK(game_id IN ('mole','rift')),
 operation TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 state_hash TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 delta INTEGER NOT NULL,
 balance_after INTEGER NOT NULL CHECK(balance_after BETWEEN 0 AND 9007199254740991),
 save_revision INTEGER NOT NULL CHECK(save_revision>0),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,game_id,operation)
);

CREATE TABLE huancai_daily (
 day TEXT PRIMARY KEY,
 starts_at INTEGER NOT NULL,
 closes_at INTEGER NOT NULL,
 user_id INTEGER REFERENCES users(id),
 entrants INTEGER NOT NULL CHECK(entrants>=0),
 sales INTEGER NOT NULL CHECK(sales>=0),
 payout INTEGER NOT NULL CHECK(payout>=0 AND payout<=9007199254740991),
 draw_token TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 CHECK((user_id IS NULL AND payout=0 AND entrants=0) OR (user_id IS NOT NULL AND entrants>0 AND payout=sales+52000))
) WITHOUT ROWID;

CREATE TABLE huancai_daily_cursor (
 id INTEGER PRIMARY KEY CHECK(id=1),
 next_day TEXT NOT NULL
);

CREATE TABLE phrase_order_settings(id INTEGER PRIMARY KEY CHECK(id=1),active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)));

CREATE TABLE phrase_order_policies(packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id) ON DELETE CASCADE) WITHOUT ROWID;

CREATE TABLE phrase_order_entries(
 packet_id TEXT NOT NULL REFERENCES phrase_order_policies(packet_id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id),message_id INTEGER NOT NULL REFERENCES chat_messages(id),
 PRIMARY KEY(packet_id,user_id),UNIQUE(packet_id,message_id)
) WITHOUT ROWID;

CREATE TABLE community_bubble_progress (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 pity INTEGER NOT NULL DEFAULT 0 CHECK(pity BETWEEN 0 AND 59),
 draws INTEGER NOT NULL DEFAULT 0 CHECK(draws>=0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);

CREATE TABLE chat_media_audit_refs (
  message_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(message_id,key)
);

CREATE TABLE chat_media_audit_state (
  id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL DEFAULT 0,
  high_water INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chat_media_audit_issues (
  message_id INTEGER PRIMARY KEY,
  reason TEXT NOT NULL
);

CREATE TABLE huancai_daily_corrections (
 day TEXT PRIMARY KEY REFERENCES huancai_daily(day),
 original_user_id INTEGER NOT NULL REFERENCES users(id),
 replacement_user_id INTEGER NOT NULL REFERENCES users(id),
 original_amount INTEGER NOT NULL CHECK(original_amount>0),
 created_at INTEGER NOT NULL,
 CHECK(original_user_id<>replacement_user_id)
);

CREATE TABLE "community_bubble_draws" (
 user_id INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 owner_id INTEGER NOT NULL REFERENCES users(id),
 item_id TEXT,
 won INTEGER NOT NULL CHECK(won IN(0,1)),
 duplicate INTEGER NOT NULL CHECK(duplicate IN(0,1)),
 guaranteed INTEGER NOT NULL CHECK(guaranteed IN(0,1)),
 pity_after INTEGER NOT NULL CHECK(pity_after BETWEEN 0 AND 59),
 chance INTEGER NOT NULL CHECK(chance BETWEEN 5 AND 25),
 finger_level INTEGER NOT NULL CHECK(finger_level BETWEEN 0 AND 5),
 catalog_source TEXT NOT NULL,
 card_id TEXT,
 card_duplicate INTEGER NOT NULL DEFAULT 0 CHECK(card_duplicate IN(0,1)),
 reward_amount INTEGER NOT NULL DEFAULT 0 CHECK(reward_amount>=0 AND reward_amount<=100000),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id),
 CHECK((won=0 AND item_id IS NULL AND duplicate=0 AND guaranteed=0) OR (won=1 AND item_id IS NOT NULL))
) WITHOUT ROWID;

CREATE TABLE "collectible_cards" (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 pack_id TEXT NOT NULL CHECK(length(pack_id)>=1 AND length(pack_id)<=48),
 card_id TEXT NOT NULL CHECK(card_id IN('0','1','2','3','4','5','6')),
 first_at INTEGER NOT NULL,
 last_at INTEGER NOT NULL,
 count INTEGER NOT NULL DEFAULT 1 CHECK(count>0),
 PRIMARY KEY(user_id,pack_id,card_id)
) WITHOUT ROWID;

CREATE TABLE pet_saves (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(json_valid(state)),
 state_hash TEXT NOT NULL,
 operation TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);

CREATE TABLE pet_progress (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 total_xp INTEGER NOT NULL CHECK(total_xp>=0),
 day TEXT NOT NULL,
 day_xp INTEGER NOT NULL CHECK(day_xp BETWEEN 0 AND 300),
 imported_xp INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);

CREATE TABLE pet_battles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 attacker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 defender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation TEXT NOT NULL,
 day TEXT NOT NULL,
 seed INTEGER NOT NULL,
 attacker_level INTEGER NOT NULL,
 defender_level INTEGER NOT NULL,
 winner INTEGER NOT NULL CHECK(winner IN (-1,0,1)),
 rounds INTEGER NOT NULL,
 fighters TEXT NOT NULL CHECK(json_valid(fighters)),
 events TEXT NOT NULL CHECK(json_valid(events)),
 xp INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 UNIQUE(attacker_id,operation),
 CHECK(attacker_id<>defender_id)
);

CREATE TABLE pet_items (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item TEXT NOT NULL,
 enh INTEGER NOT NULL DEFAULT 0 CHECK(enh BETWEEN 0 AND 10),
 source TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,item)
);

CREATE TABLE pet_loadout (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 weapon TEXT, armor TEXT, charm TEXT,
 points TEXT NOT NULL DEFAULT '{"str":0,"agi":0,"spd":0,"vit":0}' CHECK(json_valid(points)),
 updated_at INTEGER NOT NULL
);

CREATE TABLE pet_daily (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 trained INTEGER NOT NULL DEFAULT 0 CHECK(trained BETWEEN 0 AND 150),
 chest INTEGER NOT NULL DEFAULT 0 CHECK(chest IN (0,1)),
 PRIMARY KEY(user_id,day)
);

CREATE TABLE pet_ops (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL,
 ref TEXT NOT NULL,
 cost INTEGER NOT NULL CHECK(cost>=0),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,operation)
);

CREATE TABLE pet_battle_drops (
 battle_id INTEGER PRIMARY KEY REFERENCES pet_battles(id) ON DELETE CASCADE,
 item TEXT NOT NULL,
 upgraded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pet_train (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 xp INTEGER NOT NULL DEFAULT 0 CHECK(xp BETWEEN 0 AND 300),
 PRIMARY KEY(user_id,day)
);

CREATE TABLE pet_duels (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation TEXT NOT NULL,
 day TEXT NOT NULL,
 stake INTEGER NOT NULL CHECK(stake BETWEEN 100 AND 20000),
 status TEXT NOT NULL CHECK(status IN ('open','done','cancelled','declined','expired')),
 battle_id INTEGER REFERENCES pet_battles(id),
 winner_id INTEGER,
 payout INTEGER NOT NULL DEFAULT 0,
 rake INTEGER NOT NULL DEFAULT 0,
 flag INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 settled_at INTEGER,
 UNIQUE(inviter_id,operation),
 CHECK(inviter_id<>invitee_id)
);

CREATE TABLE pet_world (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 rev INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(json_valid(state)),
 op TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL
);

CREATE TABLE pet_market_volume (
 day TEXT NOT NULL,
 item TEXT NOT NULL,
 n INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,item)
);

CREATE TABLE manor (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  op TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  active_at INTEGER NOT NULL DEFAULT 0,
  ripe_at INTEGER NOT NULL DEFAULT 0,
  help_at INTEGER NOT NULL DEFAULT 0,
  lv INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE huancai_hist_cache (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  rows TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

CREATE TABLE pet_world_social_ops (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op TEXT NOT NULL,
  request TEXT NOT NULL,
  result TEXT NOT NULL CHECK(json_valid(result)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,op)
);

CREATE TABLE pet_world_social_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  fines INTEGER NOT NULL DEFAULT 0 CHECK(fines BETWEEN 0 AND 1000),
  PRIMARY KEY(user_id,day)
);

CREATE TABLE pet_world_social_targets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
  PRIMARY KEY(user_id,owner_id,day)
);

CREATE TABLE pet_world_social_rounds (
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round TEXT NOT NULL,
  visitor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op TEXT NOT NULL,
  caught INTEGER NOT NULL CHECK(caught IN (0,1)),
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity IN (0,1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,round,visitor_id)
);

CREATE TABLE pet_world_manor_policy (
  id INTEGER PRIMARY KEY CHECK(id=1),
  closed_at INTEGER NOT NULL
);

CREATE TABLE pet_world_manor_transfers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  op TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  manor_rev INTEGER NOT NULL,
  world_rev INTEGER NOT NULL,
  manor_snapshot TEXT NOT NULL CHECK(json_valid(manor_snapshot)),
  quote TEXT NOT NULL CHECK(json_valid(quote)),
  credit INTEGER NOT NULL CHECK(credit>=0),
  created_at INTEGER NOT NULL
);

CREATE TABLE pet_xp_daily (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 xp INTEGER NOT NULL DEFAULT 0 CHECK(xp BETWEEN 0 AND 5000),
 PRIMARY KEY(user_id, day)
);

CREATE TABLE site_visit_daily (
 day TEXT NOT NULL,
 surface TEXT NOT NULL,
 opens INTEGER NOT NULL DEFAULT 0,
 active_users INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(day,surface)
);

CREATE TABLE site_visit_unique (
 day TEXT NOT NULL,
 surface TEXT NOT NULL,
 identity TEXT NOT NULL,
 PRIMARY KEY(day,surface,identity)
);

CREATE TABLE manor_farewell_batches (
 id TEXT PRIMARY KEY,
 closed_at INTEGER NOT NULL,
 initialized INTEGER NOT NULL DEFAULT 0 CHECK(initialized IN(0,1)),
 status TEXT NOT NULL DEFAULT 'settling' CHECK(status IN('settling','complete')),
 completed_at INTEGER
);

CREATE TABLE manor_farewell_recipients (
 batch_id TEXT NOT NULL REFERENCES manor_farewell_batches(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','paid','skipped')),
 amount INTEGER CHECK(amount BETWEEN 0 AND 9007199254740991),
 details TEXT,
 state_snapshot TEXT,
 source_rev INTEGER,
 wallet_rev INTEGER,
 attempt TEXT UNIQUE,
 paid_at INTEGER,
 failures INTEGER NOT NULL DEFAULT 0,
 retry_at INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 PRIMARY KEY(batch_id,user_id)
);

CREATE TABLE b12_treasury (
 id INTEGER PRIMARY KEY CHECK(id=1),
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=balance),
 sales INTEGER NOT NULL DEFAULT 0,
 balance_tax INTEGER NOT NULL DEFAULT 0,
 subsidies INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE b12_tax_seasons (
 season INTEGER PRIMARY KEY,
 started_at INTEGER NOT NULL,
 sales INTEGER NOT NULL DEFAULT 0,
 balance_tax INTEGER NOT NULL DEFAULT 0,
 budget INTEGER NOT NULL DEFAULT 0,
 allocated INTEGER NOT NULL DEFAULT 0,
 paid INTEGER NOT NULL DEFAULT 0,
 snapshot_at INTEGER NOT NULL DEFAULT 0,
 phase INTEGER NOT NULL DEFAULT 0,
 snapshot_token TEXT NOT NULL DEFAULT ''
);

CREATE TABLE b12_subsidies (
 season INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 gap INTEGER NOT NULL CHECK(gap>0),
 amount INTEGER NOT NULL DEFAULT 0 CHECK(amount BETWEEN 0 AND 1000000),
 first_at INTEGER NOT NULL DEFAULT 0,
 second_at INTEGER NOT NULL DEFAULT 0,
 attempt TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(season,user_id)
);

CREATE TABLE b12_tax_days (
 day TEXT PRIMARY KEY,
 at INTEGER NOT NULL,
 season INTEGER NOT NULL,
 phase INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE b12_balance_levies (
 day TEXT NOT NULL,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 quoted INTEGER NOT NULL CHECK(quoted>=0),
 amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0),
 paid_at INTEGER NOT NULL DEFAULT 0,
 attempt TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(day,user_id)
);

CREATE TABLE hb_points_keys (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  binding_at INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_box TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE hb_points_trades (
  sender_id INTEGER NOT NULL,
  out_trade_no TEXT NOT NULL,
  trade_no TEXT NOT NULL UNIQUE,
  recipient_id INTEGER NOT NULL,
  recipient_subject TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991),
  remark TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(sender_id,out_trade_no),
  CHECK(sender_id<>recipient_id)
) WITHOUT ROWID;

CREATE TABLE b19_huancai_retire (step TEXT PRIMARY KEY, at INTEGER NOT NULL, info TEXT) WITHOUT ROWID;

CREATE TABLE "coin52_packets" (
 packet_id TEXT PRIMARY KEY REFERENCES chat_redpacks(id),
 owner_id INTEGER NOT NULL REFERENCES users(id),
 group_id INTEGER NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('fixed','random')),
 total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 5000000),
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 100),
 remaining INTEGER NOT NULL CHECK(remaining>=0 AND remaining<=total),
 remaining_count INTEGER NOT NULL CHECK(remaining_count>=0 AND remaining_count<=count),
 expires_at INTEGER NOT NULL,
 refunded_at INTEGER,
 created_at INTEGER NOT NULL
);

CREATE TABLE "coin52_packet_slots" (
 packet_id TEXT NOT NULL REFERENCES "coin52_packets"(packet_id),
 slot INTEGER NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),
 recipient_id INTEGER REFERENCES users(id),
 claimed_at INTEGER,
 attempt TEXT UNIQUE,
 PRIMARY KEY(packet_id,slot),
 UNIQUE(packet_id,recipient_id)
);

CREATE TABLE chat_kick_notes (group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (group_id, user_id, at));

CREATE TABLE chat_group_policy (group_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, open_apply INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);

CREATE TABLE "instant_card_batches" (
 user_id INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 owner_id INTEGER NOT NULL REFERENCES users(id),
 attempt TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL,
 count INTEGER NOT NULL CHECK(count IN(1,10,60,100,200)),
 finger_level INTEGER NOT NULL,
 results TEXT NOT NULL CHECK(json_valid(results)),
 pity_after INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id)
) WITHOUT ROWID;

CREATE TABLE "instant_card_receipts" (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 owner_id INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 attempt TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('draw','finger')),
 title TEXT NOT NULL REFERENCES instant_card_pools(title),
 price INTEGER NOT NULL CHECK(price BETWEEN 100 AND 9000),
 finger_level INTEGER NOT NULL CHECK(finger_level BETWEEN 0 AND 5),
 chance INTEGER NOT NULL CHECK(chance BETWEEN 5 AND 60),
 won INTEGER CHECK(won IN (0,1)),
 created_at INTEGER NOT NULL,
 batch_id TEXT,
 reward_kind TEXT,
 reward_id TEXT,
 reward_amount INTEGER,
 guaranteed INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id,request_id),
 CHECK((kind='draw' AND price=100 AND won IS NOT NULL) OR (kind='finger' AND won IS NULL))
);

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

CREATE TABLE isle_season_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 length_s INTEGER NOT NULL CHECK(length_s BETWEEN 86400 AND 8640000),
 doomsday_s INTEGER NOT NULL CHECK(doomsday_s BETWEEN 0 AND length_s),
 exchange_dcoin INTEGER NOT NULL CHECK(exchange_dcoin BETWEEN 1 AND 1000000000),
 devalue_bp INTEGER NOT NULL CHECK(devalue_bp BETWEEN 0 AND 9000),
 updated_at INTEGER NOT NULL
);

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

CREATE TABLE packet_coin_reservation_checks(packet_id TEXT NOT NULL);

CREATE TABLE oauth_clients (
 client_id TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
 icon_url TEXT,
 homepage TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 redirect_uris TEXT NOT NULL CHECK(json_valid(redirect_uris) AND json_type(redirect_uris)='array'),
 client_type TEXT NOT NULL CHECK(client_type IN('confidential','public')),
 secret_hash TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','active','rejected','disabled')),
 email_allowed INTEGER NOT NULL DEFAULT 0 CHECK(email_allowed IN(0,1)),
 review_note TEXT,
 reviewed_by INTEGER,
 reviewed_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK(client_type='public' OR secret_hash IS NOT NULL)
) WITHOUT ROWID;

CREATE TABLE oauth_subjects (
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sub TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(client_id,user_id)
) WITHOUT ROWID;

CREATE TABLE oauth_grants (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 scope TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,client_id)
) WITHOUT ROWID;

CREATE TABLE oauth_requests (
 id_hash TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 params TEXT NOT NULL CHECK(json_valid(params)),
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE oauth_codes (
 code_hash TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 redirect_uri TEXT NOT NULL,
 scope TEXT NOT NULL,
 code_challenge TEXT,
 nonce TEXT,
 auth_time INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE oauth_tokens (
 token_hash TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN('access','refresh')),
 client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope TEXT NOT NULL,
 family_id TEXT NOT NULL,
 auth_time INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 revoked_at INTEGER,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE meme_feed_reads (
  user_id INTEGER NOT NULL,
  meme_id INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id)
) WITHOUT ROWID;

CREATE TABLE meme_feed_hides (
  user_id INTEGER NOT NULL,
  meme_id INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, meme_id)
) WITHOUT ROWID;

CREATE TABLE bottles (
  id         INTEGER PRIMARY KEY,
  author_id  INTEGER NOT NULL,
  body       TEXT NOT NULL,
  mood       TEXT NOT NULL DEFAULT '',
  hidden     INTEGER NOT NULL DEFAULT 0, -- 举报人数够了自动隐藏，等管理员处理
  deleted    INTEGER NOT NULL DEFAULT 0, -- 1 瓶主删除，2 管理员删除
  created_at INTEGER NOT NULL
, anon INTEGER NOT NULL DEFAULT 1, nick TEXT NOT NULL DEFAULT '', show_badge INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL DEFAULT 0, heat INTEGER NOT NULL DEFAULT 0, poops INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, op TEXT);

CREATE TABLE bottle_draws (
  user_id   INTEGER NOT NULL,
  bottle_id INTEGER NOT NULL,
  at        INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, op TEXT,
  PRIMARY KEY (user_id, bottle_id)
) WITHOUT ROWID;

CREATE TABLE bottle_likes (
  bottle_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, user_id)
) WITHOUT ROWID;

CREATE TABLE bottle_keeps (
  user_id    INTEGER NOT NULL,
  bottle_id  INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, bottle_id)
) WITHOUT ROWID;

CREATE TABLE bottle_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id  INTEGER NOT NULL REFERENCES bottles(id),
  user_id    INTEGER NOT NULL,
  is_host    INTEGER NOT NULL DEFAULT 0,
  reply_to   INTEGER,
  body       TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
, op TEXT);

CREATE TABLE bottle_reports (
  kind       TEXT NOT NULL,
  target_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, target_id, user_id)
) WITHOUT ROWID;

CREATE TABLE bottle_author_views (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id INTEGER NOT NULL,
  viewer_id INTEGER NOT NULL,
  at        INTEGER NOT NULL
);

CREATE TABLE autumn_memorial(
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 score INTEGER NOT NULL, days INTEGER NOT NULL, peak INTEGER NOT NULL, last_at INTEGER NOT NULL
);

CREATE TABLE autumn_memorial_state(id INTEGER PRIMARY KEY CHECK(id=1), day TEXT NOT NULL, built_at INTEGER NOT NULL);

CREATE TABLE autumn_leaves(
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL, PRIMARY KEY(user_id,giver_id,day)
) WITHOUT ROWID;

CREATE TABLE autumn_opt_out(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL);

CREATE TABLE leap_posts(
 id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
 anon INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 links TEXT NOT NULL DEFAULT '[]', media TEXT NOT NULL DEFAULT '[]', request_id TEXT NOT NULL, rules TEXT NOT NULL DEFAULT '',
 hidden INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, UNIQUE(user_id,request_id)
);

CREATE TABLE leap_comments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL UNIQUE, post_id INTEGER NOT NULL REFERENCES leap_posts(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id), as_op INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, request_id TEXT NOT NULL,
 hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(user_id,request_id)
);

CREATE TABLE leap_likes(post_id INTEGER NOT NULL REFERENCES leap_posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id,user_id)) WITHOUT ROWID;

CREATE TABLE autumn_media(key TEXT PRIMARY KEY, board TEXT NOT NULL CHECK(board IN('leap')), post_id INTEGER NOT NULL) WITHOUT ROWID;

CREATE TABLE autumn_reports(
 id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL CHECK(board IN('leap')), kind TEXT NOT NULL CHECK(kind IN('post','comment')),
 target_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN('open','kept','removed')), handled_by INTEGER, handled_at INTEGER, created_at INTEGER NOT NULL,
 UNIQUE(board,kind,target_id,reporter_id)
);

CREATE TABLE autumn_reveals(id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, at INTEGER NOT NULL);

CREATE TABLE autumn_gifts(
 id TEXT PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id), recipient_id INTEGER NOT NULL REFERENCES users(id),
 gift TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>=10000), note TEXT NOT NULL DEFAULT '', attempt TEXT NOT NULL UNIQUE,
 hidden INTEGER NOT NULL DEFAULT 0, seen_at INTEGER, created_at INTEGER NOT NULL, CHECK(sender_id<>recipient_id)
);

CREATE TABLE bottle_poops (
  bottle_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, user_id)
) WITHOUT ROWID;

CREATE TABLE bottle_rewards (
  bottle_id  INTEGER NOT NULL,
  actor_id   INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK(kind IN ('like','reply')),
  user_id    INTEGER NOT NULL,
  amount     INTEGER NOT NULL,
  day        TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','void','short')), -- short：站长余额不足没发，不补
  batch      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, actor_id, kind)
) WITHOUT ROWID;

CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE INDEX idx_memes_created ON memes(hidden, created_at DESC);

CREATE INDEX idx_memes_author  ON memes(author_name);

CREATE INDEX idx_memes_series  ON memes(series);

CREATE INDEX idx_tags_tag ON meme_tags(tag);

CREATE INDEX idx_likes_meme ON likes(meme_id);

CREATE INDEX idx_likes_user ON likes(user_id, created_at);

CREATE INDEX idx_reactions_user ON reactions(user_id, created_at);

CREATE INDEX idx_replies_text ON short_replies(meme_id, text);

CREATE INDEX idx_replies_user ON short_replies(user_id, created_at);

CREATE INDEX idx_comments_meme ON comments(meme_id, id);

CREATE INDEX idx_comments_user ON comments(user_id, created_at);

CREATE INDEX idx_fav_folder ON favorites(folder_id, created_at);

CREATE INDEX idx_fav_meme   ON favorites(meme_id);

CREATE INDEX idx_views_user ON views(user_id, seen_at);

CREATE INDEX idx_anchors_user ON anchors(user_id, created_at);

CREATE INDEX idx_chat_members_user ON chat_members(user_id);

CREATE INDEX idx_chat_msg_group ON chat_messages(group_id, id);

CREATE INDEX idx_chat_msg_upd ON chat_messages(group_id, updated_at);

CREATE INDEX idx_chat_msg_user ON chat_messages(user_id, created_at);

CREATE INDEX idx_codes_puzzle ON puzzle_codes(puzzle_id, claimed_by);

CREATE INDEX idx_attempts_solved ON puzzle_attempts(puzzle_id, solved_at);

CREATE INDEX idx_memes_hot ON memes(hidden, hot DESC, id DESC);

CREATE INDEX idx_memes_author_id ON memes(author_id);

CREATE INDEX idx_memes_author_nc ON memes(author_name COLLATE NOCASE);

CREATE INDEX idx_sessions_exp ON sessions(expires_at);

CREATE INDEX idx_chat_msg_seq ON chat_messages(group_id, seq);

CREATE INDEX idx_uploads_user ON uploads(user_id, created_at);

CREATE INDEX idx_notices_day ON notices(kind, day);

CREATE INDEX idx_road_status ON road_items (hidden, status, score DESC);

CREATE INDEX idx_road_comments ON road_comments (item_id, id);

CREATE INDEX idx_join_reqs_st ON chat_join_reqs (status, created_at);

CREATE INDEX idx_badge_log_user ON badge_log (user_id, at);

CREATE INDEX idx_chat_rx_user ON chat_reactions (user_id, created_at);

CREATE INDEX idx_chat_boost_user ON chat_boosts (user_id, created_at);

CREATE INDEX idx_views_seen ON views (seen_at);

CREATE INDEX idx_chat_msg_at ON chat_messages (created_at);

CREATE INDEX idx_chat_msg_reply ON chat_messages (reply_to) WHERE reply_to IS NOT NULL;

CREATE UNIQUE INDEX idx_road_source_msg ON road_items(source_msg_id);

CREATE UNIQUE INDEX idx_chat_redpack_id ON chat_messages(redpack_id) WHERE redpack_id IS NOT NULL;

CREATE UNIQUE INDEX idx_chat_system_ref ON chat_messages(system_kind,system_ref) WHERE system_ref IS NOT NULL;

CREATE INDEX idx_redpack_notify ON chat_redpacks(notify_at) WHERE reminded_at IS NULL;

CREATE INDEX idx_redpack_success_order ON chat_redpack_successes(packet_id,seq);

CREATE UNIQUE INDEX idx_users_username ON users (username COLLATE NOCASE);

CREATE INDEX idx_users_seen ON users (last_seen);

CREATE INDEX idx_ident_user ON identities (user_id);

CREATE INDEX idx_login_fails_at ON login_fails (updated_at);

CREATE INDEX idx_auth_tokens_exp ON auth_tokens (expires_at);

CREATE INDEX idx_auth_tokens_email ON auth_tokens (email, created_at);

CREATE INDEX idx_invite_owner ON invite_codes (owner_id, created_at);

CREATE INDEX idx_invites_inviter ON invites (inviter_id, created_at);

CREATE INDEX idx_invites_pending ON invites (created_at) WHERE qualified_at IS NULL AND revoked = 0;

CREATE INDEX idx_api_tokens_user ON api_tokens (user_id);

CREATE INDEX idx_quota_scope_key_day ON quota_usage(scope,key,day);

CREATE INDEX idx_ai_jobs_run ON ai_jobs(state,run_after,id);

CREATE INDEX idx_ai_jobs_lock ON ai_jobs(state,locked_at,id);

CREATE UNIQUE INDEX idx_comments_ai_job ON comments(ai_job_id) WHERE ai_job_id IS NOT NULL;

CREATE INDEX idx_dm_threads_high ON dm_threads(user_high,last_message_id);

CREATE INDEX idx_dm_threads_low ON dm_threads(user_low,last_message_id);

CREATE INDEX idx_dm_messages_thread ON dm_messages(thread_id,id);

CREATE INDEX idx_dm_messages_sender_time ON dm_messages(sender_id,created_at);

CREATE INDEX idx_daily_post_views_day ON daily_post_views(day,user_id,meme_id);

CREATE INDEX idx_ldc_award_recipient ON ldc_awards(recipient_id);

CREATE INDEX idx_ldc_question_packet ON ldc_questions(packet_id,created_at);

CREATE INDEX idx_ldc_question_user ON ldc_questions(user_id,created_at);

CREATE INDEX idx_chat_msg_mentions ON chat_messages(group_id,created_at)
  WHERE deleted=0 AND instr(body,'@')>0;

CREATE INDEX idx_comments_mentions ON comments(created_at)
  WHERE deleted=0 AND instr(body,'@')>0;

CREATE INDEX idx_memes_mentions ON memes(created_at)
  WHERE hidden=0 AND (instr(title,'@')>0 OR instr(content,'@')>0);

CREATE INDEX idx_comments_reply_live ON comments(reply_to,created_at)
  WHERE deleted=0 AND reply_to IS NOT NULL;

CREATE INDEX idx_chat_redpacks_phrase ON chat_redpacks(phrase,message_id)
  WHERE mode='phrase';

CREATE UNIQUE INDEX idx_ldc_question_message ON ldc_questions(source_message_id) WHERE source_message_id IS NOT NULL;

CREATE INDEX idx_ldc_question_cache ON ldc_questions(packet_id,cache_key);

CREATE INDEX idx_chat_msg_media_rate ON chat_messages(user_id,created_at)
 WHERE system_kind IS NULL AND image_key IS NOT NULL;

CREATE INDEX idx_chat_msg_sender_page ON chat_messages(user_id,group_id,id DESC) WHERE deleted=0;

CREATE INDEX idx_chat_files_page ON chat_messages(group_id,id DESC)
WHERE deleted=0 AND instr(CASE WHEN json_valid(media) THEN json(media) ELSE '[]' END,'"kind":"f"')>0;

CREATE INDEX idx_guess_room_page ON guess_room_messages(packet_id,id);

CREATE INDEX idx_guess_room_updates ON guess_room_messages(packet_id,updated_at,id);

CREATE UNIQUE INDEX idx_ldc_question_room_source ON ldc_questions(source_room_id) WHERE source_room_id IS NOT NULL;

CREATE INDEX idx_ldc_guess_rank ON ldc_questions(packet_id,score DESC,created_at DESC,id DESC) WHERE kind='guess' AND score IS NOT NULL;

CREATE INDEX idx_ldc_yes_facts ON ldc_questions(packet_id,created_at DESC,id DESC) WHERE kind='question' AND verdict='yes';

CREATE INDEX idx_ldc_no_facts ON ldc_questions(packet_id,created_at DESC,id DESC) WHERE kind='question' AND verdict='no';

CREATE INDEX idx_free_guess_owner ON guess_free_rounds(owner_id);

CREATE INDEX idx_free_guess_winner ON guess_free_rounds(winner_id) WHERE winner_id IS NOT NULL;

CREATE INDEX idx_free_guess_active ON guess_free_rounds(group_id,ends_at) WHERE state='open' AND winner_id IS NULL;

CREATE INDEX idx_free_guess_history ON guess_free_rounds(group_id,created_at DESC,packet_id DESC);

CREATE INDEX idx_free_guess_due ON guess_free_rounds(ends_at,packet_id) WHERE state='open' AND mode IN('guess','clues');

CREATE INDEX idx_free_question_user ON guess_free_questions(user_id);

CREATE INDEX idx_free_question_cache ON guess_free_questions(packet_id,cache_key);

CREATE UNIQUE INDEX idx_free_question_message ON guess_free_questions(source_message_id) WHERE source_message_id IS NOT NULL;

CREATE UNIQUE INDEX idx_free_question_room ON guess_free_questions(source_room_id) WHERE source_room_id IS NOT NULL;

CREATE INDEX idx_free_guess_rank ON guess_free_questions(packet_id,score DESC,created_at DESC,id DESC) WHERE kind='guess' AND score IS NOT NULL;

CREATE INDEX idx_free_yes_facts ON guess_free_questions(packet_id,created_at DESC,id DESC) WHERE kind='question' AND verdict='yes';

CREATE INDEX idx_free_no_facts ON guess_free_questions(packet_id,created_at DESC,id DESC) WHERE kind='question' AND verdict='no';

CREATE INDEX idx_guess_wins_user ON guess_wins(user_id,created_at);

CREATE INDEX idx_memes_guest_latest ON memes(hidden, created_at DESC, id DESC);

CREATE INDEX idx_likes_recent ON likes(created_at,meme_id,user_id);

CREATE INDEX idx_reactions_recent ON reactions(created_at,meme_id,user_id);

CREATE INDEX idx_replies_recent ON short_replies(created_at,meme_id,user_id);

CREATE INDEX idx_comments_recent ON comments(created_at,meme_id,user_id) WHERE deleted=0;

CREATE INDEX idx_chat_msg_at_unread ON chat_messages(group_id,id)
  WHERE deleted=0 AND instr(body,'@')>0;

CREATE INDEX idx_guess_group_rank ON guess_group_player_stats(group_id,day,wins DESC,last_at ASC,user_id);

CREATE INDEX idx_title_raffles_due ON chat_title_raffles(status,closes_at);

CREATE INDEX idx_title_raffles_wins ON chat_title_raffles(winner_id,title,status);

CREATE INDEX idx_title_raffle_entries_user ON chat_title_raffle_entries(user_id,raffle_id);

CREATE INDEX idx_packet_luck_due ON packet_luck_jobs(due_at,packet_id);

CREATE INDEX idx_packet_luck_user ON packet_luck_wins(user_id,badge,created_at);

CREATE INDEX idx_packet_sender_count ON packet_sender_stats(group_id,day,packets DESC,created_at,user_id);

CREATE INDEX idx_packet_sender_declared ON packet_sender_stats(group_id,day,declared_cents DESC,created_at,user_id);

CREATE INDEX idx_packet_sender_paid ON packet_sender_stats(group_id,day,paid_cents DESC,paid_at,user_id);

CREATE INDEX idx_packet_sender_paid_packet ON packet_sender_paid_events(packet_id);

CREATE INDEX idx_chat_activity_count ON chat_activity_stats(group_id,day,messages DESC,user_id);

CREATE INDEX idx_chat_activity_first ON chat_activity_stats(group_id,day,first_at,user_id);

CREATE INDEX idx_chat_activity_last ON chat_activity_stats(group_id,day,last_at DESC,user_id);

CREATE INDEX idx_chat_activity_source ON chat_messages(group_id,user_id,created_at,id) WHERE deleted=0 AND system_kind IS NULL;

CREATE INDEX idx_rank_placement_user ON rank_placements(user_id,board,period,day);

CREATE INDEX idx_rank_placement_board_day ON rank_placements(group_id,board,period,day,user_id);

CREATE INDEX idx_chat_podium_rank ON chat_podium_totals(group_id,board,n DESC,user_id);

CREATE INDEX idx_views_meme_user ON views(meme_id,user_id);

CREATE INDEX idx_web_push_due ON web_push_subscriptions(enabled,next_check_at);

CREATE INDEX idx_web_push_user ON web_push_subscriptions(user_id);

CREATE INDEX idx_web_push_session ON web_push_subscriptions(session_id);

CREATE INDEX idx_upload_operations_cleanup ON upload_operations(cleanup_after);

CREATE INDEX idx_upload_operations_user_time ON upload_operations(user_id,created_at);

CREATE INDEX idx_uploads_unused_time ON uploads(created_at) WHERE used=0;

CREATE INDEX idx_guess_explanation_due ON guess_answer_explanations(next_at) WHERE state<>'done';

CREATE INDEX idx_rank_digest_due ON rank_digest_queue(next_at,group_id) WHERE state='pending';

CREATE INDEX idx_rank_placement_digest ON rank_placements(group_id,day,period,board,place);

CREATE INDEX idx_dm_messages_updates ON dm_messages(thread_id,updated_at,id);

CREATE INDEX idx_dm_media_message ON dm_media_access(message_id);

CREATE UNIQUE INDEX idx_guess_queue_order ON guess_queue(group_id,ticket);

CREATE INDEX idx_guess_queue_pending ON guess_queue(state,group_id,ticket) WHERE state IN('queued','starting');

CREATE INDEX idx_guess_queue_group ON guess_queue(group_id,ticket) WHERE state IN('queued','starting');

CREATE INDEX idx_guess_queue_owner ON guess_queue(owner_id,group_id,state,seq);

CREATE INDEX idx_ldc_pending_budget ON ldc_question_cache(packet_id,expires_at) WHERE state='pending' AND budget_reserved=1;

CREATE INDEX idx_free_pending_budget ON guess_free_cache(packet_id,expires_at) WHERE state='pending' AND budget_reserved=1;

CREATE INDEX idx_free_author_results ON guess_free_rounds(owner_id,created_at,packet_id) WHERE author_rule_version=1 AND author_result_saved=0;

CREATE INDEX idx_free_progress_open ON guess_free_rounds(ends_at,packet_id) WHERE state='open' AND author_rule_version=1;

CREATE INDEX idx_ldc_escalation_reserved ON ldc_awards(packet_id) WHERE state='reserved' AND attempts=0;

CREATE INDEX idx_guess_rate_coverage ON guess_rate_rounds(group_id,ended_at);

CREATE INDEX idx_guess_rate_rank ON guess_rate_stats(group_id,day,rate DESC,rounds DESC,user_id);

CREATE INDEX idx_rank_jobs_due ON rank_settlement_jobs(next_at,group_id,board,period);

CREATE INDEX idx_guess_review_due ON guess_review_batches(next_at,created_at) WHERE state IN ('pending','running');

CREATE INDEX idx_guess_review_unassigned ON guess_review_items(packet_id,reward_type,id) WHERE batch_id IS NULL;

CREATE INDEX idx_guess_review_batch ON guess_review_items(batch_id,id);

CREATE INDEX idx_coin52_ledger_user ON coin52_ledger(user_id,id DESC);

CREATE INDEX idx_title_paid_pending ON chat_title_raffle_entries(raffle_id,result,user_id);

CREATE INDEX idx_packet_draw_due ON packet_draws(draw_at,packet_id) WHERE settled_at IS NULL;

CREATE INDEX idx_packet_draw_user ON packet_draw_entries(user_id,entered_at);

CREATE INDEX idx_packet_events_user ON packet_events(user_id,created_at);

CREATE INDEX idx_packet_notice_due ON packet_notice_jobs(due_at,packet_id);

CREATE INDEX idx_packet_coin_pending ON packet_coin_escrows(refunded_at,packet_id) WHERE refunded_at IS NULL AND remaining>0;

CREATE INDEX idx_chat_message_favorites_page ON chat_message_favorites(user_id,created_at DESC,message_id DESC);

CREATE INDEX idx_farm_guest_owner_time ON farm_guest_visits(owner_id,visited_at DESC,actor_id DESC);

CREATE INDEX idx_farm_guest_time ON farm_guest_visits(visited_at);

CREATE INDEX idx_farm_guest_actor ON farm_guest_visits(actor_id);

CREATE INDEX idx_guess_reference_expiry ON guess_reference_preparations(expires_at);

CREATE INDEX idx_guess_reference_user ON guess_reference_preparations(user_id);

CREATE INDEX idx_activity_honor_user ON activity_honor_events(user_id,series);

CREATE INDEX idx_ldc_honor_guess ON ldc_questions(packet_id,kind,verdict,user_id);

CREATE INDEX idx_free_honor_guess ON guess_free_questions(packet_id,kind,verdict,user_id);

CREATE INDEX idx_content_reward_due ON content_coin_rewards(state,available_at,source,content_id);

CREATE INDEX idx_content_reward_user ON content_coin_rewards(user_id,created_at);

CREATE INDEX idx_content_reward_batch ON content_coin_rewards(batch_key,user_id);

CREATE INDEX idx_guess_close_active ON guess_close_votes(status,ends_at);

CREATE INDEX idx_guess_compensation_pending ON ldc_awards(state,checked_at) WHERE purpose='compensation' AND state IN('reserved','sent','unknown');

CREATE INDEX idx_fish_capacity_active ON fish_packet_capacity(owner_id,client_id,ends_at);

CREATE INDEX idx_fish_capacity_unpaid ON fish_packet_capacity(owner_id,client_id,ends_at) WHERE unpaid_cents>0;

CREATE INDEX idx_guess_tips_sender ON guess_tips(packet_id,sender_id,created_at);

CREATE INDEX idx_farm_loss_rank ON farm_loss_totals(total DESC,user_id);

CREATE INDEX idx_farm_owner_idle ON farm_saves(owner_operated_at,user_id);

CREATE INDEX idx_huancai_due ON huancai_rounds(state,closes_at);

CREATE INDEX idx_huancai_orders_user ON huancai_orders(user_id,id DESC);

CREATE INDEX idx_huancai_tickets_due ON huancai_tickets(day,settled_at,id);

CREATE INDEX idx_huancai_tickets_user ON huancai_tickets(user_id,day DESC,id);

CREATE INDEX idx_farm_visits_actor_time ON farm_visits(actor_id,created_at);

CREATE INDEX idx_farm_visits_owner ON farm_visits(owner_id,id DESC);

CREATE INDEX idx_farm_visits_owner_time ON farm_visits(owner_id,created_at DESC,id DESC);

CREATE INDEX idx_farm_visits_time ON farm_visits(created_at);

CREATE INDEX idx_farm_ranch_visits_actor_time ON farm_ranch_visits(actor_id,created_at);

CREATE INDEX idx_farm_ranch_visits_owner ON farm_ranch_visits(owner_id,id DESC);

CREATE INDEX idx_farm_ranch_visits_owner_time ON farm_ranch_visits(owner_id,created_at DESC,id DESC);

CREATE INDEX idx_farm_ranch_visits_time ON farm_ranch_visits(created_at);

CREATE INDEX idx_farm_lease_due ON farm_leases(state,expires_at);

CREATE INDEX idx_farm_lease_owner ON farm_leases(owner_id,state,expires_at);

CREATE UNIQUE INDEX idx_farm_lease_plot ON farm_leases(owner_id,plot) WHERE state='active';

CREATE INDEX idx_farm_lease_tenant ON farm_leases(tenant_id,state,expires_at);

CREATE INDEX idx_farm_lease_actions_actor ON farm_lease_actions(actor_id);

CREATE INDEX idx_farm_market_lots_owner ON farm_market_lots(owner_id,item,expires_at,id);

CREATE INDEX idx_farm_market_lots_page ON farm_market_lots(owner_id);

CREATE INDEX idx_farm_market_lots_expiry ON farm_market_lots(expires_at,id) WHERE expired=0 AND quantity>0;

CREATE INDEX idx_farm_market_receipts_time ON farm_market_receipts(created_at);

CREATE INDEX idx_farm_market_receipts_user_time ON farm_market_receipts(user_id,created_at);

CREATE INDEX idx_farm_market_ticks_time ON farm_market_ticks(tick_at);

CREATE INDEX idx_farm_conflict_members_enabled ON farm_conflict_members(enabled,user_id);

CREATE INDEX idx_farm_conflict_stakes_owner ON farm_conflict_stakes(user_id,lot_id);

CREATE INDEX idx_farm_conflicts_due ON farm_conflicts(status,resolves_at,id);

CREATE INDEX idx_farm_conflicts_release ON farm_conflicts(status,release_at,id);

CREATE INDEX idx_farm_conflicts_attacker ON farm_conflicts(attacker_id,starts_at DESC);

CREATE INDEX idx_farm_conflicts_defender ON farm_conflicts(defender_id,starts_at DESC);

CREATE INDEX idx_farm_conflicts_pair ON farm_conflicts(attacker_id,defender_id,starts_at DESC);

CREATE UNIQUE INDEX idx_farm_conflicts_active_defender ON farm_conflicts(defender_id) WHERE status IN ('preparing','escrow','uprising','claimable');

CREATE INDEX idx_farm_uprisings_due ON farm_uprisings(status,closes_at,battle_id);

CREATE INDEX idx_farm_uprising_members_user ON farm_uprising_members(user_id,battle_id);

CREATE INDEX idx_farm_conflict_receipts_time ON farm_conflict_receipts(user_id,created_at);

CREATE INDEX idx_farm_conflict_events_user_time ON farm_conflict_events(user_id,created_at DESC);

CREATE INDEX idx_title_trials_expiry ON title_trials(expires_at);

CREATE INDEX idx_huancai_classify ON huancai_tickets(day,weight,id);

CREATE INDEX idx_prediction_open ON guess_prediction_bets(packet_id,settled_at);

CREATE INDEX guess_fish_orders_due ON guess_fish_orders(state,next_at,lease_until);

CREATE INDEX guess_login_expiry ON guess_login_codes(expires_at);

CREATE INDEX guess_sidebar_user_time ON guess_sidebar_messages(user_id,created_at);

CREATE INDEX guess_sidebar_updated ON guess_sidebar_messages(updated_at,id);

CREATE INDEX guess_sidebar_created ON guess_sidebar_messages(created_at,id);

CREATE INDEX guess_prediction_due ON guess_prediction_pools(state,next_check_at,packet_id);

CREATE INDEX guess_fish_payer_capacity ON guess_fish_orders(payer_id,client_id,kind,state);

CREATE INDEX guess_fish_custodian_capacity ON guess_fish_pools(custodian_id,client_id,packet_id);

CREATE INDEX idx_user_ai_consents_user ON user_ai_consents(user_id,created_at DESC);

CREATE INDEX idx_user_ai_calls_consent ON user_ai_calls(consent_id,created_at DESC);

CREATE INDEX idx_game_ai_samples_time ON game_ai_samples(created_at DESC,id);

CREATE INDEX idx_game_word_candidates_time ON game_word_candidates(created_at DESC,id);

CREATE INDEX idx_game_room_directory_time ON game_room_directory(created_at DESC,id);

CREATE INDEX idx_game_room_directory_owner ON game_room_directory(owner_id,created_at DESC);

CREATE INDEX guess_meme_draws_time ON guess_meme_draws(user_id,created_at);

CREATE INDEX idx_novel_works_user ON novel_works(user_id,updated_at DESC,id);

CREATE INDEX idx_novel_ai_calls_user ON novel_ai_calls(user_id,created_at DESC,id);

CREATE INDEX idx_farm_outings_actor_time ON farm_outings(actor_id,created_at DESC,id DESC);

CREATE INDEX idx_farm_outings_pair_time ON farm_outings(actor_id,owner_id,created_at DESC);

CREATE INDEX idx_farm_outings_owner_time ON farm_outings(owner_id,mode,created_at DESC,id DESC);

CREATE INDEX idx_guess_announcement_events
ON chat_messages(group_id,created_at DESC,id DESC)
WHERE deleted=0 AND system_kind IN ('join','guess_level','ldc_winner','ldc_cancel','ldc_expired');

CREATE INDEX idx_guess_word_archive_due ON guess_word_archive_jobs(next_at,store,packet_id)
 WHERE status IN ('pending','error');

CREATE INDEX idx_game_word_candidates_word ON game_word_candidates(word,id);

CREATE INDEX idx_resource_recent ON resource_posts(hidden,id DESC);

CREATE INDEX idx_resource_category ON resource_posts(hidden,category,id DESC);

CREATE INDEX idx_resource_author ON resource_posts(user_id,created_at);

CREATE INDEX idx_resource_marks_post ON resource_marks(post_id,approved);

CREATE INDEX idx_resource_favorites ON resource_marks(user_id,favorite,post_id DESC);

CREATE INDEX idx_resource_comments ON resource_comments(post_id,hidden,id);

CREATE INDEX idx_resource_comment_rate ON resource_comments(user_id,created_at);

CREATE INDEX idx_guess_luckybags_work ON guess_luckybags(state,due_at,created_at);

CREATE INDEX idx_guess_luckybag_candidates_order ON guess_luckybag_candidates(packet_id,seq);

CREATE INDEX idx_release_notices_recent ON site_release_notices(created_at DESC,id DESC) WHERE active=1;

CREATE UNIQUE INDEX guess_sidebar_system_ref ON guess_sidebar_messages(system_kind,system_ref) WHERE system_kind IS NOT NULL;

CREATE INDEX idx_guess_room_pending_user ON guess_room_messages(packet_id,user_id,created_at)
 WHERE deleted=0 AND (ai_status IS NULL OR ai_status='pending');

CREATE INDEX idx_ldc_pending_user ON ldc_questions(packet_id,user_id,created_at) WHERE verdict='pending';

CREATE INDEX idx_free_pending_user ON guess_free_questions(packet_id,user_id,created_at) WHERE verdict='pending';

CREATE INDEX idx_guess_overlap_observation ON quota_usage(day DESC,scope,key) WHERE scope GLOB 'guess:overlap:*';

CREATE INDEX idx_farm_buyback_plot ON farm_lease_buybacks(owner_id,plot,cooldown_until DESC);

CREATE INDEX idx_farm_farewell_pending ON farm_farewell_recipients(batch_id,retry_at,user_id) WHERE status='pending';

CREATE INDEX music_playlist_order ON music_playlist_tracks(list,updated_at DESC,track_key DESC);

CREATE INDEX music_recommendations_user ON music_recommendations(user_id);

CREATE INDEX idx_coin52_ledger_attempt ON coin52_ledger(attempt);

CREATE INDEX idx_guess_review_running ON guess_review_batches(next_at,locked_until) WHERE state='running';

CREATE INDEX idx_coin52_wealth_rank ON coin52_wealth(earned DESC,user_id);

CREATE INDEX idx_coin52_wallet_rank ON coin52_wallets(balance DESC,user_id);

CREATE INDEX idx_ldc_active_group ON ldc_packets(group_id,ends_at) WHERE state='open' AND mode IN ('guess','clues');

CREATE INDEX idx_ldc_author_results ON ldc_packets(owner_id,created_at,packet_id) WHERE author_rule_version=1 AND author_result_saved=0;

CREATE INDEX idx_ldc_escalation_open ON ldc_packets(ends_at,packet_id) WHERE state='open' AND author_rule_version=1 AND mode IN('guess','clues');

CREATE INDEX idx_ldc_guess_due ON ldc_packets(ends_at,packet_id) WHERE state='open' AND mode IN('guess','clues');

CREATE INDEX idx_ldc_guess_history ON ldc_packets(group_id,created_at DESC,packet_id DESC) WHERE mode IN ('guess','clues');

CREATE INDEX idx_ldc_packet_owner ON ldc_packets(owner_id,state);

CREATE INDEX idx_ldc_word_backfill ON ldc_packets(group_id,created_at,packet_id);

CREATE INDEX idx_arcade_rank ON arcade_saves(game_id,rank_level DESC,rank_depth DESC,user_id);

CREATE INDEX idx_arcade_trusted_rank ON arcade_saves(game_id,rank_level DESC,rank_depth DESC,user_id) WHERE authority_version=1;

CREATE INDEX idx_huancai_orders_daily ON huancai_orders(created_at,user_id);

CREATE INDEX idx_phrase_order_rank ON phrase_order_entries(packet_id,message_id);

CREATE INDEX idx_chat_media_audit_key ON chat_media_audit_refs(key,created_at,message_id);

CREATE INDEX idx_pet_battles_attacker_day ON pet_battles(attacker_id,day,defender_id);

CREATE INDEX idx_pet_battles_defender ON pet_battles(defender_id,id);

CREATE INDEX idx_pet_duels_invitee ON pet_duels(invitee_id,status);

CREATE INDEX idx_pet_duels_inviter ON pet_duels(inviter_id,status);

CREATE INDEX idx_pet_duels_day ON pet_duels(day,inviter_id,invitee_id);

CREATE INDEX manor_ripe_at ON manor(ripe_at);

CREATE INDEX manor_active_at ON manor(active_at);

CREATE INDEX pet_world_updated_at ON pet_world(updated_at DESC,user_id DESC);

CREATE INDEX manor_farewell_pending ON manor_farewell_recipients(batch_id,status,retry_at,user_id);

CREATE INDEX b12_balance_pending ON b12_balance_levies(paid_at,day,user_id);

CREATE INDEX idx_coin52_packets_expiry ON coin52_packets(expires_at) WHERE refunded_at IS NULL AND remaining>0;

CREATE INDEX idx_coin52_packets_owner ON coin52_packets(owner_id,created_at);

CREATE INDEX idx_coin52_slots_recipient ON coin52_packet_slots(recipient_id);

CREATE INDEX idx_chat_kick_notes_user ON chat_kick_notes (user_id, at);

CREATE INDEX idx_card_batches_owner ON instant_card_batches(owner_id,created_at);

CREATE INDEX idx_card_receipts_batch ON instant_card_receipts(user_id,batch_id,id);

CREATE INDEX idx_instant_receipts_owner ON instant_card_receipts(owner_id,id DESC);

CREATE INDEX idx_instant_receipts_pool ON instant_card_receipts(title,id DESC);

CREATE INDEX idx_instant_receipts_rate ON instant_card_receipts(user_id,created_at);

CREATE INDEX idx_instant_receipts_user ON instant_card_receipts(user_id,id DESC);

CREATE INDEX idx_chat_bot_installations_group ON chat_bot_installations(group_id,created_at);

CREATE INDEX idx_chat_bot_events_due ON chat_bot_events(next_at,id) WHERE state IN('pending','delivering');

CREATE INDEX idx_chat_bot_events_history ON chat_bot_events(installation_id,created_at DESC,id DESC);

CREATE INDEX idx_chat_bot_events_cleanup ON chat_bot_events(created_at,id);

CREATE INDEX idx_isle_seasons_end ON isle_seasons(ends_at);

CREATE INDEX idx_isle_ledger_user ON isle_ledger(user_id,season_id,id DESC);

CREATE INDEX idx_oauth_clients_owner ON oauth_clients(owner_id,created_at);

CREATE INDEX idx_oauth_clients_status ON oauth_clients(status,created_at);

CREATE INDEX idx_oauth_grants_client ON oauth_grants(client_id);

CREATE INDEX idx_oauth_requests_expiry ON oauth_requests(expires_at);

CREATE INDEX idx_oauth_codes_expiry ON oauth_codes(expires_at);

CREATE INDEX idx_oauth_tokens_user_client ON oauth_tokens(user_id,client_id);

CREATE INDEX idx_oauth_tokens_family ON oauth_tokens(family_id);

CREATE INDEX idx_oauth_tokens_expiry ON oauth_tokens(expires_at);

CREATE INDEX idx_memes_featured ON memes(featured_at DESC, id DESC) WHERE featured_at > 0;

CREATE INDEX idx_memes_featured_author ON memes(author_id, featured_at) WHERE featured_at > 0;

CREATE INDEX idx_meme_feed_hides_recent ON meme_feed_hides(user_id, at DESC);

CREATE INDEX idx_bottles_author ON bottles(author_id, created_at DESC);

CREATE INDEX idx_bottle_draws_day ON bottle_draws(user_id, at);

CREATE INDEX idx_bottle_keeps_recent ON bottle_keeps(user_id, created_at DESC);

CREATE INDEX idx_bottle_replies_bottle ON bottle_replies(bottle_id, id);

CREATE INDEX idx_bottle_replies_user ON bottle_replies(user_id, bottle_id);

CREATE INDEX idx_bottle_replies_to ON bottle_replies(reply_to) WHERE reply_to IS NOT NULL;

CREATE INDEX idx_bottle_reports_open ON bottle_reports(kind, target_id) WHERE resolved = 0;

CREATE INDEX idx_autumn_leaves_giver ON autumn_leaves(giver_id,day);

CREATE INDEX idx_leap_posts_list ON leap_posts(hidden,category,id DESC);

CREATE INDEX idx_leap_comments_post ON leap_comments(post_id,id);

CREATE INDEX idx_leap_comments_user ON leap_comments(user_id,created_at);

CREATE INDEX idx_autumn_media_post ON autumn_media(board,post_id);

CREATE INDEX idx_autumn_reports_open ON autumn_reports(board,state,id);

CREATE INDEX idx_autumn_gifts_recipient ON autumn_gifts(recipient_id,created_at);

CREATE INDEX idx_autumn_gifts_sender ON autumn_gifts(sender_id,created_at);

CREATE INDEX idx_autumn_gifts_unseen ON autumn_gifts(recipient_id) WHERE seen_at IS NULL AND hidden=0;

CREATE INDEX idx_bottles_sea ON bottles(expires_at) WHERE deleted = 0 AND hidden = 0;

CREATE UNIQUE INDEX idx_bottles_op ON bottles(author_id, op) WHERE op IS NOT NULL;

CREATE UNIQUE INDEX idx_bottle_draws_op ON bottle_draws(user_id, op) WHERE op IS NOT NULL;

CREATE UNIQUE INDEX idx_bottle_replies_op ON bottle_replies(user_id, op) WHERE op IS NOT NULL;

CREATE INDEX idx_bottle_likes_user ON bottle_likes(user_id, created_at DESC);

CREATE INDEX idx_bottle_rewards_pending ON bottle_rewards(day, user_id) WHERE state = 'pending';

CREATE INDEX idx_bottle_rewards_user ON bottle_rewards(user_id, day);

CREATE INDEX idx_bottle_rewards_batch ON bottle_rewards(batch) WHERE batch IS NOT NULL;

CREATE INDEX idx_bottle_rewards_short ON bottle_rewards(state) WHERE state = 'short';

CREATE INDEX idx_bottle_rewards_actor ON bottle_rewards(actor_id, day);

CREATE VIEW packet_funding_accounts AS
 SELECT 'credit' AS payment_provider,user_id,client_id,secret_box,enabled FROM ldc_accounts
 UNION ALL SELECT 'fish',user_id,client_id,secret_box,enabled FROM fish_accounts
 UNION ALL SELECT 'coin52',user_id,'coin52:'||user_id,'',1 FROM coin52_wallets;

CREATE VIEW fish_capacity_source AS
 SELECT p.packet_id,p.owner_id,p.client_id,p.ends_at,
 CASE WHEN p.state='open' AND COUNT(a.recipient_id)<p.count
 THEN MAX(0,MAX(p.total_cents,CASE WHEN p.reward_freeze_ai_count IS NULL THEN p.base_total_cents+p.escalation_cap_cents ELSE p.total_cents END)-COALESCE(SUM(CASE WHEN a.state='accepted' THEN a.amount_cents ELSE 0 END),0))
 ELSE COALESCE(SUM(CASE WHEN a.recipient_id IS NOT NULL AND a.state<>'accepted' THEN a.amount_cents ELSE 0 END),0) END AS reserved_cents,
 COALESCE(SUM(CASE WHEN a.recipient_id IS NOT NULL AND a.state<>'accepted' THEN a.amount_cents ELSE 0 END),0) AS unpaid_cents
 FROM ldc_packets p LEFT JOIN ldc_awards a ON a.packet_id=p.packet_id WHERE p.payment_provider='fish' GROUP BY p.packet_id;

CREATE VIEW guess_sidebar_winner_snapshot AS
SELECT a.id AS award_id,a.recipient_id AS user_id,
 json_object('version',1,'message_id',r.message_id,'rank',a.slot+1,
 'amount_cents',CASE WHEN p.escalation_every=0 OR p.reward_finalized=1 THEN a.amount_cents ELSE NULL END,
 'payment_provider',p.payment_provider,'state',a.state,
 'needs_fish_setup',CASE WHEN p.payment_provider='fish' AND a.state='rejected' AND a.payment_error='RECIPIENT_NOT_FOUND' THEN 1 ELSE 0 END,
 'remaining_slots',MAX(0,p.count-a.slot-1),
 'remaining_cents',CASE WHEN p.escalation_every=0 OR p.reward_finalized=1 THEN
   MAX(0,p.total_cents-COALESCE((SELECT SUM(w.amount_cents) FROM ldc_awards w WHERE w.packet_id=a.packet_id AND w.purpose='winner' AND w.slot<=a.slot),0)) ELSE NULL END) AS payload
FROM ldc_awards a JOIN ldc_packets p ON p.packet_id=a.packet_id JOIN chat_redpacks r ON r.id=p.packet_id
WHERE p.group_id=1 AND p.mode IN ('guess','clues') AND a.purpose='winner' AND a.recipient_id IS NOT NULL;

CREATE TRIGGER trg_memes_hot AFTER UPDATE OF ld_likes, like_count, reaction_count, reply_count, comment_count, fav_count ON memes BEGIN
  UPDATE memes SET hot = NEW.ld_likes + NEW.like_count * 2 + NEW.reaction_count + NEW.reply_count * 2 + NEW.comment_count * 3 + NEW.fav_count * 3 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_chat_seq AFTER INSERT ON chat_messages BEGIN
  UPDATE chat_messages SET seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_messages WHERE group_id = NEW.group_id) WHERE id = NEW.id;
END;

CREATE TRIGGER trg_cm_ins AFTER INSERT ON chat_members BEGIN
  UPDATE chat_groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
END;

CREATE TRIGGER trg_cm_del AFTER DELETE ON chat_members BEGIN
  UPDATE chat_groups SET member_count = MAX(member_count - 1, 0) WHERE id = OLD.group_id;
END;

CREATE TRIGGER trg_cm_welcome AFTER INSERT ON chat_members BEGIN
  INSERT INTO chat_messages (group_id, user_id, body, created_at, updated_at, system_kind)
  VALUES (NEW.group_id, NEW.user_id, '加入了群聊', NEW.joined_at, NEW.joined_at, 'join');
  UPDATE chat_members SET last_read = (SELECT MAX(id) FROM chat_messages WHERE group_id = NEW.group_id)
  WHERE group_id = NEW.group_id AND user_id = NEW.user_id;
END;

CREATE TRIGGER trg_retirement_claim BEFORE INSERT ON account_retirements
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.source_id)
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.source_id AND disabled=2 AND kind='user')
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.target_id AND disabled=0 AND kind='user')
BEGIN SELECT RAISE(ABORT,'retirement_invalid'); END;

CREATE TRIGGER trg_retirement_update BEFORE UPDATE ON account_retirements
BEGIN SELECT RAISE(ABORT,'retirement_immutable'); END;

CREATE TRIGGER trg_retirement_delete BEFORE DELETE ON account_retirements
BEGIN SELECT RAISE(ABORT,'retirement_immutable'); END;

CREATE TRIGGER trg_retired_ai_jobs_ins BEFORE INSERT ON ai_jobs
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_ai_jobs_upd BEFORE UPDATE OF user_id ON ai_jobs
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_anchors_ins BEFORE INSERT ON anchors
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_anchors_upd BEFORE UPDATE OF user_id ON anchors
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_api_tokens_ins BEFORE INSERT ON api_tokens
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_api_tokens_upd BEFORE UPDATE OF user_id ON api_tokens
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_auth_tokens_ins BEFORE INSERT ON auth_tokens
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_auth_tokens_upd BEFORE UPDATE OF user_id ON auth_tokens
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_badge_log_ins BEFORE INSERT ON badge_log
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_badge_log_upd BEFORE UPDATE OF user_id ON badge_log
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_bans_ins BEFORE INSERT ON chat_bans
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_bans_upd BEFORE UPDATE OF user_id ON chat_bans
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_boosts_ins BEFORE INSERT ON chat_boosts
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_boosts_upd BEFORE UPDATE OF user_id ON chat_boosts
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_groups_ins BEFORE INSERT ON chat_groups
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.created_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_groups_upd BEFORE UPDATE OF created_by ON chat_groups
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.created_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_join_reqs_ins BEFORE INSERT ON chat_join_reqs
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_join_reqs_upd BEFORE UPDATE OF user_id ON chat_join_reqs
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_members_ins BEFORE INSERT ON chat_members
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_members_upd BEFORE UPDATE OF user_id ON chat_members
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_messages_ins BEFORE INSERT ON chat_messages
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_messages_upd BEFORE UPDATE OF user_id ON chat_messages
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_reactions_ins BEFORE INSERT ON chat_reactions
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_reactions_upd BEFORE UPDATE OF user_id ON chat_reactions
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_redpack_external_views_ins BEFORE INSERT ON chat_redpack_external_views
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_redpack_external_views_upd BEFORE UPDATE OF user_id ON chat_redpack_external_views
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_redpack_opens_ins BEFORE INSERT ON chat_redpack_opens
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_redpack_opens_upd BEFORE UPDATE OF user_id ON chat_redpack_opens
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_redpack_successes_ins BEFORE INSERT ON chat_redpack_successes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_chat_redpack_successes_upd BEFORE UPDATE OF user_id ON chat_redpack_successes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_comments_ins BEFORE INSERT ON comments
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_comments_upd BEFORE UPDATE OF user_id ON comments
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_fav_folders_ins BEFORE INSERT ON fav_folders
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_fav_folders_upd BEFORE UPDATE OF user_id ON fav_folders
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_favorites_ins BEFORE INSERT ON favorites
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_favorites_upd BEFORE UPDATE OF user_id ON favorites
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_identities_ins BEFORE INSERT ON identities
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_identities_upd BEFORE UPDATE OF user_id ON identities
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_invite_codes_ins BEFORE INSERT ON invite_codes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.owner_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.used_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_invite_codes_upd BEFORE UPDATE OF owner_id,used_by ON invite_codes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.owner_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.used_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_invites_ins BEFORE INSERT ON invites
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.invitee_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.inviter_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_invites_upd BEFORE UPDATE OF invitee_id,inviter_id ON invites
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.invitee_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.inviter_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_likes_ins BEFORE INSERT ON likes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_likes_upd BEFORE UPDATE OF user_id ON likes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_login_fails_ins BEFORE INSERT ON login_fails
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_login_fails_upd BEFORE UPDATE OF user_id ON login_fails
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_memes_ins BEFORE INSERT ON memes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.author_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_memes_upd BEFORE UPDATE OF author_id ON memes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.author_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_notif_reads_ins BEFORE INSERT ON notif_reads
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.actor_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_notif_reads_upd BEFORE UPDATE OF user_id,actor_id ON notif_reads
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.actor_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_official_title_log_ins BEFORE INSERT ON official_title_log
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.actor_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_official_title_log_upd BEFORE UPDATE OF user_id,actor_id ON official_title_log
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.actor_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_passwords_ins BEFORE INSERT ON passwords
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_passwords_upd BEFORE UPDATE OF user_id ON passwords
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_puzzle_attempts_ins BEFORE INSERT ON puzzle_attempts
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_puzzle_attempts_upd BEFORE UPDATE OF user_id ON puzzle_attempts
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_puzzle_codes_ins BEFORE INSERT ON puzzle_codes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.claimed_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_puzzle_codes_upd BEFORE UPDATE OF claimed_by ON puzzle_codes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.claimed_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_puzzles_ins BEFORE INSERT ON puzzles
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.creator_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_puzzles_upd BEFORE UPDATE OF creator_id ON puzzles
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.creator_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_quota_usage_ins BEFORE INSERT ON quota_usage
WHEN NEW.key<>0 AND NEW.scope NOT GLOB 'tok:*' AND (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.key))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_quota_usage_upd BEFORE UPDATE OF key,scope ON quota_usage
WHEN NEW.key<>0 AND NEW.scope NOT GLOB 'tok:*' AND (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.key))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_reactions_ins BEFORE INSERT ON reactions
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_reactions_upd BEFORE UPDATE OF user_id ON reactions
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_road_comments_ins BEFORE INSERT ON road_comments
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_road_comments_upd BEFORE UPDATE OF user_id ON road_comments
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_road_items_ins BEFORE INSERT ON road_items
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_road_items_upd BEFORE UPDATE OF user_id ON road_items
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_road_votes_ins BEFORE INSERT ON road_votes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_road_votes_upd BEFORE UPDATE OF user_id ON road_votes
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_sessions_ins BEFORE INSERT ON sessions
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_sessions_upd BEFORE UPDATE OF user_id ON sessions
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_short_replies_ins BEFORE INSERT ON short_replies
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_short_replies_upd BEFORE UPDATE OF user_id ON short_replies
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_uploads_ins BEFORE INSERT ON uploads
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_uploads_upd BEFORE UPDATE OF user_id ON uploads
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_badges_ins BEFORE INSERT ON user_badges
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_badges_upd BEFORE UPDATE OF user_id ON user_badges
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_limits_ins BEFORE INSERT ON user_limits
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.by_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_limits_upd BEFORE UPDATE OF user_id,by_id ON user_limits
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.by_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_official_titles_ins BEFORE INSERT ON user_official_titles
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.granted_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_official_titles_upd BEFORE UPDATE OF user_id,granted_by ON user_official_titles
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.granted_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_unlocks_ins BEFORE INSERT ON user_unlocks
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_user_unlocks_upd BEFORE UPDATE OF user_id ON user_unlocks
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_users_ins BEFORE INSERT ON users
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.invited_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_users_upd BEFORE UPDATE OF id,invited_by ON users
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.id) OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.invited_by))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_view_days_ins BEFORE INSERT ON view_days
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_view_days_upd BEFORE UPDATE OF user_id ON view_days
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_views_ins BEFORE INSERT ON views
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_views_upd BEFORE UPDATE OF user_id ON views
WHEN (EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_dm_threads_insert BEFORE INSERT ON dm_threads
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.user_low,NEW.user_high))
  OR (SELECT COUNT(*) FROM users WHERE id IN(NEW.user_low,NEW.user_high) AND kind='user' AND disabled=0)<>2
BEGIN SELECT RAISE(ABORT,'dm_participant_unavailable'); END;

CREATE TRIGGER trg_dm_messages_insert BEFORE INSERT ON dm_messages
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.sender_id)
  OR NOT EXISTS(SELECT 1 FROM dm_threads t JOIN users u ON u.id=NEW.sender_id
      WHERE t.id=NEW.thread_id AND NEW.sender_id IN(t.user_low,t.user_high) AND u.kind='user' AND u.disabled=0)
BEGIN SELECT RAISE(ABORT,'dm_sender_unavailable'); END;

CREATE TRIGGER trg_dm_messages_sender_update BEFORE UPDATE OF sender_id ON dm_messages
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.sender_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_dm_threads_participants_update BEFORE UPDATE OF user_low,user_high ON dm_threads
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.user_low,NEW.user_high))
  OR (SELECT COUNT(*) FROM users WHERE id IN(NEW.user_low,NEW.user_high) AND kind='user' AND disabled=0)<>2
BEGIN SELECT RAISE(ABORT,'dm_participant_unavailable'); END;

CREATE TRIGGER trg_retired_daily_post_views_ins BEFORE INSERT ON daily_post_views
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_daily_post_views_upd BEFORE UPDATE OF user_id ON daily_post_views
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER chat_sticker_favorites_retired_insert BEFORE INSERT ON chat_sticker_favorites
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER chat_sticker_favorites_retired_update BEFORE UPDATE OF user_id ON chat_sticker_favorites
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_accounts_retired_insert BEFORE INSERT ON ldc_accounts WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_accounts_retired_update BEFORE UPDATE OF user_id ON ldc_accounts WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_awards_retired_insert BEFORE INSERT ON ldc_awards WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.recipient_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_awards_retired_update BEFORE UPDATE OF recipient_id ON ldc_awards WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.recipient_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_questions_retired_insert BEFORE INSERT ON ldc_questions WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_questions_retired_update BEFORE UPDATE OF user_id ON ldc_questions WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER chat_packet_no_recall BEFORE UPDATE OF deleted ON chat_messages WHEN OLD.deleted=0 AND NEW.deleted<>0 AND (OLD.redpack_id IS NOT NULL OR EXISTS(SELECT 1 FROM chat_redpacks WHERE message_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'packet_irrevocable'); END;

CREATE TRIGGER chat_packet_no_edit BEFORE UPDATE OF body ON chat_messages WHEN NEW.body<>OLD.body AND (OLD.redpack_id IS NOT NULL OR EXISTS(SELECT 1 FROM chat_redpacks WHERE message_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'packet_immutable'); END;

CREATE TRIGGER guess_room_account_live BEFORE INSERT ON guess_room_messages
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER free_guess_winner_immutable BEFORE UPDATE OF winner_id ON guess_free_rounds
WHEN OLD.winner_id IS NOT NULL AND NEW.winner_id IS NOT OLD.winner_id BEGIN SELECT RAISE(ABORT,'guess_winner_immutable'); END;

CREATE TRIGGER free_guess_retired_insert BEFORE INSERT ON guess_free_rounds
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.owner_id OR source_id=NEW.winner_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER free_guess_retired_update BEFORE UPDATE OF owner_id,winner_id ON guess_free_rounds
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.owner_id OR source_id=NEW.winner_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER free_question_retired_insert BEFORE INSERT ON guess_free_questions
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER free_question_retired_update BEFORE UPDATE OF user_id ON guess_free_questions
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER guess_room_account_live_update BEFORE UPDATE OF user_id ON guess_room_messages
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER free_guess_signal_insert AFTER INSERT ON guess_room_messages BEGIN
 UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER free_guess_signal_update AFTER UPDATE OF ai_text,ai_score,ai_status,deleted ON guess_room_messages
WHEN OLD.ai_text IS NOT NEW.ai_text OR OLD.ai_score IS NOT NEW.ai_score OR OLD.ai_status IS NOT NEW.ai_status OR OLD.deleted<>NEW.deleted BEGIN
 UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER guess_wins_retired_insert BEFORE INSERT ON guess_wins
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER guess_wins_immutable BEFORE UPDATE ON guess_wins BEGIN SELECT RAISE(ABORT,'guess_win_immutable'); END;

CREATE TRIGGER free_guess_win_reward AFTER UPDATE OF winner_id ON guess_free_rounds
WHEN OLD.winner_id IS NULL AND NEW.winner_id IS NOT NULL
BEGIN INSERT OR IGNORE INTO guess_wins VALUES(NEW.packet_id,NEW.winner_id,NEW.won_at); END;

CREATE TRIGGER guess_win_unlock AFTER INSERT ON guess_wins BEGIN
 INSERT INTO user_badges(user_id,badge,n,first_at,last_day) VALUES(NEW.user_id,'guess',1,NEW.created_at,date(NEW.created_at,'unixepoch','+8 hours'))
 ON CONFLICT(user_id,badge) DO UPDATE SET n=n+1,last_day=excluded.last_day;
 INSERT OR IGNORE INTO user_unlocks(user_id,item,at)
 SELECT NEW.user_id,'guess:'||level,NEW.created_at FROM (SELECT 1 AS level,1 AS wins UNION ALL SELECT 2,3 UNION ALL SELECT 3,10 UNION ALL SELECT 4,30 UNION ALL SELECT 5,100)
 WHERE wins<=(SELECT n FROM user_badges WHERE user_id=NEW.user_id AND badge='guess');
 UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=NEW.user_id AND badge='guess'))
 WHERE id=NEW.user_id AND json_valid(deco) AND json_extract(deco,'$.bd')='guess';
 INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
 SELECT m.group_id,NEW.user_id,COALESCE(u.nick,u.name,u.username)||' 猜词累计获胜 '||b.n||' 次，升至 LV.'||r.level||'「'||r.title||'」！已解锁本级称号、徽章和气泡，可在装扮中自行选择。',NEW.created_at,NEW.created_at,'guess_level',CAST(NEW.user_id AS TEXT)||':'||r.level
 FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id JOIN users u ON u.id=NEW.user_id JOIN user_badges b ON b.user_id=u.id AND b.badge='guess'
 JOIN (SELECT 1 AS level,1 AS wins,'猜词新星' AS title UNION ALL SELECT 2,3,'识词达人' UNION ALL SELECT 3,10,'灵感猎手' UNION ALL SELECT 4,30,'谜语大师' UNION ALL SELECT 5,100,'猜词王者') r ON r.wins=b.n
 WHERE p.id=NEW.packet_id;
END;

CREATE TRIGGER guess_stats_free_start AFTER INSERT ON guess_free_rounds WHEN NEW.mode IN ('guess','clues') BEGIN INSERT INTO guess_group_stats(group_id,day,rounds,wins) VALUES(NEW.group_id,'*',1,0),(NEW.group_id,date(NEW.created_at,'unixepoch','+8 hours'),1,0) ON CONFLICT(group_id,day) DO UPDATE SET rounds=rounds+1; END;

CREATE TRIGGER guess_stats_win AFTER INSERT ON guess_wins BEGIN INSERT INTO guess_group_stats(group_id,day,rounds,wins) SELECT m.group_id,'*',0,1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id ON CONFLICT(group_id,day) DO UPDATE SET wins=wins+1; INSERT INTO guess_group_stats(group_id,day,rounds,wins) SELECT m.group_id,date(NEW.created_at,'unixepoch','+8 hours'),0,1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id ON CONFLICT(group_id,day) DO UPDATE SET wins=wins+1; INSERT INTO guess_group_player_stats(group_id,day,user_id,wins,last_at) SELECT m.group_id,'*',NEW.user_id,1,NEW.created_at FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id ON CONFLICT(group_id,day,user_id) DO UPDATE SET wins=wins+1,last_at=MAX(last_at,NEW.created_at); INSERT INTO guess_group_player_stats(group_id,day,user_id,wins,last_at) SELECT m.group_id,date(NEW.created_at,'unixepoch','+8 hours'),NEW.user_id,1,NEW.created_at FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id ON CONFLICT(group_id,day,user_id) DO UPDATE SET wins=wins+1,last_at=MAX(last_at,NEW.created_at); END;

CREATE TRIGGER trg_title_raffles_retired_insert BEFORE INSERT ON chat_title_raffles
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.creator_id,NEW.winner_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_title_raffles_retired_update BEFORE UPDATE OF creator_id,winner_id ON chat_title_raffles
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.creator_id,NEW.winner_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_title_raffle_entries_retired_insert BEFORE INSERT ON chat_title_raffle_entries
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_title_raffle_entries_retired_update BEFORE UPDATE OF user_id ON chat_title_raffle_entries
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER packet_luck_award_signal AFTER UPDATE OF state,recipient_id ON ldc_awards
WHEN OLD.state IS NOT NEW.state OR OLD.recipient_id IS NOT NEW.recipient_id BEGIN
 UPDATE packet_luck_jobs SET due_at=unixepoch() WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER packet_luck_retired_insert BEFORE INSERT ON packet_luck_wins
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER packet_luck_win_immutable BEFORE UPDATE ON packet_luck_wins BEGIN SELECT RAISE(ABORT,'luck_win_immutable'); END;

CREATE TRIGGER packet_luck_settled AFTER INSERT ON packet_luck_settlements BEGIN
 INSERT INTO packet_luck_wins(packet_id,user_id,badge,amount_cents,created_at)
 SELECT NEW.packet_id,a.recipient_id,k.badge,a.amount_cents,NEW.settled_at
 FROM ldc_awards a JOIN users u ON u.id=a.recipient_id
 JOIN (SELECT 'luck_king' badge UNION ALL SELECT 'luck_last') k
 WHERE a.packet_id=NEW.packet_id AND a.state='accepted' AND u.disabled=0 AND u.kind='user'
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=a.recipient_id)
 AND (SELECT COUNT(*) FROM ldc_awards WHERE packet_id=NEW.packet_id AND state='accepted' AND recipient_id IS NOT NULL)>=2
 AND (SELECT MIN(amount_cents)<MAX(amount_cents) FROM ldc_awards WHERE packet_id=NEW.packet_id AND state='accepted' AND recipient_id IS NOT NULL)
 AND a.amount_cents=CASE k.badge WHEN 'luck_king' THEN (SELECT MAX(amount_cents) FROM ldc_awards WHERE packet_id=NEW.packet_id AND state='accepted' AND recipient_id IS NOT NULL)
 ELSE (SELECT MIN(amount_cents) FROM ldc_awards WHERE packet_id=NEW.packet_id AND state='accepted' AND recipient_id IS NOT NULL) END;
END;

CREATE TRIGGER packet_sender_paid_immutable BEFORE UPDATE ON packet_sender_paid_events BEGIN SELECT RAISE(ABORT,'packet_paid_event_immutable'); END;

CREATE TRIGGER packet_sender_stats_retired_insert BEFORE INSERT ON packet_sender_stats WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER packet_sender_stats_retired_update BEFORE UPDATE OF user_id ON packet_sender_stats WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER chat_activity_insert AFTER INSERT ON chat_messages BEGIN
 INSERT INTO chat_activity_stats(group_id,day,user_id,messages,first_at,last_at)
 SELECT NEW.group_id,date(NEW.created_at,'unixepoch','+4 hours'),NEW.user_id,1,NEW.created_at,NEW.created_at
 WHERE NEW.deleted=0 AND NEW.system_kind IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='user')
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET messages=messages+1,first_at=MIN(first_at,excluded.first_at),last_at=MAX(last_at,excluded.last_at);
 INSERT INTO chat_activity_stats(group_id,day,user_id,messages)
 SELECT NEW.group_id,'*',NEW.user_id,1
 WHERE NEW.deleted=0 AND NEW.system_kind IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='user')
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET messages=messages+1;
END;

CREATE TRIGGER chat_activity_remove AFTER DELETE ON chat_messages BEGIN
 UPDATE chat_activity_stats SET messages=messages-1,
 first_at=CASE WHEN first_at=OLD.created_at THEN (SELECT MIN(created_at) FROM chat_messages INDEXED BY idx_chat_activity_source WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND deleted=0 AND system_kind IS NULL AND id<>OLD.id AND created_at>=(OLD.created_at+14400)/86400*86400-14400 AND created_at<(OLD.created_at+14400)/86400*86400+72000) ELSE first_at END,
 last_at=CASE WHEN last_at=OLD.created_at THEN (SELECT MAX(created_at) FROM chat_messages INDEXED BY idx_chat_activity_source WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND deleted=0 AND system_kind IS NULL AND id<>OLD.id AND created_at>=(OLD.created_at+14400)/86400*86400-14400 AND created_at<(OLD.created_at+14400)/86400*86400+72000) ELSE last_at END
 WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND day IN('*',date(OLD.created_at,'unixepoch','+4 hours')) AND OLD.deleted=0 AND OLD.system_kind IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND kind='user');
 DELETE FROM chat_activity_stats WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND day IN('*',date(OLD.created_at,'unixepoch','+4 hours')) AND messages=0;
END;

CREATE TRIGGER chat_activity_update AFTER UPDATE OF deleted,system_kind,user_id,group_id,created_at ON chat_messages WHEN OLD.deleted IS NOT NEW.deleted OR OLD.system_kind IS NOT NEW.system_kind OR OLD.user_id IS NOT NEW.user_id OR OLD.group_id IS NOT NEW.group_id OR OLD.created_at IS NOT NEW.created_at BEGIN
 UPDATE chat_activity_stats SET messages=messages-1,
 first_at=CASE WHEN first_at=OLD.created_at THEN (SELECT MIN(created_at) FROM chat_messages INDEXED BY idx_chat_activity_source WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND deleted=0 AND system_kind IS NULL AND id<>OLD.id AND created_at>=(OLD.created_at+14400)/86400*86400-14400 AND created_at<(OLD.created_at+14400)/86400*86400+72000) ELSE first_at END,
 last_at=CASE WHEN last_at=OLD.created_at THEN (SELECT MAX(created_at) FROM chat_messages INDEXED BY idx_chat_activity_source WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND deleted=0 AND system_kind IS NULL AND id<>OLD.id AND created_at>=(OLD.created_at+14400)/86400*86400-14400 AND created_at<(OLD.created_at+14400)/86400*86400+72000) ELSE last_at END
 WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND day IN('*',date(OLD.created_at,'unixepoch','+4 hours')) AND OLD.deleted=0 AND OLD.system_kind IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND kind='user');
 DELETE FROM chat_activity_stats WHERE group_id=OLD.group_id AND user_id=OLD.user_id AND day IN('*',date(OLD.created_at,'unixepoch','+4 hours')) AND messages=0;

 INSERT INTO chat_activity_stats(group_id,day,user_id,messages,first_at,last_at)
 SELECT NEW.group_id,date(NEW.created_at,'unixepoch','+4 hours'),NEW.user_id,1,NEW.created_at,NEW.created_at
 WHERE NEW.deleted=0 AND NEW.system_kind IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='user')
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET messages=messages+1,first_at=MIN(first_at,excluded.first_at),last_at=MAX(last_at,excluded.last_at);
 INSERT INTO chat_activity_stats(group_id,day,user_id,messages)
 SELECT NEW.group_id,'*',NEW.user_id,1
 WHERE NEW.deleted=0 AND NEW.system_kind IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='user')
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET messages=messages+1;
END;

CREATE TRIGGER chat_activity_retired_insert BEFORE INSERT ON chat_activity_stats WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER chat_activity_retired_update BEFORE UPDATE OF user_id ON chat_activity_stats WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER rank_placement_immutable BEFORE UPDATE ON rank_placements BEGIN SELECT RAISE(ABORT,'rank_placement_immutable'); END;

CREATE TRIGGER rank_placement_retired BEFORE INSERT ON rank_placements WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER rank_podium_total AFTER INSERT ON rank_placements WHEN NEW.period='day' AND NEW.board IN('chat_early','chat_late') BEGIN
 INSERT INTO chat_podium_totals VALUES(NEW.group_id,NEW.board,NEW.user_id,1)
 ON CONFLICT(group_id,board,user_id) DO UPDATE SET n=n+1;
END;

CREATE TRIGGER trg_views_ins AFTER INSERT ON views BEGIN
 INSERT INTO view_days(user_id,day,n,n_safe)
 SELECT NEW.user_id,date(created_at,'unixepoch','+8 hours'),1,(nsfw=0) FROM memes WHERE id=NEW.meme_id AND hidden=0
 ON CONFLICT(user_id,day) DO UPDATE SET n=n+1,n_safe=n_safe+excluded.n_safe;
END;

CREATE TRIGGER trg_views_del AFTER DELETE ON views BEGIN
 UPDATE view_days SET n=n-1,n_safe=n_safe-(SELECT nsfw=0 FROM memes WHERE id=OLD.meme_id)
 WHERE user_id=OLD.user_id AND day=(SELECT date(created_at,'unixepoch','+8 hours') FROM memes WHERE id=OLD.meme_id AND hidden=0);
END;

CREATE TRIGGER trg_memes_view_location AFTER UPDATE OF hidden,created_at ON memes
WHEN OLD.hidden!=NEW.hidden OR date(OLD.created_at,'unixepoch','+8 hours')!=date(NEW.created_at,'unixepoch','+8 hours') BEGIN
 UPDATE view_days SET n=n-1,n_safe=n_safe-(OLD.nsfw=0)
 WHERE OLD.hidden=0 AND day=date(OLD.created_at,'unixepoch','+8 hours') AND user_id IN(SELECT user_id FROM views WHERE meme_id=OLD.id);
 INSERT INTO view_days(user_id,day,n,n_safe)
 SELECT user_id,date(NEW.created_at,'unixepoch','+8 hours'),1,(OLD.nsfw=0) FROM views WHERE meme_id=NEW.id AND NEW.hidden=0
 ON CONFLICT(user_id,day) DO UPDATE SET n=n+excluded.n,n_safe=n_safe+excluded.n_safe;
END;

CREATE TRIGGER trg_memes_view_safety AFTER UPDATE OF nsfw ON memes
WHEN OLD.nsfw!=NEW.nsfw AND NEW.hidden=0 BEGIN
 INSERT INTO view_days(user_id,day,n,n_safe)
 SELECT user_id,date(NEW.created_at,'unixepoch','+8 hours'),0,(NEW.nsfw=0)-(OLD.nsfw=0) FROM views WHERE meme_id=NEW.id
 ON CONFLICT(user_id,day) DO UPDATE SET n_safe=n_safe+excluded.n_safe;
END;

CREATE TRIGGER trg_memes_view_delete BEFORE DELETE ON memes WHEN OLD.hidden=0 BEGIN
 UPDATE view_days SET n=n-1,n_safe=n_safe-(OLD.nsfw=0)
 WHERE day=date(OLD.created_at,'unixepoch','+8 hours') AND user_id IN(SELECT user_id FROM views WHERE meme_id=OLD.id);
END;

CREATE TRIGGER trg_retired_upload_operations_ins BEFORE INSERT ON upload_operations
WHEN NEW.state='pending' AND EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_upload_operations_upd BEFORE UPDATE OF user_id ON upload_operations
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER rank_placement_unlock AFTER INSERT ON rank_placements BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rank_reward_catalog WHERE series='rank_'||NEW.board||'_'||NEW.period AND level=1) THEN RAISE(ABORT,'rank_catalog_missing') END;
 INSERT INTO user_badges(user_id,badge,n,first_at,last_day) VALUES(NEW.user_id,'rank_'||NEW.board||'_'||NEW.period,4-NEW.place,NEW.created_at,NEW.day)
 ON CONFLICT(user_id,badge) DO UPDATE SET n=n+excluded.n,last_day=MAX(last_day,excluded.last_day);
 INSERT OR IGNORE INTO user_unlocks(user_id,item,at)
 SELECT NEW.user_id,r.series||':'||r.level,NEW.created_at FROM rank_reward_catalog r
 JOIN user_badges b ON b.user_id=NEW.user_id AND b.badge=r.series
 WHERE r.series='rank_'||NEW.board||'_'||NEW.period AND b.n>=r.threshold;
 UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=NEW.user_id AND badge='rank_'||NEW.board||'_'||NEW.period))
 WHERE id=NEW.user_id AND json_valid(deco) AND json_extract(deco,'$.bd')='rank_'||NEW.board||'_'||NEW.period;
END;

CREATE TRIGGER guess_rate_excluded AFTER INSERT ON guess_rate_exclusions BEGIN
 INSERT INTO guess_rate_coverage(group_id,excluded) VALUES(NEW.group_id,1) ON CONFLICT(group_id) DO UPDATE SET excluded=excluded+1;
END;

CREATE TRIGGER guess_free_questions_rate_insert AFTER INSERT ON guess_free_questions WHEN NEW.verdict IN ('yes','no','correct','similarity') AND NOT EXISTS(SELECT 1 FROM guess_rate_rounds WHERE packet_id=NEW.packet_id) AND EXISTS(SELECT 1 FROM guess_free_rounds p WHERE p.packet_id=NEW.packet_id AND p.state='open' AND p.ends_at>unixepoch()) BEGIN
 INSERT OR IGNORE INTO guess_rate_participants VALUES(NEW.packet_id,NEW.user_id);
END;

CREATE TRIGGER guess_free_questions_rate_update AFTER UPDATE OF verdict ON guess_free_questions WHEN NEW.verdict IN ('yes','no','correct','similarity') AND NOT EXISTS(SELECT 1 FROM guess_rate_rounds WHERE packet_id=NEW.packet_id) AND EXISTS(SELECT 1 FROM guess_free_rounds p WHERE p.packet_id=NEW.packet_id AND p.state='open' AND p.ends_at>unixepoch()) BEGIN
 INSERT OR IGNORE INTO guess_rate_participants VALUES(NEW.packet_id,NEW.user_id);
END;

CREATE TRIGGER guess_free_rounds_rate_close AFTER UPDATE OF state ON guess_free_rounds
 WHEN NEW.state='closed' AND OLD.state='open' AND NEW.mode IN ('guess','clues') AND NEW.game_version=1
 AND NOT EXISTS(SELECT 1 FROM guess_rate_exclusions WHERE packet_id=NEW.packet_id) BEGIN
 INSERT OR IGNORE INTO guess_rate_participants SELECT packet_id,user_id FROM guess_wins WHERE packet_id=NEW.packet_id;
 INSERT OR IGNORE INTO guess_rate_participants SELECT NEW.packet_id,NEW.winner_id WHERE NEW.winner_id IS NOT NULL;
 INSERT OR IGNORE INTO guess_rate_rounds SELECT NEW.packet_id,NEW.group_id,date(t.at,'unixepoch','+8 hours'),t.at,NEW.winner_id,'live'
 FROM (SELECT COALESCE(NEW.won_at,MIN(NEW.ends_at,unixepoch())) at) t;
END;

CREATE TRIGGER rank_group_jobs AFTER INSERT ON chat_groups BEGIN
 INSERT INTO rank_settlement_jobs
 SELECT NEW.id,b.board,p.period,((unixepoch()+b.offset)/86400+1)*86400-b.offset
 FROM (SELECT column1 board,column2 offset FROM (VALUES ('guess',28800),('guess_winrate',28800),('sender_count',28800),('sender_paid',28800),('chat_count',14400),('chat_early',14400),('chat_late',14400))) b JOIN (SELECT 'day' period UNION ALL SELECT 'all') p;
END;

CREATE TRIGGER title_entry_refund AFTER UPDATE OF result ON chat_title_raffle_entries
WHEN NEW.result=2 AND OLD.result IS NULL AND NEW.paid>0 AND NEW.refunded=0 BEGIN
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
 SELECT NEW.user_id,'title-refund',NEW.raffle_id,'title-refund:'||NEW.raffle_id||':'||NEW.user_id,NEW.paid,balance+NEW.paid,unixepoch()
 FROM coin52_wallets WHERE user_id=NEW.user_id;
 UPDATE coin52_wallets SET balance=balance+NEW.paid,revision=revision+1,updated_at=unixepoch() WHERE user_id=NEW.user_id;
 UPDATE chat_title_raffle_entries SET refunded=1 WHERE raffle_id=NEW.raffle_id AND user_id=NEW.user_id;
END;

CREATE TRIGGER title_cancel_refund AFTER UPDATE OF status ON chat_title_raffles
WHEN NEW.paid_version=1 AND NEW.status='cancelled' AND OLD.status='open' BEGIN
 UPDATE chat_title_raffle_entries SET result=2 WHERE raffle_id=NEW.id AND result IS NULL;
END;

CREATE TRIGGER instant_pool_active BEFORE INSERT ON instant_card_pools WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER instant_finger_active BEFORE INSERT ON instant_card_fingers WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER packet_draw_entry_retired BEFORE INSERT ON packet_draw_entries WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER fish_accounts_retired_insert BEFORE INSERT ON fish_accounts WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER fish_accounts_retired_update BEFORE UPDATE ON fish_accounts WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER chat_message_favorites_retired_insert BEFORE INSERT ON chat_message_favorites
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER chat_message_favorites_retired_update BEFORE UPDATE OF user_id ON chat_message_favorites
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER activity_honor_retired BEFORE INSERT ON activity_honor_events
 WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER activity_honor_immutable BEFORE UPDATE ON activity_honor_events
 BEGIN SELECT RAISE(ABORT,'activity_honor_immutable'); END;

CREATE TRIGGER activity_honor_grant AFTER INSERT ON activity_honor_events BEGIN
 INSERT INTO user_badges(user_id,badge,n,first_at,last_day)
 VALUES(NEW.user_id,NEW.series,1,NEW.created_at,date(NEW.created_at,'unixepoch','+8 hours'))
 ON CONFLICT(user_id,badge) DO UPDATE SET n=n+1,last_day=excluded.last_day;
 INSERT OR IGNORE INTO user_unlocks(user_id,item,at)
 SELECT NEW.user_id,NEW.series||':'||level,NEW.created_at
 FROM (SELECT 1 level,1 threshold UNION ALL SELECT 2,3 UNION ALL SELECT 3,10 UNION ALL SELECT 4,30 UNION ALL SELECT 5,100)
 WHERE threshold<=(SELECT n FROM user_badges WHERE user_id=NEW.user_id AND badge=NEW.series);
 UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=NEW.user_id AND badge=NEW.series))
 WHERE id=NEW.user_id AND json_valid(deco) AND json_extract(deco,'$.bd')=NEW.series;
END;

CREATE TRIGGER free_firstshot_honor AFTER UPDATE OF verdict ON guess_free_questions
WHEN NEW.kind='guess' AND OLD.verdict='pending' AND NEW.verdict<>'pending'
 AND NOT EXISTS(SELECT 1 FROM activity_honor_events WHERE event_key=NEW.packet_id AND series='guess_firstshot')
 AND EXISTS(SELECT 1 FROM guess_wins WHERE packet_id=NEW.packet_id) BEGIN
 INSERT OR IGNORE INTO activity_honor_events(event_key,user_id,series,created_at)
 SELECT w.packet_id,CASE r.series WHEN 'guess_firstshot' THEN w.user_id ELSE p.owner_id END,r.series,unixepoch()
 FROM guess_wins w JOIN guess_free_rounds p ON p.packet_id=w.packet_id
 JOIN (SELECT 'guess_firstshot' series UNION ALL SELECT 'guess_easy') r
 JOIN users u ON u.id=CASE r.series WHEN 'guess_firstshot' THEN w.user_id ELSE p.owner_id END
 WHERE w.packet_id=NEW.packet_id AND u.disabled=0 AND u.kind='user'
 AND EXISTS(SELECT 1 FROM guess_free_questions q WHERE q.packet_id=w.packet_id AND q.kind='guess' AND q.verdict='correct' AND q.user_id=w.user_id)
 AND NOT EXISTS(SELECT 1 FROM guess_free_questions q WHERE q.packet_id=w.packet_id AND q.kind='guess' AND q.verdict NOT IN('correct','unavailable','error','not_question'));
END;

CREATE TRIGGER trg_content_reward_retired BEFORE INSERT ON content_coin_rewards
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_content_reward_identity BEFORE UPDATE OF source,content_id,user_id ON content_coin_rewards
BEGIN SELECT RAISE(ABORT,'reward_identity_immutable'); END;

CREATE TRIGGER trg_content_reward_final BEFORE UPDATE ON content_coin_rewards WHEN OLD.state<>'pending'
BEGIN SELECT RAISE(ABORT,'reward_final_immutable'); END;

CREATE TRIGGER trg_meme_coin_reward AFTER INSERT ON memes
WHEN NEW.author_id IS NOT NULL AND NEW.hidden=0
 AND EXISTS(SELECT 1 FROM users WHERE id=NEW.author_id AND disabled=0 AND kind='user')
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.author_id)
BEGIN INSERT OR IGNORE INTO content_coin_rewards(source,content_id,user_id,available_at,created_at)
 VALUES('post',NEW.id,NEW.author_id,unixepoch()+60,unixepoch()); END;

CREATE TRIGGER trg_road_coin_reward AFTER INSERT ON road_items
WHEN NEW.hidden=0 AND NEW.source_hidden=0
 AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND disabled=0 AND kind='user')
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN INSERT OR IGNORE INTO content_coin_rewards(source,content_id,user_id,available_at,created_at)
 VALUES('road',NEW.id,NEW.user_id,unixepoch()+60,unixepoch()); END;

CREATE TRIGGER fish_capacity_check BEFORE INSERT ON fish_capacity_checks
 WHEN COALESCE((SELECT revision FROM fish_capacity_versions WHERE owner_id=NEW.owner_id),0)<>NEW.expected_revision
 BEGIN SELECT RAISE(ABORT,'fish_capacity_changed'); END;

CREATE TRIGGER fish_capacity_check_clear AFTER INSERT ON fish_capacity_checks
 BEGIN DELETE FROM fish_capacity_checks WHERE rowid=NEW.rowid; END;

CREATE TRIGGER fish_capacity_version_insert AFTER INSERT ON fish_packet_capacity BEGIN
 INSERT INTO fish_capacity_versions(owner_id,revision) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
 END;

CREATE TRIGGER fish_capacity_version_update AFTER UPDATE ON fish_packet_capacity BEGIN
 INSERT INTO fish_capacity_versions(owner_id,revision) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
 END;

CREATE TRIGGER fish_capacity_version_delete AFTER DELETE ON fish_packet_capacity BEGIN
 INSERT INTO fish_capacity_versions(owner_id,revision) VALUES(OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
 END;

CREATE TRIGGER huancai_order_active BEFORE INSERT ON huancai_orders WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER farm_loss_crop AFTER INSERT ON farm_visits WHEN NEW.kind='steal' AND NEW.amount>0 BEGIN
 INSERT INTO farm_loss_totals(user_id,crops,total) VALUES(NEW.owner_id,NEW.amount,NEW.amount)
 ON CONFLICT(user_id) DO UPDATE SET crops=crops+NEW.amount,total=total+NEW.amount;
END;

CREATE TRIGGER farm_loss_product AFTER INSERT ON farm_ranch_visits WHEN NEW.kind='animal_steal' AND NEW.amount>0 BEGIN
 INSERT INTO farm_loss_totals(user_id,products,total) VALUES(NEW.owner_id,NEW.amount,NEW.amount)
 ON CONFLICT(user_id) DO UPDATE SET products=products+NEW.amount,total=total+NEW.amount;
END;

CREATE TRIGGER community_wealth_insert AFTER INSERT ON coin52_wallets BEGIN
 INSERT INTO community_progress(user_id,metric,value) VALUES(NEW.user_id,'coins_peak',NEW.balance)
 ON CONFLICT(user_id,metric) DO UPDATE SET value=excluded.value WHERE community_progress.value<excluded.value;
END;

CREATE TRIGGER community_wealth_update AFTER UPDATE OF balance ON coin52_wallets WHEN NEW.balance>OLD.balance BEGIN
 INSERT INTO community_progress(user_id,metric,value) VALUES(NEW.user_id,'coins_peak',NEW.balance)
 ON CONFLICT(user_id,metric) DO UPDATE SET value=excluded.value WHERE community_progress.value<excluded.value;
END;

CREATE TRIGGER huancai_lotto_contribution AFTER UPDATE OF sales ON huancai_rounds
WHEN NEW.rules_version>=3 AND NEW.sales>OLD.sales BEGIN
 UPDATE huancai_jackpot SET available=available+(NEW.sales-OLD.sales)/10*8,
 contributed=contributed+(NEW.sales-OLD.sales)/10*8,updated_at=unixepoch() WHERE id=1;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'huancai_jackpot_missing') END;
END;

CREATE TRIGGER farm_market_import_revision BEFORE INSERT ON farm_market_imports
WHEN NOT EXISTS(SELECT 1 FROM farm_saves WHERE user_id=NEW.user_id AND revision=NEW.source_revision)
BEGIN SELECT RAISE(ABORT,'market_import_conflict'); END;

CREATE TRIGGER farm_market_import_apply AFTER INSERT ON farm_market_imports BEGIN
 INSERT OR IGNORE INTO farm_market_accounts(user_id,created_at) VALUES(NEW.user_id,NEW.created_at);
 INSERT OR IGNORE INTO farm_market_goods(item,base_cents,price_cents,tick_at,fresh_at)
 SELECT json_extract(value,'$.item'),json_extract(value,'$.base'),json_extract(value,'$.base'),NEW.created_at,NEW.created_at FROM json_each(NEW.quantities);
 INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at)
 SELECT json_extract(value,'$.id'),NEW.user_id,json_extract(value,'$.item'),json_extract(value,'$.source'),json_extract(value,'$.quantity'),json_extract(value,'$.born'),json_extract(value,'$.expires') FROM json_each(NEW.quantities) WHERE 1
 ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1;
 UPDATE farm_market_goods SET
 fresh_seconds=fresh_seconds+(SELECT sum(json_extract(value,'$.quantity')*(json_extract(value,'$.expires')-farm_market_goods.fresh_at)) FROM json_each(NEW.quantities) WHERE json_extract(value,'$.item')=farm_market_goods.item),
 fresh_qty=fresh_qty+(SELECT sum(json_extract(value,'$.quantity')) FROM json_each(NEW.quantities) WHERE json_extract(value,'$.item')=farm_market_goods.item),revision=revision+1
 WHERE item IN(SELECT json_extract(value,'$.item') FROM json_each(NEW.quantities));
 UPDATE farm_saves SET state=NEW.migrated_state,revision=revision+1,updated_at=NEW.created_at WHERE user_id=NEW.user_id;
END;

CREATE TRIGGER farm_market_supply_apply AFTER INSERT ON farm_market_supply_grants BEGIN
 INSERT OR IGNORE INTO farm_market_goods(item,base_cents,price_cents,tick_at,fresh_at)
 VALUES(NEW.item,NEW.base_cents,NEW.base_cents,NEW.born_at,NEW.born_at);
 INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at)
 VALUES('initial-'||NEW.id,0,NEW.item,'market',NEW.quantity,NEW.born_at,NEW.expires_at)
 ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired)
 DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1;
 UPDATE farm_market_goods SET fresh_seconds=fresh_seconds+NEW.quantity*(NEW.expires_at-fresh_at),
 fresh_qty=fresh_qty+NEW.quantity,revision=revision+1 WHERE item=NEW.item;
END;

CREATE TRIGGER guess_fish_capacity_insert AFTER INSERT ON guess_fish_orders BEGIN
 INSERT INTO fish_capacity_versions(owner_id,revision) VALUES(NEW.payer_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
 INSERT INTO fish_capacity_versions(owner_id,revision) SELECT f.custodian_id,1 FROM guess_fish_pools f JOIN guess_prediction_bets b ON b.packet_id=f.packet_id WHERE b.id=NEW.bet_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER guess_fish_capacity_update AFTER UPDATE OF state ON guess_fish_orders WHEN OLD.state<>NEW.state BEGIN
 INSERT INTO fish_capacity_versions(owner_id,revision) VALUES(NEW.payer_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
 INSERT INTO fish_capacity_versions(owner_id,revision) SELECT f.custodian_id,1 FROM guess_fish_pools f JOIN guess_prediction_bets b ON b.packet_id=f.packet_id WHERE b.id=NEW.bet_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
END;

CREATE TRIGGER user_ai_call_count AFTER INSERT ON user_ai_calls BEGIN
 UPDATE user_ai_consents SET used_calls=used_calls+1 WHERE id=NEW.consent_id;
END;

CREATE TRIGGER trg_memes_ins AFTER INSERT ON memes BEGIN
 UPDATE memes SET nsfw=NEW.spoiler,hot=NEW.ld_likes+NEW.like_count*2+NEW.reaction_count+NEW.reply_count*2+NEW.comment_count*3+NEW.fav_count*3 WHERE id=NEW.id;
 DELETE FROM stats_cache WHERE key NOT LIKE 'series:%' OR NEW.series IS NOT NULL;
END;

CREATE TRIGGER trg_memes_flag AFTER UPDATE OF spoiler,hidden,created_at ON memes BEGIN
 UPDATE memes SET nsfw=(NEW.spoiler=1 OR EXISTS(SELECT 1 FROM meme_tags t WHERE t.meme_id=NEW.id AND t.tag IN ('番号/车牌','番号','车牌','NSFW','nsfw','涩图','福利'))) WHERE id=NEW.id;
 DELETE FROM stats_cache WHERE key NOT LIKE 'series:%' OR NEW.series IS NOT NULL OR OLD.series IS NOT NULL;
END;

CREATE TRIGGER trg_tags_ins AFTER INSERT ON meme_tags BEGIN
 UPDATE memes SET nsfw=1 WHERE id=NEW.meme_id AND NEW.tag IN ('番号/车牌','番号','车牌','NSFW','nsfw','涩图','福利');
 DELETE FROM stats_cache WHERE key NOT LIKE 'series:%' OR EXISTS(SELECT 1 FROM memes WHERE id=NEW.meme_id AND series IS NOT NULL);
END;

CREATE TRIGGER trg_tags_del AFTER DELETE ON meme_tags BEGIN
 UPDATE memes SET nsfw=(spoiler=1 OR EXISTS(SELECT 1 FROM meme_tags t WHERE t.meme_id=OLD.meme_id AND t.tag IN ('番号/车牌','番号','车牌','NSFW','nsfw','涩图','福利'))) WHERE id=OLD.meme_id;
 DELETE FROM stats_cache WHERE key NOT LIKE 'series:%' OR EXISTS(SELECT 1 FROM memes WHERE id=OLD.meme_id AND series IS NOT NULL);
END;

CREATE TRIGGER trg_series_metadata AFTER UPDATE OF series,title,thumb_url,image_url,image_key ON memes
WHEN OLD.series IS NOT NULL OR NEW.series IS NOT NULL BEGIN
 DELETE FROM stats_cache WHERE key LIKE 'series:%';
END;

CREATE TRIGGER trg_series_deleted AFTER DELETE ON memes WHEN OLD.series IS NOT NULL BEGIN
 DELETE FROM stats_cache WHERE key LIKE 'series:%';
END;

CREATE TRIGGER trg_word_archive_paid_win AFTER UPDATE OF recipient_id ON ldc_awards
 WHEN NEW.recipient_id IS NOT NULL AND OLD.recipient_id IS NULL BEGIN
 UPDATE guess_word_archive_jobs SET next_at=0 WHERE store='ldc' AND packet_id=NEW.packet_id AND status='pending';
END;

CREATE TRIGGER trg_word_archive_paid_award AFTER INSERT ON ldc_awards
 WHEN NEW.recipient_id IS NOT NULL BEGIN
 UPDATE guess_word_archive_jobs SET next_at=0 WHERE store='ldc' AND packet_id=NEW.packet_id AND status='pending';
END;

CREATE TRIGGER trg_word_archive_free_insert AFTER INSERT ON guess_free_rounds
 WHEN NEW.mode IN ('guess','clues') BEGIN
 INSERT OR IGNORE INTO guess_word_archive_jobs(store,packet_id,next_at) VALUES('none',NEW.packet_id,CASE WHEN NEW.state='closed' OR NEW.winner_id IS NOT NULL THEN 0 ELSE NEW.ends_at END);
END;

CREATE TRIGGER trg_word_archive_free_end AFTER UPDATE OF state,ends_at,winner_id ON guess_free_rounds
 WHEN NEW.state<>OLD.state OR NEW.ends_at<>OLD.ends_at OR NEW.winner_id IS NOT OLD.winner_id BEGIN
 UPDATE guess_word_archive_jobs SET next_at=CASE WHEN NEW.state='closed' OR NEW.winner_id IS NOT NULL THEN 0 ELSE NEW.ends_at END
 WHERE store='none' AND packet_id=NEW.packet_id AND status IN ('pending','error');
END;

CREATE TRIGGER resource_approval_insert AFTER INSERT ON resource_marks WHEN NEW.approved=1 BEGIN
 UPDATE resource_posts SET approvals=approvals+1 WHERE id=NEW.post_id;
END;

CREATE TRIGGER resource_approval_update AFTER UPDATE OF approved ON resource_marks WHEN NEW.approved!=OLD.approved BEGIN
 UPDATE resource_posts SET approvals=approvals+NEW.approved-OLD.approved WHERE id=NEW.post_id;
END;

CREATE TRIGGER resource_recognition_apply AFTER INSERT ON resource_recognition BEGIN
 INSERT INTO community_progress(user_id,metric,value) VALUES(NEW.author_id,'resource_respect',1)
 ON CONFLICT(user_id,metric) DO UPDATE SET value=value+1;
END;

CREATE TRIGGER resource_comment_insert AFTER INSERT ON resource_comments BEGIN
 UPDATE resource_posts SET comments=comments+1 WHERE id=NEW.post_id;
END;

CREATE TRIGGER resource_comment_hide AFTER UPDATE OF hidden ON resource_comments WHEN OLD.hidden=0 AND NEW.hidden=1 BEGIN
 UPDATE resource_posts SET comments=MAX(0,comments-1) WHERE id=NEW.post_id;
END;

CREATE TRIGGER huancai_jackpot_floor AFTER UPDATE OF available,reserved ON huancai_jackpot
WHEN NEW.available+NEW.reserved<500000000 BEGIN
 -- Existing conservation CHECK uses contributed as all external funding.
 -- topups is its separately reported subset; sales contribution = contributed-topups.
 UPDATE huancai_jackpot SET topups=topups+500000000-available-reserved,
 contributed=contributed+500000000-available-reserved,available=500000000-reserved WHERE id=NEW.id;
END;

CREATE TRIGGER huancai_weekly_pay AFTER INSERT ON huancai_weekly WHEN NEW.payout>0 BEGIN
 INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) VALUES(NEW.user_id,NEW.created_at);
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
 SELECT NEW.user_id,'huancai-weekly',NEW.week,'weekly:'||NEW.week,NEW.payout,balance+NEW.payout,NEW.created_at FROM coin52_wallets WHERE user_id=NEW.user_id;
 UPDATE coin52_wallets SET balance=balance+NEW.payout,revision=revision+1,updated_at=NEW.created_at WHERE user_id=NEW.user_id;
 UPDATE huancai_jackpot SET available=available-NEW.payout,paid=paid+NEW.payout,updated_at=NEW.created_at WHERE id=1;
END;

CREATE TRIGGER coin52_beta_snapshot AFTER INSERT ON coin52_grant_batches BEGIN
 INSERT INTO coin52_grant_recipients(batch_id,user_id)
 SELECT NEW.id,u.id FROM chat_members m JOIN users u ON u.id=m.user_id
 WHERE m.group_id=1 AND u.kind='user' AND u.disabled=0
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id);
END;

CREATE TRIGGER coin52_beta_pay AFTER INSERT ON coin52_grant_recipients BEGIN
 INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) SELECT NEW.user_id,created_at FROM coin52_grant_batches WHERE id=NEW.batch_id;
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
 SELECT NEW.user_id,'admin-beta-grant',b.id,'beta:'||b.id||':'||NEW.user_id,b.amount,w.balance+b.amount,b.created_at
 FROM coin52_grant_batches b JOIN coin52_wallets w ON w.user_id=NEW.user_id WHERE b.id=NEW.batch_id;
 UPDATE coin52_wallets SET balance=balance+(SELECT amount FROM coin52_grant_batches WHERE id=NEW.batch_id),revision=revision+1,
 updated_at=(SELECT created_at FROM coin52_grant_batches WHERE id=NEW.batch_id) WHERE user_id=NEW.user_id;
END;

CREATE TRIGGER site_release_notice_chat AFTER INSERT ON site_release_notices BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=999999999 AND username='jinhuan_ai' AND kind='bot' AND disabled=0)
  OR NOT EXISTS(SELECT 1 FROM chat_groups WHERE is_default=1) THEN RAISE(ABORT,'release_notice_chat_unavailable') END;
 INSERT INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
 SELECT id,999999999,NEW.body,NEW.created_at,NEW.created_at,'release_notice',NEW.release_key||':'||id FROM chat_groups WHERE is_default=1;
END;

CREATE TRIGGER farm_farewell_snapshot AFTER INSERT ON farm_farewell_batches BEGIN
 INSERT INTO farm_farewell_recipients(batch_id,user_id)
 SELECT NEW.id,id FROM users WHERE id>0 AND kind='user' AND disabled=0 AND created_at<=NEW.closes_at
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=users.id);
 INSERT INTO farm_farewell_prices(batch_id,item,price_cents)
 SELECT NEW.id,item,price_cents FROM farm_market_goods;
END;

CREATE TRIGGER invite_activates_main AFTER INSERT ON invites WHEN NEW.revoked=0 BEGIN
 UPDATE users SET main_activated_at=COALESCE(main_activated_at,NEW.created_at) WHERE id=NEW.invitee_id;
END;

CREATE TRIGGER farm_lease_recovery_guard BEFORE INSERT ON farm_lease_recoveries
WHEN NOT EXISTS(SELECT 1 FROM farm_lease_recoveries WHERE lease_id=NEW.lease_id) BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM farm_leases l JOIN coin52_wallets o ON o.user_id=l.owner_id JOIN coin52_wallets t ON t.user_id=l.tenant_id
  WHERE l.id=NEW.lease_id AND l.owner_id=NEW.owner_id AND l.tenant_id=NEW.tenant_id AND l.plot=NEW.plot
   AND l.state='active' AND l.forced=1 AND l.price=NEW.rent_refund AND l.crop_state=NEW.crop_state
   AND o.balance>=NEW.rent_refund AND t.balance<=9007199254740991-NEW.rent_refund-NEW.crop_coins
   AND EXISTS(SELECT 1 FROM farm_lease_buybacks b WHERE b.owner_id=l.owner_id AND b.plot=l.plot AND b.created_at<=l.started_at)
 ) THEN RAISE(ABORT,'lease recovery state changed') END;
END;

CREATE TRIGGER farm_lease_recovery_settle AFTER INSERT ON farm_lease_recoveries BEGIN
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
 SELECT user_id,'farm-rerent-recovery',NEW.lease_id,'rerent-recovery-'||NEW.lease_id||'-'||user_id,
 CASE WHEN user_id=NEW.owner_id THEN -NEW.rent_refund ELSE NEW.rent_refund+NEW.crop_coins END,
 balance+CASE WHEN user_id=NEW.owner_id THEN -NEW.rent_refund ELSE NEW.rent_refund+NEW.crop_coins END,NEW.created_at
 FROM coin52_wallets WHERE user_id IN(NEW.owner_id,NEW.tenant_id);
 UPDATE coin52_wallets SET balance=balance+CASE WHEN user_id=NEW.owner_id THEN -NEW.rent_refund ELSE NEW.rent_refund+NEW.crop_coins END,revision=revision+1,updated_at=NEW.created_at WHERE user_id IN(NEW.owner_id,NEW.tenant_id);
 UPDATE farm_leases SET state='ended',crop_state='{"tilled":true}',revision=revision+1 WHERE id=NEW.lease_id;
 UPDATE farm_saves SET revision=revision+1 WHERE user_id IN(NEW.owner_id,NEW.tenant_id);
 DELETE FROM farm_lease_offers WHERE owner_id=NEW.owner_id AND plot=NEW.plot;
END;

CREATE TRIGGER music_recommendation_quota BEFORE INSERT ON music_recommendations
WHEN NOT EXISTS(SELECT 1 FROM music_recommendations WHERE list=NEW.list AND track_key=NEW.track_key AND user_id=NEW.user_id)
AND (SELECT COUNT(*) FROM music_recommendations WHERE user_id=NEW.user_id)>=500
BEGIN SELECT RAISE(ABORT,'music_recommendation_quota'); END;

CREATE TRIGGER trg_retired_slime_insert BEFORE INSERT ON slime_saves
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER trg_retired_slime_update BEFORE UPDATE ON slime_saves
WHEN NEW.user_id<>OLD.user_id OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER coin52_wealth_wallet AFTER INSERT ON coin52_wallets
BEGIN
 INSERT OR IGNORE INTO coin52_wealth(user_id,earned,updated_at) VALUES(NEW.user_id,NEW.balance,NEW.updated_at);
END;

CREATE TRIGGER coin52_wealth_remove_wallet AFTER DELETE ON coin52_wallets
BEGIN
 DELETE FROM coin52_wealth WHERE user_id=OLD.user_id;
END;

CREATE TRIGGER coin52_wealth_income AFTER INSERT ON coin52_ledger
WHEN NEW.delta>0 AND NEW.kind NOT LIKE '%refund%' AND NEW.kind NOT LIKE '%return%'
BEGIN
 INSERT INTO coin52_wealth(user_id,earned,updated_at) VALUES(NEW.user_id,NEW.delta,NEW.created_at)
 ON CONFLICT(user_id) DO UPDATE SET earned=MIN(9007199254740991,coin52_wealth.earned+excluded.earned),updated_at=excluded.updated_at;
END;

CREATE TRIGGER huancai_award_correct AFTER INSERT ON huancai_award_corrections
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM huancai_weekly h JOIN coin52_wallets w ON w.user_id=h.user_id
  JOIN coin52_wealth e ON e.user_id=h.user_id JOIN huancai_jackpot p ON p.id=1
  WHERE h.week=NEW.week AND h.payout=NEW.original_amount AND w.balance>=NEW.original_amount
  AND e.earned>=NEW.original_amount AND p.paid>=NEW.original_amount
  AND EXISTS(SELECT 1 FROM coin52_ledger l WHERE l.user_id=h.user_id AND l.kind='huancai-weekly' AND l.ref=h.week AND l.delta=NEW.original_amount)
 ) THEN RAISE(ABORT,'award correction precondition changed') END;
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
 SELECT h.user_id,'huancai-award-reversal',NEW.week,'weekly-correction:reverse:'||NEW.week,-NEW.original_amount,w.balance-NEW.original_amount,NEW.created_at
 FROM huancai_weekly h JOIN coin52_wallets w ON w.user_id=h.user_id WHERE h.week=NEW.week;
 UPDATE coin52_wallets SET balance=balance-NEW.original_amount,revision=revision+1,updated_at=NEW.created_at WHERE user_id=(SELECT user_id FROM huancai_weekly WHERE week=NEW.week);
 UPDATE coin52_wealth SET earned=earned-NEW.original_amount,updated_at=NEW.created_at WHERE user_id=(SELECT user_id FROM huancai_weekly WHERE week=NEW.week);
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
 SELECT h.user_id,'huancai-award-reissue',NEW.week,'weekly-correction:reissue:'||NEW.week,NEW.replacement_amount,w.balance+NEW.replacement_amount,NEW.created_at
 FROM huancai_weekly h JOIN coin52_wallets w ON w.user_id=h.user_id WHERE h.week=NEW.week;
 UPDATE coin52_wallets SET balance=balance+NEW.replacement_amount,revision=revision+1,updated_at=NEW.created_at WHERE user_id=(SELECT user_id FROM huancai_weekly WHERE week=NEW.week);
 UPDATE huancai_jackpot SET available=available+NEW.original_amount-NEW.replacement_amount,paid=paid-NEW.original_amount+NEW.replacement_amount,updated_at=NEW.created_at WHERE id=1;
 UPDATE huancai_weekly SET payout=NEW.replacement_amount WHERE week=NEW.week;
 UPDATE chat_messages SET body=REPLACE(body,'获得 '||NEW.original_amount||' D币','获得 '||NEW.replacement_amount||' D币')||'（奖金已按新规则调整：原奖励已冲正，500万 D币已补发。）',edited_at=NEW.created_at,updated_at=NEW.created_at
 WHERE system_kind='huancai_draw' AND system_ref='huancai-weekly:'||NEW.week;
END;

CREATE TRIGGER huancai_award_supplement AFTER INSERT ON coin52_ledger
WHEN NEW.kind='huancai-award-supplement'
BEGIN
 SELECT CASE WHEN NEW.delta!=200000 OR NOT EXISTS(
  SELECT 1 FROM huancai_weekly h JOIN coin52_wallets w ON w.user_id=h.user_id JOIN huancai_jackpot p ON p.id=1
  WHERE h.week=NEW.ref AND h.user_id=NEW.user_id AND h.payout=5000000
   AND NEW.balance_after=w.balance+NEW.delta AND p.available>=NEW.delta
   AND EXISTS(SELECT 1 FROM huancai_award_corrections c WHERE c.week=h.week AND c.replacement_amount=5000000)
 ) THEN RAISE(ABORT,'award supplement precondition changed') END;
 UPDATE coin52_wallets SET balance=balance+NEW.delta,revision=revision+1,updated_at=NEW.created_at WHERE user_id=NEW.user_id;
 UPDATE huancai_jackpot SET available=available-NEW.delta,paid=paid+NEW.delta,updated_at=NEW.created_at WHERE id=1;
 UPDATE huancai_weekly SET payout=payout+NEW.delta WHERE week=NEW.ref;
 UPDATE chat_messages SET body=REPLACE(REPLACE(body,'获得 5000000 D币','获得 5200000 D币'),'500万 D币已补发','520万 D币已补发'),edited_at=NEW.created_at,updated_at=NEW.created_at
 WHERE system_kind='huancai_draw' AND system_ref='huancai-weekly:'||NEW.ref;
END;

CREATE TRIGGER fish_capacity_award_delete AFTER DELETE ON ldc_awards WHEN EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=OLD.packet_id AND payment_provider='fish') BEGIN
 DELETE FROM fish_packet_capacity WHERE packet_id=OLD.packet_id;
 INSERT INTO fish_packet_capacity SELECT * FROM fish_capacity_source WHERE packet_id=OLD.packet_id AND (reserved_cents>0 OR unpaid_cents>0);
 END;

CREATE TRIGGER fish_capacity_award_insert AFTER INSERT ON ldc_awards WHEN EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id AND payment_provider='fish') BEGIN
 DELETE FROM fish_packet_capacity WHERE packet_id=NEW.packet_id;
 INSERT INTO fish_packet_capacity SELECT * FROM fish_capacity_source WHERE packet_id=NEW.packet_id AND (reserved_cents>0 OR unpaid_cents>0);
 END;

CREATE TRIGGER fish_capacity_award_update AFTER UPDATE OF state,recipient_id,amount_cents ON ldc_awards WHEN EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id AND payment_provider='fish') BEGIN
 DELETE FROM fish_packet_capacity WHERE packet_id=NEW.packet_id;
 INSERT INTO fish_packet_capacity SELECT * FROM fish_capacity_source WHERE packet_id=NEW.packet_id AND (reserved_cents>0 OR unpaid_cents>0);
 END;

CREATE TRIGGER fish_capacity_packet_insert AFTER INSERT ON ldc_packets WHEN NEW.payment_provider='fish' BEGIN
 DELETE FROM fish_packet_capacity WHERE packet_id=NEW.packet_id;
 INSERT INTO fish_packet_capacity SELECT * FROM fish_capacity_source WHERE packet_id=NEW.packet_id AND (reserved_cents>0 OR unpaid_cents>0);
 END;

CREATE TRIGGER fish_capacity_packet_update AFTER UPDATE OF state,total_cents,base_total_cents,escalation_cap_cents,reward_freeze_ai_count,ends_at,payment_provider ON ldc_packets WHEN NEW.payment_provider='fish' OR OLD.payment_provider='fish' BEGIN
 DELETE FROM fish_packet_capacity WHERE packet_id=NEW.packet_id;
 INSERT INTO fish_packet_capacity SELECT * FROM fish_capacity_source WHERE packet_id=NEW.packet_id AND (reserved_cents>0 OR unpaid_cents>0);
 END;

CREATE TRIGGER free_guess_single_active BEFORE INSERT ON guess_free_rounds
WHEN NOT EXISTS(SELECT 1 FROM guess_free_rounds WHERE packet_id=NEW.packet_id) AND (
 EXISTS(SELECT 1 FROM guess_free_rounds WHERE group_id=NEW.group_id AND state='open' AND winner_id IS NULL AND ends_at>NEW.created_at) OR
 EXISTS(SELECT 1 FROM ldc_packets p WHERE p.group_id=NEW.group_id AND p.state='open' AND p.mode IN('guess','clues') AND p.ends_at>NEW.created_at
 AND (SELECT count(*) FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)<p.count))
BEGIN SELECT RAISE(ABORT,'ldc_active_game'); END;

CREATE TRIGGER guess_close_vote_signal AFTER UPDATE OF choice ON guess_close_electors
WHEN OLD.choice IS NULL AND NEW.choice IS NOT NULL BEGIN
 UPDATE chat_messages SET updated_at=unixepoch() WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=NEW.packet_id);
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
 UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER guess_explanation_enqueue AFTER INSERT ON chat_messages
WHEN NEW.system_kind IN('ldc_winner','ldc_expired','ldc_cancel') AND NEW.deleted=0 BEGIN
 INSERT OR IGNORE INTO guess_answer_explanations(packet_id,notice_id,next_at)
 SELECT r.id,NEW.id,NEW.created_at FROM chat_redpacks r
 WHERE r.message_id=CAST(NEW.system_ref AS INTEGER) AND (
 EXISTS(SELECT 1 FROM ldc_packets p WHERE p.packet_id=r.id AND p.mode IN('guess','clues')) OR
 EXISTS(SELECT 1 FROM guess_free_rounds p WHERE p.packet_id=r.id));
END;

CREATE TRIGGER guess_fish_room_update AFTER UPDATE OF state ON guess_fish_orders WHEN OLD.state<>NEW.state BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=(SELECT packet_id FROM guess_prediction_bets WHERE id=NEW.bet_id);
 UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id=(SELECT packet_id FROM guess_prediction_bets WHERE id=NEW.bet_id);
 UPDATE chat_messages SET updated_at=unixepoch() WHERE id=(SELECT r.message_id FROM chat_redpacks r JOIN guess_prediction_bets b ON b.packet_id=r.id WHERE b.id=NEW.bet_id);
END;

CREATE TRIGGER guess_luckybag_candidate_refresh AFTER INSERT ON guess_luckybag_candidates BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER guess_luckybag_question_insert AFTER INSERT ON ldc_questions
 WHEN (NEW.kind='guess' AND ((NEW.score BETWEEN 0 AND 100 AND NEW.verdict IN('similarity','correct')) OR NEW.verdict='no')) OR (NEW.kind='question' AND NEW.verdict IN('yes','no'))
 BEGIN
 INSERT OR IGNORE INTO guess_luckybag_candidates(packet_id,user_id,qualified_at)
 SELECT NEW.packet_id,NEW.user_id,unixepoch() FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id
 JOIN users u ON u.id=NEW.user_id JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=p.group_id
 WHERE b.packet_id=NEW.packet_id AND b.state IN('pending','scheduled','open') AND p.state='open' AND p.ends_at>unixepoch()
 AND u.disabled=0 AND u.kind='user' AND u.id<>p.owner_id
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE user_id=u.id AND group_id=p.group_id)
 AND ((NEW.source_room_id IS NOT NULL AND EXISTS(SELECT 1 FROM guess_room_messages s WHERE s.id=NEW.source_room_id AND s.packet_id=p.packet_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at))
 OR (NEW.source_room_id IS NULL AND EXISTS(SELECT 1 FROM chat_messages s WHERE s.id=NEW.source_message_id AND s.group_id=p.group_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at)))
 AND (SELECT COUNT(*) FROM guess_luckybag_candidates WHERE packet_id=b.packet_id)<1000;
END;

CREATE TRIGGER guess_luckybag_question_update AFTER UPDATE OF verdict,score ON ldc_questions
 WHEN (NEW.kind='guess' AND ((NEW.score BETWEEN 0 AND 100 AND NEW.verdict IN('similarity','correct')) OR NEW.verdict='no')) OR (NEW.kind='question' AND NEW.verdict IN('yes','no'))
 BEGIN
 INSERT OR IGNORE INTO guess_luckybag_candidates(packet_id,user_id,qualified_at)
 SELECT NEW.packet_id,NEW.user_id,unixepoch() FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id
 JOIN users u ON u.id=NEW.user_id JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=p.group_id
 WHERE b.packet_id=NEW.packet_id AND b.state IN('pending','scheduled','open') AND p.state='open' AND p.ends_at>unixepoch()
 AND u.disabled=0 AND u.kind='user' AND u.id<>p.owner_id
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE user_id=u.id AND group_id=p.group_id)
 AND ((NEW.source_room_id IS NOT NULL AND EXISTS(SELECT 1 FROM guess_room_messages s WHERE s.id=NEW.source_room_id AND s.packet_id=p.packet_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at))
 OR (NEW.source_room_id IS NULL AND EXISTS(SELECT 1 FROM chat_messages s WHERE s.id=NEW.source_message_id AND s.group_id=p.group_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at)))
 AND (SELECT COUNT(*) FROM guess_luckybag_candidates WHERE packet_id=b.packet_id)<1000;
END;

CREATE TRIGGER guess_luckybag_refresh AFTER UPDATE OF state ON guess_luckybags WHEN NEW.state<>OLD.state BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER guess_luckybag_round_closed AFTER UPDATE OF state ON ldc_packets WHEN NEW.state='closed' BEGIN
 UPDATE guess_luckybags SET state=CASE WHEN state='open' THEN 'closing' ELSE 'skipped' END,ended_at=unixepoch(),reason=CASE WHEN state='open' THEN NULL ELSE 'ended_before_appearance' END
 WHERE packet_id=NEW.packet_id AND state IN('pending','scheduled','open');
END;

CREATE TRIGGER guess_luckybag_seed AFTER INSERT ON ldc_packets
 WHEN NEW.mode IN('guess','clues') AND NEW.state='open'
 BEGIN
 INSERT INTO guess_luckybags(packet_id,sponsor_id,probability_bps,min_total,max_total,created_at)
 SELECT NEW.packet_id,sponsor_id,probability_bps,min_total,max_total,NEW.created_at FROM guess_luckybag_config
 WHERE id=1 AND enabled=1 AND NEW.created_at>=activated_at;
END;

CREATE TRIGGER guess_luckybag_winner AFTER UPDATE OF recipient_id ON ldc_awards
 WHEN NEW.recipient_id IS NOT NULL AND OLD.recipient_id IS NULL AND NEW.purpose='winner'
 BEGIN
 INSERT OR IGNORE INTO guess_luckybag_candidates(packet_id,user_id,qualified_at)
 SELECT b.packet_id,NEW.recipient_id,unixepoch() FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id
 JOIN users u ON u.id=NEW.recipient_id JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=p.group_id
 WHERE b.packet_id=NEW.packet_id AND b.state IN('pending','scheduled','open','closing') AND p.ends_at>unixepoch()
 AND u.disabled=0 AND u.kind='user' AND u.id<>p.owner_id
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE user_id=u.id AND group_id=p.group_id)
 AND (SELECT COUNT(*) FROM guess_luckybag_candidates WHERE packet_id=b.packet_id)<1000;
 UPDATE guess_luckybags SET state=CASE WHEN state='open' THEN 'closing' ELSE 'skipped' END,ended_at=unixepoch(),reason=CASE WHEN state='open' THEN NULL ELSE 'ended_before_appearance' END
 WHERE packet_id=NEW.packet_id AND state IN('pending','scheduled','open') AND
 (SELECT COUNT(*) FROM ldc_awards WHERE packet_id=NEW.packet_id AND recipient_id IS NOT NULL)>=(SELECT count FROM ldc_packets WHERE packet_id=NEW.packet_id);
END;

CREATE TRIGGER guess_multi_growth AFTER UPDATE OF recipient_id ON ldc_awards
WHEN NEW.purpose='winner' AND OLD.recipient_id IS NULL AND NEW.recipient_id IS NOT NULL AND NEW.slot>0 AND EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id AND mode IN('guess','clues') AND count>1)
BEGIN

 INSERT INTO user_badges(user_id,badge,n,first_at,last_day) VALUES(NEW.recipient_id,'guess',1,unixepoch(),date(unixepoch(),'unixepoch','+8 hours'))
 ON CONFLICT(user_id,badge) DO UPDATE SET n=n+1,last_day=excluded.last_day;
 INSERT OR IGNORE INTO user_unlocks(user_id,item,at)
 SELECT NEW.recipient_id,'guess:'||level,unixepoch() FROM (SELECT 1 AS level,1 AS wins UNION ALL SELECT 2,3 UNION ALL SELECT 3,10 UNION ALL SELECT 4,30 UNION ALL SELECT 5,100)
 WHERE wins<=(SELECT n FROM user_badges WHERE user_id=NEW.recipient_id AND badge='guess');
 UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=NEW.recipient_id AND badge='guess'))
 WHERE id=NEW.recipient_id AND json_valid(deco) AND json_extract(deco,'$.bd')='guess';
 INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
 SELECT m.group_id,NEW.recipient_id,COALESCE(u.nick,u.name,u.username)||' 猜词累计获胜 '||b.n||' 次，升至 LV.'||r.level||'「'||r.title||'」！已解锁本级称号、徽章和气泡，可在装扮中自行选择。',unixepoch(),unixepoch(),'guess_level',CAST(NEW.recipient_id AS TEXT)||':'||r.level
 FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id JOIN users u ON u.id=NEW.recipient_id JOIN user_badges b ON b.user_id=u.id AND b.badge='guess'
 JOIN (SELECT 1 AS level,1 AS wins,'猜词新星' AS title UNION ALL SELECT 2,3,'识词达人' UNION ALL SELECT 3,10,'灵感猎手' UNION ALL SELECT 4,30,'谜语大师' UNION ALL SELECT 5,100,'猜词王者') r ON r.wins=b.n
 WHERE p.id=NEW.packet_id;

 INSERT INTO guess_group_stats(group_id,day,rounds,wins)
 SELECT m.group_id,'*',0,1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id
 ON CONFLICT(group_id,day) DO UPDATE SET wins=wins+1;
 INSERT INTO guess_group_stats(group_id,day,rounds,wins)
 SELECT m.group_id,date(unixepoch(),'unixepoch','+8 hours'),0,1 FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id
 ON CONFLICT(group_id,day) DO UPDATE SET wins=wins+1;
 INSERT INTO guess_group_player_stats(group_id,day,user_id,wins,last_at)
 SELECT m.group_id,'*',NEW.recipient_id,1,unixepoch() FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET wins=wins+1,last_at=MAX(last_at,unixepoch());
 INSERT INTO guess_group_player_stats(group_id,day,user_id,wins,last_at)
 SELECT m.group_id,date(unixepoch(),'unixepoch','+8 hours'),NEW.recipient_id,1,unixepoch() FROM chat_redpacks r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=NEW.packet_id
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET wins=wins+1,last_at=MAX(last_at,unixepoch());
END;

CREATE TRIGGER guess_multi_last_winner AFTER UPDATE OF recipient_id ON ldc_awards
WHEN NEW.purpose='winner' AND OLD.recipient_id IS NULL AND NEW.recipient_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id AND count>1 AND mode IN('guess','clues'))
BEGIN
 INSERT OR IGNORE INTO guess_rate_participants VALUES(NEW.packet_id,NEW.recipient_id);
 UPDATE ldc_packets SET state='closed',room_revision=room_revision+1
 WHERE packet_id=NEW.packet_id AND state='open' AND NOT EXISTS(SELECT 1 FROM ldc_awards WHERE packet_id=NEW.packet_id AND recipient_id IS NULL);
END;

CREATE TRIGGER guess_prediction_room_update AFTER UPDATE OF state,settlement_token ON guess_prediction_pools WHEN OLD.state<>NEW.state OR OLD.settlement_token IS NOT NEW.settlement_token BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
 UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
 UPDATE chat_messages SET updated_at=unixepoch() WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=NEW.packet_id);
END;

CREATE TRIGGER guess_rate_snapshot AFTER INSERT ON guess_rate_rounds BEGIN
 INSERT INTO guess_rate_coverage(group_id,since,rounds) VALUES(NEW.group_id,NEW.ended_at,1)
 ON CONFLICT(group_id) DO UPDATE SET since=MIN(COALESCE(since,excluded.since),excluded.since),rounds=rounds+1;
 INSERT INTO guess_rate_stats(group_id,day,user_id,rounds,wins)
 SELECT NEW.group_id,d.day,p.user_id,1,CASE WHEN p.user_id=NEW.winner_id OR EXISTS(SELECT 1 FROM ldc_awards a JOIN ldc_packets g ON g.packet_id=a.packet_id WHERE a.packet_id=p.packet_id AND a.recipient_id=p.user_id AND a.purpose='winner' AND g.count>1 AND g.mode IN('guess','clues')) THEN 1 ELSE 0 END
 FROM guess_rate_participants p JOIN (SELECT NEW.day day UNION ALL SELECT '*') d WHERE p.packet_id=NEW.packet_id
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET rounds=rounds+1,wins=wins+excluded.wins;
END;

CREATE TRIGGER guess_rate_winner AFTER INSERT ON guess_wins BEGIN
 INSERT OR IGNORE INTO guess_rate_participants VALUES(NEW.packet_id,NEW.user_id);
 INSERT OR IGNORE INTO guess_rate_rounds
 SELECT NEW.packet_id,p.group_id,date(NEW.created_at,'unixepoch','+8 hours'),NEW.created_at,NEW.user_id,'live'
 FROM (SELECT packet_id,group_id,game_version FROM ldc_packets WHERE count=1 UNION ALL SELECT packet_id,group_id,game_version FROM guess_free_rounds) p
 WHERE p.packet_id=NEW.packet_id AND p.game_version=1 AND NOT EXISTS(SELECT 1 FROM guess_rate_exclusions WHERE packet_id=NEW.packet_id);
END;

CREATE TRIGGER guess_reward_freeze AFTER UPDATE OF recipient_id ON ldc_awards
WHEN NEW.purpose='winner' AND OLD.recipient_id IS NULL AND NEW.recipient_id IS NOT NULL AND NEW.slot=0 BEGIN
 UPDATE ldc_packets SET reward_freeze_ai_count=ai_count WHERE packet_id=NEW.packet_id AND mode IN('guess','clues') AND reward_freeze_ai_count IS NULL;
END;

CREATE TRIGGER guess_room_signal_insert AFTER INSERT ON guess_room_messages
BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
 UPDATE chat_messages SET updated_at=MAX(updated_at,NEW.updated_at) WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=NEW.packet_id);
END;

CREATE TRIGGER guess_room_signal_update AFTER UPDATE OF ai_text,ai_score,ai_status,deleted ON guess_room_messages
WHEN OLD.ai_text IS NOT NEW.ai_text OR OLD.ai_score IS NOT NEW.ai_score OR OLD.ai_status IS NOT NEW.ai_status OR OLD.deleted<>NEW.deleted
BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
 UPDATE chat_messages SET updated_at=MAX(updated_at,NEW.updated_at) WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=NEW.packet_id);
END;

CREATE TRIGGER guess_sidebar_winner_finalized AFTER UPDATE OF reward_finalized ON ldc_packets
WHEN OLD.reward_finalized IS NOT NEW.reward_finalized AND NEW.reward_finalized=1
BEGIN
 UPDATE guess_sidebar_messages SET system_data=(SELECT payload FROM guess_sidebar_winner_snapshot WHERE award_id=system_ref),updated_at=unixepoch()
 WHERE system_kind='guess_winner' AND system_ref IN (SELECT id FROM ldc_awards WHERE packet_id=NEW.packet_id AND purpose='winner' AND recipient_id IS NOT NULL)
 AND created_at>=(CAST((unixepoch()+28800)/86400 AS INTEGER)*86400-28800)
 AND EXISTS(SELECT 1 FROM guess_sidebar_winner_snapshot WHERE award_id=system_ref AND payload<>guess_sidebar_messages.system_data);
END;

CREATE TRIGGER guess_sidebar_winner_new AFTER UPDATE OF recipient_id ON ldc_awards
WHEN OLD.recipient_id IS NULL AND NEW.recipient_id IS NOT NULL AND NEW.purpose='winner'
BEGIN
 INSERT OR IGNORE INTO guess_sidebar_messages(user_id,body,nonce,created_at,updated_at,system_kind,system_ref,system_data)
 SELECT user_id,'猜中了本轮，奖励和剩余名额见系统记录。','system:guess-winner:'||award_id,unixepoch(),unixepoch(),'guess_winner',award_id,payload
 FROM guess_sidebar_winner_snapshot WHERE award_id=NEW.id;
END;

CREATE TRIGGER guess_sidebar_winner_payment AFTER UPDATE OF state,amount_cents,payment_error ON ldc_awards
WHEN NEW.recipient_id IS NOT NULL AND NEW.purpose='winner' AND (OLD.state IS NOT NEW.state OR OLD.amount_cents IS NOT NEW.amount_cents OR OLD.payment_error IS NOT NEW.payment_error)
BEGIN
 UPDATE guess_sidebar_messages SET system_data=(SELECT payload FROM guess_sidebar_winner_snapshot WHERE award_id=NEW.id),updated_at=unixepoch()
 WHERE system_kind='guess_winner' AND system_ref=NEW.id
 AND created_at>=(CAST((unixepoch()+28800)/86400 AS INTEGER)*86400-28800)
 AND EXISTS(SELECT 1 FROM guess_sidebar_winner_snapshot WHERE award_id=NEW.id AND payload<>guess_sidebar_messages.system_data);
END;

CREATE TRIGGER guess_stats_ldc_start AFTER INSERT ON ldc_packets
WHEN NEW.group_id IS NOT NULL AND NEW.mode IN ('guess','clues') BEGIN
 INSERT INTO guess_group_stats(group_id,day,rounds,wins) VALUES(NEW.group_id,'*',1,0),(NEW.group_id,date(NEW.created_at,'unixepoch','+8 hours'),1,0)
 ON CONFLICT(group_id,day) DO UPDATE SET rounds=rounds+1;
END;

CREATE TRIGGER ldc_block_free_active BEFORE INSERT ON ldc_packets
WHEN NEW.mode IN('guess','clues') AND NOT EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id)
 AND EXISTS(SELECT 1 FROM guess_free_rounds WHERE group_id=NEW.group_id AND state='open' AND winner_id IS NULL AND ends_at>NEW.created_at)
BEGIN SELECT RAISE(ABORT,'ldc_active_game'); END;

CREATE TRIGGER ldc_exclusive_award_insert BEFORE INSERT ON ldc_awards
WHEN NEW.recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id AND exclusive_user_id IS NOT NULL AND exclusive_user_id<>NEW.recipient_id)
BEGIN SELECT RAISE(ABORT,'exclusive_recipient_mismatch'); END;

CREATE TRIGGER ldc_exclusive_award_update BEFORE UPDATE OF recipient_id,packet_id ON ldc_awards
WHEN NEW.recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id AND exclusive_user_id IS NOT NULL AND exclusive_user_id<>NEW.recipient_id)
BEGIN SELECT RAISE(ABORT,'exclusive_recipient_mismatch'); END;

CREATE TRIGGER ldc_exclusive_packet_shape_insert BEFORE INSERT ON ldc_packets
WHEN NEW.exclusive_user_id IS NOT NULL AND (NEW.count<>1 OR NEW.mode NOT IN ('fixed','random') OR NEW.exclusive_user_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'exclusive_packet_invalid'); END;

CREATE TRIGGER ldc_exclusive_packet_shape_update BEFORE UPDATE OF exclusive_user_id,count,mode,owner_id ON ldc_packets
WHEN NEW.exclusive_user_id IS NOT NULL AND (NEW.count<>1 OR NEW.mode NOT IN ('fixed','random') OR NEW.exclusive_user_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'exclusive_packet_invalid'); END;

CREATE TRIGGER ldc_firstshot_honor AFTER UPDATE OF verdict ON ldc_questions
WHEN NEW.kind='guess' AND OLD.verdict='pending' AND NEW.verdict<>'pending'
 AND NOT EXISTS(SELECT 1 FROM activity_honor_events WHERE event_key=NEW.packet_id AND series='guess_firstshot')
 AND EXISTS(SELECT 1 FROM guess_wins WHERE packet_id=NEW.packet_id) BEGIN
 INSERT OR IGNORE INTO activity_honor_events(event_key,user_id,series,created_at)
 SELECT w.packet_id,CASE r.series WHEN 'guess_firstshot' THEN w.user_id ELSE p.owner_id END,r.series,unixepoch()
 FROM guess_wins w JOIN ldc_packets p ON p.packet_id=w.packet_id
 JOIN (SELECT 'guess_firstshot' series UNION ALL SELECT 'guess_easy') r
 JOIN users u ON u.id=CASE r.series WHEN 'guess_firstshot' THEN w.user_id ELSE p.owner_id END
 WHERE w.packet_id=NEW.packet_id AND u.disabled=0 AND u.kind='user'
 AND EXISTS(SELECT 1 FROM ldc_questions q WHERE q.packet_id=w.packet_id AND q.kind='guess' AND q.verdict='correct' AND q.user_id=w.user_id)
 AND NOT EXISTS(SELECT 1 FROM ldc_questions q WHERE q.packet_id=w.packet_id AND q.kind='guess' AND q.verdict NOT IN('correct','unavailable','error','not_question'));
END;

CREATE TRIGGER ldc_packets_rate_close AFTER UPDATE OF state ON ldc_packets
 WHEN NEW.state='closed' AND OLD.state='open' AND NEW.mode IN ('guess','clues') AND NEW.game_version=1
 AND NOT EXISTS(SELECT 1 FROM guess_rate_exclusions WHERE packet_id=NEW.packet_id) BEGIN
 INSERT OR IGNORE INTO guess_rate_participants SELECT packet_id,recipient_id FROM ldc_awards WHERE packet_id=NEW.packet_id AND recipient_id IS NOT NULL AND purpose='winner';
 INSERT OR IGNORE INTO guess_rate_rounds SELECT NEW.packet_id,NEW.group_id,date(t.at,'unixepoch','+8 hours'),t.at,(SELECT user_id FROM guess_wins WHERE packet_id=NEW.packet_id),'live'
 FROM (SELECT CASE WHEN NEW.count>1 THEN MIN(NEW.ends_at,unixepoch()) ELSE COALESCE((SELECT created_at FROM guess_wins WHERE packet_id=NEW.packet_id),MIN(NEW.ends_at,unixepoch())) END at) t;
END;

CREATE TRIGGER ldc_packets_retired_insert BEFORE INSERT ON ldc_packets WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_packets_retired_update BEFORE UPDATE OF owner_id ON ldc_packets WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER ldc_questions_rate_insert AFTER INSERT ON ldc_questions WHEN NEW.verdict IN ('yes','no','correct','similarity') AND NOT EXISTS(SELECT 1 FROM guess_rate_rounds WHERE packet_id=NEW.packet_id) AND EXISTS(SELECT 1 FROM ldc_packets p WHERE p.packet_id=NEW.packet_id AND p.state='open' AND p.ends_at>unixepoch()) BEGIN
 INSERT OR IGNORE INTO guess_rate_participants VALUES(NEW.packet_id,NEW.user_id);
END;

CREATE TRIGGER ldc_questions_rate_update AFTER UPDATE OF verdict ON ldc_questions WHEN NEW.verdict IN ('yes','no','correct','similarity') AND NOT EXISTS(SELECT 1 FROM guess_rate_rounds WHERE packet_id=NEW.packet_id) AND EXISTS(SELECT 1 FROM ldc_packets p WHERE p.packet_id=NEW.packet_id AND p.state='open' AND p.ends_at>unixepoch()) BEGIN
 INSERT OR IGNORE INTO guess_rate_participants VALUES(NEW.packet_id,NEW.user_id);
END;

CREATE TRIGGER ldc_single_active BEFORE INSERT ON ldc_packets
WHEN NEW.mode IN ('guess','clues') AND NEW.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id)
AND EXISTS(SELECT 1 FROM ldc_packets p WHERE p.group_id=NEW.group_id AND p.state='open' AND p.mode IN ('guess','clues') AND p.ends_at>NEW.created_at
 AND (SELECT count(*) FROM ldc_awards a WHERE a.packet_id=p.packet_id AND a.recipient_id IS NOT NULL)<p.count)
BEGIN SELECT RAISE(ABORT,'ldc_active_game'); END;

CREATE TRIGGER packet_luck_close_signal AFTER UPDATE OF state ON ldc_packets WHEN OLD.state<>NEW.state BEGIN
 UPDATE packet_luck_jobs SET due_at=unixepoch() WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER packet_luck_enqueue AFTER INSERT ON ldc_packets WHEN NEW.mode='random' BEGIN
 INSERT INTO packet_luck_jobs VALUES(NEW.packet_id,NEW.ends_at);
END;

CREATE TRIGGER packet_luck_unlock AFTER INSERT ON packet_luck_wins BEGIN
 INSERT INTO user_badges(user_id,badge,n,first_at,last_day) VALUES(NEW.user_id,NEW.badge,1,NEW.created_at,date(NEW.created_at,'unixepoch','+8 hours'))
 ON CONFLICT(user_id,badge) DO UPDATE SET n=n+1,last_day=excluded.last_day;
 INSERT OR IGNORE INTO user_unlocks(user_id,item,at)
 SELECT NEW.user_id,NEW.badge||':'||level,NEW.created_at FROM (SELECT 1 level,1 wins UNION ALL SELECT 2,3 UNION ALL SELECT 3,10 UNION ALL SELECT 4,30 UNION ALL SELECT 5,100)
 WHERE wins<=(SELECT n FROM user_badges WHERE user_id=NEW.user_id AND badge=NEW.badge);
 UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=NEW.user_id AND badge=NEW.badge))
 WHERE id=NEW.user_id AND json_valid(deco) AND json_extract(deco,'$.bd')=NEW.badge;
 INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,created_at,updated_at,system_kind,system_ref)
 SELECT p.group_id,NEW.user_id,COALESCE(u.nick,u.name,u.username)||' 累计获得'||CASE NEW.badge WHEN 'luck_king' THEN '手气王' ELSE '手气亡' END||' '||b.n||' 次，升至 LV.'||r.level||'「'||CASE NEW.badge WHEN 'luck_king' THEN r.king ELSE r.last END||'」！称号、徽章和气泡已解锁，可在装扮中自行选择。',NEW.created_at,NEW.created_at,'luck_level',NEW.badge||':'||NEW.user_id||':'||r.level
 FROM ldc_packets p JOIN users u ON u.id=NEW.user_id JOIN user_badges b ON b.user_id=u.id AND b.badge=NEW.badge
 JOIN (SELECT 1 level,1 wins,'初遇好运' king,'微光入袋' last UNION ALL SELECT 2,3,'福气临门','一分不弃' UNION ALL SELECT 3,10,'锦鲤附体','逆风收集' UNION ALL SELECT 4,30,'鸿运当头','低谷漫游' UNION ALL SELECT 5,100,'天选锦鲤','逆运星主') r ON r.wins=b.n
 WHERE p.packet_id=NEW.packet_id;
END;

CREATE TRIGGER packet_notice_award AFTER UPDATE OF state,recipient_id ON ldc_awards WHEN OLD.state IS NOT NEW.state OR OLD.recipient_id IS NOT NEW.recipient_id BEGIN INSERT INTO packet_notice_jobs(packet_id,due_at) SELECT packet_id,unixepoch() FROM ldc_packets WHERE packet_id=NEW.packet_id AND mode IN('fixed','random') ON CONFLICT(packet_id) DO UPDATE SET due_at=excluded.due_at,revision=revision+1; END;

CREATE TRIGGER packet_notice_close AFTER UPDATE OF state ON ldc_packets WHEN OLD.state<>NEW.state AND NEW.mode IN('fixed','random') BEGIN INSERT INTO packet_notice_jobs(packet_id,due_at) VALUES(NEW.packet_id,unixepoch()) ON CONFLICT(packet_id) DO UPDATE SET due_at=excluded.due_at,revision=revision+1; END;

CREATE TRIGGER packet_notice_enqueue AFTER INSERT ON ldc_packets WHEN NEW.mode IN('fixed','random') BEGIN INSERT INTO packet_notice_jobs(packet_id,due_at) VALUES(NEW.packet_id,NEW.ends_at); END;

CREATE TRIGGER packet_sender_created AFTER INSERT ON ldc_packets WHEN NEW.group_id IS NOT NULL AND NEW.payment_provider<>'coin52' BEGIN
 INSERT INTO packet_sender_stats(group_id,day,user_id,packets,declared_cents,created_at)
 VALUES(NEW.group_id,'*',NEW.owner_id,1,NEW.total_cents,NEW.created_at),(NEW.group_id,date(NEW.created_at,'unixepoch','+8 hours'),NEW.owner_id,1,NEW.total_cents,NEW.created_at)
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET packets=packets+1,declared_cents=declared_cents+excluded.declared_cents,created_at=MAX(created_at,excluded.created_at);
END;

CREATE TRIGGER packet_sender_paid_aggregate AFTER INSERT ON packet_sender_paid_events BEGIN
 INSERT INTO packet_sender_stats(group_id,day,user_id,paid_cents,paid_at)
 SELECT p.group_id,'*',p.owner_id,NEW.amount_cents,NEW.confirmed_at FROM ldc_packets p WHERE p.packet_id=NEW.packet_id AND p.group_id IS NOT NULL
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET paid_cents=paid_cents+excluded.paid_cents,paid_at=MAX(paid_at,excluded.paid_at);
 INSERT INTO packet_sender_stats(group_id,day,user_id,paid_cents,paid_at)
 SELECT p.group_id,date(NEW.confirmed_at,'unixepoch','+8 hours'),p.owner_id,NEW.amount_cents,NEW.confirmed_at FROM ldc_packets p WHERE p.packet_id=NEW.packet_id AND p.group_id IS NOT NULL
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET paid_cents=paid_cents+excluded.paid_cents,paid_at=MAX(paid_at,excluded.paid_at);
END;

CREATE TRIGGER packet_sender_paid_insert AFTER INSERT ON ldc_awards WHEN NEW.state='accepted' AND NEW.recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM ldc_packets p WHERE p.packet_id=NEW.packet_id AND p.payment_provider<>'coin52') BEGIN
 INSERT OR IGNORE INTO packet_sender_paid_events VALUES(NEW.id,NEW.packet_id,NEW.amount_cents,unixepoch());
END;

CREATE TRIGGER packet_sender_paid_update AFTER UPDATE OF state ON ldc_awards WHEN NEW.state='accepted' AND NEW.recipient_id IS NOT NULL AND EXISTS(SELECT 1 FROM ldc_packets p WHERE p.packet_id=NEW.packet_id AND p.payment_provider<>'coin52') BEGIN
 INSERT OR IGNORE INTO packet_sender_paid_events VALUES(NEW.id,NEW.packet_id,NEW.amount_cents,unixepoch());
END;

CREATE TRIGGER trg_guess_author_result AFTER INSERT ON guess_author_results
BEGIN
 INSERT INTO guess_author_policies(owner_id,bad_streak,good_streak,restricted,updated_at)
 VALUES(NEW.owner_id,NEW.hundred_reached,0,0,NEW.created_at)
 ON CONFLICT(owner_id) DO UPDATE SET
 bad_streak=CASE WHEN NEW.hundred_reached=1 THEN MIN(2,bad_streak+1) ELSE 0 END,
 good_streak=CASE WHEN restricted=1 AND NEW.early_win=1 THEN MIN(2,good_streak+1) ELSE 0 END,
 restricted=CASE WHEN restricted=1 THEN CASE WHEN NEW.early_win=1 AND good_streak>=1 THEN 0 ELSE 1 END ELSE CASE WHEN NEW.hundred_reached=1 AND bad_streak>=1 THEN 1 ELSE 0 END END,
 updated_at=NEW.created_at;
 UPDATE ldc_packets SET author_result_saved=1 WHERE packet_id=NEW.packet_id;
 UPDATE guess_free_rounds SET author_result_saved=1 WHERE packet_id=NEW.packet_id;
END;

CREATE TRIGGER trg_guess_escalation AFTER UPDATE OF added_reward_cents ON ldc_packets
WHEN NEW.added_reward_cents>OLD.added_reward_cents AND NEW.escalation_every>0
BEGIN
 UPDATE ldc_awards SET amount_cents=CASE WHEN slot=0 THEN NEW.total_cents-
   (SELECT COALESCE(sum(CAST((NEW.total_cents/(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END))*j.value/10000 AS INTEGER)*(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END)),0) FROM json_each(NEW.guess_weights_json) j WHERE j.key>0)
  ELSE CAST((NEW.total_cents/(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END))*json_extract(NEW.guess_weights_json,'$['||slot||']')/10000 AS INTEGER)*(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END) END
 WHERE packet_id=NEW.packet_id AND (state='ready' AND recipient_id IS NULL OR state='reserved' AND attempts=0 AND sent_at IS NULL);
 INSERT INTO guess_reward_increases(packet_id,stage,added_cents,total_cents,created_at)
 VALUES(NEW.packet_id,(NEW.added_reward_cents+NEW.escalation_step_cents-1)/NEW.escalation_step_cents,NEW.added_reward_cents-OLD.added_reward_cents,NEW.total_cents,unixepoch());
END;

CREATE TRIGGER trg_guess_win_reward AFTER UPDATE OF recipient_id ON ldc_awards
WHEN NEW.purpose='winner' AND OLD.recipient_id IS NULL AND NEW.recipient_id IS NOT NULL AND NEW.slot=0
 AND EXISTS(SELECT 1 FROM ldc_packets WHERE packet_id=NEW.packet_id AND mode IN('guess','clues'))
BEGIN INSERT OR IGNORE INTO guess_wins VALUES(NEW.packet_id,NEW.recipient_id,unixepoch()); END;

CREATE TRIGGER trg_word_archive_paid_end AFTER UPDATE OF state,ends_at ON ldc_packets
 WHEN NEW.mode IN ('guess','clues') AND (NEW.state<>OLD.state OR NEW.ends_at<>OLD.ends_at) BEGIN
 UPDATE guess_word_archive_jobs SET next_at=CASE WHEN NEW.state='closed' THEN 0 ELSE NEW.ends_at END
 WHERE store='ldc' AND packet_id=NEW.packet_id AND status IN ('pending','error');
END;

CREATE TRIGGER trg_word_archive_paid_insert AFTER INSERT ON ldc_packets
 WHEN NEW.mode IN ('guess','clues') BEGIN
 INSERT OR IGNORE INTO guess_word_archive_jobs(store,packet_id,next_at) VALUES('ldc',NEW.packet_id,CASE WHEN NEW.state='closed' THEN 0 ELSE NEW.ends_at END);
END;

CREATE TRIGGER arcade_no_retired_insert BEFORE INSERT ON arcade_saves
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER arcade_no_retired_update BEFORE UPDATE ON arcade_saves
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER huancai_daily_pay AFTER INSERT ON huancai_daily WHEN NEW.user_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) VALUES(NEW.user_id,NEW.created_at);
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
 SELECT NEW.user_id,'huancai-daily',NEW.day,'daily:'||NEW.day,NEW.payout,balance+NEW.payout,NEW.created_at FROM coin52_wallets WHERE user_id=NEW.user_id;
 UPDATE coin52_wallets SET balance=balance+NEW.payout,revision=revision+1,updated_at=NEW.created_at WHERE user_id=NEW.user_id;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'huancai_daily_wallet_missing') END;
END;

CREATE TRIGGER phrase_order_policy_after_packet AFTER INSERT ON ldc_packets BEGIN
 INSERT OR IGNORE INTO phrase_order_policies(packet_id)
 SELECT NEW.packet_id FROM chat_redpacks r JOIN phrase_order_settings s ON s.id=1 AND s.active=1
 WHERE r.id=NEW.packet_id AND r.provider='native' AND r.mode='phrase' AND NEW.mode IN('fixed','random');
END;

CREATE TRIGGER phrase_order_record_after_message AFTER INSERT ON chat_messages
WHEN NEW.deleted=0 AND NEW.redpack_id IS NULL AND NEW.system_kind IS NULL AND NEW.body<>'' BEGIN
 INSERT OR IGNORE INTO phrase_order_entries(packet_id,user_id,message_id)
 SELECT r.id,NEW.user_id,NEW.id
 FROM chat_redpacks r JOIN phrase_order_policies policy ON policy.packet_id=r.id
 JOIN chat_messages packet_msg ON packet_msg.id=r.message_id AND packet_msg.deleted=0
 JOIN ldc_packets p ON p.packet_id=r.id AND p.state='open' AND p.ends_at>NEW.created_at
 JOIN users u ON u.id=NEW.user_id AND u.kind='user' AND u.disabled=0 AND u.silenced=0
 JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=NEW.group_id
 WHERE r.mode='phrase' AND r.phrase=NEW.body AND packet_msg.group_id=NEW.group_id
 AND packet_msg.id<NEW.id AND packet_msg.created_at>=cm.joined_at AND u.id<>p.owner_id
 AND (p.exclusive_user_id IS NULL OR p.exclusive_user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=NEW.group_id AND b.user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM account_retirements ar WHERE ar.source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM user_limits l WHERE l.user_id=u.id AND u.is_admin=0 AND l.kind='chat' AND (l.until=0 OR l.until>NEW.created_at))
 AND (p.payment_provider='coin52' OR EXISTS(SELECT 1 FROM identities i WHERE i.provider='linuxdo' AND i.user_id=u.id AND i.verified_at IS NOT NULL AND i.username IS NOT NULL AND i.username<>'' AND i.subject<>'' AND i.subject NOT GLOB '*[^0-9]*' AND CAST(i.subject AS INTEGER)>0 AND CAST(i.subject AS INTEGER)<=9007199254740991));
END;

CREATE TRIGGER chat_media_audit_insert AFTER INSERT ON chat_messages
WHEN NEW.image_key IS NOT NULL OR NEW.media IS NOT NULL BEGIN
 INSERT OR IGNORE INTO chat_media_audit_refs(message_id,key,created_at)
 SELECT NEW.id,NEW.image_key,NEW.created_at WHERE NEW.image_key LIKE 'c/%';
 INSERT OR IGNORE INTO chat_media_audit_refs(message_id,key,created_at)
 SELECT NEW.id,key,NEW.created_at FROM (
   SELECT CASE WHEN j.type='object' THEN json_extract(j.value,'$.k') END AS key FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
   UNION SELECT CASE WHEN j.type='object' THEN json_extract(j.value,'$.p') END FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
   UNION SELECT CASE WHEN j.type='object' THEN json_extract(j.value,'$.o') END FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
 ) WHERE typeof(key)='text' AND key LIKE 'c/%';
 INSERT OR REPLACE INTO chat_media_audit_issues(message_id,reason)
 SELECT NEW.id,'invalid_media' WHERE NEW.media IS NOT NULL AND (NOT json_valid(NEW.media) OR json_type(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE 'null' END)<>'array' OR EXISTS(
  SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
  WHERE j.type<>'object' OR CASE WHEN j.type='object' THEN COALESCE(json_type(j.value,'$.k'),'') ELSE '' END<>'text'
  OR CASE WHEN j.type='object' THEN COALESCE(length(json_extract(j.value,'$.k')),0) ELSE 0 END=0
  OR CASE WHEN j.type='object' THEN COALESCE(json_type(j.value,'$.p'),'text') ELSE 'text' END NOT IN ('text','null')
  OR CASE WHEN j.type='object' THEN COALESCE(json_type(j.value,'$.o'),'text') ELSE 'text' END NOT IN ('text','null')
 ));
END;

CREATE TRIGGER chat_media_audit_update AFTER UPDATE OF image_key,media,created_at ON chat_messages
WHEN OLD.image_key IS NOT NEW.image_key OR OLD.media IS NOT NEW.media OR OLD.created_at IS NOT NEW.created_at BEGIN
 DELETE FROM chat_media_audit_refs WHERE message_id=OLD.id;
 DELETE FROM chat_media_audit_issues WHERE message_id=OLD.id;
 INSERT OR IGNORE INTO chat_media_audit_refs(message_id,key,created_at)
 SELECT NEW.id,NEW.image_key,NEW.created_at WHERE NEW.image_key LIKE 'c/%';
 INSERT OR IGNORE INTO chat_media_audit_refs(message_id,key,created_at)
 SELECT NEW.id,key,NEW.created_at FROM (
   SELECT CASE WHEN j.type='object' THEN json_extract(j.value,'$.k') END AS key FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
   UNION SELECT CASE WHEN j.type='object' THEN json_extract(j.value,'$.p') END FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
   UNION SELECT CASE WHEN j.type='object' THEN json_extract(j.value,'$.o') END FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
 ) WHERE typeof(key)='text' AND key LIKE 'c/%';
 INSERT OR REPLACE INTO chat_media_audit_issues(message_id,reason)
 SELECT NEW.id,'invalid_media' WHERE NEW.media IS NOT NULL AND (NOT json_valid(NEW.media) OR json_type(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE 'null' END)<>'array' OR EXISTS(
  SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.media) THEN NEW.media ELSE '[]' END) j
  WHERE j.type<>'object' OR CASE WHEN j.type='object' THEN COALESCE(json_type(j.value,'$.k'),'') ELSE '' END<>'text'
  OR CASE WHEN j.type='object' THEN COALESCE(length(json_extract(j.value,'$.k')),0) ELSE 0 END=0
  OR CASE WHEN j.type='object' THEN COALESCE(json_type(j.value,'$.p'),'text') ELSE 'text' END NOT IN ('text','null')
  OR CASE WHEN j.type='object' THEN COALESCE(json_type(j.value,'$.o'),'text') ELSE 'text' END NOT IN ('text','null')
 ));
END;

CREATE TRIGGER huancai_daily_correct AFTER INSERT ON huancai_daily_corrections
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM huancai_daily d
   JOIN coin52_wallets w ON w.user_id=d.user_id
   JOIN coin52_wealth e ON e.user_id=d.user_id
  WHERE d.day=NEW.day AND d.user_id=NEW.original_user_id AND d.payout=NEW.original_amount
    AND w.balance>=NEW.original_amount AND e.earned>=NEW.original_amount
    AND EXISTS(SELECT 1 FROM coin52_ledger l WHERE l.user_id=d.user_id AND l.kind='huancai-daily' AND l.ref=d.day AND l.delta=NEW.original_amount)
 ) THEN RAISE(ABORT,'huancai_daily_correction_precondition_changed') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM users u
   JOIN coin52_wallets w ON w.user_id=u.id
  WHERE u.id=NEW.replacement_user_id AND u.kind='user' AND u.disabled=0
    AND EXISTS(SELECT 1 FROM chat_members WHERE group_id=1 AND user_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
    AND w.balance<=9007199254740991-NEW.original_amount
 ) THEN RAISE(ABORT,'huancai_daily_replacement_ineligible') END;
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
  SELECT NEW.original_user_id,'huancai-daily-reroll-reversal',NEW.day,'daily-reroll:reverse:'||NEW.day,-NEW.original_amount,w.balance-NEW.original_amount,NEW.created_at
  FROM coin52_wallets w WHERE w.user_id=NEW.original_user_id;
 UPDATE coin52_wallets SET balance=balance-NEW.original_amount,revision=revision+1,updated_at=NEW.created_at WHERE user_id=NEW.original_user_id;
 UPDATE coin52_wealth SET earned=earned-NEW.original_amount,updated_at=NEW.created_at WHERE user_id=NEW.original_user_id;
 INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
  SELECT NEW.replacement_user_id,'huancai-daily-reroll',NEW.day,'daily-reroll:reissue:'||NEW.day,NEW.original_amount,w.balance+NEW.original_amount,NEW.created_at
  FROM coin52_wallets w WHERE w.user_id=NEW.replacement_user_id;
 UPDATE coin52_wallets SET balance=balance+NEW.original_amount,revision=revision+1,updated_at=NEW.created_at WHERE user_id=NEW.replacement_user_id;
 UPDATE huancai_daily SET user_id=NEW.replacement_user_id WHERE day=NEW.day AND user_id=NEW.original_user_id;
 UPDATE chat_messages SET body=body||char(10)||'欢彩每日保底已重新抽取：原获奖账号不参与本次结果；新获奖账号为 '||COALESCE((SELECT nick FROM users WHERE id=NEW.replacement_user_id),(SELECT name FROM users WHERE id=NEW.replacement_user_id),(SELECT username FROM users WHERE id=NEW.replacement_user_id))||'，奖励已冲正并补发。',edited_at=NEW.created_at,updated_at=NEW.created_at
  WHERE system_kind='huancai_draw' AND system_ref='huancai-daily:'||NEW.day;
END;

CREATE TRIGGER pet_saves_no_retired_insert BEFORE INSERT ON pet_saves
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER pet_saves_no_retired_update BEFORE UPDATE ON pet_saves
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER pet_progress_no_retired_insert BEFORE INSERT ON pet_progress
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER pet_battles_no_retired_insert BEFORE INSERT ON pet_battles
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (NEW.attacker_id,NEW.defender_id))
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER pet_items_no_retired_insert BEFORE INSERT ON pet_items
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER pet_ops_no_retired_insert BEFORE INSERT ON pet_ops
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER pet_duels_no_retired_insert BEFORE INSERT ON pet_duels
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (NEW.inviter_id,NEW.invitee_id))
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER pet_world_no_retired_insert BEFORE INSERT ON pet_world
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'retired_account'); END;

CREATE TRIGGER card_batch_active BEFORE INSERT ON instant_card_batches
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.user_id,NEW.owner_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER instant_receipt_active BEFORE INSERT ON instant_card_receipts
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.user_id,NEW.owner_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER packet_coin_reservation_check BEFORE INSERT ON packet_coin_reservation_checks BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM packet_coin_escrows WHERE packet_id=NEW.packet_id)
  THEN RAISE(IGNORE) ELSE RAISE(ABORT,'dcoin_balance_insufficient') END;
END;

INSERT INTO isle_season_config(id,length_s,doomsday_s,exchange_dcoin,devalue_bp,updated_at)
VALUES(1,604800,259200,100,1500,1795363200);

INSERT INTO isle_seasons(id,starts_at,ends_at,doomsday_at,exchange_dcoin,devalue_bp,created_at)
VALUES(1,1795363200,1795622400,1795363200,100,1500,1795363200);
