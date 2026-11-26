import { Hono } from 'hono'
import type { Ctx } from '../types'
import { boundedJson, fail, sameOrigin } from '../lib/http'
import { assertCurrentAccess, needMember } from '../services/chat-access'

export const chatGroupPin = new Hono<Ctx>()

chatGroupPin.put('/api/chat/groups/:id/pin', async c => {
  sameOrigin(c)
  const gid = Number(c.req.param('id'))
  if (!Number.isSafeInteger(gid) || gid < 1) fail(400, '群编号无效')
  const { u } = await needMember(c, gid)
  await assertCurrentAccess(c, u.id, gid)
  const { pinned } = await boundedJson(c, 1024)
  if (typeof pinned !== 'boolean') fail(400, '请选择置顶或取消置顶')
  const db = c.env.DB
  const statements = pinned ? [
    // Clear and set in one transaction so concurrent requests keep one pin per user.
    db.prepare(`UPDATE chat_members SET pinned=0 WHERE user_id=?1 AND pinned=1
      AND EXISTS(SELECT 1 FROM chat_members WHERE group_id=?2 AND user_id=?1)`).bind(u.id, gid),
    db.prepare('UPDATE chat_members SET pinned=1 WHERE group_id=? AND user_id=? RETURNING group_id').bind(gid, u.id),
  ] : [
    db.prepare('UPDATE chat_members SET pinned=0 WHERE group_id=? AND user_id=? RETURNING group_id').bind(gid, u.id),
  ]
  const result = await db.batch(statements)
  if (!result.at(-1)?.results.length) fail(403, '你不在这个群里')
  c.header('Cache-Control', 'no-store')
  return c.json({ ok: true, pinned })
})
