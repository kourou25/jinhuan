# 尽欢主站

这是线上站点的完整源码：Cloudflare Worker（Hono + D1 + R2）、无构建的静态前端 `public/`、React 账号页 `web/`。

## 本地运行

使用 Node.js 24。

```sh
npm ci
npx wrangler d1 execute meme-hall --local --file=schema.sql
for f in migrations/013[3-9]_*.sql migrations/01[45][0-9]_*.sql; do npx wrangler d1 execute meme-hall --local --file="$f"; done
cp .dev.vars.example .dev.vars   # 填一个至少 16 位的 DEV_LOGIN_KEY
npm run dev
```

打开 http://localhost:8787/ ，访问 `/auth/dev` 用测试口令登录。需要站长权限时，从本地数据库查到测试账号 ID 填进 `wrangler.toml` 的 `ADMIN_USER_IDS`。

`schema.sql` 截至 0132 号迁移；之后的结构在 `migrations/0133`–`0158`，新库按上面的命令依次执行。

## 自己部署

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
