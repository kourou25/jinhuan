-- 社区 PR #6 的配套表：D 币托管红包创建时，用这张表的触发器确认已成功冻结余额，否则整次发包回滚。
-- 0159 改写 PR #6 迁移时漏掉了它，导致 D 币托管红包报 no such table（2026-11-24 补上）。
CREATE TABLE IF NOT EXISTS packet_coin_reservation_checks(packet_id TEXT NOT NULL);

CREATE TRIGGER IF NOT EXISTS packet_coin_reservation_check BEFORE INSERT ON packet_coin_reservation_checks BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM packet_coin_escrows WHERE packet_id=NEW.packet_id)
  THEN RAISE(IGNORE) ELSE RAISE(ABORT,'dcoin_balance_insufficient') END;
END;
