import {cleanPacketSnapshot} from './redpacket-status'

export function publicPacketDraw(b: ReturnType<typeof cleanPacketSnapshot>) {
  if (!['lottery','timed_draw'].includes(b.kind) || !b.draw_at) return null
  return {kind:b.kind,draw_at:b.draw_at,draw_deadline:b.draw_deadline,draw_complete:b.draw_complete,
    participant_count:b.participant_count,winner_count:b.winner_count,
    winners:b.winners,roster_more:b.roster_more,roster_error:b.roster_error}
}
// 只由用户查询得到的公开字段更新共享摘要；不复制本人领取状态。
export function drawSyncStatements(db: D1Database, p: {id:string;message_id:number;provider:string}, d: NonNullable<ReturnType<typeof publicPacketDraw>>, at: number) {
  const done = d.draw_complete && !d.roster_error && d.draw_at <= at
  return [
    db.prepare(`UPDATE chat_redpacks SET draw_data=?,draw_synced_at=?,notify_at=COALESCE(notify_at,?)
      WHERE id=? AND (draw_announced_at IS NULL OR ?=1)`).bind(JSON.stringify(d),at,d.draw_at,p.id,done?1:0),
    ...(done ? [
      // 开奖结果不再发群消息，红包袋和红包详情直接读 draw_data；已发过的旧消息保留
      db.prepare('UPDATE chat_redpacks SET draw_announced_at=COALESCE(draw_announced_at,?) WHERE id=?').bind(at,p.id),
    ] : []),
  ]
}
