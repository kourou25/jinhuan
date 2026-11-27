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
