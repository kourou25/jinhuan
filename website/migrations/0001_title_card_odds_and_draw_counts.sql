CREATE TABLE instant_card_batches_next (
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

INSERT INTO instant_card_batches_next(user_id,request_id,owner_id,attempt,title,count,finger_level,results,pity_after,created_at)
SELECT user_id,request_id,owner_id,attempt,title,count,finger_level,results,pity_after,created_at FROM instant_card_batches;

DROP TABLE instant_card_batches;
ALTER TABLE instant_card_batches_next RENAME TO instant_card_batches;

CREATE TABLE instant_card_receipts_next (
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

INSERT INTO instant_card_receipts_next(id,user_id,owner_id,request_id,attempt,kind,title,price,finger_level,chance,won,created_at,batch_id,reward_kind,reward_id,reward_amount,guaranteed)
SELECT id,user_id,owner_id,request_id,attempt,kind,title,price,finger_level,chance,won,created_at,batch_id,reward_kind,reward_id,reward_amount,guaranteed FROM instant_card_receipts;

-- Retain the high-water mark even if the newest historical receipts were deleted.
INSERT INTO sqlite_sequence(name,seq)
SELECT 'instant_card_receipts_next',seq FROM sqlite_sequence WHERE name='instant_card_receipts'
AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='instant_card_receipts_next');
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='instant_card_receipts'),0))
WHERE name='instant_card_receipts_next';

DROP TABLE instant_card_receipts;
ALTER TABLE instant_card_receipts_next RENAME TO instant_card_receipts;

CREATE INDEX idx_card_batches_owner ON instant_card_batches(owner_id,created_at);
CREATE INDEX idx_card_receipts_batch ON instant_card_receipts(user_id,batch_id,id);
CREATE INDEX idx_instant_receipts_owner ON instant_card_receipts(owner_id,id DESC);
CREATE INDEX idx_instant_receipts_pool ON instant_card_receipts(title,id DESC);
CREATE INDEX idx_instant_receipts_rate ON instant_card_receipts(user_id,created_at);
CREATE INDEX idx_instant_receipts_user ON instant_card_receipts(user_id,id DESC);

CREATE TRIGGER card_batch_active BEFORE INSERT ON instant_card_batches
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.user_id,NEW.owner_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;

CREATE TRIGGER instant_receipt_active BEFORE INSERT ON instant_card_receipts
WHEN EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(NEW.user_id,NEW.owner_id))
BEGIN SELECT RAISE(ABORT,'account_retired'); END;
