// D1 兼容层：用 Node 自带的 node:sqlite 实现 Cloudflare D1 的接口（prepare / bind / first / all / run / batch）。
// 业务代码不用改；batch 在一个事务里执行，任何一条失败整批回滚，和 D1 一致。
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'

// 慢查询统计：node:sqlite 是同步的，一条慢查询会卡住整个进程，所以按语句累计耗时，定期写到日志里供优化
const SLOW_MS = Number(process.env.SLOW_SQL_MS || 20)
const slow = new Map()
const record = (sql, ms, rows) => {
  if (ms < SLOW_MS) return
  const key = sql.replace(/s+/g, ' ').trim().slice(0, 600), s = slow.get(key) || { n: 0, total: 0, max: 0, rows: 0 }
  s.n++; s.total += ms; s.max = Math.max(s.max, ms); s.rows = Math.max(s.rows, rows); slow.set(key, s)
}
export function dumpSlowQueries(file) {
  if (!slow.size) return
  let old = {}; try { old = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  for (const [k, v] of slow) { const o = old[k] || { n: 0, total: 0, max: 0, rows: 0 }; old[k] = { n: o.n + v.n, total: Math.round(o.total + v.total), max: Math.round(Math.max(o.max, v.max)), rows: Math.max(o.rows, v.rows) } }
  slow.clear()
  const top = Object.fromEntries(Object.entries(old).sort((a, b) => b[1].total - a[1].total).slice(0, 300))
  fs.writeFileSync(file, JSON.stringify(top, null, 1))
}

const READER = /^\s*(?:WITH\b[\s\S]*?\bSELECT\b|SELECT\b|PRAGMA\b|VALUES\b|EXPLAIN\b)/i
const plain = (row) => (row ? Object.assign({}, row) : row)
// D1 接受 boolean，node:sqlite 不接受；undefined 在 D1 里会报错，这里按 null 处理以免整页挂掉
const value = (v) => (v === true ? 1 : v === false ? 0 : v === undefined ? null : v instanceof ArrayBuffer ? new Uint8Array(v) : v)

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params }
  bind(...params) { return new Statement(this.db, this.sql, params.map(value)) }
  // 执行并返回 D1 格式的结果
  _exec() {
    const started = performance.now(), stmt = this.db._prepare(this.sql)
    const rows = stmt.all(...this.params).map(plain)
    const reader = READER.test(this.sql) && !/\bRETURNING\b/i.test(this.sql)
    const meta = this.db._meta(reader)
    meta.duration = performance.now() - started
    record(this.sql, meta.duration, rows.length)
    return { results: rows, success: true, meta }
  }
  async first(column) {
    const row = this._exec().results[0] ?? null
    if (column === undefined) return row
    return row ? (row[column] ?? null) : null
  }
  async all() { return this._exec() }
  async run() { return this._exec() }
  async raw(opts = {}) {
    const stmt = this.db._prepare(this.sql), rows = stmt.all(...this.params)
    const cols = rows[0] ? Object.keys(rows[0]) : []
    const out = rows.map((r) => cols.map((c) => r[c]))
    return opts.columnNames ? [cols, ...out] : out
  }
}

export class D1Database {
  constructor(file, { readonly = false } = {}) {
    this.file = file
    this.sqlite = new DatabaseSync(file, { readOnly: readonly })
    // 与 D1 一致：外键约束开启；WAL 让读写并发；忙时最多等 5 秒
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    if (!readonly) this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL')
    this.sqlite.exec('PRAGMA busy_timeout = 5000')
    // 读性能：64MB 页缓存、整库内存映射、临时表放内存
    this.sqlite.exec('PRAGMA cache_size = -65536; PRAGMA mmap_size = 4294967296; PRAGMA temp_store = MEMORY')
    // 导入的数据没有统计信息，查询规划器会选错索引；启动时补上，之后由定时任务刷新
    if (!readonly) this.optimize()
    this.cache = new Map()
    this.changesStmt = this.sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id')
  }
  _prepare(sql) {
    let stmt = this.cache.get(sql)
    if (stmt) { this.cache.delete(sql); this.cache.set(sql, stmt); return stmt }
    stmt = this.sqlite.prepare(sql)
    this.cache.set(sql, stmt)
    if (this.cache.size > 800) this.cache.delete(this.cache.keys().next().value)
    return stmt
  }
  _meta(reader) {
    if (reader) return { changes: 0, last_row_id: 0, changed_db: false, rows_read: 0, rows_written: 0 }
    const { changes, last_row_id } = this.changesStmt.get()
    return { changes: Number(changes), last_row_id: Number(last_row_id), changed_db: Number(changes) > 0, rows_read: 0, rows_written: Number(changes) }
  }
  optimize() { try { this.sqlite.exec('PRAGMA analysis_limit = 1000; PRAGMA optimize = 0x10002') } catch (e) { console.error('sqlite_optimize_failed', e?.message) } }
  prepare(sql) { return new Statement(this, sql) }
  async batch(statements) {
    if (!statements.length) return []
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const out = statements.map((s) => s._exec())
      this.sqlite.exec('COMMIT')
      return out
    } catch (error) {
      try { this.sqlite.exec('ROLLBACK') } catch {}
      throw error
    }
  }
  async exec(sql) { this.sqlite.exec(sql); return { count: 1, duration: 0 } }
  withSession() { return this }
  close() { this.sqlite.close() }
}
