import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Ctx} from './types'
import {needMember} from './services/chat-access'
import {isOwner} from './services/auth'
import {boundedJson,fail,sameOrigin} from './lib/http'
import {ensureCoinWallet} from './farm/coin-packets'
import {now} from './lib/time'
import {raffleRoll} from './title-growth'
import {readCommunityCatalog} from './community-skins/sync.mjs'

const PRICE=100,PITY=60,PREFIX='bubble:community:',LIMITED_CHANCE=5,CARD_PACK='owner52b'
export const BUBBLE_PRIZE_CUTOFF=1793548800
export const BUBBLE_PRIZE_POLICY={denominator:10000,jackpotBand:1,jackpotAmount:120000,baseMin:12,baseSpan:9988} as const
const CARD_CATALOG=[
 {id:'0',name:'玛奇玛',rarity:'UR',description:'链锯人角色；冷静、支配与红色环纹。',asset:'/assets/owner52-v033/cards/0-makima.webp',back:'/assets/owner52-v033/cards/back.webp'},
 {id:'1',name:'蕾塞',rarity:'SSR',description:'链锯人角色；深色短发、花朵与爆裂蓝紫。',asset:'/assets/owner52-v033/cards/1-reze.webp',back:'/assets/owner52-v033/cards/back.webp'},
 {id:'2',name:'杀手皇后',rarity:'SR',description:'JoJo 替身；保持粉色猫头人形替身轮廓。',asset:'/assets/owner52-v033/cards/2-killer-queen.webp',back:'/assets/owner52-v033/cards/back.webp'},
 {id:'3',name:'山田',rarity:'R',description:'《在超市后门吸烟的二人》角色；红色三角头巾与亲和笑容。',asset:'/assets/owner52-v033/cards/3-yamada.webp',back:'/assets/owner52-v033/cards/back.webp'},
 {id:'4',name:'田山',rarity:'R',description:'《在超市后门吸烟的二人》角色；酒红齐刘海、低束发与黑色颈圈。',asset:'/assets/owner52-v033/cards/4-tayama.webp',back:'/assets/owner52-v033/cards/back.webp'},
 {id:'5',name:'初音未来',rarity:'SSR',description:'Piapro Character；青绿色双马尾与舞台麦克风。',asset:'/assets/owner52-v033/cards/5-miku.webp',back:'/assets/owner52-v033/cards/back.webp'},
 {id:'6',name:'雪之下雪乃',rarity:'UR',description:'《我的青春恋爱喜剧果然有问题》角色；黑长发、冷静眼神与书本。',asset:'/assets/owner52-v033/cards/6-yukino.webp',back:'/assets/owner52-v033/cards/back.webp'},
] as const
class BubbleRuleError extends Error {}
type Bubble={id:string;name:string;author:string;components:{bubble?:unknown;title?:unknown;badge?:unknown;reply?:unknown}}
type Catalog={source:string;entries:Bubble[]}
type Receipt={request_id:string;item_id:string|null;won:number;duplicate:number;guaranteed:number;pity_after:number;chance:number;finger_level:number;catalog_source:string;card_id:string|null;card_duplicate:number;reward_amount:number;created_at:number}
const available=(catalog:Catalog)=>catalog.entries.filter((x,i,a)=>x.components?.bubble&&/^[a-z0-9][a-z0-9-]{2,47}$/.test(x.id)&&a.findIndex(y=>y.id===x.id)===i)
const ownerId=(value:string|undefined)=>{const text=(value||'').split(',')[0]?.trim();return /^\d+$/.test(text||'')?Number(text):0}
const randomIndex=(length:number)=>{const limit=Math.floor(4294967296/length)*length;let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);return n%length}
export const bubblePrizeReward=(won:boolean,owner:boolean,pick=randomIndex,t=now())=>{
 if(won||owner||t>=BUBBLE_PRIZE_CUTOFF)return 0
 const band=pick(BUBBLE_PRIZE_POLICY.denominator)
 if(band<BUBBLE_PRIZE_POLICY.jackpotBand)return BUBBLE_PRIZE_POLICY.jackpotAmount
 return BUBBLE_PRIZE_POLICY.baseMin+pick(BUBBLE_PRIZE_POLICY.baseSpan)
}
const result=(r:Receipt)=>({request_id:r.request_id,item_id:r.item_id,won:!!r.won,duplicate:!!r.duplicate,guaranteed:!!r.guaranteed,pity:r.pity_after,chance:r.chance,level:r.finger_level,source:r.catalog_source,card_id:r.card_id,card_duplicate:!!r.card_duplicate,reward:r.reward_amount,created_at:r.created_at,price:PRICE,refund:r.duplicate?PRICE:0})
const batchResult=(rows:Receipt[])=>{
 const receipts=rows.map(result),last=receipts[receipts.length-1]
 return {...last,receipts,count:receipts.length,price:PRICE*receipts.length,refund:receipts.reduce((n,x)=>n+x.refund,0),reward:receipts.reduce((n,x)=>n+x.reward,0)}
}
export async function bubbleReceipt(db:D1Database,uid:number,id:string){return db.prepare('SELECT request_id,item_id,won,duplicate,guaranteed,pity_after,chance,finger_level,catalog_source,card_id,card_duplicate,reward_amount,created_at FROM community_bubble_draws WHERE user_id=? AND request_id=?').bind(uid,id).first<Receipt>()}
export async function bubbleBatchReceipts(db:D1Database,uid:number,id:string){return (await db.prepare('SELECT request_id,item_id,won,duplicate,guaranteed,pity_after,chance,finger_level,catalog_source,card_id,card_duplicate,reward_amount,created_at FROM community_bubble_draws WHERE user_id=?1 AND (request_id=?2 OR (request_id>=?3 AND request_id<?4)) ORDER BY request_id').bind(uid,id,`${id}:`,`${id};`).all<Receipt>()).results}
export async function drawCommunityBubble(db:D1Database,bucket:R2Bucket,p:{uid:number;id:string;count?:number;ownerId:number;owner:boolean;t:number},roll=raffleRoll,pick=randomIndex){
 const count=p.count??1
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id)||!Number.isSafeInteger(p.ownerId)||p.ownerId<1||![1,60].includes(count))throw new BubbleRuleError('抽奖参数或奖池账户无效')
 const prior=await bubbleBatchReceipts(db,p.uid,p.id)
 if(prior.length){if(prior.length!==count)throw new BubbleRuleError('请求标识已用于其他操作');return batchResult(prior)}
 const catalog=await readCommunityCatalog(bucket) as Catalog,items=available(catalog);if(!catalog.source||!items.length)throw new BubbleRuleError('限定气泡池暂未上新')
 await ensureCoinWallet(db,p.uid,p.t);if(p.ownerId!==p.uid)await ensureCoinWallet(db,p.ownerId,p.t)
 await db.prepare("INSERT OR IGNORE INTO community_bubble_progress(user_id) SELECT id FROM users WHERE id=? AND kind='user' AND disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)").bind(p.uid,p.uid).run()
 const state=await db.prepare('SELECT p.pity,p.revision FROM community_bubble_progress p WHERE p.user_id=?1').bind(p.uid).first<{pity:number;revision:number}>();if(!state)throw new BubbleRuleError('账号不可用')
 const initialOwned=new Set(await ownedBubbles(db,p.uid)),owned=new Set(initialOwned)
 const ownedCards=new Set((await db.prepare('SELECT card_id FROM collectible_cards WHERE user_id=? AND pack_id=?').bind(p.uid,CARD_PACK).all<{card_id:string}>()).results.map(x=>x.card_id))
 const chance=LIMITED_CHANCE,attempt=crypto.randomUUID(),level=0,cardCounts=new Map<string,number>()
 type PlannedDraw={request_id:string;attempt:string;item_id:string|null;won:number;duplicate:number;guaranteed:number;pity_after:number;card_id:string;card_duplicate:number;reward_amount:number}
 const draws:PlannedDraw[]=[];let pity=state.pity,totalRefund=0,totalReward=0
 for(let i=0;i<count;i++){
  const guaranteed=pity>=PITY-1,won=guaranteed||roll()<chance,item=won?items[pick(items.length)]:null
  const duplicate=item&&owned.has(item.id)?1:0
  if(item&&!duplicate)owned.add(item.id)
  if(duplicate)totalRefund+=PRICE
  pity=won?0:pity+1
  const cardId=String(pick(CARD_CATALOG.length)),cardDuplicate=ownedCards.has(cardId)?1:0
  ownedCards.add(cardId);cardCounts.set(cardId,(cardCounts.get(cardId)||0)+1)
  const rewardAmount=bubblePrizeReward(won,p.ownerId===p.uid,pick,p.t)
  totalReward+=rewardAmount
  draws.push({request_id:i===0?p.id:`${p.id}:${String(i).padStart(3,'0')}`,attempt:count===1?attempt:`${attempt}:${String(i).padStart(3,'0')}`,item_id:item?.id??null,won:won?1:0,duplicate,guaranteed:guaranteed?1:0,pity_after:pity,card_id:cardId,card_duplicate:cardDuplicate,reward_amount:rewardAmount})
 }
 const totalPrice=PRICE*count
 const bank=await db.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(p.ownerId).first<{balance:number}>()
 if(totalReward>0&&p.ownerId!==p.uid&&(!bank||bank.balance+totalPrice-totalRefund<totalReward))throw new BubbleRuleError('奖池站长余额不足，暂时无法发放本次D币奖励')
 const current=await readCommunityCatalog(bucket) as Catalog;if(current.source!==catalog.source)throw new BubbleRuleError('奖池刚刚更新，请刷新后重试')
 const touchedBubbles=[...new Set(draws.filter(d=>d.item_id).map(d=>d.item_id!))]
 const ownedSnapshot=JSON.stringify(touchedBubbles.map(id=>({item:PREFIX+id,owned:initialOwned.has(id)?1:0})))
 const newUnlocks=[...owned].filter(id=>!initialOwned.has(id)).map(id=>PREFIX+id)
 const cardAgg=[...cardCounts.entries()].map(([card_id,n])=>({card_id,count:n}))
 const first=draws[0],headAttempt=first.attempt,gate='EXISTS(SELECT 1 FROM community_bubble_draws WHERE attempt=?1)'
 const sql=[db.prepare(`INSERT OR IGNORE INTO community_bubble_draws(user_id,request_id,attempt,owner_id,item_id,won,duplicate,guaranteed,pity_after,chance,finger_level,catalog_source,card_id,card_duplicate,reward_amount,created_at)
 SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16
 FROM coin52_wallets w JOIN coin52_wallets bank ON bank.user_id=?4 JOIN community_bubble_progress progress ON progress.user_id=?1
 WHERE w.user_id=?1 AND w.balance>=?17 AND w.balance-?17+?18+?19<=9007199254740991
 AND (bank.user_id=?1 OR (bank.balance+?17<=9007199254740991 AND bank.balance+?17-?18>=?19)) AND progress.revision=?20
 AND NOT EXISTS(SELECT 1 FROM json_each(?21) s WHERE EXISTS(SELECT 1 FROM user_unlocks u WHERE u.user_id=?1 AND u.item=json_extract(s.value,'$.item'))<>json_extract(s.value,'$.owned'))
 AND EXISTS(SELECT 1 FROM users u JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=1 WHERE u.id=?1 AND u.disabled=0 AND u.kind='user')
 AND EXISTS(SELECT 1 FROM users WHERE id=?4 AND disabled=0 AND kind='user')
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=1 AND user_id=?1)
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?1,?4))`).bind(p.uid,first.request_id,headAttempt,p.ownerId,first.item_id,first.won,first.duplicate,first.guaranteed,first.pity_after,chance,level,catalog.source,first.card_id,first.card_duplicate,first.reward_amount,p.t,totalPrice,totalRefund,totalReward,state.revision,ownedSnapshot)]
 if(draws.length>1){
  sql.push(db.prepare(`INSERT INTO community_bubble_draws(user_id,request_id,attempt,owner_id,item_id,won,duplicate,guaranteed,pity_after,chance,finger_level,catalog_source,card_id,card_duplicate,reward_amount,created_at)
  SELECT ?2,json_extract(value,'$.request_id'),json_extract(value,'$.attempt'),?3,json_extract(value,'$.item_id'),json_extract(value,'$.won'),json_extract(value,'$.duplicate'),json_extract(value,'$.guaranteed'),json_extract(value,'$.pity_after'),?4,?5,?6,json_extract(value,'$.card_id'),json_extract(value,'$.card_duplicate'),json_extract(value,'$.reward_amount'),?7
  FROM json_each(?8) WHERE ${gate}`).bind(headAttempt,p.uid,p.ownerId,chance,level,catalog.source,p.t,JSON.stringify(draws.slice(1))))
 }
 const money=(uid:number,kind:string,amount:number,suffix:string,condition:string)=>{
  sql.push(db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?2,?3,?4,?5,?6,balance+?6,?7 FROM coin52_wallets WHERE user_id=?2 AND ${condition}`).bind(headAttempt,uid,kind,p.id,attempt+suffix,amount,p.t))
  sql.push(db.prepare(`UPDATE coin52_wallets SET balance=balance+?3,revision=revision+1,updated_at=?4 WHERE user_id=?2 AND ${condition}`).bind(headAttempt,uid,amount,p.t))
 }
 money(p.uid,'bubble-pool-pay',-totalPrice,':pay',gate);money(p.ownerId,'bubble-pool-income',totalPrice,':income',gate)
 if(totalRefund){money(p.ownerId,'bubble-pool-refund-pay',-totalRefund,':refund-pay',gate);money(p.uid,'bubble-pool-refund',totalRefund,':refund',gate)}
 if(totalReward){const rewardGate=gate+' AND balance>='+totalReward;money(p.ownerId,'bubble-pool-prize-pay',-totalReward,':prize-pay',rewardGate);money(p.uid,'bubble-pool-prize',totalReward,':prize',gate)}
 if(newUnlocks.length)sql.push(db.prepare(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at) SELECT ?2,value,?3 FROM json_each(?4) WHERE ${gate}`).bind(headAttempt,p.uid,p.t,JSON.stringify(newUnlocks)))
 sql.push(db.prepare(`INSERT INTO collectible_cards(user_id,pack_id,card_id,first_at,last_at,count) SELECT ?2,?3,json_extract(value,'$.card_id'),?4,?4,json_extract(value,'$.count') FROM json_each(?5) WHERE ${gate} ON CONFLICT(user_id,pack_id,card_id) DO UPDATE SET last_at=excluded.last_at,count=collectible_cards.count+excluded.count`).bind(headAttempt,p.uid,CARD_PACK,p.t,JSON.stringify(cardAgg)))
 sql.push(db.prepare(`UPDATE community_bubble_progress SET pity=?3,draws=draws+?4,revision=revision+1 WHERE user_id=?2 AND ${gate}`).bind(headAttempt,p.uid,pity,count))
 await db.batch(sql)
 const saved=await bubbleBatchReceipts(db,p.uid,p.id)
 if(saved.length!==count){if(saved.length)throw new BubbleRuleError('请求标识已用于其他操作');throw new BubbleRuleError('余额不足、参与资格或保底进度发生变化，请刷新后重试；未扣款')}
 return batchResult(saved)
}
export const communityBubblePool=new Hono<Ctx>()
communityBubblePool.onError((error,c)=>{
 if(error instanceof HTTPException)return c.json({error:error.message},error.status)
 console.error('community bubble pool error',error)
 return c.json({error:'限定气泡池暂时不可用，请稍后重试'},500)
})
const ownedBubbles=async(db:D1Database,uid:number)=>(await db.prepare('SELECT item FROM user_unlocks WHERE user_id=?1 AND item>=?2 AND item<?3').bind(uid,PREFIX,PREFIX+'\uffff').all<{item:string}>()).results.map(x=>x.item.slice(PREFIX.length))
communityBubblePool.get('/api/community-bubbles/owned',async c=>{
 const u=c.get('user');if(!u||u.disabled||u.kind==='bot')fail(401,'请先登录')
 c.header('Cache-Control','no-store');return c.json({owned:await ownedBubbles(c.env.DB,u!.id),all:isOwner(c,u)})
})
communityBubblePool.get('/api/me/owner52b-cards',async c=>{
 const {u}=await needMember(c,1),rows=await c.env.DB.prepare('SELECT card_id,count,first_at,last_at FROM collectible_cards WHERE user_id=? AND pack_id=? ORDER BY card_id').bind(u.id,CARD_PACK).all<{card_id:string;count:number;first_at:number;last_at:number}>(),owned=new Map(rows.results.map(x=>[x.card_id,x]))
 c.header('Cache-Control','no-store');return c.json({packs:[{id:CARD_PACK,name:'52B角色巡展',cards:CARD_CATALOG.map(card=>({...card,owned:owned.has(card.id),count:owned.get(card.id)?.count||0,first_at:owned.get(card.id)?.first_at||null,last_at:owned.get(card.id)?.last_at||null})),owned:rows.results.length,total:CARD_CATALOG.length}]})
})
communityBubblePool.get('/api/community-bubbles/pool',async c=>{
 const {u}=await needMember(c,1),catalog=await readCommunityCatalog(c.env.BUCKET) as Catalog,items=available(catalog),owner=isOwner(c,u)
 const state=await c.env.DB.prepare('SELECT COALESCE((SELECT balance FROM coin52_wallets WHERE user_id=?1),0) AS balance,COALESCE((SELECT pity FROM community_bubble_progress WHERE user_id=?1),0) AS pity,COALESCE((SELECT level FROM instant_card_fingers WHERE user_id=?1),0) AS level').bind(u.id).first<{balance:number;pity:number;level:number}>()
 const owned=await ownedBubbles(c.env.DB,u.id)
 const level=owner?5:Math.max(0,Math.min(5,Number(state?.level)||0));c.header('Cache-Control','no-store')
 return c.json({items:items.map(x=>({id:x.id,name:x.name,author:x.author,owned:owner||owned.includes(x.id)})),owned,balance:state?.balance||0,pity:state?.pity||0,level:0,chance:LIMITED_CHANCE,price:PRICE,pity_limit:PITY,source:catalog.source,cards:CARD_CATALOG})
})
communityBubblePool.post('/api/community-bubbles/draw',async c=>{
 sameOrigin(c);const {u}=await needMember(c,1),b=await boundedJson(c,1024),id=String(b.id||''),count=b.count===undefined?1:Number(b.count)
 try{return c.json(await drawCommunityBubble(c.env.DB,c.env.BUCKET,{uid:u.id,id,count,ownerId:ownerId(c.env.ADMIN_USER_IDS),owner:isOwner(c,u),t:now()}))}catch(e){if(e instanceof BubbleRuleError)fail(409,e.message);fail(503,'结算状态暂未确认，请重试原请求，不会重复扣款')}
})
