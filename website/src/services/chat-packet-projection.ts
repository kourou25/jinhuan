import { sharedPacket } from '../../public/redpacket-reference.js'
import { now } from '../lib/time'

type PacketPublic = {
  packet_id: string
  message_id: number
  opened: number
  coin52_remaining: number
  coin52_total: number
  coin52_expires_at: number | null
  coin52_kind: string
}
type PacketPersonal = {
  packet_id: string
  external_snapshot: string | null
  synced_at: number | null
  solved_at: number | null
  coin52_claimed: number
}
type PacketMessageRow = { id: number; deleted: number; redpack_id: string | null; body: string }

const PUBLIC_FIELDS = `p.id AS packet_id,p.message_id,p.mode,p.game,p.prompt,p.provider,p.notify_at,p.draw_data,
  COALESCE(lp.mode,fp.mode) AS ldc_mode,COALESCE(lp.room_revision,fp.room_revision) AS guess_revision,
  lp.total_cents AS ldc_total,lp.count AS ldc_count,lp.payment_provider,
  COALESCE(lp.response_mode,fp.response_mode) AS ldc_response_mode,
  CASE WHEN COALESCE(lp.response_mode,fp.response_mode)='similarity' THEN COALESCE(lp.answer_length,fp.answer_length) END AS ldc_answer_length,
  cp.remaining_count AS coin52_remaining,cp.count AS coin52_total,cp.expires_at AS coin52_expires_at,cp.mode AS coin52_kind,
  (SELECT COUNT(*) FROM chat_redpack_opens s WHERE s.packet_id=p.id AND s.solved_at IS NOT NULL) AS opened`
const PUBLIC_JOINS = `LEFT JOIN ldc_packets lp ON lp.packet_id=p.id
  LEFT JOIN guess_free_rounds fp ON fp.packet_id=p.id
  LEFT JOIN coin52_packets cp ON cp.packet_id=p.id`
const PERSONAL_FIELDS = 'v.data AS external_snapshot,v.synced_at,o.solved_at,s.recipient_id IS NOT NULL AS coin52_claimed'
const personalJoins = (packet: 'p.id' | 'requested.value') => `
  LEFT JOIN chat_redpack_opens o ON o.packet_id=${packet} AND o.user_id=?1
  LEFT JOIN chat_redpack_external_views v ON v.packet_id=${packet} AND v.user_id=?1
  LEFT JOIN coin52_packet_slots s ON s.packet_id=${packet} AND s.recipient_id=?1`

function chatPacketMessageIds(rows: PacketMessageRow[]) {
  // 沿用历史消息的红包标记和旧分享识别；有候选时按这批消息的实际红包关联查找。
  return rows.some(r => !r.deleted && (r.redpack_id || sharedPacket(r.body))) ? rows.map(row => row.id) : []
}

export async function hydrateChatPackets(db: D1Database, rows: PacketMessageRow[]) {
  const ids = chatPacketMessageIds(rows)
  if (!ids.length) return new Map<number, PacketPublic>()
  const { results } = await db.prepare(`SELECT ${PUBLIC_FIELDS} FROM chat_redpacks p ${PUBLIC_JOINS}
    WHERE p.message_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<PacketPublic>()
  return new Map(results.map(row => [row.message_id, row]))
}
export type ChatPacketPublicMap = Awaited<ReturnType<typeof hydrateChatPackets>>

function withPersonalState(packet: PacketPublic, state: PacketPersonal | undefined, at: number) {
  const snapshot = packet.coin52_expires_at === null ? state?.external_snapshot ?? null : JSON.stringify({
    state: packet.coin52_expires_at <= at ? 'expired' : packet.coin52_remaining === 0 ? 'exhausted' : 'active',
    claimed: state?.coin52_claimed ?? 0,
    remaining: packet.coin52_remaining,
    total: packet.coin52_total,
    claimed_count: packet.coin52_total - packet.coin52_remaining,
    expires_at: packet.coin52_expires_at,
    kind: packet.coin52_kind,
  })
  return { ...packet, snapshot, synced_at: state?.synced_at ?? null, solved_at: state?.solved_at ?? null }
}

export async function readChatPacketProjections(db: D1Database, uid: number, rows: PacketMessageRow[], shared?: ChatPacketPublicMap) {
  const ids = chatPacketMessageIds(rows)
  if (!ids.length) return []
  if (!shared) {
    const { results } = await db.prepare(`SELECT ${PUBLIC_FIELDS},${PERSONAL_FIELDS} FROM chat_redpacks p
      ${PUBLIC_JOINS} ${personalJoins('p.id')} WHERE p.message_id IN (SELECT value FROM json_each(?2))`)
      .bind(uid, JSON.stringify(ids)).all<PacketPublic & PacketPersonal>()
    const at = now()
    return results.map(row => withPersonalState(row, row, at))
  }
  const packets = ids.flatMap(id => shared.get(id) ?? [])
  if (!packets.length) return []
  // 每个订阅者只读自己在该页可见红包中的记录；公共统计和开奖数据由群页共用。
  const { results } = await db.prepare(`SELECT requested.value AS packet_id,${PERSONAL_FIELDS}
    FROM json_each(?2) requested ${personalJoins('requested.value')}`)
    .bind(uid, JSON.stringify(packets.map(packet => packet.packet_id))).all<PacketPersonal>()
  const states = new Map(results.map(row => [row.packet_id, row]))
  const at = now()
  return packets.map(packet => withPersonalState(packet, states.get(packet.packet_id), at))
}
