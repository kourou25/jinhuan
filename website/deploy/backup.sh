#!/bin/sh
# 每日备份：SQLite 在线备份（不停服），保留 14 天
set -e
day=$(date +%Y%m%d-%H%M)
mkdir -p /meme/backups
for db in meme-hall miniapp-sandbox; do
  src=/meme/data/db/$db.sqlite
  [ -f "$src" ] || continue
  sqlite3 "$src" ".backup /meme/backups/$db-$day.sqlite"
  gzip -f "/meme/backups/$db-$day.sqlite"
done
find /meme/backups -name '*.sqlite.gz' -mtime +14 -delete
