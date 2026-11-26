// 生成 deploy/nginx-meme.conf 与 deploy/proxy.conf：需要先经过程序的路径取自 wrangler.toml 的 run_worker_first
//   node deploy/gen-nginx.mjs
import fs from 'node:fs'

const toml = fs.readFileSync('wrangler.toml', 'utf8')
const list = JSON.parse(toml.match(/run_worker_first = (\[[^\]]*\])/)[1])
const exact = list.filter((p) => !p.endsWith('/*')), prefix = list.filter((p) => p.endsWith('/*')).map((p) => p.slice(0, -1))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const exactRe = '^(' + exact.map(esc).join('|') + ')$', prefixRe = '^(' + prefix.map(esc).join('|') + ')'

fs.writeFileSync('deploy/nginx-meme.conf', `# 尽欢 Nginx 配置（node deploy/gen-nginx.mjs 生成；路径规则来自 wrangler.toml 的 run_worker_first）
# Cloudflare（代理） → 本机 Nginx :443 → Node :8080。80/443 只对 Cloudflare 开放（ufw）。
upstream meme_app { server 127.0.0.1:8080; keepalive 32; }

# 还原访客真实 IP：Cloudflare 网段由 deploy/update-cloudflare-ips.sh 生成
include /meme/config/cloudflare-ips.conf;
real_ip_header CF-Connecting-IP;

server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  return 301 https://$host$request_uri;
}

server {
  # Nginx 1.24 用 listen ... http2 的写法
  listen 443 ssl http2 default_server;
  listen [::]:443 ssl http2 default_server;
  server_name 52dmeme.com www.52dmeme.com;
  ssl_certificate     /meme/config/tls/origin.pem;
  ssl_certificate_key /meme/config/tls/origin.key;

  root /meme/app/current/client;
  client_max_body_size 130m;
  access_log /meme/logs/nginx-access.log;
  error_log  /meme/logs/nginx-error.log warn;

  # Nginx 自带的类型表里没有这几种
  include /etc/nginx/mime.types;
  types { application/manifest+json webmanifest; text/plain atlas; application/octet-stream skel; }

  gzip on; gzip_comp_level 5; gzip_min_length 1024;
  gzip_types text/css text/javascript application/javascript application/json image/svg+xml text/plain application/manifest+json;

  # 原 _headers：带哈希的构建产物长期缓存
  location ^~ /assets/app- { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }
  location ^~ /mini-cdn/    { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; add_header Access-Control-Allow-Origin "https://linux.do"; }
  location ~ ^/(pets/dsh/animations|pets/ark/m|pets/vpet/sheets|vendor)/ { try_files $uri =404; add_header Cache-Control "public, max-age=604800"; }

  # 群聊 WebSocket 使用独立的 Upgrade 配置，普通 HTTP 仍复用上游连接
  location = /api/chat/ws {
    proxy_pass http://meme_app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header CF-Connecting-IP $remote_addr;
    proxy_read_timeout 75s;
    proxy_send_timeout 75s;
  }

  # 需要先经过程序的路径（与 Cloudflare 的 run_worker_first 一致）
  location ~ ${exactRe} { proxy_pass http://meme_app; include /meme/config/proxy.conf; }
  location ~ ${prefixRe} { proxy_pass http://meme_app; include /meme/config/proxy.conf; }

  # 其余：有静态文件直接发，否则交给程序（单页路由、/foo → foo.html）
  location / {
    try_files $uri @app;
    add_header Cache-Control "public, max-age=0, must-revalidate";
  }
  location @app { proxy_pass http://meme_app; include /meme/config/proxy.conf; }
}
`)

fs.writeFileSync('deploy/proxy.conf', `proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header CF-Connecting-IP $remote_addr;
proxy_read_timeout 120s;
proxy_send_timeout 120s;
# AI 回复等流式响应不缓冲；大文件上传直接转给程序
proxy_buffering off;
proxy_request_buffering off;
`)
console.log('已生成 deploy/nginx-meme.conf、deploy/proxy.conf')
