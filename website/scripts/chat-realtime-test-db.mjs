import { readdirSync, readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const directory = new URL('../migrations/', import.meta.url)
const files = readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
const migrationNumber = name => Number(name.slice(0, 4))

export function initializeChatRealtimeTestDb(db, through) {
  db.exec(schema)
  const record = db.prepare('INSERT INTO d1_migrations(name) VALUES (?)')
  // 11 月 25 日快照覆盖至 0201，0180–0183 需另外执行。
  for (const name of files) {
    const number = migrationNumber(name)
    if (number <= 201 && (number < 180 || number > 183)) record.run(name)
  }
  return applyChatRealtimeTestMigrations(db, through)
}

export function applyChatRealtimeTestMigrations(db, through = Infinity) {
  const recorded = new Set(db.prepare('SELECT name FROM d1_migrations').all().map(row => row.name))
  const pending = files.filter(name => migrationNumber(name) <= through && !recorded.has(name))
  const record = db.prepare('INSERT INTO d1_migrations(name) VALUES (?)')
  const { foreign_keys: foreignKeys } = db.prepare('PRAGMA foreign_keys').get()
  db.exec('PRAGMA foreign_keys=OFF')
  try {
    for (const name of pending) {
      const sql = readFileSync(new URL(name, directory), 'utf8')
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec(sql)
        record.run(name)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys=' + foreignKeys)
  }
  return pending
}
