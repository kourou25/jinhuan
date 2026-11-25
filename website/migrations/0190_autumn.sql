-- 死如秋叶：好久不见 / 跃进
CREATE TABLE autumn_memorial(
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 score INTEGER NOT NULL, days INTEGER NOT NULL, peak INTEGER NOT NULL, last_at INTEGER NOT NULL
);
CREATE TABLE autumn_memorial_state(id INTEGER PRIMARY KEY CHECK(id=1), day TEXT NOT NULL, built_at INTEGER NOT NULL);
CREATE TABLE autumn_leaves(
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL, PRIMARY KEY(user_id,giver_id,day)
) WITHOUT ROWID;
CREATE INDEX idx_autumn_leaves_giver ON autumn_leaves(giver_id,day);
CREATE TABLE autumn_opt_out(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL);

-- hidden：0 正常，1 作者删除，2 管理员移除，3 被举报后先隐藏待处理
CREATE TABLE leap_posts(
 id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
 anon INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 links TEXT NOT NULL DEFAULT '[]', media TEXT NOT NULL DEFAULT '[]', request_id TEXT NOT NULL, rules TEXT NOT NULL DEFAULT '',
 hidden INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, UNIQUE(user_id,request_id)
);
CREATE INDEX idx_leap_posts_list ON leap_posts(hidden,category,id DESC);
CREATE TABLE leap_comments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL UNIQUE, post_id INTEGER NOT NULL REFERENCES leap_posts(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id), as_op INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, request_id TEXT NOT NULL,
 hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(user_id,request_id)
);
CREATE INDEX idx_leap_comments_post ON leap_comments(post_id,id);
CREATE INDEX idx_leap_comments_user ON leap_comments(user_id,created_at);
CREATE TABLE leap_likes(post_id INTEGER NOT NULL REFERENCES leap_posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id,user_id)) WITHOUT ROWID;

-- 图片归属：只有所属帖子可见时图片才可见
CREATE TABLE autumn_media(key TEXT PRIMARY KEY, board TEXT NOT NULL CHECK(board IN('leap')), post_id INTEGER NOT NULL) WITHOUT ROWID;
CREATE INDEX idx_autumn_media_post ON autumn_media(board,post_id);
CREATE TABLE autumn_reports(
 id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL CHECK(board IN('leap')), kind TEXT NOT NULL CHECK(kind IN('post','comment')),
 target_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN('open','kept','removed')), handled_by INTEGER, handled_at INTEGER, created_at INTEGER NOT NULL,
 UNIQUE(board,kind,target_id,reporter_id)
);
CREATE INDEX idx_autumn_reports_open ON autumn_reports(board,state,id);
-- 站长处理举报时查看匿名作者的留痕
CREATE TABLE autumn_reveals(id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, at INTEGER NOT NULL);
