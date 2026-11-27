-- 群游标保留个人事件的位置；之前记录的事件继续按原有公开语义重放。
ALTER TABLE chat_realtime_events ADD COLUMN audience_user_id INTEGER CHECK(audience_user_id IS NULL OR kind='update');

DROP TRIGGER chat_realtime_packet_view_insert;
DROP TRIGGER chat_realtime_packet_view_update;
DROP TRIGGER chat_realtime_packet_view_delete;

CREATE TRIGGER chat_realtime_packet_view_insert AFTER INSERT ON chat_redpack_external_views BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind,audience_user_id)
    SELECT m.group_id,m.id,'update',NEW.user_id FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id=NEW.packet_id AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_view_update AFTER UPDATE ON chat_redpack_external_views
WHEN OLD.data IS NOT NEW.data OR OLD.synced_at IS NOT NEW.synced_at
  OR OLD.packet_id IS NOT NEW.packet_id OR OLD.user_id IS NOT NEW.user_id
BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind,audience_user_id)
    SELECT m.group_id,m.id,'update',OLD.user_id FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE (OLD.packet_id IS NOT NEW.packet_id OR OLD.user_id IS NOT NEW.user_id) AND p.id=OLD.packet_id AND m.deleted=0;
  INSERT INTO chat_realtime_events(group_id,message_id,kind,audience_user_id)
    SELECT m.group_id,m.id,'update',NEW.user_id FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id=NEW.packet_id AND m.deleted=0;
END;

CREATE TRIGGER chat_realtime_packet_view_delete AFTER DELETE ON chat_redpack_external_views BEGIN
  INSERT INTO chat_realtime_events(group_id,message_id,kind,audience_user_id)
    SELECT m.group_id,m.id,'update',OLD.user_id FROM chat_redpacks p JOIN chat_messages m ON m.id=p.message_id
    WHERE p.id=OLD.packet_id AND m.deleted=0;
END;
