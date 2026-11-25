// 构建服务器版：把 Worker 源码打包成 Node 可运行的 server/dist/app.mjs，并导出 wrangler.toml 的公开变量。
//   node server/build.mjs
import { build } from 'esbuild'
import fs from 'node:fs'

await build({
  entryPoints: ['src/worker.ts'],
  outfile: 'server/dist/app.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  tsconfig: 'tsconfig.json',
  // 打包后的 CommonJS 依赖需要 require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
})

// [vars] 段：只支持 KEY = "value" 形式（本项目都是这种）
const toml = fs.readFileSync('wrangler.toml', 'utf8'), vars = {}
const section = toml.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] || ''
for (const line of section.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line)
  if (m) vars[m[1]] = JSON.parse('"' + m[2] + '"')
}
fs.writeFileSync('server/vars.json', JSON.stringify(vars, null, 1) + '\n')
console.log('server/dist/app.mjs 已生成；公开变量', Object.keys(vars).length, '个')
