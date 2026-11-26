# 尽欢主站

这是线上站点的完整源码：Hono 后端、无构建的静态前端 `public/`、React 账号页 `web/`。线上自 2026-11-23 起运行在自有服务器的 Node.js 上；`server/` 用 SQLite 和本地磁盘实现 D1、R2 的接口，同一套业务代码仍可部署到 Cloudflare Workers。

## 本地运行

使用 Node.js 24。

```sh
npm ci
npx wrangler d1 execute meme-hall --local --file=schema.sql
cp .dev.vars.example .dev.vars   # 填一个至少 16 位的 DEV_LOGIN_KEY
npm run dev
```

打开 http://localhost:8787/ ，访问 `/auth/dev` 用测试口令登录。需要站长权限时，从本地数据库查到测试账号 ID 填进 `wrangler.toml` 的 `ADMIN_USER_IDS`。

`schema.sql` 是新实例的完整表结构（含 0203 号及之前的全部迁移），新库只需执行它。`migrations/` 供已有实例升级使用。

## 自己部署（Node.js 服务器）

```sh
npm ci && npx vite build && node server/build.mjs
mkdir -p /meme/data/db /meme/data/storage /meme/config /meme/logs /meme/cache
sqlite3 /meme/data/db/meme-hall.sqlite < schema.sql
# 新库已包含全部迁移，登记为已执行，否则发布脚本会再跑一遍
for f in migrations/*.sql; do sqlite3 /meme/data/db/meme-hall.sqlite "INSERT INTO d1_migrations(name) VALUES('$(basename $f)')"; done
cd server && MEME_ROOT=/meme CLIENT_DIR=../web/dist/client node main.mjs   # 监听 127.0.0.1:8080
```

机密写在 `/meme/config/.env`。`deploy/` 里有 nginx、systemd、备份和发布脚本，服务器地址用环境变量 `MEME_HOST` 指定。漂流瓶的内置敏感词库不随仓库分发，部署后在站长后台自行维护。

### VPS 群聊实时推送

同源浏览器通过 `/api/chat/ws` 订阅群聊，发送、上传和查历史仍走原 HTTP 接口。普通消息提交后推给有权查看的成员，重连用 SQLite 事件游标补齐。游标过期时，正在翻历史的面板通过 HTTP 重新加载当前阅读位置附近的消息，随后从新快照继续订阅。主窗口和画中画共享同一账号、同一群的已读进度。阅读最新消息时合并写回，离开面板时立即提交已看到的位置。此部署方式使用一个 Node 进程和同机 SQLite；多实例发布前需要重新核验跨实例撤权和广播。

1. 已有实例先备份数据库，再按顺序应用尚未执行的 `0202_chat_realtime.sql` 和 `0203_chat_realtime_packet_audience.sql`。已运行 0202 的实例只需补 0203，随后启动新版服务。安装本版 `deploy/nginx-meme.conf`（或合并其中的精确 `/api/chat/ws` location），通过 `nginx -t` 后重载 Nginx。应用发布包同时需要 `server/dist/app.mjs` 和 `server/dist/chat-realtime.mjs`。
2. 选择测试群，例如群 7。在数据库写入下面的影子设置，再在 `/meme/config/.env` 添加 `CHAT_REALTIME_GROUPS=7` 并重启应用。该配置接受逗号分隔的群 ID，默认留空。影子模式同时收取 HTTP 和 WebSocket，以 HTTP 渲染；页面上可监听 `chat-realtime-shadow` 事件，查看该面板的 `compared`、`mismatch` 和 `batches` 计数。
3. 确认比对覆盖活跃消息且无异常后，在同一行把 `shadow` 改为 0。用两个账号确认发言、编辑、撤回和重连补发，并在浏览器 Network 中检查稳定连接期间的群消息 GET。群摘要、@ 已读和私信有独立请求。随时把 `disabled` 改为 1，可让在线客户端退回 HTTP，数据库、草稿和命令回执继续保留。重新开启后，重新打开群聊即可重新协商能力。

```sql
INSERT INTO chat_realtime_controls(group_id,disabled,shadow) VALUES(7,0,1)
ON CONFLICT(group_id) DO UPDATE SET disabled=0,shadow=1;
```

事件日志保留最近约 20,000 个全站事件序号，繁忙群会缩短其他群的补发时间窗口。消息正文仍存在原消息表。监测 SQLite 慢查询、进程 CPU、发言到接收的延迟、重连比例和每群消息 GET。连接或投递队列达到上限时，客户端可通过现有 HTTP 路径恢复。

本机从 `website/` 运行以下检查。服务端脚本在独立临时目录中初始化数据库和测试登录，只监听回环地址，退出时清理夹具。浏览器检查需要 Python Playwright 和本机 Chromium；`PYTHON` 可指定相应解释器。

```sh
npm ci
npm run build
npm run build:server
node --test scripts/check-chat-realtime-schema.mjs scripts/test-chat-realtime-gateway.mjs scripts/test-chat-read-queue.mjs
node scripts/test-chat-realtime-server.mjs
node scripts/test-chat-realtime-server.mjs --browser
node scripts/test-chat-realtime-server.mjs --measure
```

## 自己部署（Cloudflare）

1. 用自己的 Cloudflare 账号创建 D1（`meme-hall`，另建一个小程序沙箱库可选）和 R2（`meme-hall-images`），把 ID 填进 `wrangler.toml`。
2. 在 `wrangler.toml` 的 `[vars]` 填好站点配置，见下表。`B12_CLOCK_START`（鱼鱼谷岛钟起点）首次部署填当前 Unix 秒数，之后不要改。
3. 用 `npx wrangler secret put` 配置机密：至少 `LINUXDO_CLIENT_SECRET`；邮件、Google、GitHub 登录和 AI 功能按需配置。
4. 宠物动画、表情包、壁纸、小说数据等大素材不在仓库里，放到 `public/` 对应目录后再构建；目录为空时相关功能显示为空。
5. `npm run deploy` 只做检查（类型、构建、素材数量），`npm run deploy:go` 才会真正部署。

| 变量 | 说明 |
| --- | --- |
| `LINUXDO_CLIENT_ID` | Linux.DO Connect 应用 ID，回调地址 `https://<域名>/auth/callback` |
| `ADMIN_USER_IDS` | 站长账号 ID（逗号分隔） |
| `REGISTER_MODE` | `open` 开放注册，`invite` 仅邀请码 |
| `EXT_HOSTS` | `/ext` 外链图片代理允许的域名 |
| `MINI_APP_*`、`GALLERY_APP_ID` | 小程序渠道，不用时留空，`MINI_APP_PRODUCTION = "off"` |

代码里有若干处写的是线上域名 `52dmeme.com`（分享链接、红包脚本、跨子域图片），自己部署时搜索替换成自己的域名。

## 代码结构

| 位置 | 内容 |
| --- | --- |
| `src/legacy/live-app.js` | 线上 2026-11 前以补丁方式发布的全部逻辑（路由、鱼鱼谷、补丁内嵌模块），提取自当时的线上包，正在逐步拆分 |
| `src/routes`、`src/services`、`src/ldc`、`src/farm` 等 | 按功能拆好的 TS 模块 |
| `public/` | 主站前端，直接作为静态资源发布 |
| `web/` | 登录、账号、邀请等 React 页面 |
| `migrations/` | 数据库迁移 |

新功能请写成独立模块，不要再往 `live-app.js` 里加。

## 安全问题

发现漏洞请通过 GitHub 私下报告（Security → Report a vulnerability），不要直接公开 Issue。
