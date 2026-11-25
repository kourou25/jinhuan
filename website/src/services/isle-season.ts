// 鱼鱼谷重做 · 赛季与鱼币（2026-11-23 第 1 阶段，表见 migrations/0161_isle_seasons_fishcoin.sql）。
// 赛季按 isle_season_config 自动续季；末日期间兑换汇率逐日变差（D币 贬值）。
// 鱼币只能由 D币 单向兑入，钱包按赛季分开；所有记账都带 attempt，重复提交返回第一次的结果。
// 第 1 阶段只提供数据模型和服务函数，兑换入口等新游戏上线（第 2 阶段）再开放。

export type IsleSeasonRow = { id: number; starts_at: number; ends_at: number; doomsday_at: number; exchange_dcoin: number; devalue_bp: number }
type SeasonConfig = { length_s: number; doomsday_s: number; exchange_dcoin: number; devalue_bp: number }
export type IsleSeason = {
  id: number
  startsAt: number
  endsAt: number
  doomsdayAt: number
  phase: 'normal' | 'doomsday'
  /** 末日第几天（1 起），未进入末日为 0 */
  doomDay: number
  /** 当前兑换 1 鱼币需要的 D币 */
  rate: number
  /** 下一次汇率变化 / 赛季切换的时间，客户端据此刷新 */
  nextChangeAt: number
  baseRate: number
  devaluePercent: number
}

const DAY = 86400
const SEASON_COLS = 'id,starts_at,ends_at,doomsday_at,exchange_dcoin,devalue_bp'

/** 末日第 k 天：需要 base / (1 - bp)^k 个 D币 才换 1 鱼币（向上取整，最多 10 亿）。 */
export function isleRate(row: Pick<IsleSeasonRow, 'doomsday_at' | 'exchange_dcoin' | 'devalue_bp' | 'ends_at'>, t: number) {
  const doomDay = t >= row.doomsday_at && t < row.ends_at ? Math.floor((t - row.doomsday_at) / DAY) + 1 : 0
  const keep = 1 - row.devalue_bp / 10000
  const rate = doomDay && keep > 0 ? Math.min(1e9, Math.ceil(row.exchange_dcoin / keep ** doomDay - 1e-9)) : row.exchange_dcoin
  return { doomDay, rate }
}

export function isleSeasonView(row: IsleSeasonRow, t: number): IsleSeason {
  const { doomDay, rate } = isleRate(row, t)
  const nextDay = doomDay ? row.doomsday_at + doomDay * DAY : row.doomsday_at
  return {
    id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, doomsdayAt: row.doomsday_at,
    phase: doomDay ? 'doomsday' : 'normal', doomDay, rate,
    nextChangeAt: Math.min(row.ends_at, nextDay > t ? nextDay : row.ends_at),
    baseRate: row.exchange_dcoin, devaluePercent: row.devalue_bp / 100,
  }
}

// 赛季表很小，按进程缓存到当季结束；跨季时才回数据库。
const seasonCache = new WeakMap<D1Database, IsleSeasonRow>()

/** 取 t 时刻所在赛季；最近一季已结束就按配置接着往后开新季（多实例并发时靠主键去重）。 */
export async function isleSeasonAt(db: D1Database, t: number): Promise<IsleSeasonRow> {
  const hit = seasonCache.get(db)
  if (hit && hit.starts_at <= t && t < hit.ends_at) return hit
  for (let guard = 0; guard < 520; guard++) {
    const row = await db.prepare(`SELECT ${SEASON_COLS} FROM isle_seasons WHERE starts_at<=?1 AND ends_at>?1 ORDER BY id DESC LIMIT 1`).bind(t).first<IsleSeasonRow>()
    if (row) { seasonCache.set(db, row); return row }
    const [last, cfg] = await Promise.all([
      db.prepare(`SELECT ${SEASON_COLS} FROM isle_seasons ORDER BY id DESC LIMIT 1`).first<IsleSeasonRow>(),
      db.prepare('SELECT length_s,doomsday_s,exchange_dcoin,devalue_bp FROM isle_season_config WHERE id=1').first<SeasonConfig>(),
    ])
    if (!last || !cfg) throw Error('鱼鱼谷赛季未配置')
    if (last.starts_at > t) throw Error('鱼鱼谷赛季尚未开始')
    // 中间空了很多季（服务停过）时直接跳到包含 t 的那一季，避免逐季补建。
    const skip = Math.max(0, Math.floor((t - last.ends_at) / cfg.length_s))
    const start = last.ends_at + skip * cfg.length_s, end = start + cfg.length_s
    await db.prepare(`INSERT OR IGNORE INTO isle_seasons(id,starts_at,ends_at,doomsday_at,exchange_dcoin,devalue_bp,created_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(last.id + 1, start, end, end - cfg.doomsday_s, cfg.exchange_dcoin, cfg.devalue_bp, t).run()
  }
  throw Error('鱼鱼谷赛季计算异常')
}

export const isleSeason = async (db: D1Database, t: number) => isleSeasonView(await isleSeasonAt(db, t), t)

export type FishWallet = { seasonId: number; balance: number; revision: number }
export async function fishWallet(db: D1Database, seasonId: number, userId: number): Promise<FishWallet> {
  const row = await db.prepare('SELECT balance,revision FROM isle_wallets WHERE season_id=? AND user_id=?').bind(seasonId, userId).first<{ balance: number; revision: number }>()
  return { seasonId, balance: row?.balance ?? 0, revision: row?.revision ?? -1 }
}

export type FishEntry = { id: number; kind: string; ref: string; delta: number; balance_after: number; dcoin: number; created_at: number }
const entryByAttempt = (db: D1Database, userId: number, attempt: string) =>
  db.prepare('SELECT id,season_id,kind,ref,delta,balance_after,dcoin,created_at FROM isle_ledger WHERE user_id=? AND attempt=?').bind(userId, attempt).first<FishEntry & { season_id: number }>()

const ATTEMPT = /^[A-Za-z0-9:_-]{8,80}$/
const KIND = /^[a-z][a-z0-9-]{1,39}$/
const USABLE = `EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)`

export type FishResult = { replay: boolean; entry: FishEntry; balance: number }

/**
 * 鱼币记账（岛内收入 / 支出）。delta 为负表示扣款，余额不足时报错。
 * attempt 相同的重复请求直接返回第一次的结果；(kind,ref) 重复视为同一业务已入账。
 */
export async function fishApply(db: D1Database, p: { userId: number; seasonId: number; kind: string; ref: string; attempt: string; delta: number; t: number }): Promise<FishResult> {
  if (!ATTEMPT.test(p.attempt) || !KIND.test(p.kind) || !p.ref || p.ref.length > 120) throw Error('鱼币记账参数无效')
  if (!Number.isSafeInteger(p.delta) || p.delta === 0) throw Error('鱼币数额无效')
  for (let retry = 0; retry < 4; retry++) {
    const done = await entryByAttempt(db, p.userId, p.attempt)
    if (done) {
      if (done.kind !== p.kind || done.ref !== p.ref || done.delta !== p.delta || done.season_id !== p.seasonId) throw Error('操作编号已被其他请求使用')
      return { replay: true, entry: done, balance: (await fishWallet(db, p.seasonId, p.userId)).balance }
    }
    const w = await fishWallet(db, p.seasonId, p.userId)
    const balance = w.balance + p.delta
    if (balance < 0) throw Object.assign(Error('鱼币不足'), { status: 409, code: 'fish_insufficient' })
    if (!Number.isSafeInteger(balance)) throw Error('鱼币余额异常')
    const r = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO isle_wallets(season_id,user_id,updated_at) SELECT ?2,?1,?3 WHERE ${USABLE}`).bind(p.userId, p.seasonId, p.t),
      db.prepare(`INSERT OR IGNORE INTO isle_ledger(season_id,user_id,kind,ref,attempt,delta,balance_after,created_at)
        SELECT ?2,?1,?3,?4,?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM isle_wallets WHERE season_id=?2 AND user_id=?1 AND revision=?9) AND ${USABLE} RETURNING id`)
        .bind(p.userId, p.seasonId, p.kind, p.ref, p.attempt, p.delta, balance, p.t, Math.max(0, w.revision)),
      db.prepare('UPDATE isle_wallets SET balance=?1,revision=revision+1,updated_at=?2 WHERE season_id=?3 AND user_id=?4 AND EXISTS(SELECT 1 FROM isle_ledger WHERE user_id=?4 AND attempt=?5)')
        .bind(balance, p.t, p.seasonId, p.userId, p.attempt),
    ])
    if (r[1].results.length) return { replay: false, entry: { id: (r[1].results[0] as { id: number }).id, kind: p.kind, ref: p.ref, delta: p.delta, balance_after: balance, dcoin: 0, created_at: p.t }, balance }
    // 没写进去：并发改了钱包（重试），或 (kind,ref) 已入账 / 账号不可用。
    const dup = await db.prepare('SELECT 1 FROM isle_ledger WHERE user_id=? AND kind=? AND ref=?').bind(p.userId, p.kind, p.ref).first()
    if (dup && !(await entryByAttempt(db, p.userId, p.attempt))) throw Object.assign(Error('这笔鱼币已经入账'), { status: 409, code: 'fish_duplicate' })
    if (!(await db.prepare(`SELECT 1 ok WHERE ${USABLE}`).bind(p.userId).first())) throw Object.assign(Error('账号不可用'), { status: 403 })
  }
  throw Object.assign(Error('鱼币正在同步，请稍后重试'), { status: 409, code: 'fish_busy' })
}

/**
 * D币 单向兑入鱼币：按当前赛季汇率扣 D币（coin52_ledger kind=isle-exchange），同一批里加鱼币。
 * fish 为想要的鱼币数；需要的 D币 = fish × 当前汇率。重复 attempt 返回第一次结果。
 */
export async function fishExchange(db: D1Database, p: { userId: number; fish: number; attempt: string; t: number }) {
  if (!ATTEMPT.test(p.attempt)) throw Error('操作编号无效')
  if (!Number.isSafeInteger(p.fish) || p.fish < 1 || p.fish > 1_000_000) throw Error('兑换数量无效')
  const season = await isleSeasonAt(db, p.t), { rate } = isleRate(season, p.t), cost = p.fish * rate
  if (!Number.isSafeInteger(cost)) throw Error('兑换数量过大')
  for (let retry = 0; retry < 4; retry++) {
    const done = await entryByAttempt(db, p.userId, p.attempt)
    if (done) return { replay: true, seasonId: done.season_id, fish: done.delta, dcoin: done.dcoin, balance: (await fishWallet(db, done.season_id, p.userId)).balance }
    const [coin, fish] = await Promise.all([
      db.prepare('SELECT balance,revision FROM coin52_wallets WHERE user_id=?').bind(p.userId).first<{ balance: number; revision: number }>(),
      fishWallet(db, season.id, p.userId),
    ])
    if (!coin || coin.balance < cost) throw Object.assign(Error(`D币不足：本次需要 ${cost} D币`), { status: 409, code: 'dcoin_insufficient' })
    const coinAfter = coin.balance - cost, fishAfter = fish.balance + p.fish, ref = 'isle-exchange:' + p.attempt
    const r = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO isle_wallets(season_id,user_id,updated_at) SELECT ?2,?1,?3 WHERE ${USABLE}`).bind(p.userId, season.id, p.t),
      db.prepare(`INSERT OR IGNORE INTO isle_ledger(season_id,user_id,kind,ref,attempt,delta,balance_after,dcoin,created_at)
        SELECT ?2,?1,'exchange',?3,?4,?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM isle_wallets WHERE season_id=?2 AND user_id=?1 AND revision=?9)
        AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?10 AND balance>=?7) AND ${USABLE} RETURNING id`)
        .bind(p.userId, season.id, ref, p.attempt, p.fish, fishAfter, cost, p.t, Math.max(0, fish.revision), coin.revision),
      db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?1,'isle-exchange',?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM isle_ledger WHERE user_id=?1 AND attempt=?7)`)
        .bind(p.userId, ref, 'isle:' + p.attempt, -cost, coinAfter, p.t, p.attempt),
      db.prepare('UPDATE coin52_wallets SET balance=?1,revision=revision+1,updated_at=?2 WHERE user_id=?3 AND EXISTS(SELECT 1 FROM isle_ledger WHERE user_id=?3 AND attempt=?4)').bind(coinAfter, p.t, p.userId, p.attempt),
      db.prepare('UPDATE isle_wallets SET balance=?1,revision=revision+1,updated_at=?2 WHERE season_id=?3 AND user_id=?4 AND EXISTS(SELECT 1 FROM isle_ledger WHERE user_id=?4 AND attempt=?5)').bind(fishAfter, p.t, season.id, p.userId, p.attempt),
    ])
    if (r[1].results.length) return { replay: false, seasonId: season.id, fish: p.fish, dcoin: cost, balance: fishAfter, coins: coinAfter, rate }
    if (!(await db.prepare(`SELECT 1 ok WHERE ${USABLE}`).bind(p.userId).first())) throw Object.assign(Error('账号不可用'), { status: 403 })
  }
  throw Object.assign(Error('余额正在变动，请稍后重试'), { status: 409, code: 'fish_busy' })
}
