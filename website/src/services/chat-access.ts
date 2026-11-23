import {independentGuessRequest,guessBansSql} from './guess-access'
import type {C} from '../types'
import {needUser} from './auth'
import {fail} from '../lib/http'
// 欢迎消息由现有入群触发器原子写入；复用其 ID 为分页提供下界。
// 老数据没有欢迎消息时，入群当秒的先后无法确认，从该秒之后开始展示。
export const CHAT_HISTORY_FLOOR=`COALESCE((SELECT MAX(j.id) FROM chat_messages j INDEXED BY idx_chat_msg_user
 WHERE j.user_id=cm.user_id AND j.created_at=cm.joined_at AND j.group_id=cm.group_id AND j.system_kind='join'),
 (SELECT MAX(m.id)+1 FROM chat_messages m INDEXED BY idx_chat_msg_at WHERE m.created_at=cm.joined_at AND m.group_id=cm.group_id),0)`
export type ChatGroup={id:number;name:string;is_default:number;created_at:number;joined_at:number;history_floor:number;last_read:number|null;away_from:number|null}
export type ChatHistoryBoundary=Pick<ChatGroup,'joined_at'|'history_floor'>
export function assertChatHistory(g:ChatHistoryBoundary,id:number,createdAt:number){
 if(createdAt<g.joined_at||id<g.history_floor)fail(404,'消息不在你的可见范围内')
}
export async function needMember(c:C,gid:number,_legacyJoinDefault=false){
 const u=needUser(c)
 const g=await c.env.DB.prepare(`SELECT g.id,g.name,g.is_default,g.created_at,cm.joined_at,cm.last_read,cm.away_from,${CHAT_HISTORY_FLOOR} AS history_floor
 FROM chat_groups g LEFT JOIN chat_members cm ON cm.group_id=g.id AND cm.user_id=? WHERE g.id=?`).bind(u.id,gid).first<ChatGroup>()
 if(!g)fail(404,'群不存在')
 if(await independentGuessRequest(c,gid)){
  if(await c.env.DB.prepare(`SELECT 1 FROM ${guessBansSql} WHERE group_id=? AND user_id=?`).bind(gid,u.id).first())fail(403,'当前账号暂不可参与游戏')
  return {u,g:{...g!,joined_at:0,history_floor:0,last_read:0,away_from:null}}
 }
 if(g!.last_read==null){
  const ban=await c.env.DB.prepare('SELECT kind FROM chat_bans WHERE group_id=? AND user_id=?').bind(gid,u.id).first<{kind:string}>()
  if(ban)fail(403,ban.kind==='left'?'你已自行退出群聊，请保持看图的纯粹':'群聊已临时关闭')
  fail(403,'请先在群聊页面申请加入，管理员通过后可查看消息')
 }
 return {u,g:g!}
}
export async function assertCurrentAccess(c:C,uid:number,gid?:number){
 const user=await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND disabled=0 AND kind='user'").bind(uid).first()
 if(!user)fail(403,'账号暂不可用')
 if(gid!==undefined){
  if(await independentGuessRequest(c,gid)){
   if(await c.env.DB.prepare(`SELECT 1 FROM ${guessBansSql} WHERE group_id=? AND user_id=?`).bind(gid,uid).first())fail(403,'当前账号暂不可参与游戏')
   return
  }
  const member=await c.env.DB.prepare(`SELECT 1 FROM chat_members m JOIN chat_groups g ON g.id=m.group_id
  WHERE m.group_id=?1 AND m.user_id=?2 AND NOT EXISTS(SELECT 1 FROM chat_bans b WHERE b.group_id=?1 AND b.user_id=?2)`).bind(gid,uid).first()
  if(!member)fail(403,'你不在这个群里')
 }
}
