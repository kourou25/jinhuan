# 尽欢主站

使用 Node.js 24。以下命令仅启动本地实例。

```sh
npm ci
npm run db:init:local
npm run dev
```

访问 http://127.0.0.1:8787/。默认图廊为空。需要本地登录时，将 `.dev.vars.example` 复制为 `.dev.vars`，填写自行生成的至少 16 位 `DEV_LOGIN_KEY`，再访问 `/auth/dev`。如需站长权限，登录后从自己的本地数据库查到测试账号 ID，然后配置 `ADMIN_USER_IDS`。

```sh
npm run typecheck
npm run build
```

`schema.sql` 用于初始化全新的数据库，包含结构和公共规则初始值。自行部署时，使用自己创建的 D1 和 R2，填写 `wrangler.toml` 中的资源绑定。OAuth、邮件和第三方服务使用自己的应用配置及秘密。示例域名 `jinhuan.example`、`play.jinhuan.example`、`fish.jinhuan.example` 用于标记拆分部署的地址。跨实例登录、游戏 Worker 服务绑定和外部服务需要额外配置。测试登录密钥仅用于本地开发。

壁纸及表情目录为空。从导航栏打开鱼鱼谷，或登录后访问 `/valley`。鱼鱼谷使用程序绘制和附带许可的 CC0 地图素材。

## 升级已有数据库

部署称号新出率和 200 连抽前，在 `website/` 对已有 D1 数据库运行 `npx wrangler d1 migrations apply <数据库名> --remote`。本地已有数据库可使用 `--local`。新库直接用 `schema.sql` 初始化即可。
