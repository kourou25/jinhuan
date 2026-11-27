// 线上第 66 版对应 kourou25/meme-hall-skins 的固定来源版本。
// 每项用 git log -1 --format=%ct <来源版本> -- submissions/<套装编号> 取得。
const baselineSource = 'ba0d7554ae222540e728218f4e95e7d0701e7258'
const baselineTimes = {
  'deep-think': 1795694728,
  'electroboy-armor': 1795707128,
  'fas-dino-flame': 1795673894,
  'gushen-yinpa': 1795487722,
  'lanting-ink': 1793452510,
  'laoda-purple': 1794988155,
  'laowu-dispatch': 1794987985,
  'laowu-dispatch-all-in': 1795400456,
  'laowu-dispatch-black': 1795507404,
  'laowu-dispatch-calico': 1795657693,
  'laowu-dispatch-gray': 1795416117,
  'laowu-dispatch-siamese': 1795581006,
  'laowu-dispatch-white': 1795484811,
  'live-on-air': 1795607714,
  'luna-raincity': 1795590310,
  'manga-tremor': 1795526483,
  'oiia-loaf': 1794988096,
  'orange-flick': 1794973890,
  'p3-azure-moon-oath': 1795577712,
  'p3r-zero-hour-fool': 1795577719,
  'rem-dual-form': 1795521461,
  'round-maodie': 1794988080,
  'shadow-dao': 1795143532,
  'shadow-path': 1795077719,
  'shiratori-starlight': 1795678238,
  'step-by-step-bird': 1795491132,
  'succubus-lace': 1795527528,
  'taike-lili': 1795484797,
  'waibi-babu': 1794988114,
  'yimao-simao': 1795685929,
}
const isUpdateTime = value => Number.isSafeInteger(value) && value > 0

export function withKnownSkinUpdateTimes(catalog) {
  if (catalog.source !== baselineSource) return catalog
  let changed = false
  const entries = catalog.entries.map(entry => {
    if (isUpdateTime(entry.updated_at) || !Object.hasOwn(baselineTimes, entry.id)) return entry
    changed = true
    return { ...entry, updated_at: baselineTimes[entry.id] }
  })
  return changed ? { ...catalog, entries } : catalog
}

// 比较仓库目录和主站已安装目录时，只取两端都有的展示信息。
function appearance(entry) {
  const parts = Object.entries(entry.components).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([entry.author, entry.github, entry.license, parts.map(([kind, part]) =>
    [kind, part.type, part.sha256, part.slice, part.style?.sha256])])
}

export function skinChanges(previous, next) {
  if (next.revision <= previous.revision || next.source === previous.source) return []
  const before = new Map(previous.entries.map(entry => [entry.id, entry]))
  const changes = []
  for (const entry of next.entries) {
    const old = before.get(entry.id)
    const change = { source: next.source, id: entry.id, name: entry.name }
    if (!old) changes.push({ ...change, kind: 'added' })
    else if (old.name !== entry.name) changes.push({ ...change, kind: 'renamed', previous_name: old.name })
    else if (appearance(old) !== appearance(entry)) changes.push({ ...change, kind: 'updated' })
    before.delete(entry.id)
  }
  for (const old of before.values()) changes.push({ source: next.source, id: old.id, name: old.name, kind: 'removed' })
  return changes
}

async function readSkinUpdateTime(source, id, fetcher) {
  const url = new URL('https://api.github.com/repos/kourou25/meme-hall-skins/commits')
  url.search = new URLSearchParams({ sha: source, path: 'submissions/' + id, per_page: '1' })
  try {
    const response = await fetcher(url.href, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'jinhuan-community' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return
    }
    const commits = await response.json()
    const date = commits?.[0]?.commit?.committer?.date
    if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(date)) return
    const timestamp = Date.parse(date) / 1000
    if (isUpdateTime(timestamp)) return timestamp
  } catch {
    // 保留空时间，下次同步可继续补齐。
  }
}

export async function refreshSkinUpdateTimes(previous, catalog, fetcher = fetch) {
  const next = withKnownSkinUpdateTimes(catalog)
  if (!/^[0-9a-f]{40}$/.test(next.source || '')) return next

  const old = previous && withKnownSkinUpdateTimes(previous)
  const changedIds = new Set(old ? skinChanges(old, next).map(change => change.id) : [])
  const previousTimes = new Map(old?.entries.map(entry => [entry.id, entry.updated_at]))
  const times = new Map()
  const missing = []
  for (const entry of next.entries) {
    if (isUpdateTime(entry.updated_at)) continue
    const prior = previousTimes.get(entry.id)
    if (isUpdateTime(prior) && !changedIds.has(entry.id)) times.set(entry.id, prior)
    else if (/^[a-z0-9][a-z0-9-]{2,47}$/.test(entry.id)) missing.push(entry.id)
  }

  // 每五分钟轮换待补查的作品，连续失败的作品不会挡住队尾。
  const batchSize = 4
  const batchCount = Math.max(1, Math.ceil(missing.length / batchSize))
  const window = Math.floor(Date.now() / (5 * 60_000))
  const offset = (window % batchCount) * batchSize
  await Promise.all(missing.slice(offset, offset + batchSize).map(async id => {
    const timestamp = await readSkinUpdateTime(next.source, id, fetcher)
    if (timestamp !== undefined) times.set(id, timestamp)
  }))
  if (!times.size) return next
  return {
    ...next,
    entries: next.entries.map(entry => times.has(entry.id) ? { ...entry, updated_at: times.get(entry.id) } : entry),
  }
}

// 首次同步建立基线，后续与目录在同一次条件写入中确认，防止产生未上线的记录。
export function publishedSkinUpdates(previous, next, publishedAt) {
  if (!previous?.source) return []
  const published = skinChanges(previous, next).map(change => ({ ...change, published_at: publishedAt }))
  return [...published, ...(previous?.recentUpdates || [])].slice(0, 200)
}

// 更新页只读官方投稿目录。合并并发读取，短时缓存结果；上游不可用时仍可看主站发布记录。
export function skinUpdatesReader(fetchCatalog) {
  let latest = null
  let expires = 0
  let loading = null
  return async function readUpdates(published) {
    if (Date.now() >= expires) {
      loading ||= fetchCatalog().catch(() => null).then(result => {
        latest = result
        expires = Date.now() + 60_000
        loading = null
      })
      await loading
    }
    let pending = []
    let available = !!latest
    if (latest) {
      try { pending = skinChanges(published, latest) }
      catch { available = false }
    }
    return { updates: published.recentUpdates || [], pending, pending_source_available: available }
  }
}
