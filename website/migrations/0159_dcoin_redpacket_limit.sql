-- 社区 PR #6：D 币红包单个总额上限提高到 500 万。
-- 只放宽 CHECK 里的上限数字（已有数据都满足更宽的约束），不重建表：
-- ldc_packets 被五十多个触发器和视图引用，重建或删列风险很高。
-- SQLite 官方文档允许用 writable_schema 修改约束文本，前提是不让已有数据失效。
PRAGMA writable_schema = ON;
UPDATE sqlite_master SET sql = replace(sql, 'CHECK(total BETWEEN 1 AND 2000000)', 'CHECK(total BETWEEN 1 AND 5000000)')
 WHERE type = 'table' AND name = 'coin52_packets';
UPDATE sqlite_master SET sql = replace(sql, 'CASE WHEN payment_provider=''coin52'' THEN 20000000 ELSE 200000 END', 'CASE WHEN payment_provider=''coin52'' THEN 500000000 ELSE 200000 END')
 WHERE type = 'table' AND name = 'ldc_packets';
PRAGMA writable_schema = OFF;
