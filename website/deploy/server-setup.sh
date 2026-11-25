#!/bin/bash
# 服务器一次性初始化（已装好 Node / Nginx / SQLite 之后执行）：Nginx 站点、systemd 服务、Cloudflare 网段、每日备份。
# 在本机运行：ssh root@服务器 'bash -se' < deploy/server-setup.sh（需先把 deploy/ 下的配置传到 /meme/config/deploy/）
set -e
D=/meme/config/deploy
install -m 644 $D/proxy.conf /meme/config/proxy.conf
sh $D/update-cloudflare-ips.sh
# TLS：先用自签证书让 Cloudflare「完全」模式可用；换成 Cloudflare 源站证书时覆盖这两个文件即可
mkdir -p /meme/config/tls
if [ ! -f /meme/config/tls/origin.pem ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=52dmeme.com" -keyout /meme/config/tls/origin.key -out /meme/config/tls/origin.pem 2>/dev/null
fi
chmod 600 /meme/config/tls/origin.key
install -m 644 $D/nginx-meme.conf /etc/nginx/sites-available/meme.conf
ln -sfn /etc/nginx/sites-available/meme.conf /etc/nginx/sites-enabled/meme.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx >/dev/null 2>&1 && systemctl reload nginx
install -m 644 $D/meme-hall.service /etc/systemd/system/meme-hall.service
systemctl daemon-reload
systemctl enable meme-hall >/dev/null 2>&1
install -m 755 $D/backup.sh /meme/scripts/backup.sh
install -m 755 $D/update-cloudflare-ips.sh /meme/scripts/update-cloudflare-ips.sh
cat > /etc/cron.d/meme <<'EOF'
# 每天 04:10 备份数据库；每周一更新 Cloudflare 网段
10 4 * * * root /meme/scripts/backup.sh >> /meme/logs/backup.log 2>&1
0 5 * * 1 root /meme/scripts/update-cloudflare-ips.sh && systemctl reload nginx
EOF
touch /meme/config/.env && chown root:meme /meme/config/.env && chmod 640 /meme/config/.env
echo 服务器初始化完成
