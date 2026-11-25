import {communityProgressStatements} from './community-growth'
import {ensureCoinWallet} from './farm/coin-packets'
import {farmWallet} from './farm/wallet'
import {newFarm,CROPS,type FarmState} from './farm/rules'
import {farewellRelease} from './legacy/live-app.js'
import {raffleRoll,titleLevelSql} from './title-growth'
import {RAFFLE_TITLES,raffleTitleEnabled} from './title-raffle'
import {TITLE_PITY,TITLE_MAX_LEVEL,TITLE_DRAW_COUNTS,titleAvailable,titleChance,collectionTitle} from './shared/title-collection'

export class DrawRuleError extends Error {}
export type DrawInput={uid:number;id:string;title:string;count:number;level:number;revision:number;owner:boolean;t:number}
type Prize={request_id:string;title:string;kind:'draw';price:number;finger_level:number;chance:number;won:number;reward_kind:'title'|'trial'|'coin'|'seed'|'none';reward_id:string;reward_amount:number;guaranteed:number;created_at:number;expires_at?:number;reward_level?:number}
type Batch={title:string;count:number;finger_level:number;results:string;pity_after:number}
export async function drawProgress(db:D1Database,uid:number,limited=false){
 if(limited){await db.prepare('INSERT OR IGNORE INTO instant_card_limited_progress(user_id) VALUES(?)').bind(uid).run();return db.prepare('SELECT pity,draws,revision FROM instant_card_limited_progress WHERE user_id=?').bind(uid).first<{pity:number;draws:number;revision:number}>()}
 // One bounded indexed history pass only for accounts without a progress row.
 const old=await db.prepare('SELECT pity,draws,revision FROM instant_card_progress WHERE user_id=?').bind(uid).first<{pity:number;draws:number;revision:number}>();if(old)return old
 const {results}=await db.prepare("SELECT won FROM instant_card_receipts WHERE user_id=? AND kind='draw' ORDER BY id DESC LIMIT 119").bind(uid).all<{won:number}>()
 const firstWin=results.findIndex(x=>x.won===1),pity=firstWin<0?results.length:firstWin
 await db.prepare(`INSERT OR IGNORE INTO instant_card_progress(user_id,pity) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)`).bind(uid,pity,uid,uid).run()
 return await db.prepare('SELECT pity,draws,revision FROM instant_card_progress WHERE user_id=?').bind(uid).first<{pity:number;draws:number;revision:number}>()
}
export async function drawBatchReceipt(db:D1Database,uid:number,id:string){return db.prepare('SELECT title,count,finger_level,results,pity_after FROM instant_card_batches WHERE user_id=? AND request_id=?').bind(uid,id).first<Batch>()}
const output=(b:Batch)=>{const receipts=JSON.parse(b.results) as Prize[];return {receipts,pity:b.pity_after,count:receipts.length,requested_count:b.count,unspent:(b.count-receipts.length)*100}}
export async function drawCards(db:D1Database,p:DrawInput,roll=raffleRoll){
 if(!/^[0-9a-f-]{36}$/.test(p.id)||!TITLE_DRAW_COUNTS.includes(p.count)||!Number.isInteger(p.level)||p.level<0||p.level>5||!Number.isInteger(p.revision)||!RAFFLE_TITLES.some(t=>t.id===p.title&&t.enabled&&!t.newcomer&&!t.commemorative))throw new DrawRuleError('抽卡参数无效')
 const compatible=(b:Batch)=>{if(b.title!==p.title||b.count!==p.count||b.finger_level!==p.level)throw new DrawRuleError('请求标识已用于其他操作');return output(b)}
 const old=await drawBatchReceipt(db,p.uid,p.id);if(old)return compatible(old)
 // Recover pre-upgrade single receipts without charging again.
 const legacy=await db.prepare('SELECT * FROM instant_card_receipts WHERE user_id=? AND request_id=?').bind(p.uid,p.id).first<Record<string,unknown>>()
 if(legacy){if(p.count!==1||legacy.kind!=='draw'||legacy.title!==p.title||legacy.finger_level!==p.level)throw new DrawRuleError('请求标识已用于其他操作');return {receipts:[legacy],pity:(await drawProgress(db,p.uid))?.pity??0,count:1}}
 if(!raffleTitleEnabled(p.title))throw new DrawRuleError('称号已下线');
 if(!titleAvailable(p.title,p.t))throw new DrawRuleError('这个限定展期已结束；保底进度保留至下一展期')
 const limited=!!collectionTitle(p.title)?.limited,progressTable=limited?'instant_card_limited_progress':'instant_card_progress'
 const pool=await db.prepare('SELECT owner_id FROM instant_card_pools WHERE title=? AND active=1').bind(p.title).first<{owner_id:number}>();if(!pool)throw new DrawRuleError('奖池不存在')
 const ids=RAFFLE_TITLES.filter(t=>t.enabled&&!t.newcomer&&!t.commemorative).map(t=>t.id)
 const owned=(await db.prepare(`SELECT value AS title,${titleLevelSql('?1','j.value')} AS level FROM json_each(?2) j`).bind(p.uid,JSON.stringify(ids)).all<{title:string;level:number}>()).results
 const levels=new Map(owned.map(t=>[t.title,t.level])),initialLevels=new Map(levels)
 // Owner entitlement is virtual; keep the stored snapshot for the transaction guard.
 if(p.owner)for(const id of ids)levels.set(id,TITLE_MAX_LEVEL)
 await ensureCoinWallet(db,p.uid,p.t);if(pool.owner_id!==p.uid)await ensureCoinWallet(db,pool.owner_id,p.t)
 const progress=await drawProgress(db,p.uid,limited);if(!progress)throw new DrawRuleError('账号不可用')
 const enabled=new Set((await db.prepare('SELECT title FROM instant_card_pools WHERE active=1').all<{title:string}>()).results.map(x=>x.title));
 const chance=titleChance(p.level),normal=RAFFLE_TITLES.filter(t=>t.enabled&&enabled.has(t.id)&&raffleTitleEnabled(t.id)&&!t.newcomer&&!t.commemorative&&t.limited===limited&&titleAvailable(t.id,p.t)).map(t=>t.id),prizes:Prize[]=[];let pity=progress.pity,refund=0,maxDry=progress.pity
 const randomIndex=(length:number)=>{if(roll!==raffleRoll)return Math.min(length-1,Math.floor(roll()*length/100));const limit=Math.floor(4294967296/length)*length;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);return n%length}
 for(let i=0;i<p.count;i++){
  const guaranteed=pity>=TITLE_PITY-1,won=guaranteed||roll()<chance
  let reward_kind:Prize['reward_kind']='none',reward_id='',reward_amount=0
  if(won){
   reward_id=guaranteed||roll()<75||!normal.length?p.title:normal[randomIndex(normal.length)];const n=roll(),ownedLevel=levels.get(reward_id)||0
   if(ownedLevel>=TITLE_MAX_LEVEL){reward_kind='coin';reward_amount=100;refund+=reward_amount}
   else{reward_kind='title';reward_amount=Math.min(n<80?1:n<98?2:5,TITLE_MAX_LEVEL-ownedLevel);levels.set(reward_id,ownedLevel+reward_amount)}
   pity=0
  }
  else{pity++;maxDry=Math.max(maxDry,pity);const extra=roll();if(extra<20){reward_kind='coin';reward_amount=20+Math.floor(roll()*31/100);refund+=reward_amount}else if(extra<50){reward_kind='seed';reward_id=['carrot','cabbage','wheat','tomato','corn','pumpkin'][randomIndex(6)];reward_amount=1+randomIndex(3)}else if(extra<80){
   const rare=roll()===0&&roll()<10,options=RAFFLE_TITLES.filter(t=>t.enabled&&raffleTitleEnabled(t.id)&&!t.newcomer&&!t.commemorative&&t.limited===rare&&(levels.get(t.id)||0)<TITLE_MAX_LEVEL)
   if(options.length){reward_kind='trial';reward_id=options[randomIndex(options.length)].id;const r=roll();reward_amount=r<60?1+randomIndex(50):r<90?50+randomIndex(251):r<99?300+randomIndex(1301):1600+randomIndex(3601)}else{reward_kind='seed';reward_id='wheat';reward_amount=1}
  }}
  if(reward_kind==='seed'&&farewellRelease.farmClosed(p.t)){reward_kind='coin';reward_amount*=CROPS.find(c=>c.id===reward_id)!.seedPrice;reward_id='';refund+=reward_amount}
  prizes.push({request_id:crypto.randomUUID(),title:p.title,kind:'draw',price:100,finger_level:p.level,chance,won:won?1:0,reward_kind,reward_id,reward_amount,guaranteed:guaranteed?1:0,created_at:p.t,...(reward_kind==='title'?{reward_level:levels.get(reward_id)}:{}),...(reward_kind==='trial'?{expires_at:p.t+86400}:{})})
 }
 let farmRevision:number|null=null,encoded:string|null=null
 if(prizes.some(x=>x.reward_kind==='seed')){
  const existing=await db.prepare('SELECT 1 FROM farm_saves WHERE user_id=?').bind(p.uid).first()
  const farm=existing?await farmWallet(db,p.uid,p.t):null
  if(existing&&!farm)throw new DrawRuleError('农场存档暂不可用')
  const state=farm?JSON.parse(farm.state) as FarmState:newFarm(p.t)
  for(const prize of prizes)if(prize.reward_kind==='seed'){const key=prize.reward_id as keyof FarmState['seeds'];state.seeds[key]=(state.seeds[key]??0)+prize.reward_amount}
  farmRevision=farm?.revision??-1;encoded=JSON.stringify(state)
 }
 const attempt=crypto.randomUUID(),price=100*prizes.length,gate='EXISTS(SELECT 1 FROM instant_card_batches WHERE attempt=?1)',effective=p.owner?'5':'COALESCE((SELECT level FROM instant_card_fingers WHERE user_id=?1),0)'
 const touched=[...new Set([p.title,...prizes.filter(x=>x.reward_kind==='title'||x.reward_kind==='trial'||x.reward_kind==='coin'&&x.reward_id).map(x=>x.reward_id)])]
 const snapshot=JSON.stringify(touched.map(title=>({title,level:initialLevels.get(title)||0})))
 const sqls=[db.prepare(`INSERT OR IGNORE INTO instant_card_batches(user_id,request_id,owner_id,attempt,title,count,finger_level,results,pity_after,created_at)
  SELECT ?1,?2,p.owner_id,?3,p.title,?4,?5,?6,?7,?8 FROM instant_card_pools p JOIN coin52_wallets w ON w.user_id=?1 JOIN coin52_wallets receiver ON receiver.user_id=p.owner_id
  WHERE p.title=?9 AND p.active=1 AND p.revision=?10 AND p.owner_id=?11 AND w.balance>=?12 AND (receiver.user_id=?1 OR receiver.balance+?12<=9007199254740991)
  AND ${effective}=?5 AND EXISTS(SELECT 1 FROM ${progressTable} WHERE user_id=?1 AND revision=?13)
  AND NOT EXISTS(SELECT 1 FROM json_each(?15) snapshot WHERE ${titleLevelSql('?1',"json_extract(snapshot.value,'$.title')")}<>json_extract(snapshot.value,'$.level'))
  AND (?14 IS NULL OR (?14=-1 AND NOT EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1)) OR EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?14))
  AND EXISTS(SELECT 1 FROM users u JOIN chat_members m ON m.user_id=u.id AND m.group_id=1 WHERE u.id=?1 AND u.disabled=0 AND u.kind='user')
  AND EXISTS(SELECT 1 FROM users WHERE id=p.owner_id AND disabled=0 AND kind='user')
  AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?1,p.owner_id)) AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=?1)
  AND NOT EXISTS(SELECT 1 FROM instant_card_receipts WHERE user_id=?1 AND request_id=?2)
  AND (SELECT COUNT(*) FROM instant_card_receipts WHERE user_id=?1 AND created_at>?8-60)+?16<=200`).bind(p.uid,p.id,attempt,p.count,p.level,JSON.stringify(prizes),pity,p.t,p.title,p.revision,pool.owner_id,price,progress.revision,farmRevision,snapshot,prizes.length)]
 const money=(uid:number,kind:string,delta:number,suffix:string)=>{
  sqls.push(db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?2,?3,?4,?5,?6,balance+?6,?7 FROM coin52_wallets WHERE user_id=?2 AND ${gate}`).bind(attempt,uid,kind,p.id,attempt+suffix,delta,p.t))
  sqls.push(db.prepare(`UPDATE coin52_wallets SET balance=balance+?3,revision=revision+1,updated_at=?4 WHERE user_id=?2 AND ${gate}`).bind(attempt,uid,delta,p.t))
 }
 money(p.uid,'card-pay',-price,':pay');money(pool.owner_id,'card-income',price,':income')
 if(refund){money(pool.owner_id,'card-prize-pay',-refund,':prize-pay');money(p.uid,'card-prize',refund,':prize')}
 // Three set-based writes regardless of batch size. Each card keeps its own
 // immutable receipt and award source; a retry cannot add rewards a second time.
 const prizeJson=JSON.stringify(prizes)
 sqls.push(db.prepare(`INSERT INTO instant_card_receipts(user_id,owner_id,request_id,attempt,kind,title,price,finger_level,chance,won,created_at,batch_id,reward_kind,reward_id,reward_amount,guaranteed)
  SELECT ?2,?3,json_extract(value,'$.request_id'),?1||':'||key,'draw',?4,100,?5,?6,json_extract(value,'$.won'),?7,?8,json_extract(value,'$.reward_kind'),json_extract(value,'$.reward_id'),json_extract(value,'$.reward_amount'),json_extract(value,'$.guaranteed') FROM json_each(?9) WHERE ${gate}`).bind(attempt,p.uid,pool.owner_id,p.title,p.level,chance,p.t,p.id,prizeJson))
 sqls.push(db.prepare(`INSERT INTO title_awards(user_id,title,source,created_at,levels)
  SELECT ?2,json_extract(value,'$.reward_id'),'card-v3:'||json_extract(value,'$.request_id'),?3,json_extract(value,'$.reward_amount') FROM json_each(?4) WHERE json_extract(value,'$.reward_kind')='title' AND ${gate}`).bind(attempt,p.uid,p.t,prizeJson))
 sqls.push(db.prepare(`INSERT INTO title_trials(user_id,title,level,expires_at)
  SELECT ?2,json_extract(value,'$.reward_id'),MAX(json_extract(value,'$.reward_amount')),MAX(json_extract(value,'$.expires_at')) FROM json_each(?3) WHERE json_extract(value,'$.reward_kind')='trial' AND ${gate} GROUP BY json_extract(value,'$.reward_id')
  ON CONFLICT(user_id,title) DO UPDATE SET level=CASE WHEN title_trials.expires_at>?4 THEN MAX(title_trials.level,excluded.level) ELSE excluded.level END,expires_at=MAX(title_trials.expires_at,excluded.expires_at)`).bind(attempt,p.uid,prizeJson,p.t))
 if(farmRevision===-1)sqls.push(db.prepare(`INSERT INTO farm_saves(user_id,state,updated_at,owner_operated_at) SELECT ?2,?3,?4,?4 WHERE ${gate}`).bind(attempt,p.uid,JSON.stringify(newFarm(p.t)),p.t))
 if(encoded!==null)sqls.push(db.prepare(`UPDATE farm_saves SET state=?3,revision=revision+1,updated_at=?4 WHERE user_id=?2 AND ${gate}`).bind(attempt,p.uid,encoded,p.t))
 sqls.push(db.prepare(`UPDATE ${progressTable} SET pity=?3,draws=draws+?4,revision=revision+1 WHERE user_id=?2 AND ${gate}`).bind(attempt,p.uid,pity,prizes.length))
 if(!p.owner)sqls.push(db.prepare(`UPDATE users SET deco=json_set(deco,'$.fp',${titleLevelSql('users.id',"json_extract(deco,'$.ft')")},'$.fxp',COALESCE((SELECT expires_at FROM title_trials WHERE user_id=users.id AND title=json_extract(deco,'$.ft') AND expires_at>?3),0),'$.fn',MAX(${titleLevelSql('users.id',"json_extract(deco,'$.ft')")},COALESCE((SELECT level FROM title_trials WHERE user_id=users.id AND title=json_extract(deco,'$.ft') AND expires_at>?3),0))),updated_at=?3 WHERE id=?2 AND json_extract(deco,'$.ft') IS NOT NULL AND ${gate}`).bind(attempt,p.uid,p.t))
 sqls.push(...communityProgressStatements(db,p.uid,{card_draws:prizes.length,card_wins:prizes.filter(x=>x.won).length},p.t,gate,[attempt]),...communityProgressStatements(db,p.uid,{card_dry:maxDry},p.t,gate,[attempt],true))
 await db.batch(sqls)
 const saved=await drawBatchReceipt(db,p.uid,p.id);if(!saved)throw new DrawRuleError('余额不足、奖池或存档状态变化，或每分钟超过200抽；请刷新后重试')
 return compatible(saved)
}
