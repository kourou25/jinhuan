// 1 群匿名头像：生成提示词文档、切图、写清单。在仓库根目录运行。
//   node scripts/anon-avatars.mjs prompts          重新生成 docs/anon-avatar-prompts.md
//   node scripts/anon-avatars.mjs slice <系列id>    把 art/anon-sheets/<系列id>/01.png… 切成单张头像（不写系列 id = 全部）
//   node scripts/anon-avatars.mjs manifest         扫描 public/assets/anon，更新 src/anon/avatar-manifest.json
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const GRID = 5, PER = GRID * GRID, SIZE = 128, PIXELS = 32
const SHEETS = 'art/anon-sheets', OUT = 'public/assets/anon', MANIFEST = 'src/anon/avatar-manifest.json'
const pad = (n, w = 3) => String(n).padStart(w, '0')

// Key the full-resolution cell before downsampling so thin outlines protect purple details.
function removeMagentaBackground(data, width, height) {
  const count = width * height, candidates = new Uint8Array(count), seen = new Uint8Array(count)
  const queue = new Int32Array(count)
  let head = 0, tail = 0
  const enqueue = (i) => { if (candidates[i] && !seen[i]) { seen[i] = 1; queue[tail++] = i } }
  for (let i = 0; i < count; i++) {
    const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2]
    candidates[i] = r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 70 && Math.min(r, b) - g > 130 ? 1 : 0
    // Nearly pure magenta also seeds enclosed background gaps.
    if (r > 235 && b > 235 && g < 35 && Math.abs(r - b) < 20) enqueue(i)
  }
  // Do not seed every purple border pixel: a character's ears may touch the cell edge.
  while (head < tail) {
    const i = queue[head++], x = i % width
    data[i * 4 + 3] = 0
    if (x > 0) enqueue(i - 1)
    if (x + 1 < width) enqueue(i + 1)
    if (i >= width) enqueue(i - width)
    if (i + width < count) enqueue(i + width)
  }
}

async function catalog() {
  const { outputFiles } = await build({ entryPoints: ['src/anon/catalog.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
  return (await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))).SERIES_LIST
}

async function prompts() {
  const list = await catalog(), total = list.reduce((a, s) => a + s.items.length, 0), out = []
  out.push(`# 1 群匿名头像：生图提示词

> 本文件由 \`node scripts/anon-avatars.mjs prompts\` 生成，内容来自 \`src/anon/series/\`。要改角色特征就改那里，再重新生成。
> 共 ${list.length} 个系列、${total} 个角色。每周只用一个系列，可以按周出图；下周是哪个系列，站长在群设置「匿名身份」里能看到，也能更换。

## 1. 流程

1. 复制下面某个系列的提示词，一次画 5×5 = 25 个角色（最后一张可能不满，空格留纯品红）。
2. 存成 \`${SHEETS}/<系列id>/01.png\`、\`02.png\`……（不进 git）。1024×1024 以上的正方形 PNG，等分 5 行 5 列。
3. 在 \`D:\\self\\claude\\meme-hall\` 运行 \`node scripts/anon-avatars.mjs slice <系列id>\`：切开、去掉品红底、缩成 ${PIXELS}×${PIXELS} 像素再放大到 ${SIZE}×${SIZE}，存到 \`${OUT}/<系列id>/001.webp\`，并更新清单。
4. 打开 \`${OUT}/<系列id>\` 看一遍，不满意的单张可以直接替换同名文件。
5. 提交 \`${MANIFEST}\`，然后发布（第二次上线）。

也可以单张画：透明底 PNG / WebP，存成 \`${OUT}/<系列id>/<三位编号>.webp\`，再运行 \`node scripts/anon-avatars.mjs manifest\`。

**缺图怎么显示**：清单里没有的角色用统一占位头像（系列底色 + 名字首字 + 像素边框），不会出现裂图，所以一个系列可以分几次补。

## 2. 统一画风

- 尺寸：成品 ${SIZE}×${SIZE} WebP，画面按 ${PIXELS}×${PIXELS} 像素网格；聊天里按 36px 显示，所以只画头和肩，脸占画面六成以上。
- 背景：切图用纯品红 \`#FF00FF\`，成品透明。人物身上不要用这个颜色。
- 描边：一圈 1 像素深色描边；颜色不超过 16 色；不要抖动、不要渐变、不要文字和水印。
- 区分度：先看轮廓（发型、帽子、角），再看主色，最后看脸上的特征。同一张图里相邻两格不要同一主色。

每段提示词都以这段英文开头：

\`\`\`
5x5 grid sprite sheet of 25 different character portraits, strict 32x32 pixel art icons, each cell exactly the same size,
head-and-shoulders bust facing slightly left, face fills 60% of the cell, bold readable silhouette, 1px dark outline,
max 16 colors per portrait, flat cel shading with two tones, no dithering, no anti-aliasing, no text, no watermark,
no border lines between cells, solid pure magenta #FF00FF background in every cell, consistent style and scale across all cells
\`\`\`

## 3. 各系列

| 系列 | id | 人数 | 图数 | 风格补充 |
|---|---|---|---|---|
${list.map((s) => `| ${s.name} | \`${s.id}\` | ${s.items.length} | ${Math.ceil(s.items.length / PER)} | ${s.style} |`).join('\n')}
`)
  for (const s of list) {
    out.push(`\n### ${s.name}（\`${s.id}\`，${s.items.length} 人）\n\n风格补充：${s.style}。存放：\`${SHEETS}/${s.id}/\``)
    for (let i = 0; i < s.items.length; i += PER) {
      const group = s.items.slice(i, i + PER), n = i / PER + 1
      out.push(`\n**${s.id} / ${pad(n, 2)}.png**（${pad(i + 1)}–${pad(i + group.length)}）\n\n\`\`\`\n${s.style}。5×5，从左到右、从上到下依次是：`)
      for (let r = 0; r < group.length; r += GRID) out.push(`第 ${r / GRID + 1} 行：` + group.slice(r, r + GRID).map((x, k) => `${pad(i + r + k + 1)} ${x.name}（${x.look}）`).join('；'))
      if (group.length < PER) out.push(`其余 ${PER - group.length} 格留纯品红。`)
      out.push('```')
    }
  }
  fs.writeFileSync('docs/anon-avatar-prompts.md', out.join('\n') + '\n')
  console.log(`docs/anon-avatar-prompts.md：${list.length} 个系列，${total} 个角色`)
}

async function slice(only) {
  const sharp = (await import('sharp')).default
  for (const s of (await catalog()).filter((x) => !only || x.id === only)) {
    const dir = path.join(SHEETS, s.id)
    if (!fs.existsSync(dir)) { if (only) throw Error('没有 ' + dir); continue }
    fs.mkdirSync(path.join(OUT, s.id), { recursive: true })
    let n = 0
    for (const file of fs.readdirSync(dir).filter((f) => /^\d+\.(png|webp|jpg)$/i.test(f)).sort()) {
      const sheet = parseInt(file, 10), img = sharp(path.join(dir, file)), { width, height } = await img.metadata()
      for (let k = 0; k < PER; k++) {
        const item = (sheet - 1) * PER + k + 1
        if (item > s.items.length) break
        const x0 = Math.round((k % GRID) * width / GRID), x1 = Math.round((k % GRID + 1) * width / GRID)
        const y0 = Math.round(Math.floor(k / GRID) * height / GRID), y1 = Math.round((Math.floor(k / GRID) + 1) * height / GRID)
        const cellWidth = x1 - x0, cellHeight = y1 - y0
        const source = await sharp(path.join(dir, file)).extract({ left: x0, top: y0, width: cellWidth, height: cellHeight }).ensureAlpha().raw().toBuffer()
        removeMagentaBackground(source, cellWidth, cellHeight)
        const data = await sharp(source, { raw: { width: cellWidth, height: cellHeight, channels: 4 } }).resize(PIXELS, PIXELS, { fit: 'fill', kernel: 'nearest' }).raw().toBuffer()
        let solid = 0
        for (let p = 0; p < data.length; p += 4) {
          if (data[p + 3] > 0) solid++
        }
        if (solid < PIXELS * PIXELS * 0.1) { console.warn(`${s.id} ${pad(item)} ${s.items[item - 1].name}：这一格几乎是空的，跳过`); continue }
        await sharp(data, { raw: { width: PIXELS, height: PIXELS, channels: 4 } }).resize(SIZE, SIZE, { kernel: 'nearest' }).webp({ lossless: true }).toFile(path.join(OUT, s.id, pad(item) + '.webp'))
        n++
      }
    }
    console.log(`${s.name}：${n} / ${s.items.length}`)
  }
  await manifest()
}

async function manifest() {
  const out = {}
  for (const s of await catalog()) {
    const dir = path.join(OUT, s.id)
    if (!fs.existsSync(dir)) continue
    const list = fs.readdirSync(dir).map((f) => /^(\d{3})\.webp$/.exec(f)?.[1]).filter(Boolean).map(Number).filter((n) => n >= 1 && n <= s.items.length).sort((a, b) => a - b)
    if (list.length) out[s.id] = list
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(out) + '\n')
  console.log('清单：' + (Object.entries(out).map(([k, v]) => k + ' ' + v.length).join('，') || '还没有头像'))
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'prompts') await prompts()
else if (cmd === 'slice') await slice(arg)
else if (cmd === 'manifest') await manifest()
else { console.error('用法：node scripts/anon-avatars.mjs prompts | slice [系列id] | manifest'); process.exit(1) }
