import { CHAT_HISTORY_FLOOR } from './chat-access'

type ReactionRow = { message_id: number; emoji: string; n: number; who: string; actors: string }
type BoostRow = {
  message_id: number; text: string; user_id: number; created_at: number; ai_status: string; ai_score: number | null
  kind: string; username: string | null; name: string | null; avatar: string | null; deco: string | null
}
type RoadRow = { mid: number; id: number }
type ReplyCount = { id: number; n: number }
type ReplySummary = ReplyCount & { first_id: number; first_at: number }

const CHAT_REPLIES_BY_PARENT_SQL = `FROM json_each(?1) ids
  CROSS JOIN chat_messages parent ON parent.id=ids.value
  CROSS JOIN chat_messages x INDEXED BY idx_chat_msg_reply ON x.reply_to=parent.id AND x.group_id=parent.group_id`

export async function readChatReplyCounts(
  db: D1Database, uid: number, ids: number[],
  shared?: { joinedAt: number; historyFloor?: number; decorations?: ChatDecorations },
) {
  const counts: ReplyCount[] = []
  const summaries = shared?.decorations?.replies
  const partial = summaries ? ids.filter(id => {
    const reply = summaries.get(id)
    if (!reply) return false
    if (reply.first_at < shared!.joinedAt || reply.first_id < shared!.historyFloor!) return true
    counts.push({ id, n: reply.n })
    return false
  }) : ids
  if (!partial.length) return counts
  const { results } = await db.prepare(`SELECT parent.id,COUNT(*) AS n
    ${CHAT_REPLIES_BY_PARENT_SQL}
    CROSS JOIN chat_members cm ON cm.group_id=parent.group_id AND cm.user_id=?2
    WHERE x.deleted=0 AND x.created_at>=cm.joined_at AND x.id>=${CHAT_HISTORY_FLOOR}
      ${shared ? 'AND x.created_at>=?3' : ''}
    GROUP BY parent.id`).bind(JSON.stringify(partial), uid, ...shared ? [shared.joinedAt] : []).all<ReplyCount>()
  return [...counts, ...results]
}

// 群内共用查询返回的回应者编号只保留在进程内，用于派生每位订阅者自己的 mine。
export async function hydrateChatDecorations(db: D1Database, messageIds: number[]) {
  const ids = JSON.stringify(messageIds)
  const [reacts, boosts, road, replies] = await Promise.all([
    db.prepare(`SELECT r.message_id, r.emoji, COUNT(*) AS n, json_group_array(r.user_id) AS actors,
      (SELECT json_group_array(json_object('username', w.username, 'name', w.name, 'avatar', w.avatar))
       FROM (SELECT r2.user_id FROM chat_reactions r2 WHERE r2.message_id=r.message_id AND r2.emoji=r.emoji
             ORDER BY r2.created_at LIMIT 3) t JOIN users w ON w.id=t.user_id) AS who
      FROM chat_reactions r WHERE r.message_id IN (SELECT value FROM json_each(?))
      GROUP BY r.message_id, r.emoji ORDER BY MIN(r.created_at)`).bind(ids).all<ReactionRow>(),
    db.prepare(`SELECT b.message_id,b.text,b.user_id,b.created_at,b.ai_status,b.ai_score,
      u.kind,u.username,u.name,u.avatar,u.deco FROM chat_boosts b LEFT JOIN users u ON u.id=b.user_id
      WHERE b.message_id IN (SELECT value FROM json_each(?)) ORDER BY b.created_at`).bind(ids).all<BoostRow>(),
    db.prepare(`SELECT source_msg_id AS mid,id FROM road_items INDEXED BY idx_road_source_msg
      WHERE source_msg_id IN (SELECT value FROM json_each(?)) AND hidden=0 AND source_hidden=0`).bind(ids).all<RoadRow>(),
    db.prepare(`SELECT parent.id,COUNT(*) AS n,MIN(x.id) AS first_id,MIN(x.created_at) AS first_at
      ${CHAT_REPLIES_BY_PARENT_SQL}
      WHERE x.deleted=0 GROUP BY parent.id`).bind(ids).all<ReplySummary>(),
  ])
  return {
    reacts: { results: reacts.results.map(({ actors, ...reaction }) => ({ ...reaction, actors: new Set<number>(JSON.parse(actors)) })) },
    boosts,
    road,
    replies: new Map(replies.results.map(row => [row.id, row])),
  }
}
export type ChatDecorations = Awaited<ReturnType<typeof hydrateChatDecorations>>
