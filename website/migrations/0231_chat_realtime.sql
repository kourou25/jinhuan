ALTER TABLE chat_members ADD COLUMN realtime_epoch TEXT;

-- 现有成员可继续用空代际。入群、身份边界变化及封禁均替换代际，入群时间精度不影响撤销。
CREATE TRIGGER chat_realtime_member_insert AFTER INSERT ON chat_members BEGIN
  UPDATE chat_members SET realtime_epoch=lower(hex(randomblob(16)))
    WHERE group_id=NEW.group_id AND user_id=NEW.user_id;
END;

CREATE TRIGGER chat_realtime_member_update AFTER UPDATE OF group_id,user_id,joined_at ON chat_members
WHEN OLD.group_id IS NOT NEW.group_id OR OLD.user_id IS NOT NEW.user_id OR OLD.joined_at IS NOT NEW.joined_at
BEGIN
  UPDATE chat_members SET realtime_epoch=lower(hex(randomblob(16)))
    WHERE group_id=NEW.group_id AND user_id=NEW.user_id;
END;

CREATE TRIGGER chat_realtime_ban_insert AFTER INSERT ON chat_bans BEGIN
  UPDATE chat_members SET realtime_epoch=lower(hex(randomblob(16)))
    WHERE group_id=NEW.group_id AND user_id=NEW.user_id;
END;

CREATE TRIGGER chat_realtime_ban_update AFTER UPDATE OF group_id,user_id,kind,created_at ON chat_bans
WHEN OLD.group_id IS NOT NEW.group_id OR OLD.user_id IS NOT NEW.user_id
  OR OLD.kind IS NOT NEW.kind OR OLD.created_at IS NOT NEW.created_at
BEGIN
  UPDATE chat_members SET realtime_epoch=lower(hex(randomblob(16)))
    WHERE group_id=NEW.group_id AND user_id=NEW.user_id;
END;

-- 灰度关停仅影响传输，新旧写入路径继续记录事件。
CREATE TABLE chat_realtime_controls (
  group_id INTEGER PRIMARY KEY REFERENCES chat_groups(id) ON DELETE CASCADE,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  shadow INTEGER NOT NULL DEFAULT 0 CHECK(shadow IN (0,1))
);

-- 事件只记录需要重新装饰的消息编号。业务事务回滚时对应事件一起回滚。
CREATE TABLE chat_realtime_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('create','update','delete'))
);
CREATE INDEX idx_chat_realtime_events_group_seq ON chat_realtime_events(group_id,seq);

CREATE TABLE chat_realtime_pruned (
  group_id INTEGER PRIMARY KEY,
  seq INTEGER NOT NULL
);

-- 按全库序号保留最近 20000 个位置。每次新增最多清理 128 条，群内重放以实际清理边界为准。
CREATE TRIGGER chat_realtime_event_trim AFTER INSERT ON chat_realtime_events
WHEN NEW.seq>20000
BEGIN
  DELETE FROM chat_realtime_events WHERE seq IN (
    SELECT seq FROM chat_realtime_events WHERE seq<=NEW.seq-20000 ORDER BY seq LIMIT 128
  );
END;

CREATE TRIGGER chat_realtime_event_pruned AFTER DELETE ON chat_realtime_events BEGIN
  INSERT INTO chat_realtime_pruned(group_id,seq) VALUES(OLD.group_id,OLD.seq)
    ON CONFLICT(group_id) DO UPDATE SET seq=MAX(seq,excluded.seq);
END;

-- 业务写入与命令登记同事务。消息硬删后仍保留编号，旧命令重试不会重新发送。
CREATE TABLE chat_realtime_commands (
  user_id INTEGER NOT NULL,
  command_id TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  message_id INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,command_id)
) WITHOUT ROWID;

CREATE INDEX idx_chat_realtime_commands_message ON chat_realtime_commands(user_id,kind,message_id);

CREATE TRIGGER chat_realtime_message_insert AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    VALUES(NEW.group_id,NEW.id,CASE WHEN NEW.deleted=0 THEN 'create' ELSE 'delete' END);
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages
    WHERE id=NEW.reply_to AND id<>NEW.id AND group_id=NEW.group_id AND deleted=0 AND NEW.deleted=0;
END;

-- 旧入群楼层触发器仅修改 seq。表情、短评和路线图直接监听对应表。
-- 部分红包结算或猜词触发器仅写消息时间，同一秒内也可能发生多次状态变化。
CREATE TRIGGER chat_realtime_message_update
AFTER UPDATE OF group_id,user_id,body,image_key,width,height,media,reply_to,deleted,created_at,edited_at,meme_id,redpack_id,system_kind,system_ref,updated_at ON chat_messages
WHEN OLD.group_id IS NOT NEW.group_id OR OLD.user_id IS NOT NEW.user_id
  OR OLD.body IS NOT NEW.body OR OLD.image_key IS NOT NEW.image_key OR OLD.width IS NOT NEW.width OR OLD.height IS NOT NEW.height
  OR OLD.media IS NOT NEW.media OR OLD.reply_to IS NOT NEW.reply_to OR OLD.deleted IS NOT NEW.deleted
  OR OLD.created_at IS NOT NEW.created_at OR OLD.edited_at IS NOT NEW.edited_at OR OLD.meme_id IS NOT NEW.meme_id
  OR OLD.redpack_id IS NOT NEW.redpack_id OR OLD.system_kind IS NOT NEW.system_kind OR OLD.system_ref IS NOT NEW.system_ref
  OR (NEW.deleted=0 AND (NEW.redpack_id IS NOT NULL OR EXISTS(SELECT 1 FROM chat_redpacks WHERE message_id=NEW.id)))
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT OLD.group_id,OLD.id,'delete' WHERE OLD.group_id<>NEW.group_id AND OLD.deleted=0;
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    VALUES(NEW.group_id,NEW.id,CASE
      WHEN NEW.deleted<>0 THEN 'delete'
      WHEN OLD.group_id<>NEW.group_id OR OLD.deleted<>0 THEN 'create'
      ELSE 'update'
    END);
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages
    WHERE id<>NEW.id AND deleted=0
    AND (OLD.reply_to IS NOT NEW.reply_to OR OLD.deleted IS NOT NEW.deleted
      OR OLD.group_id IS NOT NEW.group_id OR OLD.created_at IS NOT NEW.created_at)
    AND ((id=OLD.reply_to AND group_id=OLD.group_id AND OLD.deleted=0)
      OR (id=NEW.reply_to AND group_id=NEW.group_id AND NEW.deleted=0));
END;

CREATE TRIGGER chat_realtime_message_delete AFTER DELETE ON chat_messages BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    VALUES(OLD.group_id,OLD.id,'delete');
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages
    WHERE id=OLD.reply_to AND group_id=OLD.group_id AND deleted=0 AND OLD.deleted=0;
END;

CREATE TRIGGER chat_realtime_reaction_insert AFTER INSERT ON chat_reactions BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=NEW.message_id AND deleted=0;
END;

CREATE TRIGGER chat_realtime_reaction_update AFTER UPDATE ON chat_reactions
WHEN OLD.message_id IS NOT NEW.message_id OR OLD.user_id IS NOT NEW.user_id
  OR OLD.emoji IS NOT NEW.emoji OR OLD.created_at IS NOT NEW.created_at
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id IN (OLD.message_id,NEW.message_id) AND deleted=0;
END;

CREATE TRIGGER chat_realtime_reaction_delete AFTER DELETE ON chat_reactions BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=OLD.message_id AND deleted=0;
END;

CREATE TRIGGER chat_realtime_boost_insert AFTER INSERT ON chat_boosts BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=NEW.message_id AND deleted=0;
END;

CREATE TRIGGER chat_realtime_boost_update AFTER UPDATE ON chat_boosts
WHEN OLD.message_id IS NOT NEW.message_id OR OLD.user_id IS NOT NEW.user_id
  OR OLD.text IS NOT NEW.text OR OLD.created_at IS NOT NEW.created_at
  OR OLD.ai_status IS NOT NEW.ai_status OR OLD.ai_score IS NOT NEW.ai_score
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id IN (OLD.message_id,NEW.message_id) AND deleted=0;
END;

CREATE TRIGGER chat_realtime_boost_delete AFTER DELETE ON chat_boosts BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=OLD.message_id AND deleted=0;
END;

-- 共享红包可在消息写入后另行提交，外站开奖和本人状态也可以独立更新。
CREATE TRIGGER chat_realtime_packet_insert AFTER INSERT ON chat_redpacks BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=NEW.message_id AND deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_update AFTER UPDATE OF message_id,mode,game,prompt,provider,notify_at,draw_data ON chat_redpacks
WHEN OLD.message_id IS NOT NEW.message_id OR OLD.mode IS NOT NEW.mode OR OLD.game IS NOT NEW.game
  OR OLD.prompt IS NOT NEW.prompt OR OLD.provider IS NOT NEW.provider OR OLD.notify_at IS NOT NEW.notify_at
  OR OLD.draw_data IS NOT NEW.draw_data
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id IN (OLD.message_id,NEW.message_id) AND deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_delete AFTER DELETE ON chat_redpacks BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=OLD.message_id AND deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_open_insert AFTER INSERT ON chat_redpack_opens WHEN NEW.solved_at IS NOT NULL BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id=NEW.packet_id AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_open_update AFTER UPDATE OF packet_id,user_id,solved_at ON chat_redpack_opens
WHEN (OLD.solved_at IS NOT NULL OR NEW.solved_at IS NOT NULL)
  AND (OLD.packet_id IS NOT NEW.packet_id OR OLD.user_id IS NOT NEW.user_id OR OLD.solved_at IS NOT NEW.solved_at)
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE m.deleted=0 AND ((p.id=OLD.packet_id AND OLD.solved_at IS NOT NULL)
      OR (p.id=NEW.packet_id AND NEW.solved_at IS NOT NULL));
END;

CREATE TRIGGER chat_realtime_packet_open_delete AFTER DELETE ON chat_redpack_opens WHEN OLD.solved_at IS NOT NULL BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id=OLD.packet_id AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_view_insert AFTER INSERT ON chat_redpack_external_views BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id=NEW.packet_id AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_view_update AFTER UPDATE ON chat_redpack_external_views
WHEN OLD.data IS NOT NEW.data OR OLD.synced_at IS NOT NEW.synced_at
  OR OLD.packet_id IS NOT NEW.packet_id OR OLD.user_id IS NOT NEW.user_id
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id,NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_view_delete AFTER DELETE ON chat_redpack_external_views BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id=OLD.packet_id AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_road_insert AFTER INSERT ON road_items
WHEN NEW.source_msg_id IS NOT NULL AND NEW.source_hidden=0 AND NEW.hidden=0
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=NEW.source_msg_id AND deleted=0;
END;

CREATE TRIGGER chat_realtime_road_update AFTER UPDATE OF source_msg_id,source_hidden,hidden ON road_items
WHEN OLD.source_msg_id IS NOT NEW.source_msg_id OR OLD.source_hidden IS NOT NEW.source_hidden OR OLD.hidden IS NOT NEW.hidden
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE deleted=0
      AND ((id=OLD.source_msg_id AND OLD.source_hidden=0 AND OLD.hidden=0)
        OR (id=NEW.source_msg_id AND NEW.source_hidden=0 AND NEW.hidden=0));
END;

CREATE TRIGGER chat_realtime_road_delete AFTER DELETE ON road_items
WHEN OLD.source_msg_id IS NOT NULL AND OLD.source_hidden=0 AND OLD.hidden=0
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT group_id,id,'update' FROM chat_messages WHERE id=OLD.source_msg_id AND deleted=0;
END;

-- 猜词轮次、内置红包余额及个人领取状态都能独立于消息表更新。
CREATE TRIGGER chat_realtime_ldc_packets_insert AFTER INSERT ON ldc_packets
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_ldc_packets_update AFTER UPDATE OF packet_id,mode,room_revision,total_cents,count,payment_provider,response_mode,answer_length ON ldc_packets
WHEN (OLD.packet_id IS NOT NEW.packet_id
  OR OLD.mode IS NOT NEW.mode
  OR OLD.room_revision IS NOT NEW.room_revision
  OR OLD.total_cents IS NOT NEW.total_cents
  OR OLD.count IS NOT NEW.count
  OR OLD.payment_provider IS NOT NEW.payment_provider
  OR OLD.response_mode IS NOT NEW.response_mode
  OR OLD.answer_length IS NOT NEW.answer_length)
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id,NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_ldc_packets_delete AFTER DELETE ON ldc_packets
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_guess_free_rounds_insert AFTER INSERT ON guess_free_rounds
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_guess_free_rounds_update AFTER UPDATE OF packet_id,mode,room_revision,response_mode,answer_length ON guess_free_rounds
WHEN (OLD.packet_id IS NOT NEW.packet_id
  OR OLD.mode IS NOT NEW.mode
  OR OLD.room_revision IS NOT NEW.room_revision
  OR OLD.response_mode IS NOT NEW.response_mode
  OR OLD.answer_length IS NOT NEW.answer_length)
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id,NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_guess_free_rounds_delete AFTER DELETE ON guess_free_rounds
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_coin52_packets_insert AFTER INSERT ON coin52_packets
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_coin52_packets_update AFTER UPDATE OF packet_id,mode,expires_at,count,remaining_count ON coin52_packets
WHEN (OLD.packet_id IS NOT NEW.packet_id
  OR OLD.mode IS NOT NEW.mode
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.count IS NOT NEW.count
  OR OLD.remaining_count IS NOT NEW.remaining_count)
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id,NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_coin52_packets_delete AFTER DELETE ON coin52_packets
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_coin52_packet_slots_insert AFTER INSERT ON coin52_packet_slots WHEN NEW.recipient_id IS NOT NULL
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_coin52_packet_slots_update AFTER UPDATE OF packet_id,recipient_id ON coin52_packet_slots
WHEN (OLD.recipient_id IS NOT NULL OR NEW.recipient_id IS NOT NULL) AND (OLD.packet_id IS NOT NEW.packet_id
  OR OLD.recipient_id IS NOT NEW.recipient_id)
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id,NEW.packet_id) AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_coin52_packet_slots_delete AFTER DELETE ON coin52_packet_slots WHEN OLD.recipient_id IS NOT NULL
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind)
    SELECT m.group_id,m.id,'update' FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id IN (OLD.packet_id) AND m.deleted=0;
END;
