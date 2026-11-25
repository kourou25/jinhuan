-- 群头像（2026-11-24 站长需求）：群管理员在群管理里上传，存 /img/a/... 站内路径；为空时用站标 /group-logo.svg。
ALTER TABLE chat_groups ADD COLUMN avatar TEXT;
