import {Hono} from 'hono'
import type {Ctx,C} from '../types'
import {needUser} from '../services/auth'
import {inviteWriteGuard} from '../services/invite-guard'
import {boundedJson,fail} from '../lib/http'
import {now} from '../lib/time'

export const mainActivation=new Hono<Ctx>()
mainActivation.get('/api/main-access',c=>{c.header('cache-control','no-store');return c.json({logged_in:!!c.get('user'),activated:c.env.MAIN_ACTIVATION!=='required'||!!c.get('user')?.main_activated_at,game_url:'https://play.jinhuan.example'})})
mainActivation.get('/activate',async c=>{const url=new URL(c.req.url);url.pathname='/main-activation.html';url.search='';const r=await c.env.ASSETS.fetch(new Request(url));return new Response(r.body,{status:r.status,headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}})})
mainActivation.post('/api/main-access',async c=>{
 const u=needUser(c);await inviteWriteGuard(c)
 if(u.main_activated_at)return c.json({ok:true,duplicate:true})
 const body=await boundedJson(c,1024) as {code?:unknown},code=String(body.code??'').trim().toUpperCase(),t=now()
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code))fail(400,'请输入8位邀请码')
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE invite_codes SET used_by=?1,used_at=?2 WHERE code=?3 AND used_by IS NULL AND revoked=0 AND expires_at>?2 AND owner_id<>?1
   AND EXISTS(SELECT 1 FROM users WHERE id=owner_id AND disabled=0 AND kind='user')
   AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND main_activated_at IS NULL AND disabled=0 AND kind='user')
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1) RETURNING code`).bind(u.id,t,code),
  c.env.DB.prepare(`INSERT OR IGNORE INTO main_activation_receipts(user_id,code,activated_at) SELECT ?1,code,?2 FROM invite_codes WHERE code=?3 AND used_by=?1`).bind(u.id,t,code),
  c.env.DB.prepare(`UPDATE users SET main_activated_at=?2 WHERE id=?1 AND main_activated_at IS NULL AND EXISTS(SELECT 1 FROM main_activation_receipts WHERE user_id=?1 AND code=?3)`).bind(u.id,t,code),
  c.env.DB.prepare(`INSERT OR IGNORE INTO invites(invitee_id,inviter_id,code,method,created_at) SELECT ?1,owner_id,code,'activation',?2 FROM invite_codes WHERE code=?3 AND used_by=?1 AND EXISTS(SELECT 1 FROM main_activation_receipts WHERE user_id=?1 AND code=?3)`).bind(u.id,t,code),
 ])
 const activated=result[0].results.length||await c.env.DB.prepare('SELECT 1 FROM users WHERE id=? AND main_activated_at IS NOT NULL').bind(u.id).first()
 if(!activated)fail(409,'邀请码无效、已使用或已过期；本次未消耗邀请码')
 return c.json({ok:true})
})
export async function mainAccessGate(c:C,next:()=>Promise<void>){
 const path=c.req.path,host=new URL(c.req.url).hostname
 // cc is a service-binding URL. It has its own authenticated route allowlist.
 // 2026-11-04 起主站不再需要邀请码激活；环境变量 MAIN_ACTIVATION="required" 可恢复
 if(c.env.MAIN_ACTIVATION!=='required'||host==='play.jinhuan.example'||c.get('user')?.main_activated_at){await next();return}
 if(path==='/api/me')return c.json({user:null,main_activation_required:true})
 if(c.req.method==='POST'&&/^\/api\/chat-bots\/[a-f0-9-]{36}\/messages$/.test(path)){await next();return}
 if(path==='/activate'||path==='/api/main-access'||path.startsWith('/auth/')||path.startsWith('/api/auth/')||path.startsWith('/api/invites/')||path.startsWith('/api/me/account')||path.startsWith('/api/me/bind/')||path==='/api/me'||path==='/api/config'||/^\/(?:login|register|reset|welcome|i)(?:\/|$)/.test(path)||path.startsWith('/img/')||path==='/ext'||path.startsWith('/assets/')||/\.(?:js|css|woff2?|png|webp|svg|ico|html)$/.test(path)){await next();return}
 c.header('cache-control','no-store')
 if(path.startsWith('/api/'))return c.json({error:'主站需要邀请码激活；VIP游戏站仍可访问',code:'main_activation_required',activation_url:'/activate'},403)
 return c.redirect('/activate')
}
