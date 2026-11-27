// 打包漂流瓶小程序：node miniapps/bottle/build.mjs
//   MINI_SDK_DIR  平台 SDK 目录（mapp-developer-guide/sdk，0.4.0 以上）
//   BOTTLE_APP_ID 平台分配的程序 ID；不填就读 wrangler.toml。两处都空时只生成网页文件，不出 ZIP。
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..')
const sdk = path.resolve(process.env.MINI_SDK_DIR || path.join(repo, '../discourse-mini-app-guidelines/sdk'))
if (!fs.existsSync(path.join(sdk, 'index.mjs'))) throw Error('请用 MINI_SDK_DIR 指定平台 SDK 目录')
// 上传文件、按字节取图、playProgram 播视频要 0.4.0 以上（github.com/linux-do/mapp-developer-guide 的 sdk 目录）
const sdkVersion = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8')).version.split('.').map(Number)
if (sdkVersion[0] === 0 && sdkVersion[1] < 4) throw Error(`平台 SDK 版本 ${sdkVersion.join('.')} 太旧，需要 0.4.0 以上`)
const out = path.join(here, 'dist/web')
fs.mkdirSync(out, { recursive: true })
await build({ entryPoints: [path.join(here, 'src/main.js')], outfile: path.join(out, 'app.js'), bundle: true, format: 'iife', target: 'es2022', charset: 'utf8', alias: { '@discourse-mini-app/sdk': path.join(sdk, 'index.mjs') } })
fs.copyFileSync(path.join(here, 'src/app.css'), path.join(out, 'app.css'))
fs.writeFileSync(path.join(out, 'index.html'), '<div id="app"></div>\n')
fs.writeFileSync(path.join(out, 'strings.json'), '{}\n')

const toml = /^BOTTLE_APP_ID\s*=\s*"([^"]*)"/m.exec(fs.readFileSync(path.join(repo, 'wrangler.toml'), 'utf8'))?.[1] || ''
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'))
manifest.id = process.env.BOTTLE_APP_ID || toml
manifest.version = process.env.MINI_APP_VERSION || manifest.version
if (!manifest.id) console.log('还没有程序 ID（BOTTLE_APP_ID 为空）：已生成网页文件，没有出 ZIP')
else {
  const { pack } = await import(pathToFileURL(path.join(sdk, 'pack.mjs')))
  const files = Object.fromEntries(['index.html', 'app.js', 'app.css', 'strings.json'].map((f) => [f, fs.readFileSync(path.join(out, f))]))
  const r = await pack({ manifest, files, outputDirectory: path.join(here, 'dist/package') })
  console.log(`已生成 ${r.file}（${r.size} 字节），程序 ${manifest.id}，版本 ${manifest.version}`)
}
