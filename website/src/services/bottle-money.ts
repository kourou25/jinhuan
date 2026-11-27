// 漂流瓶的 D币：超出免费次数后付费捞 / 扔，以及互动奖励。走现有钱包和流水（coin52_wallets / coin52_ledger），操作编号保证幂等。
import type { Env } from '../env'
import { fail } from '../lib/http'
import { now } from '../lib/time'
import { ensureCoinWallet } from '../farm/coin-packets'

// 付费捞和付费扔用同一张价目表：单看扣款分不出是捞还是扔
export const BASE_PRICE = 12000
export const MAX_PAID = 10 // 每天每种最多付费 10 次（第 10 次 614.4 万）
export const priceOf = (paidToday: number) => BASE_PRICE * 2 ** paidToday

// 付费收入进谁的账户：只改这里。目前是站长（ADMIN_USER_IDS 的第一个）
export function incomeUser(env: Env): number {
  const id = Number((env.ADMIN_USER_IDS ?? '').split(',')[0]?.trim())
  return Number.isSafeInteger(id) && id !== 0 ? id : fail(503, '付费暂时不可用')
}
export const balanceOf = async (db: D1Database, uid: number) => (await db.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(uid).first<{ balance: number }>())?.balance ?? 0

const ACTIVE = `EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)`
// 扣款 + 入账的四条语句。guard 用 ?1=用户 ?2=操作编号 ?3=attempt ?4=价格 ?5=时间，后面可以接自己的参数；
// gate 为真表示这次扣款真的发生了，业务写入要带上它
export function payStatements(db: D1Database, p: { uid: number; payee: number; kind: string; op: string; price: number; attempt: string; t: number; guard: string; guardArgs: unknown[] }) {
  const gate = 'EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=?1 AND attempt=?2)'
  return [
    db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
      SELECT ?1,'${p.kind}',?2,?3,-?4,balance-?4,?5 FROM coin52_wallets WHERE user_id=?1 AND balance>=?4 AND ${ACTIVE} AND ${p.guard}`).bind(p.uid, p.op, p.attempt, p.price, p.t, ...p.guardArgs),
    db.prepare(`UPDATE coin52_wallets SET balance=balance-?3,revision=revision+1,updated_at=?4 WHERE user_id=?1 AND ${gate}`).bind(p.uid, p.attempt, p.price, p.t),
    // 收款流水的 ref 用 attempt，不带付款人
    db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
      SELECT ?3,'bottle-income',?2,?2||':in',?4,balance+?4,?5 FROM coin52_wallets WHERE user_id=?3 AND ${gate}`).bind(p.uid, p.attempt, p.payee, p.price, p.t),
    db.prepare(`UPDATE coin52_wallets SET balance=balance+?4,revision=revision+1,updated_at=?5 WHERE user_id=?3 AND ${gate}`).bind(p.uid, p.attempt, p.payee, p.price, p.t),
  ]
}
export async function prepareWallets(db: D1Database, uid: number, payee: number) {
  const t = now()
  await ensureCoinWallet(db, uid, t)
  if (payee !== uid) await ensureCoinWallet(db, payee, t)
}

// ---------- 互动奖励 ----------
// 来源只有一处：site_settings.bottle_reward，没设过就是 owner（站长 2026-11-25 定）。off = 不发也不排队；owner = 站长账户出；system = 系统新增
export type RewardSource = 'off' | 'owner' | 'system'
export const REWARD = 1000
export const REWARD_PER_AUTHOR_DAY = 10 // 每人每天最多得 10 份
export const REWARD_PER_ACTOR_DAY = 20 // 每个互动的人每天最多带出 20 份，防小号刷
const KEY = 'bottle_reward'
export async function rewardSource(db: D1Database): Promise<RewardSource> {
  const v = (await db.prepare('SELECT v FROM site_settings WHERE k=?').bind(KEY).first<{ v: string }>())?.v
  return v === 'off' || v === 'system' ? v : 'owner'
}
export async function setRewardSource(db: D1Database, v: unknown): Promise<RewardSource> {
  const source = v === 'off' || v === 'owner' || v === 'system' ? v : fail(400, '奖励来源不正确')
  await db.prepare('INSERT INTO site_settings(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at').bind(KEY, source, now()).run()
  return source
}
const bjDay = (t: number) => new Date((t + 28800) * 1000).toISOString().slice(0, 10)
// 喜欢 / 回信之后调用；主键挡住重复（取消再点也不会多一份）。站长自己的瓶子不产生奖励
export async function queueReward(env: Env, p: { bottle: number; author: number; actor: number; kind: 'like' | 'reply' }) {
  const db = env.DB
  // 小程序里没有站内账号的人：不拿奖励，也不带出奖励
  if (p.author < -5e12 || p.actor < -5e12) return
  if (p.author === p.actor || p.author === incomeUser(env) || await rewardSource(db) === 'off') return
  const t = now(), day = bjDay(t)
  await db.prepare(`INSERT OR IGNORE INTO bottle_rewards(bottle_id,actor_id,kind,user_id,amount,day,created_at)
    SELECT ?1,?2,?3,?4,${REWARD},?5,?6
    WHERE (SELECT COUNT(*) FROM bottle_rewards WHERE user_id=?4 AND day=?5)<${REWARD_PER_AUTHOR_DAY}
      AND (SELECT COUNT(*) FROM bottle_rewards WHERE actor_id=?2 AND day=?5)<${REWARD_PER_ACTOR_DAY}`).bind(p.bottle, p.actor, p.kind, p.author, day, t).run()
}
const ROWS = `(bottle_id,actor_id,kind) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?1))`
type RewardRow = { bottle_id: number; actor_id: number; kind: string; user_id: number; amount: number }
// 结算昨天及以前的：喜欢 / 回信还在、瓶子没被管理员删的才算。整批一个事务：
// 每个瓶主一笔合计收入，站长只有一笔总支出，流水里没有瓶子编号，也不逐人列收款人。
export async function settleRewards(env: Env, t = now()) {
  const db = env.DB, source = await rewardSource(db)
  if (source === 'off') return { source, paid: 0, short: 0 }
  const payer = incomeUser(env), today = bjDay(t)
  await db.prepare(`UPDATE bottle_rewards SET state='void' WHERE state='pending' AND day<?1 AND (user_id=?2
      OR EXISTS(SELECT 1 FROM bottles b WHERE b.id=bottle_rewards.bottle_id AND b.deleted=2)
      OR kind='like' AND NOT EXISTS(SELECT 1 FROM bottle_likes l WHERE l.bottle_id=bottle_rewards.bottle_id AND l.user_id=bottle_rewards.actor_id)
      OR kind='reply' AND NOT EXISTS(SELECT 1 FROM bottle_replies r WHERE r.bottle_id=bottle_rewards.bottle_id AND r.user_id=bottle_rewards.actor_id AND r.is_host=0 AND r.deleted=0 AND r.hidden=0)
      OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=bottle_rewards.user_id AND u.disabled=0 AND u.kind='user')
      OR EXISTS(SELECT 1 FROM account_retirements a WHERE a.source_id=bottle_rewards.user_id))`).bind(today, payer).run()
  const { results } = await db.prepare(`SELECT bottle_id,actor_id,kind,user_id,amount FROM bottle_rewards WHERE state='pending' AND day<? ORDER BY created_at,bottle_id,actor_id,kind LIMIT 1000`).bind(today).all<RewardRow>()
  if (!results.length) return { source, paid: 0, short: 0 }
  for (const uid of new Set(results.map((r) => r.user_id))) await ensureCoinWallet(db, uid, t)
  let left = Number.MAX_SAFE_INTEGER
  if (source === 'owner') { await ensureCoinWallet(db, payer, t); left = await balanceOf(db, payer) }
  // 按互动先后发，站长余额用完为止；剩下的记「余额不足」，不补
  const pay: RewardRow[] = [], short: RewardRow[] = []
  for (const r of results) { if (r.amount <= left) { pay.push(r); left -= r.amount } else short.push(r) }
  const keys = (rows: RewardRow[]) => JSON.stringify(rows.map((r) => [r.bottle_id, r.actor_id, r.kind]))
  const batch = crypto.randomUUID(), total = pay.reduce((n, r) => n + r.amount, 0), statements: D1PreparedStatement[] = []
  if (pay.length) {
    statements.push(
      // 全部仍是待发、站长余额仍够，整批才成立；否则后面几条都是空操作，下次再来
      db.prepare(`UPDATE bottle_rewards SET state='paid',batch=?2 WHERE state='pending' AND ${ROWS}
        AND (SELECT COUNT(*) FROM bottle_rewards WHERE state='pending' AND ${ROWS})=?3
        AND (?4=0 OR EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?5 AND balance>=?6)) RETURNING bottle_id`).bind(keys(pay), batch, pay.length, source === 'owner' ? 1 : 0, payer, total),
      db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
        SELECT r.user_id,'bottle-reward',?1,?1,SUM(r.amount),w.balance+SUM(r.amount),?2 FROM bottle_rewards r JOIN coin52_wallets w ON w.user_id=r.user_id WHERE r.batch=?1 GROUP BY r.user_id`).bind(batch, t),
      db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT SUM(r.amount) FROM bottle_rewards r WHERE r.batch=?1 AND r.user_id=coin52_wallets.user_id),revision=revision+1,updated_at=?2
        WHERE user_id IN (SELECT user_id FROM bottle_rewards WHERE batch=?1)`).bind(batch, t))
    if (source === 'owner') statements.push(
      db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
        SELECT ?3,'bottle-reward-pay',?1,?1,-x.total,w.balance-x.total,?2 FROM (SELECT SUM(amount) AS total FROM bottle_rewards WHERE batch=?1) x JOIN coin52_wallets w ON w.user_id=?3 WHERE x.total>0`).bind(batch, t, payer),
      db.prepare(`UPDATE coin52_wallets SET balance=balance-(SELECT SUM(r.amount) FROM bottle_rewards r WHERE r.batch=?1),revision=revision+1,updated_at=?2
        WHERE user_id=?3 AND EXISTS(SELECT 1 FROM bottle_rewards WHERE batch=?1)`).bind(batch, t, payer))
  }
  if (short.length) statements.push(db.prepare(`UPDATE bottle_rewards SET state='short' WHERE state='pending' AND ${ROWS}`).bind(keys(short)))
  const out = await db.batch<{ bottle_id: number }>(statements)
  return { source, paid: pay.length ? out[0].results.length : 0, short: short.length }
}
// 因站长余额不足没发的：给站长看总数
export const shortCount = async (db: D1Database) => (await db.prepare("SELECT COUNT(*) AS n FROM bottle_rewards WHERE state='short'").first<{ n: number }>())?.n ?? 0
