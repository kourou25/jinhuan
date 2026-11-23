-- Replace the legacy packet and slot tables together so their foreign key is always valid.

CREATE TABLE coin52_packets_next (
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

CREATE TABLE coin52_packet_slots_next (
 packet_id TEXT NOT NULL REFERENCES coin52_packets_next(packet_id),
 slot INTEGER NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),
 recipient_id INTEGER REFERENCES users(id),
 claimed_at INTEGER,
 attempt TEXT UNIQUE,
 PRIMARY KEY(packet_id,slot),
 UNIQUE(packet_id,recipient_id)
);

INSERT INTO coin52_packets_next(packet_id,owner_id,group_id,mode,total,count,remaining,remaining_count,expires_at,refunded_at,created_at)
SELECT packet_id,owner_id,group_id,mode,total,count,remaining,remaining_count,expires_at,refunded_at,created_at FROM coin52_packets;

INSERT INTO coin52_packet_slots_next(packet_id,slot,amount,recipient_id,claimed_at,attempt)
SELECT packet_id,slot,amount,recipient_id,claimed_at,attempt FROM coin52_packet_slots;

DROP TABLE coin52_packet_slots;
DROP TABLE coin52_packets;
ALTER TABLE coin52_packets_next RENAME TO coin52_packets;
ALTER TABLE coin52_packet_slots_next RENAME TO coin52_packet_slots;

CREATE INDEX idx_coin52_packets_expiry ON coin52_packets(expires_at) WHERE refunded_at IS NULL AND remaining>0;
CREATE INDEX idx_coin52_packets_owner ON coin52_packets(owner_id,created_at);
CREATE INDEX idx_coin52_slots_recipient ON coin52_packet_slots(recipient_id);

-- Keep the native packet table in place so award, escrow and other dependent rows stay attached.

CREATE TABLE ldc_packet_totals_before_limit (packet_id TEXT PRIMARY KEY, total_cents INTEGER NOT NULL) WITHOUT ROWID;
INSERT INTO ldc_packet_totals_before_limit(packet_id,total_cents) SELECT packet_id,total_cents FROM ldc_packets;

-- Restore the amount-dependent views and triggers after replacing the checked column.

DROP TRIGGER fish_capacity_award_delete;
DROP TRIGGER fish_capacity_award_insert;
DROP TRIGGER fish_capacity_award_update;
DROP TRIGGER fish_capacity_packet_insert;
DROP TRIGGER fish_capacity_packet_update;
DROP TRIGGER guess_sidebar_winner_finalized;
DROP TRIGGER guess_sidebar_winner_new;
DROP TRIGGER guess_sidebar_winner_payment;
DROP TRIGGER packet_sender_created;
DROP TRIGGER trg_guess_escalation;
DROP VIEW fish_capacity_source;
DROP VIEW guess_sidebar_winner_snapshot;

ALTER TABLE ldc_packets DROP COLUMN total_cents;
ALTER TABLE ldc_packets ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 1 CHECK(total_cents BETWEEN 1 AND CASE WHEN payment_provider='coin52' THEN 500000000 ELSE 200000 END);
UPDATE ldc_packets SET total_cents = (SELECT total_cents FROM ldc_packet_totals_before_limit WHERE packet_id = ldc_packets.packet_id);
DROP TABLE ldc_packet_totals_before_limit;

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

CREATE TRIGGER packet_sender_created AFTER INSERT ON ldc_packets WHEN NEW.group_id IS NOT NULL AND NEW.payment_provider<>'coin52' BEGIN
 INSERT INTO packet_sender_stats(group_id,day,user_id,packets,declared_cents,created_at)
 VALUES(NEW.group_id,'*',NEW.owner_id,1,NEW.total_cents,NEW.created_at),(NEW.group_id,date(NEW.created_at,'unixepoch','+8 hours'),NEW.owner_id,1,NEW.total_cents,NEW.created_at)
 ON CONFLICT(group_id,day,user_id) DO UPDATE SET packets=packets+1,declared_cents=declared_cents+excluded.declared_cents,created_at=MAX(created_at,excluded.created_at);
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

CREATE TABLE IF NOT EXISTS packet_coin_reservation_checks(packet_id TEXT NOT NULL);

CREATE TRIGGER IF NOT EXISTS packet_coin_reservation_check BEFORE INSERT ON packet_coin_reservation_checks BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM packet_coin_escrows WHERE packet_id=NEW.packet_id)
  THEN RAISE(IGNORE) ELSE RAISE(ABORT,'dcoin_balance_insufficient') END;
END;
