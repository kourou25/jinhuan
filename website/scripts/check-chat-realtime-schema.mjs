import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../migrations/0231_chat_realtime.sql', import.meta.url), 'utf8')
const audienceMigration = readFileSync(new URL('../migrations/0232_chat_realtime_packet_audience.sql', import.meta.url), 'utf8')

function database(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(schema)
  db.exec(`
    INSERT INTO users(id,username,created_at,updated_at) VALUES (900001,'tester',1,1),(900002,'reader',1,1);
    INSERT INTO chat_groups(id,name,created_at) VALUES (21,'群一',1),(22,'群二',1);
  `)
  return db
}

function message(db, group = 21, replyTo = null) {
  return db.prepare(`
    INSERT INTO chat_messages(group_id,user_id,body,reply_to,created_at,updated_at)
    VALUES (?,900001,'正文',?,2,2) RETURNING id
  `).get(group, replyTo).id
}

function events(db, after = 0) {
  return db.prepare(`
    SELECT message_id,kind FROM chat_realtime_events WHERE seq>? ORDER BY seq
  `).all(after).map(row => [row.message_id, row.kind])
}

function head(db) {
  return db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM chat_realtime_events').get().seq
}

test('空库与升级路径使用相同的实时数据库对象', (t) => {
  const fresh = database(t)
  const upgraded = database(t)
  const objects = "SELECT type,name,sql FROM sqlite_schema WHERE name LIKE '%chat_realtime%' ORDER BY type,name"
  for (const {type, name} of upgraded.prepare(objects).all().reverse()) {
    if (type !== 'index') upgraded.exec(`DROP ${type} ${name}`)
  }
  upgraded.exec('ALTER TABLE chat_members DROP COLUMN realtime_epoch')
  const id = message(upgraded)
  upgraded.prepare('INSERT INTO chat_members(group_id,user_id,joined_at,last_read) VALUES (21,900001,1,?)').run(id)
  upgraded.prepare("INSERT INTO chat_redpacks(id,message_id,secret,mode) VALUES ('legacy-packet',?,'','open')").run(id)
  upgraded.exec("INSERT INTO chat_redpack_external_views(packet_id,user_id,data,synced_at) VALUES('legacy-packet',900002,'{}',4)")
  const legacyRows = () => ({
    member: upgraded.prepare('SELECT group_id,user_id,joined_at,last_read,muted,last_read_at,away_from FROM chat_members').get(),
    message: upgraded.prepare('SELECT * FROM chat_messages WHERE id=?').get(id),
    packet: upgraded.prepare('SELECT * FROM chat_redpacks').get(),
    view: upgraded.prepare('SELECT * FROM chat_redpack_external_views').get(),
  })
  const beforeRealtime = legacyRows()
  upgraded.exec(migration)
  assert.deepEqual(legacyRows(), beforeRealtime)
  assert.equal(upgraded.prepare('SELECT realtime_epoch AS epoch FROM chat_members').get().epoch, null)
  assert.equal(head(upgraded), 0)

  const syncPacket = upgraded.prepare("UPDATE chat_redpack_external_views SET synced_at=? WHERE packet_id='legacy-packet'")
  syncPacket.run(5)
  assert.deepEqual(events(upgraded), [[id, 'update']])
  const legacySeq = head(upgraded)
  const beforeAudience = legacyRows()
  upgraded.exec(audienceMigration)
  assert.deepEqual(upgraded.prepare(objects).all(), fresh.prepare(objects).all())
  assert.deepEqual(upgraded.prepare('PRAGMA table_info(chat_members)').all(), fresh.prepare('PRAGMA table_info(chat_members)').all())
  assert.deepEqual(legacyRows(), beforeAudience)
  const audienceEvents = () => upgraded.prepare('SELECT seq,message_id,kind,audience_user_id FROM chat_realtime_events ORDER BY seq')
    .all().map(row => [row.seq, row.message_id, row.kind, row.audience_user_id])
  assert.deepEqual(audienceEvents(), [[legacySeq, id, 'update', null]])
  syncPacket.run(6)
  assert.deepEqual(audienceEvents(), [[legacySeq, id, 'update', null], [legacySeq + 1, id, 'update', 900002]])
})

test('写入与旧楼层触发器兼容，撤回、物理删除和回复计数按顺序记录', (t) => {
  const db = database(t)
  const parent = message(db)
  const reply = message(db, 21, parent)
  const otherGroup = message(db, 22, parent)
  assert.equal(db.prepare('SELECT seq FROM chat_messages WHERE id=?').get(reply).seq, 2)
  assert.equal(db.prepare('SELECT last_insert_rowid() AS id').get().id, otherGroup)
  const missedBefore = head(db)
  db.prepare('UPDATE chat_messages SET body=? WHERE id=?').run('同一秒编辑', reply)
  db.prepare('UPDATE chat_messages SET seq=seq WHERE id=?').run(reply)
  db.prepare('UPDATE chat_messages SET deleted=1,body=\'\' WHERE id=?').run(reply)
  db.prepare('DELETE FROM chat_messages WHERE id=?').run(reply)
  assert.deepEqual(events(db), [
    [parent, 'create'], [reply, 'create'], [parent, 'update'], [otherGroup, 'create'],
    [reply, 'update'], [reply, 'delete'], [parent, 'update'], [reply, 'delete'],
  ])
  assert.equal(missedBefore, 4)
})

test('直接写入表情、AI 短评、路线图和红包时通知消息失效', (t) => {
  const db = database(t)
  const id = message(db)
  const afterSend = head(db)
  db.exec(`
    INSERT INTO chat_reactions(message_id,user_id,emoji,created_at) VALUES (${id},900002,'🙂',3);
    UPDATE chat_messages SET updated_at=3 WHERE id=${id};
    DELETE FROM chat_reactions WHERE message_id=${id} AND user_id=900002;

    INSERT INTO chat_boosts(message_id,user_id,text,created_at,ai_status) VALUES (${id},900001,'待生成',3,'pending');
    UPDATE chat_messages SET updated_at=4 WHERE id=${id};
    UPDATE chat_boosts SET text='已生成',ai_status='done',ai_score=65 WHERE message_id=${id};
    UPDATE chat_boosts SET text=text WHERE message_id=${id};
    DELETE FROM chat_boosts WHERE message_id=${id};

    INSERT INTO road_items(user_id,kind,title,body,created_at,updated_at,source_msg_id,source_group_id)
      VALUES (900001,'feature','路线图','内容',3,3,${id},21);
    UPDATE road_items SET source_hidden=1 WHERE source_msg_id=${id};

    INSERT INTO chat_redpacks(id,message_id,secret,mode) VALUES ('shared:pack',${id},'红包口令','open');
    UPDATE chat_redpacks SET draw_lease_until=5 WHERE id='shared:pack';
    UPDATE chat_redpacks SET draw_data='{"draw_complete":true}' WHERE id='shared:pack';
    INSERT INTO chat_redpack_opens(packet_id,user_id,attempts) VALUES ('shared:pack',900002,1);
    UPDATE chat_redpack_opens SET solved_at=4 WHERE packet_id='shared:pack' AND user_id=900002;
    INSERT INTO chat_redpack_external_views(packet_id,user_id,data,synced_at) VALUES ('shared:pack',900002,'{}',4);
    UPDATE chat_messages SET updated_at=4 WHERE id=${id};
  `)
  assert.deepEqual(events(db, afterSend), Array.from({length: 12}, () => [id, 'update']))
  assert.deepEqual(db.prepare('PRAGMA table_info(chat_realtime_events)').all().map(x => x.name), [
    'seq', 'group_id', 'message_id', 'kind', 'audience_user_id',
  ])
})

test('红包同步只通知其账号，公共开奖继续通知群组', (t) => {
  const db = database(t)
  const mid = message(db), second = message(db, 22)
  const packet = db.prepare("INSERT INTO chat_redpacks(id,message_id,secret,mode,provider) VALUES(?,?,'','open','fish')")
  packet.run('external', mid)
  packet.run('second', second)
  const cursor = head(db)
  db.exec(`
    INSERT INTO chat_redpack_external_views(packet_id,user_id,data,synced_at) VALUES('external',900002,'{}',4);
    UPDATE chat_redpack_external_views SET synced_at=4 WHERE packet_id='external';
    UPDATE chat_redpack_external_views SET synced_at=5 WHERE packet_id='external';
    UPDATE chat_redpacks SET draw_data='{"draw_complete":true}' WHERE id='external';
    UPDATE chat_redpack_external_views SET packet_id='second',user_id=900001 WHERE packet_id='external';
    DELETE FROM chat_redpack_external_views WHERE packet_id='second';
  `)
  assert.deepEqual(db.prepare(`
    SELECT group_id,message_id,kind,audience_user_id FROM chat_realtime_events WHERE seq>? ORDER BY seq
  `).all(cursor).map(r => [r.group_id, r.message_id, r.kind, r.audience_user_id]), [
    [21, mid, 'update', 900002],
    [21, mid, 'update', 900002],
    [21, mid, 'update', null],
    [21, mid, 'update', 900002],
    [22, second, 'update', 900001],
    [22, second, 'update', 900001],
  ])
})

test('独立更新猜词线索触发消息刷新，空红包槽不会制造更新', (t) => {
  const db = database(t)
  const mid = message(db)
  db.prepare("INSERT INTO chat_redpacks(id,message_id,secret,mode) VALUES('round',?,'','open')").run(mid)
  db.exec(`
    INSERT INTO guess_free_rounds(packet_id,owner_id,group_id,mode,ends_at,answer_box,created_at,response_mode,answer_length,generated)
      VALUES('round',900001,21,'clues',100,'',3,'yesno',2,0);
    INSERT INTO coin52_packets(packet_id,owner_id,group_id,mode,total,count,remaining,remaining_count,expires_at,created_at)
      VALUES('round',900001,21,'fixed',3,1,3,1,100,3);
  `)
  const cursor = head(db)
  db.exec(`
    UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id='round';
    INSERT INTO coin52_packet_slots(packet_id,slot,amount) VALUES('round',1,3);
    UPDATE coin52_packet_slots SET recipient_id=900002 WHERE packet_id='round' AND slot=1;
  `)
  assert.deepEqual(events(db,cursor), [[mid,'update'], [mid,'update']])
})

test('群控、事务回滚、命令唯一键以及同秒重新入群', (t) => {
  const db = database(t)
  db.exec('INSERT INTO chat_members(group_id,user_id,joined_at) VALUES (21,900002,2)')
  const epoch = () => db.prepare('SELECT realtime_epoch AS epoch FROM chat_members WHERE group_id=21 AND user_id=900002').get().epoch
  const first = epoch()
  assert.match(first, /^[a-f0-9]{32}$/)
  const join = db.prepare("SELECT id FROM chat_messages WHERE group_id=21 AND system_kind='join'").get()
  assert.deepEqual(events(db), [[join.id, 'create']])
  db.exec('UPDATE chat_members SET last_read=1 WHERE group_id=21 AND user_id=900002')
  assert.equal(epoch(), first)
  db.exec("INSERT INTO chat_bans(group_id,user_id,created_at,kind) VALUES (21,900002,2,'kick')")
  const banned = epoch()
  assert.notEqual(banned, first)
  db.exec(`
    DELETE FROM chat_bans WHERE group_id=21 AND user_id=900002;
    DELETE FROM chat_members WHERE group_id=21 AND user_id=900002;
    INSERT INTO chat_members(group_id,user_id,joined_at) VALUES (21,900002,2);
    INSERT INTO chat_realtime_controls(group_id,disabled,shadow) VALUES (21,1,1);
  `)
  assert.notEqual(epoch(), banned)
  const before = head(db)
  db.exec('BEGIN')
  message(db)
  db.exec('ROLLBACK')
  assert.equal(head(db), before)
  const persisted = message(db)
  assert.deepEqual(events(db, before), [[persisted, 'create']])

  const register = db.prepare(`
    INSERT INTO chat_realtime_commands(user_id,command_id,group_id,kind,request_hash,message_id,created_at)
    VALUES (?,'op-1',?,'send','hash',?,2)
  `)
  register.run(900001, 21, persisted)
  assert.throws(() => register.run(900001, 22, persisted), /UNIQUE constraint failed/)
  register.run(900002, 21, persisted)
})

test('修剪保留可重放的区间并记录低流量群的边界', (t) => {
  const db = database(t)
  message(db)
  db.exec(`
    WITH RECURSIVE rows(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM rows WHERE n<20001)
    INSERT INTO chat_realtime_events(group_id,message_id,kind) SELECT 22,n,'create' FROM rows;
  `)
  const count = db.prepare('SELECT COUNT(*) AS n,MIN(seq) AS min,MAX(seq) AS max FROM chat_realtime_events').get()
  assert.deepEqual({...count}, {n: 20000, min: 3, max: 20002})
  assert.deepEqual(db.prepare('SELECT group_id,seq FROM chat_realtime_pruned ORDER BY group_id').all().map(row => ({...row})), [
    {group_id: 21, seq: 1}, {group_id: 22, seq: 2},
  ])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_realtime_events WHERE group_id=21').get().n, 0)
  const newHead = head(db)
  message(db)
  assert.equal(head(db), newHead + 1)
  assert.equal(db.prepare('SELECT seq FROM chat_realtime_pruned WHERE group_id=22').get().seq, 3)
})
