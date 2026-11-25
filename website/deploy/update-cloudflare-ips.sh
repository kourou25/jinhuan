#!/bin/sh
# 生成 Nginx 的 Cloudflare 网段（还原真实 IP 用）
set -e
out=/meme/config/cloudflare-ips.conf
{ for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do echo "set_real_ip_from $ip;"; done; } > "$out.tmp"
mv "$out.tmp" "$out"
