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

`schema.sql` 是 2026-11-25 线上的完整表结构（含 0201 号及之前的迁移，但不含 0180–0183）。新库先执行它，再按编号执行 0180–0183 和 0201 之后的迁移；`migrations/` 也供已有实例升级使用。

## 自己部署（Node.js 服务器）

```sh
npm ci && npx vite build && node server/build.mjs
mkdir -p /meme/data/db /meme/data/storage /meme/config /meme/logs /meme/cache
sqlite3 /meme/data/db/meme-hall.sqlite < schema.sql
# schema.sql 已包含的迁移登记为已执行；其余（0180–0183、0201 之后）留给发布脚本按编号执行
for f in migrations/*.sql; do n=$(basename $f); case $n in 018[0-3]_*) continue;; esac; [ "$n" \> "0201_~" ] && continue; sqlite3 /meme/data/db/meme-hall.sqlite "INSERT INTO d1_migrations(name) VALUES('$n')"; done
cd server && MEME_ROOT=/meme CLIENT_DIR=../web/dist/client node main.mjs   # 监听 127.0.0.1:8080
```

机密写在 `/meme/config/.env`。`deploy/` 里有 nginx、systemd、备份和发布脚本，服务器地址用环境变量 `MEME_HOST` 指定。漂流瓶的内置敏感词库不随仓库分发，部署后在站长后台自行维护。

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
