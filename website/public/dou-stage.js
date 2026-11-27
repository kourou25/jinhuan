// 「斗 · 大模型江湖」画面引擎：Q版卡通人物（矢量、骨骼姿势）+ 水墨笔触特效。纯前端表现，不参与任何结算。
// 坐标用「格」做单位：人物站立约 30 格高，脚底中心是锚点；画布按 R 倍分辨率绘制，界面上平滑缩放。
// 正式立绘 / 特效贴图到位前全部由代码画；替换时保持同样的锚点和尺寸（见 docs/dou-art-prompts.md）。

export const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`
const rand = (a, b) => a + Math.random() * (b - a)
const lerp = (a, b, t) => a + (b - a) * t
const ease = (t) => 1 - (1 - t) * (1 - t)
const clamp01 = (t) => Math.max(0, Math.min(1, t))
const TAU = Math.PI * 2
const INK = '#2a1d16'

// ---------- 画布 ----------
// 逻辑尺寸 w×h，实际按 R 倍绘制；animate 时每帧重画，画布离开页面后自动停
export function pixelCanvas(w, h, paint, animate = false) {
  const R = Math.min(3, Math.max(2, Math.ceil((globalThis.devicePixelRatio || 1) * 1.5)))
  const c = document.createElement('canvas')
  c.width = w * R; c.height = h * R
  c.className = 'dou-px'
  const g = c.getContext('2d')
  let started = false
  const frame = (t) => {
    if (started && !c.isConnected) return
    if (c.isConnected) started = true
    g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, w, h); g.lineJoin = 'round'; g.lineCap = 'round'
    paint(g, t / 1000)
    if (animate) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  return c
}
// 描边文字（伤害数字、招式名）
export function pixelText(g, txt, x, y, color, size = 10, align = 'center') {
  g.font = `900 ${size}px "Songti SC", "STSong", "Noto Serif SC", serif`
  g.textAlign = align; g.textBaseline = 'alphabetic'
  g.lineWidth = Math.max(2, size / 4); g.strokeStyle = '#1a120c'; g.strokeText(txt, x, y)
  g.fillStyle = color; g.fillText(txt, x, y)
}

// ---------- 场景：水墨山水 ----------
const SC = {
  village: { sky: ['#f6efe0', '#e7dcc4'], far: '#b9c4b6', mid: '#7f9a86', ground: '#cdbf9c', accent: '#5a7a4a', prop: 'bamboo' },
  popup_valley: { sky: ['#eef3f6', '#d9e4ea'], far: '#b6c3cc', mid: '#8aa0ae', ground: '#c9c2ae', accent: '#3b82c4', prop: 'popups' },
  training: { sky: ['#f4eadb', '#e3d2b6'], far: '#bfb19a', mid: '#93806a', ground: '#c8b08a', accent: '#8a5a34', prop: 'racks' },
  academy: { sky: ['#f5ede0', '#e6d6bd'], far: '#c2b8a8', mid: '#8f8676', ground: '#cfc2a8', accent: '#b4322a', prop: 'banners' },
  question_terrace: { sky: ['#efe9f6', '#d6cce6'], far: '#b9b0cc', mid: '#8e83aa', ground: '#c9c1d0', accent: '#7c4dcc', prop: 'qclouds' },
  taiji_lake: { sky: ['#eef2ec', '#d8e2d6'], far: '#a9bcb2', mid: '#6f8f86', ground: '#b9c7bd', accent: '#1f8a7a', prop: 'taiji' },
  dark_moon: { sky: ['#1d2238', '#2c3352'], far: '#3a4266', mid: '#262c48', ground: '#3c3f55', accent: '#c9c6ff', prop: 'moon', dark: true },
  library: { sky: ['#efe6d6', '#d9c8aa'], far: '#b8a68a', mid: '#7d6a50', ground: '#bda886', accent: '#4a5ad0', prop: 'lanterns' },
  grassland: { sky: ['#eef4f0', '#d7e6dc'], far: '#c9d6d6', mid: '#93b08a', ground: '#b7c98f', accent: '#e8d8b0', prop: 'alpacas' },
  rocket_base: { sky: ['#f3e8e0', '#e2cbbb'], far: '#b9a9a0', mid: '#8a7a74', ground: '#b5a294', accent: '#e8452c', prop: 'rocket' },
  twin_stars: { sky: ['#1a1f3a', '#3a2c5a'], far: '#3c3a6a', mid: '#2a2850', ground: '#3a3658', accent: '#9ab8ff', prop: 'stars', dark: true },
  server_hall: { sky: ['#e3ecf2', '#c6d6e2'], far: '#9fb4c4', mid: '#6d8496', ground: '#a9b8c4', accent: '#3aa0e8', prop: 'servers' },
  charter_peak: { sky: ['#f8efe6', '#ead8c6'], far: '#d2c4b8', mid: '#a8968a', ground: '#e9e2da', accent: '#d97a4a', prop: 'pavilion' },
  whale_fall: { sky: ['#0f2a44', '#163a5c'], far: '#1e4a70', mid: '#123250', ground: '#1f3b52', accent: '#7fd4ff', prop: 'whale', dark: true },
  golf_manor: { sky: ['#fbf0d6', '#f0dca8'], far: '#d8c48a', mid: '#a8b06a', ground: '#9ec36a', accent: '#e8b830', prop: 'golf' },
  arena: { sky: ['#f4e8d8', '#e3cfb4'], far: '#c4b29a', mid: '#9a8468', ground: '#c9ac84', accent: '#b4322a', prop: 'ring' },
  board: { sky: ['#f6e3d0', '#e8c6a8'], far: '#c9a88c', mid: '#9a6e58', ground: '#c99c74', accent: '#c8383a', prop: 'summit' },
}
// 旧战斗快照里的场景名
const SCENE_ALIAS = { bamboo: 'village', gate: 'training', ferry: 'taiji_lake', market: 'popup_valley', escort: 'training', desert: 'rocket_base', snow: 'charter_peak', swamp: 'grassland', river: 'taiji_lake', cliff: 'charter_peak', clouds: 'twin_stars', peak: 'charter_peak' }
export const SCENES = SC
export const horizonOf = (h) => Math.round(h * 0.64)
function mountains(g, w, h, base, amp, freq, seed, color, alpha = 1) {
  g.globalAlpha = alpha
  const grad = g.createLinearGradient(0, base - amp * 2, 0, base + 10)
  grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath(); g.moveTo(0, h)
  for (let x = 0; x <= w; x += 4) g.lineTo(x, base - amp * (0.55 + 0.45 * Math.sin(x / freq + seed)) - amp * 0.35 * Math.sin(x / (freq * 0.37) + seed * 2))
  g.lineTo(w, h); g.closePath(); g.fill()
  g.globalAlpha = 1
}
function brushLine(g, x1, y1, x2, y2, w, color) { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo((x1 + x2) / 2 + (y2 - y1) * 0.08, (y1 + y2) / 2, x2, y2); g.stroke() }
export function drawScene(g, key, w, h, t = 0) {
  const s = SC[key] || SC[SCENE_ALIAS[key]] || SC.arena
  const hz = horizonOf(h)
  const sky = g.createLinearGradient(0, 0, 0, hz)
  sky.addColorStop(0, s.sky[0]); sky.addColorStop(1, s.sky[1])
  g.fillStyle = sky; g.fillRect(0, 0, w, h)
  // 纸纹
  g.globalAlpha = s.dark ? 0.05 : 0.07
  for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? '#fff' : '#8a6a40'; g.fillRect((i * 97) % w, (i * 61) % h, 1 + (i % 3), 0.6) }
  g.globalAlpha = 1
  if (s.dark) { g.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 40; i++) { const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i)); g.globalAlpha = tw; g.beginPath(); g.arc((i * 73) % w, (i * 37) % (hz - 10), i % 5 ? 0.6 : 1.1, 0, TAU); g.fill() } g.globalAlpha = 1 }
  mountains(g, w, h, hz - 18, h * 0.16, 46, key.length, s.far, 0.85)
  propBack(g, s.prop, w, h, hz, t, s)
  mountains(g, w, h, hz - 2, h * 0.08, 22, key.length * 3, s.mid, 0.9)
  // 雾
  const mist = g.createLinearGradient(0, hz - 24, 0, hz + 6)
  mist.addColorStop(0, 'rgba(255,255,255,0)'); mist.addColorStop(1, s.dark ? 'rgba(120,140,200,.18)' : 'rgba(255,255,255,.55)')
  g.fillStyle = mist; g.fillRect(0, hz - 24, w, 30)
  // 地面
  const gr = g.createLinearGradient(0, hz, 0, h)
  gr.addColorStop(0, s.ground); gr.addColorStop(1, shade(s.ground, s.dark ? -10 : -18))
  g.fillStyle = gr; g.fillRect(0, hz, w, h - hz)
  g.globalAlpha = 0.25
  for (let i = 0; i < 9; i++) brushLine(g, (i * 53) % w, hz + 8 + (i * 13) % (h - hz - 10), (i * 53) % w + 30 + (i % 4) * 8, hz + 8 + (i * 13) % (h - hz - 10), 1.2, shade(s.ground, -30))
  g.globalAlpha = 1
  propFront(g, s.prop, w, h, hz, t, s)
}
function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, v + d)).toString(16).padStart(2, '0')
  return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255)
}
function propBack(g, prop, w, h, hz, t, s) {
  const sway = Math.sin(t * 1.6) * 1.2
  switch (prop) {
    case 'moon': { g.fillStyle = '#f2efe0'; g.beginPath(); g.arc(w * 0.78, h * 0.2, h * 0.11, 0, TAU); g.fill(); g.fillStyle = s.sky[0]; g.beginPath(); g.arc(w * 0.78 + h * 0.05, h * 0.18, h * 0.1, 0, TAU); g.fill(); break }
    case 'stars': for (const [x, y, c] of [[0.3, 0.2, '#8fb4ff'], [0.7, 0.18, '#c9a0ff']]) { const r = 4 + Math.sin(t * 3) * 0.8; g.fillStyle = c; star(g, w * x, h * y, r, r * 0.4); g.globalAlpha = 0.25; g.beginPath(); g.arc(w * x, h * y, r * 3, 0, TAU); g.fill(); g.globalAlpha = 1 } g.strokeStyle = 'rgba(200,190,255,.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w * 0.3, h * 0.2); g.quadraticCurveTo(w * 0.5, h * 0.05, w * 0.7, h * 0.18); g.stroke(); break
    case 'rocket': g.fillStyle = '#e8e2da'; g.beginPath(); g.ellipse(w * 0.82, hz - 40, 6, 22, 0, 0, TAU); g.fill(); g.fillStyle = '#e8452c'; g.beginPath(); g.moveTo(w * 0.82 - 6, hz - 26); g.lineTo(w * 0.82 - 11, hz - 14); g.lineTo(w * 0.82 - 4, hz - 18); g.fill(); break
    case 'whale': g.strokeStyle = 'rgba(160,220,255,.45)'; g.lineWidth = 2; g.beginPath(); g.ellipse(w * 0.6, hz - 10, w * 0.22, 16, 0, Math.PI, TAU); g.stroke(); for (let i = 0; i < 9; i++) brushLine(g, w * 0.42 + i * w * 0.045, hz - 22 + Math.abs(i - 4) * 2, w * 0.42 + i * w * 0.045, hz - 4, 1.4, 'rgba(160,220,255,.35)'); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(180,230,255,.08)'; g.fillRect(w * (0.1 + i * 0.17) + Math.sin(t + i) * 4, 0, 10, hz) } break
    case 'servers': for (let x = 10; x < w; x += 44) { g.fillStyle = 'rgba(60,90,120,.35)'; g.fillRect(x, hz - 56, 26, 56); for (let y = hz - 50; y < hz - 4; y += 7) { g.fillStyle = (Math.floor(t * 4 + x + y) % 7) ? 'rgba(80,200,255,.6)' : 'rgba(120,255,160,.8)'; g.fillRect(x + 3, y, 2, 2) } } break
    case 'pavilion': { const x = w * 0.78, y = hz - 30; g.fillStyle = '#7a3a24'; g.fillRect(x - 12, y, 3, 26); g.fillRect(x + 9, y, 3, 26); g.fillStyle = s.accent; g.beginPath(); g.moveTo(x - 22, y + 2); g.quadraticCurveTo(x, y - 18, x + 22, y + 2); g.lineTo(x + 16, y - 2); g.quadraticCurveTo(x, y - 12, x - 16, y - 2); g.fill(); g.fillStyle = '#f6efe2'; for (let i = 0; i < 3; i++) g.fillRect(w * 0.12 + i * 10, hz - 52 + Math.sin(t + i) * 1.5, 5, 30); break }
    case 'golf': g.fillStyle = '#f0d27a'; g.fillRect(w * 0.66, hz - 34, 70, 34); g.fillStyle = '#e8b830'; g.beginPath(); g.moveTo(w * 0.66 - 4, hz - 34); g.lineTo(w * 0.66 + 35, hz - 52); g.lineTo(w * 0.66 + 74, hz - 34); g.fill(); g.fillStyle = '#fff6d0'; for (let i = 0; i < 5; i++) g.fillRect(w * 0.66 + 6 + i * 13, hz - 26, 5, 12); break
    case 'summit': g.fillStyle = s.accent; for (const x of [0.16, 0.84]) { g.fillRect(w * x, hz - 60, 2, 60); g.beginPath(); g.moveTo(w * x + 2, hz - 60); g.quadraticCurveTo(w * x + 18 + sway * 2, hz - 50, w * x + 2, hz - 34); g.fill() } for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i * 0.33) % 1, fx = w * (0.3 + i * 0.2), fy = hz - 40 - k * 40; g.globalAlpha = 1 - k; g.fillStyle = ['#ffd27a', '#ff8a6a', '#a8d8ff'][i]; for (let j = 0; j < 8; j++) { const a = j / 8 * TAU; g.beginPath(); g.arc(fx + Math.cos(a) * k * 18, fy + Math.sin(a) * k * 18, 1.2, 0, TAU); g.fill() } } g.globalAlpha = 1; break
    case 'banners': for (let i = 0; i < 4; i++) { const x = w * (0.1 + i * 0.26); g.fillStyle = '#f6efe2'; g.fillRect(x, 6, 12, 40 + sway); g.fillStyle = '#2a1d16'; for (let j = 0; j < 4; j++) g.fillRect(x + 4, 12 + j * 8, 4, 4) } break
    case 'lanterns': for (let i = 0; i < 6; i++) { const x = w * (0.08 + i * 0.17), y = 14 + (i % 2) * 8; g.strokeStyle = '#5a3a22'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, y); g.stroke(); g.fillStyle = s.accent; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(x, y + 5, 4, 6, 0, 0, TAU); g.fill(); g.globalAlpha = 0.2; g.beginPath(); g.arc(x, y + 5, 12, 0, TAU); g.fill(); g.globalAlpha = 1 } break
    case 'popups': for (let i = 0; i < 5; i++) { const x = ((i * 83 + t * 6) % (w + 40)) - 20, y = 18 + (i * 23) % (hz - 60); g.fillStyle = '#ffffffd0'; g.fillRect(x, y, 30, 20); g.fillStyle = s.accent; g.fillRect(x, y, 30, 4); g.fillStyle = '#e8452c'; g.fillRect(x + 25, y + 0.5, 3, 3) } break
    case 'qclouds': g.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i < 4; i++) { const x = ((i * 97 + t * 4) % (w + 60)) - 30, y = 20 + i * 14; g.beginPath(); g.ellipse(x, y, 22, 7, 0, 0, TAU); g.fill() } g.fillStyle = 'rgba(124,77,204,.35)'; g.font = '900 18px serif'; g.fillText('?', w * 0.2, 40); g.fillText('?', w * 0.75, 30); break
    case 'taiji': g.save(); g.translate(w * 0.72, hz - 8); g.scale(1, 0.32); taijiDisc(g, 0, 0, 30, t * 0.3, 0.6); g.restore(); break
    case 'racks': for (const x of [0.12, 0.86]) { g.fillStyle = '#7a5230'; g.fillRect(w * x - 14, hz - 30, 28, 3); g.fillRect(w * x - 12, hz - 30, 2, 30); g.fillRect(w * x + 10, hz - 30, 2, 30); for (let i = 0; i < 4; i++) { g.strokeStyle = '#c9ccd2'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(w * x - 8 + i * 5, hz - 44); g.lineTo(w * x - 8 + i * 5, hz - 26); g.stroke() } } break
  }
}
function propFront(g, prop, w, h, hz, t, s) {
  const sway = Math.sin(t * 1.6) * 1.5
  switch (prop) {
    case 'bamboo': for (const [x, k] of [[8, 1], [26, 0.8], [w - 16, 1.1], [w - 34, 0.9]]) { g.strokeStyle = shade(s.accent, (k * 20) | 0); g.lineWidth = 4 * k; g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + sway, h * 0.4, x + sway * 2, -4); g.stroke(); g.strokeStyle = INK; g.globalAlpha = 0.3; g.lineWidth = 0.8; for (let y = h * 0.1; y < h; y += 22) { g.beginPath(); g.moveTo(x - 2 * k, y); g.lineTo(x + 2 * k, y); g.stroke() } g.globalAlpha = 1; g.fillStyle = shade(s.accent, 20); for (let i = 0; i < 3; i++) { g.save(); g.translate(x + sway * 1.5, 20 + i * 30); g.rotate(-0.5 + i * 0.4); g.beginPath(); g.ellipse(8, 0, 9, 2.2, 0, 0, TAU); g.fill(); g.restore() } } break
    case 'ring': g.fillStyle = '#7a4a2a'; g.fillRect(14, hz + 10, w - 28, 5); g.fillStyle = s.accent; for (const x of [14, w - 18]) g.fillRect(x, hz - 24, 4, 40); g.strokeStyle = '#efe0c0'; g.lineWidth = 1; for (const y of [hz - 16, hz - 6]) { g.beginPath(); g.moveTo(18, y); g.quadraticCurveTo(w / 2, y + 3, w - 18, y); g.stroke() } break
    case 'alpacas': for (let i = 0; i < 3; i++) { const x = w * (0.1 + i * 0.4) + Math.sin(t + i) * 2, y = hz + 4; g.fillStyle = '#f2e6cc'; g.beginPath(); g.ellipse(x, y, 7, 5, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(x + 6, y - 7, 2.5, 5, 0, 0, TAU); g.fill(); g.fillStyle = INK; g.fillRect(x + 6.5, y - 10, 0.8, 0.8) } break
    case 'golf': for (let i = 0; i < 4; i++) { g.fillStyle = '#fff'; g.beginPath(); g.arc(w * (0.1 + i * 0.25), hz + 14 + (i % 2) * 6, 1.6, 0, TAU); g.fill() } g.strokeStyle = '#e8452c'; g.lineWidth = 1; g.beginPath(); g.moveTo(w * 0.9, hz + 18); g.lineTo(w * 0.9, hz - 8); g.stroke(); g.fillStyle = '#e8452c'; g.beginPath(); g.moveTo(w * 0.9, hz - 8); g.lineTo(w * 0.9 + 9, hz - 5); g.lineTo(w * 0.9, hz - 2); g.fill(); break
  }
}
function star(g, x, y, r, r2, n = 5) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * TAU - Math.PI / 2, rr = i % 2 ? r2 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) } g.closePath(); g.fill() }
function taijiDisc(g, x, y, r, rot, alpha = 1) {
  g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha *= alpha
  g.fillStyle = '#f6f2ea'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill()
  g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); g.arc(0, r / 2, r / 2, Math.PI / 2, -Math.PI / 2, true); g.arc(0, -r / 2, r / 2, Math.PI / 2, -Math.PI / 2); g.fill()
  g.fillStyle = '#f6f2ea'; g.beginPath(); g.arc(0, r / 2, r / 7, 0, TAU); g.fill()
  g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(0, -r / 2, r / 7, 0, TAU); g.fill()
  g.restore()
}

// ---------- 人物造型 ----------
// shape：human（Q 版人）/ cassette / robot / blob（小怪）；hairStyle 决定发型；acc 是饰品
const STYLES = {
  deepseek: { hair: '#2f4fb8', hairStyle: 'whale', outfit: '#f4f6fb', trim: '#3b5bdb', skin: '#ffe2cc', eye: '#1e3a8a', acc: 'whalepin' },
  doubao: { hair: '#b8733a', hairStyle: 'buns', outfit: '#fff3e2', trim: '#e8954a', skin: '#ffe0c8', eye: '#6a3a1a', acc: 'beanclip', blush: true },
  b1: { shape: 'cassette', body: '#5a5a66', trim: '#e8b04a' },
  b2: { shape: 'robot', body: '#9aa8b4', trim: '#3b82c4' },
  b3: { hair: '#1e1e24', hairStyle: 'topknot', outfit: '#f2f0ea', trim: '#8a8a8a', skin: '#ffe0c4', eye: '#222', male: true, acc: 'cheats' },
  b4: { hair: '#1a1a1a', hairStyle: 'highbun', outfit: '#fbf6ee', trim: '#c8383a', skin: '#ffe4d0', eye: '#2a1a1a', acc: 'brushpin' },
  b5: { hair: '#e8823a', hair2: '#8a5ad0', hairStyle: 'long', outfit: '#6a4aa8', trim: '#f2c46a', skin: '#ffe2cc', eye: '#5a2a9a', acc: 'qmark' },
  b6: { hair: '#2a2a2a', hair2: '#f2f2f2', hairStyle: 'yinyang', outfit: '#eaf4f0', trim: '#1f8a7a', skin: '#ffe2cc', eye: '#1f5a50' },
  b7: { hair: '#c8bfe6', hairStyle: 'long', outfit: '#232a4a', trim: '#c9c6ff', skin: '#fde6d8', eye: '#6a5aa8', acc: 'moonclip', sleepy: true },
  b8: { hair: '#3a3a8a', hairStyle: 'bob', outfit: '#f6f8ff', trim: '#4a5ad0', skin: '#ffe4d0', eye: '#2a2a6a', acc: 'glasses' },
  b9: { hair: '#f2e6cc', hairStyle: 'fluffy', outfit: '#c8653a', trim: '#2a8a7a', skin: '#ffe2cc', eye: '#6a4a2a', acc: 'poncho' },
  b10: { hair: '#1a1a1a', hair2: '#f2f2f2', hairStyle: 'spiky', outfit: '#1e1e22', trim: '#e8452c', skin: '#ffdcc4', eye: '#e8452c', acc: 'jacket' },
  b11: { hair: '#4a7ae8', hair2: '#9a5ae8', hairStyle: 'twin', outfit: '#eef0ff', trim: '#7a6ae8', skin: '#ffe4d4', eye: '#4a4ab8', acc: 'stars' },
  b12: { hair: '#141414', hairStyle: 'long', outfit: '#f4f4f4', trim: '#141414', skin: '#ffe4d0', eye: '#222', acc: 'knot' },
  b13: { hair: '#c8643a', hairStyle: 'long', outfit: '#fbf3e6', trim: '#b8562a', skin: '#ffe6d4', eye: '#7a3a1a', acc: 'starburst' },
  b14: { hair: '#1a1a1a', hairStyle: 'short', outfit: '#8a8e96', trim: '#3b5bdb', skin: '#ffdcc0', eye: '#222', male: true, acc: 'glassesWhale' },
  b15: { hair: '#f2c84a', hairStyle: 'swoop', outfit: '#1f2a4a', trim: '#d0283a', skin: '#ffd2b0', eye: '#2a2a3a', male: true, acc: 'tie' },
}
export const ROLE_COLORS = { deepseek: '#3b5bdb', doubao: '#e8954a' }
function styleOf(who) {
  const look = who.look || {}
  if (look.foe && STYLES[look.foe]) return STYLES[look.foe]
  if (look.foe && look.foe.startsWith('m')) return { shape: 'blob', body: hsl(look.hue ?? 30, 45, 62), trim: hsl((look.hue ?? 30) + 40, 60, 40) }
  return STYLES[look.role] || STYLES.deepseek
}
// 姿势：手臂角度（0 = 自然下垂，正值朝前抬），身体倾斜，武器朝向（0 = 正前方，负值朝上）
const POSES = {
  idle: { aF: 0.35, aB: -0.25, lean: 0, wpn: -0.75, sq: 1 },
  windup: { aF: -2.3, aB: 0.4, lean: -0.14, wpn: -2.5, sq: 0.92 },
  attack: { aF: 1.55, aB: -0.7, lean: 0.2, wpn: 0, sq: 1.04 },
  hit: { aF: -0.9, aB: -1.3, lean: -0.3, wpn: -1.9, sq: 0.95 },
  cast: { aF: 2.7, aB: 2.7, lean: -0.05, wpn: -1.57, sq: 1.02 },
  win: { aF: 2.4, aB: -0.4, lean: 0, wpn: -2.4, sq: 1 },
  dodge: { aF: 0.8, aB: -0.8, lean: -0.38, wpn: -0.6, sq: 1 },
  sit: { aF: 0.9, aB: 0.9, lean: 0, wpn: -0.3, sq: 0.8 },
}
export const OUTFIT_COLORS = { o_straw_hat: '#c9a45c', o_headband: '#c8383a', o_half_mask: '#f2ece0', o_blue_robe: '#3f6f9a', o_black_robe: '#2b2b38', o_cape: '#7a4b2a', o_sword_box: '#6a5848', o_gold_skin: '#e8c04a', o_leaf_aura: '#d98b3a', o_cloud_aura: '#cfe3f0' }
export const KIND_COLOR = { sword: '#bfe8ff', blade: '#ff9a3c', spear: '#8fdcff', staff: '#ffd36a', fan: '#a8f0b8', dart: '#e0e6f0', fist: '#ff7a5a' }
// 武器专属主色（特效用）
export const FX_COLOR = { code: '#7dffb0', flash: '#ffffff', emoji: '#ffd84a', keycap: '#ff7aa8', pages: '#f6ecd0', question: '#b48aff', taiji: '#f2f2f2', moon: '#d8d4ff', light: '#ffffff', wool: '#fff3dc', rocket: '#ff8a3a', twin: '#8fa8ff', cable: '#5ac8ff', rgb: '#ff5ad0', whale: '#6ad0ff', seal: '#ffcf4a' }

// 主绘制：who = { look: { role, foe, hue, outfit, boss }, kind, weapon, fx }，x / y = 脚底中心
export function drawFighter(g, who, x, y, o = {}) {
  const st = styleOf(who), S = o.scale || 2, flip = o.flip ? -1 : 1, pose = o.pose || 'idle', t = o.t || 0
  const P = POSES[pose] || POSES.idle, outfit = o.outfit || who.look?.outfit || {}
  const W = (c) => (o.flash ? '#ffffff' : c)
  const bob = pose === 'idle' ? Math.sin(t * 3.2 + (who.look?.hue ?? 0)) * 0.5 : pose === 'win' ? -Math.abs(Math.sin(t * 7)) * 4 : 0
  if (!o.noShadow) { g.fillStyle = 'rgba(30,20,10,.22)'; g.beginPath(); g.ellipse(x, y, 9 * S, 2 * S, 0, 0, TAU); g.fill() }
  g.save(); g.translate(x, y); g.scale(S * flip, S)
  if (outfit.aura) aura(g, outfit.aura, t)
  if (pose === 'ko') { g.rotate(-Math.PI / 2 * 0.98); g.translate(-3, -2) }
  g.translate(0, bob); g.scale(1, P.sq)
  g.lineWidth = 0.8; g.strokeStyle = INK
  if (st.shape === 'cassette') drawCassette(g, st, P, W, t)
  else if (st.shape === 'robot') drawRobot(g, st, P, W, t)
  else if (st.shape === 'blob') drawBlob(g, st, P, W, t, who.look?.foe)
  else drawHuman(g, st, P, W, t, pose, outfit, who, o)
  g.restore()
}
function aura(g, id, t) {
  const c = OUTFIT_COLORS[id] || '#fff'
  for (let i = 0; i < 7; i++) { const a = t * 1.8 + i / 7 * TAU; g.globalAlpha = 0.65; g.fillStyle = c; g.save(); g.translate(Math.cos(a) * 11, -1 + Math.sin(a) * 2.5); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 2, 1, 0, 0, TAU); g.fill(); g.restore() }
  g.globalAlpha = 1
}
function limb(g, x1, y1, x2, y2, w, color) { g.strokeStyle = INK; g.lineWidth = w + 1.2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke() }
function blob(g, color) { g.fillStyle = color; g.fill(); g.lineWidth = 0.8; g.strokeStyle = INK; g.stroke() }
function drawHuman(g, st, P, W, t, pose, outfit, who, o) {
  const robe = outfit.body ? OUTFIT_COLORS[outfit.body] : st.outfit, trim = st.trim
  // 背饰
  if (outfit.back === 'o_cape') { g.beginPath(); g.moveTo(-3, -15); g.quadraticCurveTo(-9 - Math.sin(t * 3) * 1.5, -7, -7, -1); g.lineTo(1, -2); g.closePath(); blob(g, W(OUTFIT_COLORS.o_cape)) }
  if (outfit.back === 'o_sword_box') { g.save(); g.rotate(-0.3); g.beginPath(); g.roundRect(-8, -20, 4, 15, 1); blob(g, W(OUTFIT_COLORS.o_sword_box)); g.restore() }
  if (st.hairStyle === 'long' || st.hairStyle === 'twin' || st.hairStyle === 'whale') backHair(g, st, W, t)
  const lean = P.lean
  g.save(); g.rotate(lean * 0.6)
  // 后手
  const sh = [-1.5, -14.5]
  const hand = (a, L = 6.2) => [sh[0] + Math.sin(a) * L, sh[1] + Math.cos(a) * L]
  const hb = hand(P.aB)
  limb(g, sh[0] - 1, sh[1], hb[0] - 1, hb[1], 2.2, W(robe))
  // 腿
  const step = pose === 'attack' ? 2.5 : pose === 'windup' ? -1 : pose === 'dodge' ? -2 : 0
  if (pose === 'sit') { limb(g, -2, -5, 3, -2, 2.6, W(st.male ? shade(st.outfit, -30) : '#3a3036')); limb(g, 2, -5, -3, -2, 2.6, W('#3a3036')) }
  else { limb(g, -1.5, -6, -2.5 - step, -1, 2.4, W(st.male ? shade(st.outfit, -30) : '#3a3036')); limb(g, 1.5, -6, 2.5 + step, -1, 2.4, W(st.male ? shade(st.outfit, -30) : '#3a3036')) }
  g.fillStyle = W(INK); g.beginPath(); g.ellipse(-2.6 - step, -0.6, 2, 1, 0, 0, TAU); g.ellipse(2.8 + step, -0.6, 2, 1, 0, 0, TAU); g.fill()
  // 身体（裙装 / 长袍 / 西装）
  g.beginPath()
  if (st.male) { g.moveTo(-4.5, -16); g.lineTo(4.5, -16); g.lineTo(4.8, -6); g.lineTo(-4.8, -6) }
  else { g.moveTo(-4, -16); g.lineTo(4, -16); g.lineTo(6.2, -5.5); g.quadraticCurveTo(0, -4, -6.2, -5.5) }
  g.closePath(); blob(g, W(robe))
  g.fillStyle = W(trim); g.fillRect(-4.6, -10.5, 9.2, 1.4)
  if (!st.male) { g.beginPath(); g.moveTo(-6.2, -5.5); g.quadraticCurveTo(0, -4, 6.2, -5.5); g.lineTo(5.9, -6.6); g.quadraticCurveTo(0, -5.2, -5.9, -6.6); g.fill() }
  g.beginPath(); g.moveTo(-1.6, -16); g.lineTo(0, -13.6); g.lineTo(1.6, -16); g.fillStyle = W(trim); g.fill()
  bodyAcc(g, st, W, t)
  g.restore()
  // 头
  g.save(); g.translate(0.5 + lean * 3, 0)
  g.beginPath(); g.ellipse(0, -22.5, 7.6, 7.2, 0, 0, TAU); blob(g, W(st.skin))
  face(g, st, W, pose, outfit, t)
  frontHair(g, st, W, t)
  headAcc(g, st, W, t, outfit)
  g.restore()
  // 前手 + 武器
  g.save(); g.rotate(lean * 0.6)
  const shF = [1.5, -14.5], hf = [shF[0] + Math.sin(P.aF) * 6.2, shF[1] + Math.cos(P.aF) * 6.2]
  if (!o.noWeapon) drawHeld(g, who, P.wpn, hf, W, outfit, t, 'behind')
  limb(g, shF[0], shF[1], hf[0], hf[1], 2.2, W(robe))
  g.beginPath(); g.arc(hf[0], hf[1], 1.25, 0, TAU); blob(g, W(st.skin))
  if (!o.noWeapon) drawHeld(g, who, P.wpn, hf, W, outfit, t, 'front')
  if (pose === 'cast') { const hb2 = [sh[0] + Math.sin(P.aB) * 6.2, sh[1] + Math.cos(P.aB) * 6.2]; g.beginPath(); g.arc(hb2[0], hb2[1], 1.2, 0, TAU); blob(g, W(st.skin)) }
  g.restore()
}
function backHair(g, st, W, t) {
  const sway = Math.sin(t * 2.4) * 0.8
  if (st.hairStyle === 'whale') {
    g.beginPath(); g.moveTo(-5, -25); g.quadraticCurveTo(-12 + sway, -18, -10 + sway, -11); g.quadraticCurveTo(-6, -15, -4, -20); g.closePath(); blob(g, W(st.hair))
    g.beginPath(); g.moveTo(-10 + sway, -11); g.lineTo(-14 + sway, -9); g.lineTo(-11.5 + sway, -12.5); g.lineTo(-13 + sway, -15); g.closePath(); blob(g, W(st.hair))
  } else if (st.hairStyle === 'twin') {
    g.beginPath(); g.moveTo(-6, -24); g.quadraticCurveTo(-11 + sway, -16, -8 + sway, -8); g.lineTo(-5, -15); g.closePath(); blob(g, W(st.hair))
    g.beginPath(); g.moveTo(6, -24); g.quadraticCurveTo(11 + sway, -16, 8 + sway, -8); g.lineTo(5, -15); g.closePath(); blob(g, W(st.hair2 || st.hair))
  } else {
    g.beginPath(); g.moveTo(-7.5, -24); g.quadraticCurveTo(-9 + sway, -14, -6 + sway, -9); g.lineTo(5 + sway, -9); g.quadraticCurveTo(8 + sway, -14, 7.5, -24); g.closePath(); blob(g, W(st.hair))
    if (st.hair2) { g.fillStyle = W(st.hair2); g.globalAlpha = 0.6; g.fillRect(-6 + sway, -13, 11, 3.5); g.globalAlpha = 1 }
  }
}
function frontHair(g, st, W, t) {
  const c = W(st.hair)
  g.beginPath(); g.moveTo(-7.8, -21); g.quadraticCurveTo(-8, -30.5, 0, -30); g.quadraticCurveTo(8, -30.5, 7.8, -21)
  switch (st.hairStyle) {
    case 'spiky': g.lineTo(6, -25); g.lineTo(4, -21.5); g.lineTo(2, -25.5); g.lineTo(-1, -21.5); g.lineTo(-3, -25.5); g.lineTo(-6, -21.5); break
    case 'swoop': g.quadraticCurveTo(9, -26, 4, -25); g.quadraticCurveTo(-2, -27.5, -6, -24.5); break
    case 'short': case 'topknot': g.lineTo(6.5, -25); g.quadraticCurveTo(0, -27, -6.5, -25); break
    default: g.quadraticCurveTo(5, -26.5, 2, -24.5); g.quadraticCurveTo(-1, -26.5, -3.5, -24.2); g.quadraticCurveTo(-6, -26, -7.8, -21)
  }
  g.closePath(); blob(g, c)
  if (st.hairStyle === 'spiky' && st.hair2) { g.fillStyle = W(st.hair2); g.beginPath(); g.moveTo(2, -29.5); g.lineTo(5, -33); g.lineTo(4.5, -28); g.fill() }
  if (st.hairStyle === 'yinyang') { g.beginPath(); g.arc(-6, -29, 2.8, 0, TAU); blob(g, W(st.hair)); g.beginPath(); g.arc(6, -29, 2.8, 0, TAU); blob(g, W(st.hair2)) }
  if (st.hairStyle === 'buns') { g.beginPath(); g.arc(-6.2, -28.6, 3, 0, TAU); blob(g, c); g.beginPath(); g.arc(6.2, -28.6, 3, 0, TAU); blob(g, c) }
  if (st.hairStyle === 'highbun' || st.hairStyle === 'topknot') { g.beginPath(); g.arc(0, -31.5, st.hairStyle === 'topknot' ? 2 : 3.2, 0, TAU); blob(g, c) }
  if (st.hairStyle === 'fluffy') for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(-6.5 + i * 2.6, -29 - (i % 2), 2.4, 0, TAU); blob(g, c) }
  if (st.hairStyle === 'bob') { g.beginPath(); g.moveTo(-7.8, -21); g.quadraticCurveTo(-8.5, -17, -6, -16.5); g.lineTo(-6, -21); g.closePath(); blob(g, c); g.beginPath(); g.moveTo(7.8, -21); g.quadraticCurveTo(8.5, -17, 6, -16.5); g.lineTo(6, -21); g.closePath(); blob(g, c) }
  if (st.hairStyle === 'swoop') { g.beginPath(); g.moveTo(-7, -27); g.quadraticCurveTo(2, -36, 10, -28); g.quadraticCurveTo(3, -31, -7, -27); blob(g, c) }
}
function face(g, st, W, pose, outfit, t) {
  const hurt = pose === 'hit' || pose === 'ko', blinkT = (t * 0.7) % 4 < 0.12
  g.fillStyle = W(st.eye || INK)
  if (hurt) { g.strokeStyle = W(INK); g.lineWidth = 0.7; for (const ex of [1.2, 5]) { g.beginPath(); g.moveTo(ex - 1.2, -23.6); g.lineTo(ex + 1.2, -22); g.moveTo(ex - 1.2, -22); g.lineTo(ex + 1.2, -23.6); g.stroke() } }
  else if (st.sleepy || blinkT) { g.strokeStyle = W(st.eye || INK); g.lineWidth = 0.7; for (const ex of [1.4, 5]) { g.beginPath(); g.arc(ex, -22.6, 1.2, 0.2, Math.PI - 0.2); g.stroke() } }
  else if (pose === 'win') { g.strokeStyle = W(st.eye || INK); g.lineWidth = 0.8; for (const ex of [1.4, 5]) { g.beginPath(); g.arc(ex, -22, 1.2, Math.PI + 0.3, -0.3); g.stroke() } }
  else for (const ex of [1.4, 5]) { g.beginPath(); g.ellipse(ex, -22.6, 1.05, 1.5, 0, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + 0.35, -23.2, 0.4, 0, TAU); g.fill(); g.fillStyle = W(st.eye || INK) }
  if (st.blush || pose === 'win') { g.fillStyle = 'rgba(255,120,120,.35)'; g.beginPath(); g.ellipse(0, -20, 1.4, 0.7, 0, 0, TAU); g.ellipse(6.4, -20, 1.4, 0.7, 0, 0, TAU); g.fill() }
  g.strokeStyle = W(INK); g.lineWidth = 0.6; g.beginPath()
  if (hurt) { g.arc(3.4, -18.2, 0.9, Math.PI, TAU) } else if (pose === 'attack' || pose === 'windup') { g.moveTo(2.4, -19.4); g.lineTo(4.4, -19.2) } else g.arc(3.4, -19.6, 1, 0.2, Math.PI - 0.2)
  g.stroke()
  if (outfit.face) { g.beginPath(); g.moveTo(-0.5, -21); g.lineTo(7.6, -21); g.lineTo(7, -17.5); g.quadraticCurveTo(3, -16, -0.5, -17.5); g.closePath(); blob(g, W(OUTFIT_COLORS[outfit.face])); g.strokeStyle = '#c8383a'; g.lineWidth = 0.5; g.beginPath(); g.arc(3.5, -19, 1, 0, Math.PI); g.stroke() }
}
function headAcc(g, st, W, t, outfit) {
  switch (st.acc) {
    case 'whalepin': g.fillStyle = W('#ffffff'); g.beginPath(); g.ellipse(-4.5, -28.2, 2.4, 1.2, -0.3, 0, TAU); g.fill(); g.strokeStyle = W(st.trim); g.lineWidth = 0.5; g.stroke(); break
    case 'beanclip': g.fillStyle = W('#7cc06a'); for (const x of [-4.5, 4.5]) { g.beginPath(); g.ellipse(x, -27, 1.2, 0.8, 0.4, 0, TAU); g.fill() } break
    case 'brushpin': g.strokeStyle = W('#7a4a2a'); g.lineWidth = 0.7; g.beginPath(); g.moveTo(-4, -30); g.lineTo(4, -33); g.stroke(); g.fillStyle = W(INK); g.beginPath(); g.ellipse(4.5, -33.2, 1.2, 0.6, -0.4, 0, TAU); g.fill(); break
    case 'qmark': g.fillStyle = W(st.trim); g.font = '900 7px serif'; g.textAlign = 'center'; g.fillText('?', 0, -31); break
    case 'moonclip': g.fillStyle = W('#e8e4ff'); g.beginPath(); g.arc(-4.6, -27.6, 1.8, 0.6, Math.PI * 1.6); g.arc(-4, -28, 1.3, Math.PI * 1.6, 0.6, true); g.fill(); break
    case 'glasses': case 'glassesWhale': g.strokeStyle = W(INK); g.lineWidth = 0.55; for (const ex of [1.4, 5]) { g.beginPath(); g.arc(ex, -22.5, 1.9, 0, TAU); g.stroke() } g.beginPath(); g.moveTo(3.3, -22.5); g.lineTo(3.1, -22.5); g.stroke(); break
    case 'stars': g.fillStyle = W('#8fa8ff'); star(g, -5, -28.5, 1.8, 0.7); g.fillStyle = W('#c9a0ff'); star(g, 5, -28.5, 1.8, 0.7); break
    case 'knot': g.fillStyle = W('#ffffff'); for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; g.beginPath(); g.ellipse(-4.5 + Math.cos(a) * 1.2, -28 + Math.sin(a) * 1.2, 1.2, 0.7, a, 0, TAU); g.fill() } g.strokeStyle = W(INK); g.lineWidth = 0.3; g.stroke(); break
    case 'starburst': g.fillStyle = W('#e8a050'); star(g, -4.8, -28.2, 2.4, 0.6, 8); break
  }
  if (outfit.head === 'o_straw_hat') { g.beginPath(); g.moveTo(-11, -27); g.quadraticCurveTo(0, -38, 11, -27); g.quadraticCurveTo(0, -29.5, -11, -27); blob(g, W(OUTFIT_COLORS.o_straw_hat)) }
  else if (outfit.head === 'o_headband') { g.fillStyle = W(OUTFIT_COLORS.o_headband); g.fillRect(-7.6, -26.4, 15.2, 1.6); g.beginPath(); g.moveTo(-7.6, -26); g.quadraticCurveTo(-12, -24 + Math.sin(t * 5), -13, -21); g.lineTo(-11.5, -21.5); g.quadraticCurveTo(-10.5, -24, -7.6, -24.8); g.fill() }
}
function bodyAcc(g, st, W, t) {
  switch (st.acc) {
    case 'cheats': g.fillStyle = W('#ffffff'); for (let i = 0; i < 3; i++) { g.save(); g.translate(-3 + i * 3, -12 + (i % 2)); g.rotate(-0.2 + i * 0.2); g.fillRect(-1, -1.5, 2, 3); g.strokeStyle = '#999'; g.lineWidth = 0.2; g.strokeRect(-1, -1.5, 2, 3); g.restore() } break
    case 'poncho': g.fillStyle = W('#f2d27a'); for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-4 + i * 2.6, -13); g.lineTo(-2.7 + i * 2.6, -11.5); g.lineTo(-1.4 + i * 2.6, -13); g.fill() } break
    case 'jacket': g.fillStyle = W('#e8452c'); g.fillRect(-0.4, -16, 0.8, 10); break
    case 'tie': g.fillStyle = W('#ffffff'); g.beginPath(); g.moveTo(-2, -16); g.lineTo(0, -13); g.lineTo(2, -16); g.fill(); g.fillStyle = W(st.trim); g.beginPath(); g.moveTo(-0.9, -14.6); g.lineTo(0.9, -14.6); g.lineTo(1.3, -4); g.lineTo(0, -2.6); g.lineTo(-1.3, -4); g.closePath(); g.fill(); break
    case 'glassesWhale': g.fillStyle = W(st.trim); g.beginPath(); g.ellipse(0, -12.5, 2, 1, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(2, -12.5); g.lineTo(3.2, -13.5); g.lineTo(3.2, -11.5); g.fill(); break
    case 'starburst': g.strokeStyle = W('#e8c890'); g.lineWidth = 1.4; g.beginPath(); g.moveTo(-4.5, -15); g.quadraticCurveTo(0, -11, 5.5, -7); g.stroke(); break
  }
}
function drawCassette(g, st, P, W, t) {
  g.beginPath(); g.roundRect(-8, -22, 16, 12, 2); blob(g, W(st.body))
  g.fillStyle = W('#f2efe6'); g.fillRect(-6, -20, 12, 5)
  for (const ex of [-3, 3]) { g.beginPath(); g.arc(ex, -17.5, 2, 0, TAU); blob(g, W('#2a2a2a')); g.fillStyle = W('#fff'); g.save(); g.translate(ex, -17.5); g.rotate(t * 4); g.fillRect(-0.3, -1.6, 0.6, 3.2); g.restore() }
  g.fillStyle = W(st.trim); g.fillRect(-6, -13, 12, 1.5)
  limb(g, -3, -10, -4, -2, 1.8, W(st.body)); limb(g, 3, -10, 4, -2, 1.8, W(st.body))
  const a = P.aF; limb(g, 8, -16, 8 + Math.sin(a) * 5, -16 + Math.cos(a) * 5, 1.6, W(st.body))
  g.strokeStyle = W(st.trim); g.lineWidth = 0.6; for (let i = 1; i <= 2; i++) { g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6 + i); g.beginPath(); g.arc(0, -16, 9 + i * 3, -0.6, 0.6); g.stroke() } g.globalAlpha = 1
}
function drawRobot(g, st, P, W, t) {
  limb(g, -2.5, -8, -3, -1, 2.2, W(st.body)); limb(g, 2.5, -8, 3, -1, 2.2, W(st.body))
  g.beginPath(); g.roundRect(-5.5, -17, 11, 10, 1.5); blob(g, W(st.body))
  g.fillStyle = W('#fff7c0'); for (let i = 0; i < 3; i++) g.fillRect(-4 + i * 3, -15 + (i % 2) * 3, 2.2, 1.6)
  g.beginPath(); g.arc(0, -23, 6, 0, TAU); blob(g, W('#cfe6ff'))
  g.strokeStyle = W(INK); g.lineWidth = 1.2; g.beginPath(); g.arc(0, -23, 6, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(4, -19); g.lineTo(7, -16); g.stroke()
  g.fillStyle = W(st.trim); g.beginPath(); g.arc(-1.5, -23.5, 1, 0, TAU); g.arc(2, -23.5, 1, 0, TAU); g.fill()
  const a = P.aF; limb(g, 5, -15, 5 + Math.sin(a) * 6, -15 + Math.cos(a) * 6, 1.8, W(st.body))
}
function drawBlob(g, st, P, W, t, foe) {
  const n = foe ? Number(foe.split('_')[1]) || 1 : 1
  g.beginPath(); g.moveTo(-7, -1); g.quadraticCurveTo(-9, -16, 0, -17 - n); g.quadraticCurveTo(9, -16, 7, -1); g.closePath(); blob(g, W(st.body))
  g.fillStyle = W('#fff'); for (const ex of [-2.2, 2.6]) { g.beginPath(); g.ellipse(ex, -10, 1.6, 2, 0, 0, TAU); g.fill() }
  g.fillStyle = W(INK); for (const ex of [-1.8, 3]) { g.beginPath(); g.arc(ex, -9.6, 0.8, 0, TAU); g.fill() }
  g.strokeStyle = W(INK); g.lineWidth = 0.6; g.beginPath(); g.arc(0.4, -6.5, 1.2, 0.2, Math.PI - 0.2); g.stroke()
  g.fillStyle = W(st.trim); if (n === 1) { g.fillRect(-3, -19, 6, 2) } else if (n === 2) { star(g, 0, -19.5, 2.4, 1) } else { g.beginPath(); g.arc(0, -19.5, 1.6, 0, TAU); g.fill() }
  const a = P.aF; limb(g, 6, -8, 6 + Math.sin(a) * 4, -8 + Math.cos(a) * 4, 1.5, W(st.body))
}

// ---------- 武器 ----------
// 每把武器按 fx 画专属造型；没有专属的按类别画
function drawHeld(g, who, ang, hand, W, outfit, t, layer) {
  const kind = who.kind, fx = who.fx || (who.weapon ? null : null), gold = outfit?.weapon ? OUTFIT_COLORS[outfit.weapon] : null
  if (!kind) return
  const front = kind === 'fist' || kind === 'fan' || kind === 'dart'
  if ((layer === 'front') !== front) return
  g.save(); g.translate(hand[0], hand[1]); g.rotate(front ? ang * 0.4 + 0.5 : ang) // 扇 / 暗器 / 拳套握在手里，不挡脸
  weaponShape(g, kind, fx, W, t, gold, 1)
  g.restore()
}
export function weaponShape(g, kind, fx, W = (c) => c, t = 0, gold = null, scale = 1) {
  g.save(); g.scale(scale, scale); g.lineWidth = 0.6; g.strokeStyle = INK
  const metal = gold || '#dfe6ee'
  const outline = () => { g.lineWidth = 0.6; g.strokeStyle = INK; g.stroke() }
  switch (kind) {
    case 'sword': {
      const blade = fx === 'light' ? '#ffffff' : fx === 'whale' ? '#3a7ae0' : metal
      if (fx === 'light' || fx === 'code') { g.fillStyle = fx === 'light' ? 'rgba(255,255,255,.35)' : 'rgba(125,255,176,.3)'; g.beginPath(); g.roundRect(1, -2, 16, 4, 2); g.fill() }
      g.beginPath(); g.moveTo(2, -0.9); g.lineTo(15, -0.7); g.lineTo(17, 0); g.lineTo(15, 0.7); g.lineTo(2, 0.9); g.closePath(); g.fillStyle = W(blade); g.fill(); outline()
      if (fx === 'code') { g.fillStyle = '#2aa860'; for (let i = 0; i < 4; i++) g.fillRect(4 + i * 2.6, -0.25, 1.4, 0.5) }
      if (fx === 'whale') { g.fillStyle = '#9adfff'; g.beginPath(); g.moveTo(-1, 0); g.lineTo(-3, -2); g.lineTo(-2.4, 0); g.lineTo(-3, 2); g.fill() }
      g.fillStyle = W(fx === 'code' ? '#2aa860' : '#8a6a30'); g.fillRect(0.6, -2, 1.2, 4)
      g.fillStyle = W('#5a3a22'); g.fillRect(-2.2, -0.6, 2.8, 1.2)
      break
    }
    case 'blade': {
      if (fx === 'rgb') {
        g.beginPath(); g.roundRect(1, -2.6, 14, 5.2, 1); g.fillStyle = W('#3a3a44'); g.fill(); outline()
        for (const fxp of [5, 10.5]) { g.fillStyle = W('#22222a'); g.beginPath(); g.arc(fxp, 0, 1.9, 0, TAU); g.fill(); g.save(); g.translate(fxp, 0); g.rotate(t * 12); g.fillStyle = '#9aa'; for (let i = 0; i < 3; i++) { g.rotate(TAU / 3); g.fillRect(0, -0.25, 1.6, 0.5) } g.restore() }
        const hue = (t * 120) % 360; g.fillStyle = hsl(hue, 90, 60); g.fillRect(1, -2.8, 14, 0.7); g.fillStyle = hsl(hue + 120, 90, 60); g.fillRect(1, 2.1, 14, 0.7)
      } else { g.beginPath(); g.moveTo(2, -1.2); g.quadraticCurveTo(10, -3, 15, -2.6); g.lineTo(13, 1.4); g.quadraticCurveTo(8, 1.6, 2, 1.2); g.closePath(); g.fillStyle = W(metal); g.fill(); outline() }
      g.fillStyle = W('#5a3a22'); g.fillRect(-2.5, -0.7, 3.5, 1.4)
      break
    }
    case 'spear': {
      if (fx === 'cable') { g.strokeStyle = W('#4a8ad0'); g.lineWidth = 1.1; g.beginPath(); g.moveTo(-6, 0); for (let i = -6; i <= 14; i += 2) g.lineTo(i, Math.sin(i * 0.9 + t * 4) * 0.4); g.stroke(); g.beginPath(); g.roundRect(14, -1.3, 4, 2.6, 0.4); g.fillStyle = W('#d8f0ff'); g.fill(); outline(); g.fillStyle = '#e0b030'; for (let i = 0; i < 3; i++) g.fillRect(16.6, -0.9 + i * 0.7, 1, 0.4) }
      else { g.strokeStyle = W('#7a5230'); g.lineWidth = 1; g.beginPath(); g.moveTo(-6, 0); g.lineTo(15, 0); g.stroke(); g.beginPath(); g.moveTo(15, -1.6); g.lineTo(19.5, 0); g.lineTo(15, 1.6); g.closePath(); g.fillStyle = W(metal); g.fill(); outline()
        g.fillStyle = W(fx === 'question' ? '#8a5ad0' : '#c8383a'); g.beginPath(); g.moveTo(14.5, 0); g.lineTo(12, -1.8); g.lineTo(12.5, 1.8); g.fill()
        if (fx === 'question') { g.strokeStyle = '#b48aff'; g.lineWidth = 0.7; g.beginPath(); g.arc(18, -2.6, 1.2, Math.PI, 0.6); g.stroke() } }
      break
    }
    case 'staff': {
      g.strokeStyle = W(fx === 'wool' ? '#e8dcc0' : fx === 'seal' ? '#7a4a2a' : fx === 'flash' ? '#3a3a40' : '#8a5a34'); g.lineWidth = fx === 'wool' ? 1.8 : 1.2; g.beginPath(); g.moveTo(-5, 0); g.lineTo(14, 0); g.stroke()
      if (fx === 'flash') { g.beginPath(); g.roundRect(13, -2.8, 3, 5.6, 0.6); g.fillStyle = W('#1e1e24'); g.fill(); outline(); g.strokeStyle = 'rgba(255,255,220,.95)'; g.lineWidth = 0.6; g.beginPath(); g.arc(17.2, 0, 1.6, 0, TAU); g.stroke() }
      if (fx === 'wool') { g.beginPath(); g.arc(15.5, 0, 2.6, 0, TAU); g.fillStyle = W('#fff3dc'); g.fill(); outline(); g.beginPath(); g.ellipse(17.5, -2.4, 0.7, 1.4, 0.3, 0, TAU); g.fill(); g.fillStyle = INK; g.fillRect(16.4, -0.6, 0.5, 0.5) }
      if (fx === 'seal') { g.beginPath(); g.roundRect(13, -3.2, 5, 6.4, 0.8); g.fillStyle = W('#ffcf4a'); g.fill(); outline(); g.fillStyle = '#d0283a'; g.fillRect(17.4, -2.4, 0.8, 4.8) }
      break
    }
    case 'fan': {
      const c1 = fx === 'twin' ? '#8fa8ff' : fx === 'pages' ? '#f6ecd0' : '#f2ead6'
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 7, -2.2, -0.6); g.closePath(); g.fillStyle = W(c1); g.fill(); outline()
      g.strokeStyle = 'rgba(42,29,22,.55)'; g.lineWidth = 0.3; for (let i = 0; i < 5; i++) { const a = -2.2 + i * 0.4; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); g.stroke() }
      if (fx === 'pages') { g.fillStyle = INK; for (let i = 0; i < 3; i++) g.fillRect(2 + i * 1.3, -5 + i * 0.4, 0.4, 1.8) }
      if (fx === 'twin') { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 6, -0.6, 0.9); g.closePath(); g.fillStyle = W('#c9a0ff'); g.fill(); outline() }
      break
    }
    case 'dart': {
      if (fx === 'emoji') { g.beginPath(); g.arc(1.5, -0.5, 2, 0, TAU); g.fillStyle = W('#ffd84a'); g.fill(); outline(); g.fillStyle = INK; g.fillRect(0.6, -1.2, 0.5, 0.5); g.fillRect(2, -1.2, 0.5, 0.5); g.beginPath(); g.arc(1.5, 0, 0.8, 0.2, Math.PI - 0.2); g.strokeStyle = INK; g.lineWidth = 0.3; g.stroke() }
      else if (fx === 'moon') { g.beginPath(); g.arc(1.5, 0, 2.2, 0.8, Math.PI * 1.6); g.arc(2.4, -0.4, 1.6, Math.PI * 1.6, 0.8, true); g.fillStyle = W('#e8e4ff'); g.fill(); outline() }
      else { g.fillStyle = W(metal); star(g, 1.5, 0, 2.2, 0.8, 4); g.strokeStyle = INK; g.lineWidth = 0.3; g.stroke() }
      break
    }
    case 'fist': {
      const c = fx === 'rocket' ? '#c8c8d0' : fx === 'taiji' ? '#f2f2f2' : fx === 'keycap' ? '#3a3a44' : '#8a5a3a'
      g.beginPath(); g.roundRect(-1.8, -2, 4, 4, 1); g.fillStyle = W(gold || c); g.fill(); outline()
      if (fx === 'keycap') { const cols = ['#ff7aa8', '#7ad0ff', '#ffd84a', '#8be06a']; for (let i = 0; i < 4; i++) { g.fillStyle = cols[i]; g.fillRect(-1.4 + (i % 2) * 1.8, -1.6 + Math.floor(i / 2) * 1.8, 1.4, 1.4) } }
      if (fx === 'rocket') { g.fillStyle = '#e8452c'; g.fillRect(-3.6, -1, 1.8, 2); g.fillStyle = 'rgba(255,170,60,.9)'; g.beginPath(); g.moveTo(-3.6, -0.8); g.lineTo(-6 - Math.sin(t * 30) * 1.2, 0); g.lineTo(-3.6, 0.8); g.fill() }
      if (fx === 'taiji') taijiDisc(g, 0.2, 0, 1.4, t * 2)
      break
    }
  }
  g.restore()
}
// 图标：武器 16×16
export function drawWeaponIcon(g, kind, x, y, s = 1, color, fx) {
  g.save(); g.translate(x + 8 * s, y + 8 * s); g.rotate(kind === 'fist' || kind === 'dart' || kind === 'fan' ? 0 : -0.75)
  const sc = kind === 'fist' || kind === 'dart' ? 2.2 * s : kind === 'fan' ? 1.5 * s : 0.62 * s
  g.translate(kind === 'fist' || kind === 'dart' ? 0 : kind === 'fan' ? 0 : -6 * s, kind === 'fan' ? 4 * s : 0)
  g.lineJoin = 'round'; g.lineCap = 'round'
  weaponShape(g, kind || 'fist', fx, (c) => c, 0, color && color !== KIND_COLOR[kind] ? color : null, sc)
  g.restore()
}
// 卡的图标：从卡的效果推出来
export function cardIconKind(c) {
  if (!c) return 'scroll'
  if (c.dmg) return 'bolt'
  if (c.heal) return 'potion'
  if (c.lastStand) return 'flame'
  if (c.shield) return 'shield'
  if (c.mp) return 'orb'
  if (c.nextSkill) return 'scroll'
  if (c.bleed) return 'drop'
  if (c.reflect) return 'mirror'
  if (c.immune) return 'lock'
  if (c.gauge) return 'arrow'
  if (c.debuff) return 'skull'
  const st = c.buffs?.[0]?.stat
  return st === 'atk' ? 'sword' : st === 'def' ? 'wall' : st === 'spd' ? 'wind' : st === 'crit' ? 'star' : st === 'dodge' ? 'cloud' : 'scroll'
}
// 通用图标 16×16（毛笔描边 + 平涂）
export function drawIcon(g, kind, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s); g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 0.9; g.strokeStyle = INK
  const fillStroke = (c) => { g.fillStyle = c; g.fill(); g.stroke() }
  switch (kind) {
    case 'bolt': g.beginPath(); g.moveTo(9.5, 1); g.lineTo(4, 9); g.lineTo(8, 9); g.lineTo(6, 15); g.lineTo(12.5, 6.5); g.lineTo(8.5, 6.5); g.closePath(); fillStroke('#ffd84a'); break
    case 'potion': g.beginPath(); g.moveTo(6.5, 2); g.lineTo(9.5, 2); g.lineTo(9.5, 5.5); g.quadraticCurveTo(14, 8, 12.5, 12.5); g.quadraticCurveTo(8, 15.5, 3.5, 12.5); g.quadraticCurveTo(2, 8, 6.5, 5.5); g.closePath(); fillStroke('#e8452c'); g.fillStyle = '#fff'; g.fillRect(7.2, 8, 1.6, 4); g.fillRect(6, 9.2, 4, 1.6); break
    case 'flame': g.beginPath(); g.moveTo(8, 1.5); g.quadraticCurveTo(14, 7, 12, 11.5); g.quadraticCurveTo(8, 16, 4, 11.5); g.quadraticCurveTo(2.5, 7.5, 6, 5.5); g.quadraticCurveTo(6.5, 8, 8, 8); g.quadraticCurveTo(9, 5, 8, 1.5); fillStroke('#ff8a3a'); break
    case 'shield': g.beginPath(); g.moveTo(8, 1.5); g.lineTo(13.5, 3.5); g.quadraticCurveTo(13.5, 11, 8, 14.5); g.quadraticCurveTo(2.5, 11, 2.5, 3.5); g.closePath(); fillStroke('#5aa0e8'); g.fillStyle = '#d0ecff'; g.fillRect(7.3, 4, 1.4, 8); break
    case 'orb': g.beginPath(); g.arc(8, 8, 5.5, 0, TAU); fillStroke('#4a8ae8'); g.fillStyle = '#d0ecff'; g.beginPath(); g.arc(6.3, 6.3, 1.6, 0, TAU); g.fill(); break
    case 'scroll': g.beginPath(); g.roundRect(3, 3.5, 10, 9, 1); fillStroke('#f0e2b8'); g.fillStyle = '#a8743a'; g.fillRect(2, 2.5, 12, 2); g.fillRect(2, 11.5, 12, 2); g.fillStyle = INK; g.fillRect(5, 6.5, 6, 0.8); g.fillRect(5, 8.6, 4, 0.8); break
    case 'drop': g.beginPath(); g.moveTo(8, 2); g.quadraticCurveTo(13.5, 9, 11.5, 12); g.quadraticCurveTo(8, 15.5, 4.5, 12); g.quadraticCurveTo(2.5, 9, 8, 2); fillStroke('#c0302a'); break
    case 'mirror': g.beginPath(); g.ellipse(8, 6.5, 4.5, 5, 0, 0, TAU); fillStroke('#9ad1ff'); g.fillStyle = '#7a5230'; g.fillRect(7.2, 11.5, 1.6, 3.5); break
    case 'lock': g.beginPath(); g.arc(8, 6.5, 3.2, Math.PI, 0); g.lineWidth = 1.6; g.stroke(); g.lineWidth = 0.9; g.beginPath(); g.roundRect(3.5, 6.5, 9, 7.5, 1.2); fillStroke('#e8c04a'); break
    case 'arrow': g.beginPath(); g.moveTo(2, 6.5); g.lineTo(9, 6.5); g.lineTo(9, 3.5); g.lineTo(14.5, 8); g.lineTo(9, 12.5); g.lineTo(9, 9.5); g.lineTo(2, 9.5); g.closePath(); fillStroke('#6fe08a'); break
    case 'skull': g.beginPath(); g.arc(8, 7, 5, Math.PI * 0.9, Math.PI * 0.1); g.lineTo(11, 13); g.lineTo(5, 13); g.closePath(); fillStroke('#c49cff'); g.fillStyle = INK; g.beginPath(); g.arc(6, 7.5, 1.2, 0, TAU); g.arc(10, 7.5, 1.2, 0, TAU); g.fill(); break
    case 'sword': g.save(); g.translate(8, 8); g.rotate(-0.78); g.translate(-7, 0); weaponShape(g, 'sword', null, (c) => c, 0, '#ff7a5a', 0.8); g.restore(); break
    case 'wall': for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 3; c2++) { g.beginPath(); g.roundRect(1.5 + c2 * 4.5 + (r % 2) * 2, 2.5 + r * 3, 4, 2.6, 0.5); fillStroke('#c9a87a') } break
    case 'wind': g.lineWidth = 1.4; g.strokeStyle = '#7ab8e8'; for (const [y, l] of [[4.5, 9], [8, 12], [11.5, 7]]) { g.beginPath(); g.moveTo(2, y); g.lineTo(2 + l, y); g.arc(2 + l, y - 1.5, 1.5, Math.PI / 2, -Math.PI / 2, true); g.stroke() } break
    case 'star': g.fillStyle = '#ffd84a'; star(g, 8, 8.5, 6.5, 2.8); g.stroke(); break
    case 'cloud': g.beginPath(); g.arc(5.5, 9.5, 3, Math.PI / 2, Math.PI * 1.5); g.arc(8.5, 6.5, 3.5, Math.PI, 0); g.arc(11.5, 9.5, 3, -Math.PI / 2, Math.PI / 2); g.closePath(); fillStroke('#ffffff'); break
    case 'chest': g.beginPath(); g.roundRect(2, 6, 12, 8, 1); fillStroke('#a8743a'); g.beginPath(); g.roundRect(2, 3, 12, 4, 2); fillStroke('#8a5a2a'); g.fillStyle = '#e8c04a'; g.fillRect(7, 6.5, 2, 3); break
    case 'think': g.beginPath(); g.ellipse(9, 7, 5.5, 4.5, 0, 0, TAU); fillStroke('#ffffff'); g.beginPath(); g.arc(4, 12.5, 1.4, 0, TAU); fillStroke('#ffffff'); g.fillStyle = '#ffd84a'; g.beginPath(); g.arc(9, 6.5, 2, 0, TAU); g.fill(); break
  }
  g.restore()
}

// ---------- 战斗舞台 ----------
// 吃服务端事件，每条返回建议停留的毫秒数（1× 速度）；画面时钟按真实时间推进
const MELEE = new Set(['basic', 'slash', 'thrust', 'smash', 'palm', 'kick', 'slash3', 'sheath', 'cleave', 'spin', 'dragon', 'leapsmash', 'punch', 'combo', 'sweep', 'rocket', 'repeat', 'pages'])
const RANGED = new Set(['throw', 'volley', 'pin', 'windblade', 'vortex', 'spearrain', 'moe', 'beans', 'qrain', 'tags', 'light', 'moon', 'twin', 'multi', 'scroll', 'stamp', 'taiji', 'alpaca', 'bun', 'whale', 'tariff'])
const CASTS = new Set(['qi', 'firewall', 'windmill', 'think', 'chat', 'guard', 'heal'])
export function createStage({ W = 384, H = 216, scene, sides, cards, weapons }) {
  const hz = horizonOf(H), floor = hz + 34
  const F = sides.map((s, i) => ({
    ...s, fx: weapons?.get(s.weapon)?.fx ?? null, side: i, home: i === 0 ? W * 0.3 : W * 0.7, x: i === 0 ? -30 : W + 30, y: floor, lift: 0, pose: 'idle', flash: 0, knock: 0,
    stun: false, bleed: 0, shield: 0, ko: null, ghost: [], dash: null, back: false, bulb: 0, twin: 0,
  }))
  const parts = [], fx = [], texts = []
  let shake = 0, stop = 0, dark = 0, whiteFlash = 0, last = null, clock = 0, banner = null, cardFly = null, confetti = false
  const cam = { z: 1, x: W / 2, y: H / 2, tz: 1, tx: W / 2, ty: H / 2, until: 0 }
  const scale = (f) => (f.boss ? 3.3 : 3)
  const now = () => clock
  const timers = []
  const later = (fn, ms) => timers.push({ at: now() + ms, fn })
  const add = (o) => fx.push({ born: now(), delay: 0, ...o })
  const P = (o) => parts.push({ vx: 0, vy: 0, grav: 0.03, size: 2, rot: 0, vr: 0, kind: 'dot', ...o, max: o.life })
  const burst = (x, y, n, color, sp = 1.5, life = 500, size = 2, grav = 0.03, kind = 'dot') => { for (let i = 0; i < n; i++) { const a = rand(0, TAU), v = rand(0.3, sp); P({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.4, life, color, size, grav, kind, rot: rand(0, TAU), vr: rand(-0.2, 0.2) }) } }
  const ink = (x, y, n, color, sp = 2) => { burst(x, y, n, INK, sp, 600, 2.4, 0.07, 'drop'); burst(x, y, Math.ceil(n / 2), color, sp * 0.8, 500, 2, 0.05, 'drop') }
  const float = (f, txt, color, big = false) => texts.push({ x: f.x + rand(-8, 8), y: f.y - 100 - texts.filter((t) => t.f === f && now() - t.born < 300).length * 13, txt, color, big, born: now(), f })
  const chest = (f) => ({ x: f.x, y: f.y - f.lift - 14 * scale(f) })
  const zoom = (x, y, z, ms) => { cam.tx = x; cam.ty = y; cam.tz = z; cam.until = now() + ms }
  const fxColor = (f) => FX_COLOR[f.fx] || KIND_COLOR[f.kind] || '#ffffff'
  F.forEach((f) => { f.dash = { from: f.x, to: f.home, t0: 0, dur: 420 } })

  // 武器专属的命中点缀（括号、表情、键帽、书页、问号、毛绒、单据……）
  function weaponFlair(att, c, crit) {
    const n = crit ? 6 : 3
    switch (att.fx) {
      case 'code': for (let i = 0; i < n; i++) P({ x: c.x, y: c.y, vx: rand(-1.4, 1.4), vy: rand(-2, -0.4), life: 600, color: '#7dffb0', kind: 'glyph', ch: ['{', '}', '<>', ';'][i % 4], size: 7, grav: 0.04 }); break
      case 'emoji': for (let i = 0; i < n; i++) P({ x: c.x, y: c.y, vx: rand(-1.2, 1.2), vy: rand(-2, -0.6), life: 700, color: '#ffd84a', kind: 'emoji', size: 4, grav: 0.05, mood: i % 3 }); break
      case 'keycap': for (let i = 0; i < n + 2; i++) P({ x: c.x, y: c.y, vx: rand(-1.8, 1.8), vy: rand(-2.4, -0.6), life: 700, color: ['#ff7aa8', '#7ad0ff', '#ffd84a', '#8be06a'][i % 4], kind: 'key', ch: 'QWERASDF'[i % 8], size: 4, grav: 0.08, vr: rand(-0.3, 0.3) }); break
      case 'pages': for (let i = 0; i < n; i++) P({ x: c.x, y: c.y, vx: rand(-1, 1), vy: rand(-1.4, -0.2), life: 900, color: '#f6ecd0', kind: 'page', size: 5, grav: 0.01, vr: rand(-0.15, 0.15) }); break
      case 'question': for (let i = 0; i < n; i++) P({ x: c.x, y: c.y, vx: rand(-1, 1), vy: rand(-1.8, -0.5), life: 700, color: '#b48aff', kind: 'glyph', ch: '?', size: 9, grav: 0.02 }); break
      case 'wool': burst(c.x, c.y, n * 3, '#fff3dc', 1.4, 800, 3.5, 0.005); break
      case 'rocket': burst(c.x, c.y, n * 3, '#ff8a3a', 2.2, 400, 2.5, -0.02); break
      case 'flash': whiteFlash = Math.max(whiteFlash, 60); add({ type: 'ring', x: c.x, y: c.y, r: 6, grow: 50, dur: 220, color: '#ffffff', w: 4 }); break
      case 'seal': add({ type: 'seal', x: c.x, y: c.y + 6, dur: 900 }); for (let i = 0; i < n; i++) P({ x: c.x, y: c.y, vx: rand(-1.5, 1.5), vy: rand(-2, -0.5), life: 900, color: '#ffffff', kind: 'page', size: 5, grav: 0.02, vr: rand(-0.2, 0.2) }); break
      case 'rgb': for (let i = 0; i < 12; i++) P({ x: c.x, y: c.y, vx: rand(-2, 2), vy: rand(-2, 0.5), life: 500, color: hsl(i * 30, 90, 60), size: 2.5, grav: 0.02 }); break
      case 'twin': add({ type: 'xcross', x: c.x, y: c.y, dur: 260, c1: '#8fa8ff', c2: '#c9a0ff' }); break
      case 'moon': add({ type: 'crescent', x: c.x, y: c.y, r: 16, dur: 260, color: '#d8d4ff' }); break
      case 'light': for (let i = 0; i < 5; i++) add({ type: 'ray', x: c.x, y: c.y, a: -0.9 + i * 0.45, len: 40, dur: 220, color: '#ffffff' }); break
      case 'taiji': add({ type: 'taiji', x: c.x, y: c.y, r: 9, dur: 400 }); break
      case 'cable': add({ type: 'zap', x1: chest(att).x, y1: c.y, x2: c.x, y2: c.y, dur: 160, color: '#5ac8ff' }); break
      case 'whale': if (crit) add({ type: 'whaleSil', x: c.x, y: floor, dur: 700, small: true }); break
    }
  }

  // 命中特效：先看招式专属，再按武器类别兜底
  function hitFx(att, tgt, e) {
    const anim = last?.a || 'basic', big = !!last?.big, crit = !!e.c, kind = att?.kind || 'fist'
    const c = chest(tgt), dir = tgt.side === 1 ? 1 : -1, col = crit ? '#ffd84a' : fxColor(att)
    const brush = (r, w, dur, color = col) => add({ type: 'brush', x: c.x, y: c.y, r, w, dir, dur, color })
    switch (anim) {
      case 'slash3': add({ type: 'brush', x: c.x, y: c.y - 6 + (e.h % 3) * 6, r: 26, w: 3, dir: dir * (e.h % 2 ? -1 : 1), dur: 200, color: col }); break
      case 'sheath': for (let i = 0; i < 3; i++) add({ type: 'brush', x: c.x, y: c.y, r: 30, w: 3, dir, rot: -0.8 + i * 0.8, dur: 260, delay: i * 30, color: col }); add({ type: 'ring', x: c.x, y: c.y, r: 6, grow: 40, dur: 300, color: '#ffffff', w: 3 }); break
      case 'cleave': brush(46, 10, 320, crit ? '#ffd84a' : '#ff8a3a'); add({ type: 'crack', x: tgt.x, y: floor, dur: 900 }); burst(c.x, c.y, 16, '#ffb060', 2.4, 500, 2.5, 0.06); shake = Math.max(shake, 8); break
      case 'spin': add({ type: 'ring', x: chest(att).x, y: c.y, r: 18, grow: 18, dur: 260, color: col, w: 5 }); brush(30, 5, 220); break
      case 'dragon': add({ type: 'beam', x1: chest(att).x, y: c.y, x2: c.x + 80 * dir, dur: 260, color: col }); add({ type: 'ring', x: c.x + 30 * dir, y: c.y, r: 6, grow: 34, dur: 300, color: '#ffffff', w: 3 }); tgt.knock += 10 * dir; break
      case 'leapsmash': add({ type: 'ring', x: tgt.x, y: floor, r: 8, grow: 78, dur: 380, color: '#ffe9a8', w: 4, flat: true }); add({ type: 'pillar', x: tgt.x, y: floor, dur: 220, color: '#fff6d0' }); burst(tgt.x, floor - 2, 18, '#8a7a64', 2.6, 700, 3, 0.1, 'rock'); tgt.lift = 18; shake = Math.max(shake, 7); break
      case 'windblade': case 'vortex': if (anim === 'vortex') { add({ type: 'spiral', x: c.x, y: c.y, dur: 520, color: col }); tgt.lift = 26 } else add({ type: 'crescent', x: c.x, y: c.y, r: 16, dur: 220, color: col }); burst(c.x, c.y, 10, att.fx === 'pages' ? '#f6ecd0' : '#a8e8b0', 1.8, 700, 3, 0.005, att.fx === 'pages' ? 'page' : 'leaf'); break
      case 'combo': add({ type: 'ring', x: c.x, y: c.y, r: 4, grow: 22, dur: 180, color: col, w: 3 }); add({ type: 'fist', x: c.x - 10 * dir, y: c.y + rand(-8, 8), dir, dur: 140 }); if (e.h >= 4) { tgt.lift = 40; add({ type: 'pillar', x: tgt.x, y: floor, dur: 260, color: '#ffb060' }); shake = Math.max(shake, 6) } break
      case 'punch': add({ type: 'ring', x: c.x, y: c.y, r: 4, grow: 30, dur: 220, color: col, w: 4 }); add({ type: 'fist', x: c.x - 10 * dir, y: c.y, dir, dur: 160 }); break
      case 'rocket': add({ type: 'pillar', x: tgt.x, y: floor, dur: 300, color: '#ff8a3a' }); tgt.lift = 46; burst(c.x, c.y, 20, '#ff8a3a', 2.6, 500, 3, -0.02); shake = Math.max(shake, 8); break
      case 'repeat': for (let i = 0; i < 3; i++) add({ type: 'ring', x: c.x, y: c.y, r: 6 + i * 6, grow: 20, dur: 300, delay: i * 50, color: '#e8b04a', w: 2 }); break
      case 'pages': case 'tags': for (let i = 0; i < 12; i++) P({ x: c.x, y: c.y, vx: rand(-2, 2), vy: rand(-2.4, -0.2), life: 900, color: anim === 'tags' ? '#ffe9a8' : '#ffffff', kind: anim === 'tags' ? 'tag' : 'page', size: 5, grav: 0.03, vr: rand(-0.2, 0.2) }); brush(30, 4, 220); break
      case 'qrain': case 'spearrain': add({ type: 'fall', x: c.x + rand(-14, 14), y0: -10, y1: c.y, dur: 160, color: anim === 'qrain' ? '#b48aff' : col, glyph: anim === 'qrain' ? '?' : null }); break
      case 'volley': case 'pin': case 'throw': case 'beans': case 'moe': add({ type: 'proj', from: chest(att), to: { x: c.x + rand(-4, 4), y: c.y + rand(-6, 6) }, dur: 120, color: anim === 'beans' ? '#8be06a' : anim === 'moe' ? hsl(e.h * 90 + 200, 80, 60) : col, kind: anim === 'beans' ? 'bean' : anim === 'moe' ? 'fish' : att.fx === 'emoji' ? 'emoji' : att.fx === 'moon' ? 'moon' : 'star' }); if (anim === 'pin') add({ type: 'pinned', f: tgt, dur: 2400, dy: rand(-10, 4) }); break
      case 'light': add({ type: 'ray', x: c.x, y: c.y, a: -1.2 + (e.h % 7) * 0.4, len: 60, dur: 220, color: '#ffffff' }); break
      case 'moon': add({ type: 'crescent', x: c.x, y: c.y, r: 22, dur: 240, color: '#d8d4ff', rot: e.h * 1.3 }); break
      case 'twin': add({ type: 'xcross', x: c.x, y: c.y, dur: 320, c1: '#8fa8ff', c2: '#c9a0ff' }); break
      case 'multi': { const ks = ['sword', 'spear', 'fan', 'fist'], cs = ['#bfe8ff', '#8fdcff', '#a8f0b8', '#ff7a5a']; add({ type: 'brush', x: c.x, y: c.y, r: 30, w: 5, dir, rot: e.h * 0.9, dur: 240, color: cs[e.h % 4] }); add({ type: 'weaponPop', f: att, kind: ks[e.h % 4], dur: 260 }); break }
      case 'scroll': add({ type: 'ribbon', f: tgt, dur: 1200 }); break
      case 'stamp': add({ type: 'stroke', x: c.x, y: c.y, dur: 600 }); add({ type: 'seal', x: c.x + 12, y: c.y + 10, dur: 1000 }); shake = Math.max(shake, 8); break
      case 'taiji': add({ type: 'taiji', x: c.x, y: c.y, r: 18, dur: 500 }); break
      case 'alpaca': add({ type: 'alpaca', y: floor - 4 - e.h * 3, dir, dur: 520 }); tgt.knock += 8 * dir; break
      case 'bun': add({ type: 'fall', x: c.x + rand(-10, 10), y0: -20, y1: c.y, dur: 220, color: '#fff6e8', bun: true }); tgt.lift = 6; break
      case 'whale': add({ type: 'whaleSil', x: tgt.x, y: floor, dur: 900 }); tgt.lift = 36; burst(tgt.x, floor, 26, '#7fd4ff', 3, 800, 3, 0.08, 'drop'); shake = Math.max(shake, 9); break
      case 'tariff': add({ type: 'stamp', x: tgt.x, y: c.y - 20, dur: 500 }); add({ type: 'seal', x: c.x, y: c.y + 8, dur: 1100 }); for (let i = 0; i < 14; i++) P({ x: c.x, y: c.y - 30, vx: rand(-2.4, 2.4), vy: rand(-2.6, -0.4), life: 1100, color: i % 3 ? '#ffffff' : '#f2f2f2', kind: i % 3 ? 'page' : 'ball', size: i % 3 ? 5 : 2.2, grav: 0.06, vr: rand(-0.2, 0.2) }); shake = Math.max(shake, 8); break
      case 'sweep': add({ type: 'ring', x: tgt.x, y: floor, r: 6, grow: 30, dur: 260, color: '#d8c8a8', w: 3, flat: true }); burst(tgt.x, floor - 2, 10, '#b8a888', 1.4, 500, 2.5, 0.04); break
      default:
        if (kind === 'blade') { brush(40, 8, 260); shake = Math.max(shake, 4) }
        else if (kind === 'spear') add({ type: 'beam', x1: chest(att).x, y: c.y, x2: c.x + 40 * dir, dur: 200, color: col })
        else if (kind === 'staff') { add({ type: 'ring', x: tgt.x, y: floor, r: 6, grow: 44, dur: 300, color: '#ffe9a8', w: 3, flat: true }); shake = Math.max(shake, 4) }
        else if (kind === 'fan') add({ type: 'crescent', x: c.x, y: c.y, r: 14, dur: 200, color: col })
        else if (kind === 'dart') add({ type: 'proj', from: chest(att), to: c, dur: 120, color: col, kind: 'star' })
        else if (kind === 'fist') add({ type: 'ring', x: c.x, y: c.y, r: 4, grow: 24, dur: 200, color: col, w: 3 })
        else brush(26, 4, 200)
    }
    weaponFlair(att, c, crit)
    ink(c.x, c.y, crit ? 14 : 7, col, crit ? 3 : 2)
    add({ type: 'flashdot', x: c.x, y: c.y, dur: 70, r: crit ? 12 : 7 })
    if (crit) { stop = now() + 110; shake = Math.max(shake, big ? 10 : 6); whiteFlash = Math.max(whiteFlash, 70); zoom(c.x, c.y, 1.18, 320) } else stop = Math.max(stop, now() + (big ? 90 : 40))
    if (big) shake = Math.max(shake, 7)
  }

  // 出招前的演出（蓄力、召唤、天降……），返回这一步要等的毫秒
  function windup(f, tgt, e) {
    const a = e.a, c = chest(tgt), dir = tgt.side === 1 ? 1 : -1
    switch (a) {
      case 'cleave': f.pose = 'windup'; burst(f.x, f.y - 50, 12, '#ff8a3a', 1, 500, 2, -0.02); return 380
      case 'leapsmash': f.pose = 'windup'; later(() => { f.jump = { t0: now(), dur: 360, from: f.x, to: tgt.x - 30 * dir }; f.pose = 'win' }, 120); later(() => { f.pose = 'attack' }, 420); f.back = true; return 520
      case 'sheath': return 0
      case 'spearrain': case 'qrain': f.pose = 'cast'; f.jump = { t0: now(), dur: 400, from: f.x, to: f.x, high: 40 }; return 260
      case 'volley': f.pose = 'windup'; f.knock = -dir * 14; return 180
      case 'moe': f.pose = 'cast'; for (let i = 0; i < 4; i++) add({ type: 'fishOrbit', f, i, dur: 520 }); return 420
      case 'beans': f.pose = 'attack'; return 160
      case 'bun': f.pose = 'cast'; return 360
      case 'whale': f.pose = 'cast'; add({ type: 'sea', dur: 1400 }); return 520
      case 'moon': dark = 1.4; f.pose = 'cast'; return 420
      case 'twin': f.twin = 1; add({ type: 'clone', f, x: tgt.x + 40 * dir, dur: 900 }); f.pose = 'attack'; return 360
      case 'multi': f.pose = 'cast'; return 260
      case 'scroll': f.pose = 'cast'; add({ type: 'scrollOut', f, dur: 600 }); return 420
      case 'stamp': f.pose = 'cast'; return 320
      case 'taiji': f.pose = 'cast'; add({ type: 'taiji', x: chest(f).x + 14 * dir, y: chest(f).y, r: 12, dur: 500, grow: true }); return 420
      case 'alpaca': f.pose = 'cast'; return 260
      case 'tariff': f.pose = 'win'; return 360
      case 'tags': case 'vortex': case 'windblade': f.pose = 'attack'; for (let i = 0; i < 3; i++) add({ type: 'wind', x: chest(f).x, y: c.y - 14 + i * 12, to: c.x + 20 * dir, dur: 260, delay: i * 40, color: fxColor(f) }); return 220
      case 'light': f.pose = 'attack'; add({ type: 'ray', x: chest(f).x, y: chest(f).y, a: dir > 0 ? 0 : Math.PI, len: 70, dur: 240, color: '#ffffff' }); return 200
      case 'repeat': for (let i = 1; i <= 2; i++) add({ type: 'clone', f, x: f.x - dir * 18 * i, dur: 700, ghost: true }); return 200
      case 'rocket': f.pose = 'windup'; burst(f.x - dir * 10, f.y - 30, 14, '#ff8a3a', 1.6, 400, 2.5, -0.02); return 220
    }
    return 0
  }

  function run(e) {
    const f = F[e.s]
    if (e.k !== 'hit') for (const x of F) if (x.back && (x.pose === 'attack' || x.pose === 'windup' || x.pose === 'win') && !x.dash && !x.jump && !x.ko) x.pose = 'idle'
    switch (e.k) {
      case 'start':
        F.forEach((x) => { x.max = e.max[x.side]; x.hp = e.hp[x.side] })
        later(() => F.forEach((x) => { x.pose = 'windup'; add({ type: 'weapon', f: x, dur: 800 }); burst(chest(x).x, chest(x).y - 30, 10, fxColor(x), 1.2, 500) }), 430)
        later(() => F.forEach((x) => { x.pose = 'idle' }), 1050)
        return 1200
      case 'act': {
        last = { s: e.s, a: e.a, big: !!e.big }
        const tgt = F[1 - e.s], dir = tgt.side === 1 ? 1 : -1
        let pre = 0
        if (e.big) { dark = 1.2; banner = { txt: e.n, side: e.s, born: now(), role: f.look?.role, foe: f.look?.foe }; f.pose = 'cast'; burst(f.x, f.y - 40, 24, fxColor(f), 2, 600); zoom(f.x, f.y - 40, 1.12, 700); pre = 620 }
        const w = windup(f, tgt, e)
        pre += w
        if (e.a === 'think') { f.pose = 'sit'; f.bulb = 2; add({ type: 'bubble', f, dur: 900 }); later(() => { f.pose = 'idle' }, 800); return pre + 820 }
        if (e.a === 'chat') { f.pose = 'win'; for (let i = 0; i < 4; i++) add({ type: 'speech', f, i, dur: 900, delay: i * 120 }); later(() => { f.pose = 'idle' }, 700); return pre + 700 }
        if (e.a === 'qi') { f.pose = 'sit'; for (let i = 0; i < 18; i++) { const a = rand(0, TAU); P({ x: f.x + Math.cos(a) * 44, y: f.y - 40 + Math.sin(a) * 30, tx: f.x, ty: f.y - 36, life: 520, color: '#9ad1ff', size: 2, home: true }) } later(() => { f.pose = 'idle' }, 520); return pre + 520 }
        if (e.a === 'firewall' || e.a === 'guard') { f.pose = 'cast'; add({ type: 'firewall', f, dur: 700 }); later(() => { f.pose = 'idle' }, 420); return pre + 420 }
        if (e.a === 'windmill') { f.pose = 'cast'; add({ type: 'windmill', f, dur: 600 }); later(() => { f.pose = 'idle' }, 500); return pre + 480 }
        if (e.a === 'heal') { f.pose = 'cast'; later(() => { f.pose = 'idle' }, 420); return pre + 380 }
        if (MELEE.has(e.a) || (!RANGED.has(e.a) && !CASTS.has(e.a) && (f.kind === 'sword' || f.kind === 'blade' || f.kind === 'spear' || f.kind === 'staff' || f.kind === 'fist' || !f.kind))) {
          if (e.a === 'leapsmash') return pre
          const gap = e.a === 'dragon' ? 110 : 76
          const to = tgt.x - dir * gap
          if (!f.pose || f.pose === 'idle') f.pose = 'windup'
          later(() => { f.dash = { from: f.x, to, t0: now(), dur: e.a === 'dragon' || e.a === 'rocket' ? 90 : 130 }; f.pose = 'attack'; f.ghost = [] }, pre + 90)
          f.back = true
          return pre + 250
        }
        if (f.pose === 'idle' || !f.pose) f.pose = 'attack'
        later(() => { if (f.pose === 'attack' || f.pose === 'cast' || f.pose === 'windup') f.pose = 'idle' }, pre + 320)
        return pre + 220
      }
      case 'hit': {
        const att = e.card ? F[1 - e.s] : F[last?.s ?? 1 - e.s]
        f.hp = e.hp
        const travel = !e.card && (['volley', 'pin', 'throw', 'beans', 'moe', 'qrain', 'spearrain', 'bun'].includes(last?.a) || (att.kind === 'dart' && !MELEE.has(last?.a))) ? 130 : 0
        if (e.card) add({ type: 'bolt', x: f.x, y: f.y, dur: 280 })
        else hitFx(att, f, e)
        later(() => {
          f.flash = now() + 90; if (!f.ko) f.pose = 'hit'; f.knock += (f.side === 0 ? -1 : 1) * (e.c ? 14 : 7)
          float(f, String(e.d), e.c ? '#ffd84a' : '#ffffff', !!e.c)
          if (e.sh) { f.shield = Math.max(0, f.shield - e.sh); add({ type: 'bubblePop', f, dur: 220 }) }
          later(() => { if (f.hp > 0 && f.pose === 'hit') f.pose = 'idle' }, 240)
        }, travel)
        return (e.h > 0 ? 140 : 230) + travel
      }
      case 'miss':
        f.ghost = [{ x: f.x, born: now() }]; f.knock += (f.side === 0 ? -1 : 1) * 20; f.pose = 'dodge'
        add({ type: 'streak', x: chest(F[1 - e.s]).x, y: chest(f).y, len: 50, dir: f.side === 1 ? 1 : -1, dur: 160, color: 'rgba(255,255,255,.7)' })
        later(() => { f.pose = 'idle' }, 300); float(f, '闪', '#cfe8ff')
        return 320
      case 'heal': f.hp = e.hp; for (let i = 0; i < 14; i++) P({ x: f.x + rand(-14, 14), y: f.y - rand(0, 34), vy: -rand(0.4, 1), life: 700, color: i % 2 ? '#6fe08a' : '#c8f0a0', size: 2.4, grav: 0, kind: 'leaf', vr: rand(-0.1, 0.1) }); float(f, '+' + e.v, '#6fe08a'); return 260
      case 'shield': f.shield = e.v; add({ type: 'bubbleUp', f, dur: 300 }); return 220
      case 'buff': for (let i = 0; i < 6; i++) add({ type: 'up', x: f.x + rand(-14, 14), y: f.y - rand(10, 60), delay: i * 40, dur: 520, color: '#ffd27a' }); return 200
      case 'debuff': for (let i = 0; i < 12; i++) P({ x: f.x + rand(-12, 12), y: f.y - rand(20, 76), vx: rand(-0.2, 0.2), vy: -0.3, life: 800, color: i % 2 ? '#3a2050' : '#6a3aa0', size: 4, grav: 0, kind: 'smoke' }); return 200
      case 'bleedOn': f.bleed = 3; return 60
      case 'bleed': f.hp = e.hp; f.flash = now() + 60; burst(f.x, f.y - 50, 10, '#c0302a', 0.8, 600, 2.4, 0.09, 'drop'); float(f, String(e.d), '#ff7a6a'); if (--f.bleed <= 0) f.bleed = 0; return 280
      case 'reflect': f.hp = e.hp; add({ type: 'ring', x: chest(f).x, y: chest(f).y, r: 4, grow: 24, dur: 220, color: '#ff9a5a', w: 3 }); float(f, String(e.d), '#ff9a5a'); return 220
      case 'stun': f.stun = true; return 240
      case 'resist': add({ type: 'bubbleUp', f, dur: 300 }); return 160
      case 'skip': f.stun = false; f.flash = now() + 60; return 420
      case 'trigger': for (let i = 0; i < 22; i++) P({ x: f.x + rand(-16, 16), y: f.y, vy: -rand(0.8, 1.8), life: 800, color: '#ffb04a', size: 3, grav: 0, kind: 'leaf' }); zoom(f.x, f.y - 40, 1.1, 400); return 340
      case 'offer': return 0
      case 'card': cardFly = { id: e.id, side: e.s, born: now(), card: cards?.get(e.id) }; return 800
      case 'end': {
        const w = F[e.w], l = F[1 - e.w]
        if (l.hp <= 0) { l.ko = { vx: (l.side === 0 ? -1 : 1) * 2.4, vy: -3.6, rot: 0 }; shake = 9; stop = now() + 180; whiteFlash = 100; zoom(l.x, l.y - 30, 1.2, 600); ink(chest(l).x, chest(l).y, 20, '#ffffff', 3.4) }
        later(() => { w.pose = 'win'; confetti = true }, 500)
        return 1400
      }
    }
    return 80
  }

  function step(dt) {
    if (dt > 40) { for (let left = dt; left > 0; left -= 40) step(Math.min(40, left)); return }
    if (now() < stop) { clock += dt * 0.08; return }
    clock += dt
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= now()) { const tm = timers[i]; timers.splice(i, 1); tm.fn() }
    for (const f of F) {
      if (f.dash) { const k = Math.min(1, (now() - f.dash.t0) / f.dash.dur); f.x = lerp(f.dash.from, f.dash.to, ease(k)); if (k >= 1) f.dash = null; if (f.pose === 'attack' && (!f.ghost.length || Math.abs(f.ghost.at(-1).x - f.x) > 14)) f.ghost.push({ x: f.x, born: now() }) }
      else if (f.jump) { const k = Math.min(1, (now() - f.jump.t0) / f.jump.dur); f.x = lerp(f.jump.from, f.jump.to, k); f.lift = Math.sin(k * Math.PI) * (f.jump.high ?? 34); if (k >= 1) { f.jump = null; f.lift = 0 } }
      else if (f.back && !['attack', 'windup', 'cast', 'win'].includes(f.pose) && !f.ko) { f.x = lerp(f.x, f.home, 0.18); if (Math.abs(f.x - f.home) < 1) { f.x = f.home; f.back = false } }
      if (f.knock) { f.x += f.knock * 0.35; f.knock *= 0.6; if (Math.abs(f.knock) < 0.5) f.knock = 0 }
      if (!f.jump && f.lift > 0 && !f.ko) { f.liftV = (f.liftV ?? 0) - 0.25 * dt / 16; f.lift = Math.max(0, f.lift + f.liftV * dt / 16 + (f.liftV > -0.1 ? 1.2 : 0)); if (f.lift === 0) { f.liftV = 0; if (Math.abs(f.lastLand ?? 0) < now() - 200) { shake = Math.max(shake, 2); burst(f.x, floor, 6, '#b8a888', 1, 400, 2, 0.04); f.lastLand = now() } } }
      if (f.ko) { const k = f.ko; k.vy += 0.17; f.x += k.vx; f.y = Math.min(floor, f.y + k.vy); k.rot += 0.26; if (f.y >= floor && k.vy > 0) { if (Math.abs(k.vy) > 1) { k.vy = -k.vy * 0.36; k.vx *= 0.5; shake = Math.max(shake, 3); ink(f.x, floor - 4, 6, '#ffffff', 1.4) } else { k.vy = 0; k.vx = 0; k.rot = 0; f.pose = 'ko' } } f.x = Math.max(16, Math.min(W - 16, f.x)) }
      f.ghost = f.ghost.filter((gh) => now() - gh.born < 160)
    }
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue } if (p.home) { p.x = lerp(p.x, p.tx, 0.12); p.y = lerp(p.y, p.ty, 0.12) } else { p.x += p.vx * dt / 16; p.y += p.vy * dt / 16; p.vy += p.grav * dt / 16; p.rot += p.vr * dt / 16 } }
    if (confetti && parts.length < 160) for (let i = 0; i < 3; i++) P({ x: rand(0, W), y: -4, vx: rand(-0.3, 0.3), vy: rand(0.6, 1.2), life: 2400, color: hsl(rand(0, 360), 80, 62), size: 2.4, grav: 0, kind: 'page', vr: rand(-0.2, 0.2) })
    shake *= 0.86; if (shake < 0.3) shake = 0
    dark = Math.max(0, dark - dt / 900)
    whiteFlash = Math.max(0, whiteFlash - dt)
    if (now() > cam.until) { cam.tz = 1; cam.tx = W / 2; cam.ty = H / 2 }
    const k = Math.min(1, dt / 90); cam.z = lerp(cam.z, cam.tz, k); cam.x = lerp(cam.x, cam.tx, k); cam.y = lerp(cam.y, cam.ty, k)
  }

  function draw(g, t) {
    g.save()
    if (cam.z !== 1) { g.translate(W / 2, H / 2); g.scale(cam.z, cam.z); g.translate(-lerp(W / 2, cam.x, (cam.z - 1) / 0.2), -lerp(H / 2, cam.y, (cam.z - 1) / 0.2)) }
    if (shake) g.translate(rand(-shake, shake), rand(-shake, shake) * 0.6)
    drawScene(g, scene, W, H, t)
    if (dark > 0) { g.fillStyle = `rgba(14,10,24,${Math.min(0.7, dark * 0.7)})`; g.fillRect(-40, -40, W + 80, H + 80) }
    for (const e of fx) if (e.under) drawFx(g, e, t)
    for (const e of fx) if (e.flat) drawFx(g, e, t)
    for (const f of F) {
      const S = scale(f), who = { look: f.look, kind: f.kind, fx: f.fx, boss: f.boss }
      for (const gh of f.ghost.slice(-3)) { g.globalAlpha = 0.18 * (1 - (now() - gh.born) / 160); drawFighter(g, who, gh.x, f.y, { pose: f.pose, t, scale: S, flip: f.side === 1, noShadow: true, outfit: f.look?.outfit }); g.globalAlpha = 1 }
      g.save()
      if (f.ko && f.pose !== 'ko') { g.translate(f.x, f.y - 12 * S); g.rotate(f.ko.rot * (f.side === 0 ? -1 : 1)); g.translate(-f.x, -(f.y - 12 * S)) }
      drawFighter(g, who, f.x, f.y - f.lift, { pose: f.ko && f.pose !== 'ko' ? 'hit' : f.pose, t, scale: S, flip: f.side === 1, flash: now() < f.flash, outfit: f.look?.outfit, noShadow: f.lift > 2 })
      if (f.lift > 2) { g.fillStyle = 'rgba(30,20,10,.18)'; g.beginPath(); g.ellipse(f.x, f.y, 8 * S * Math.max(0.4, 1 - f.lift / 80), 2 * S, 0, 0, TAU); g.fill() }
      g.restore()
      if (f.shield > 0) { g.save(); g.globalAlpha = 0.85; g.strokeStyle = '#bfe6ff'; g.lineWidth = 1.4; g.fillStyle = 'rgba(154,209,255,.14)'; g.beginPath(); g.ellipse(f.x, f.y - f.lift - 14 * S, 13 * S, 16 * S, 0, 0, TAU); g.fill(); g.stroke(); g.restore() }
      if (f.stun) for (let i = 0; i < 3; i++) { const a = t * 6 + i * 2.1; g.fillStyle = '#ffd84a'; star(g, f.x + Math.cos(a) * 12, f.y - f.lift - 31 * S + Math.sin(a) * 3, 3, 1.3) }
      if (f.bleed && Math.floor(t * 6) % 2) { g.fillStyle = '#c0302a'; g.beginPath(); g.ellipse(f.x + 6, f.y - f.lift - 10 * S + ((t * 40) % 20), 1.2, 2, 0, 0, TAU); g.fill() }
      if (f.bulb > 0) { g.fillStyle = '#ffd84a'; g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 8); g.beginPath(); g.arc(f.x, f.y - f.lift - 34 * S, 3, 0, TAU); g.fill(); g.globalAlpha = 1 }
    }
    for (const e of fx) if (!e.flat && !e.under) drawFx(g, e, t)
    for (let i = fx.length - 1; i >= 0; i--) if (now() - fx[i].born > fx[i].dur + (fx[i].delay || 0)) fx.splice(i, 1)
    for (const p of parts) drawPart(g, p)
    g.globalAlpha = 1
    for (let i = texts.length - 1; i >= 0; i--) {
      const x = texts[i], age = (now() - x.born) / 850
      if (age > 1) { texts.splice(i, 1); continue }
      const pop = age < 0.15 ? 1 + (0.15 - age) * 4 : 1
      g.globalAlpha = age > 0.7 ? (1 - age) / 0.3 : 1
      pixelText(g, x.txt, x.x, x.y - ease(Math.min(1, age * 2)) * 16, x.color, Math.round((x.big ? 20 : 13) * pop))
      g.globalAlpha = 1
    }
    if (banner && now() - banner.born < 1000) drawBanner(g, t)
    if (cardFly) drawCardFly(g)
    g.restore()
    if (whiteFlash > 0) { g.fillStyle = `rgba(255,255,255,${whiteFlash / 170})`; g.fillRect(0, 0, W, H) }
  }
  // 大招横幅：墨色长条从出招方扫过来，人物半身剪影 + 招式名
  function drawBanner(g, t) {
    const k = (now() - banner.born) / 1000, slide = k < 0.18 ? ease(k / 0.18) : k > 0.82 ? 1 - ease((k - 0.82) / 0.18) : 1
    const y = H * 0.24, bw = W * slide, x0 = banner.side === 0 ? 0 : W - bw
    g.save(); g.beginPath(); g.moveTo(x0, y - 22); g.lineTo(x0 + bw, y - 26); g.lineTo(x0 + bw, y + 22); g.lineTo(x0, y + 26); g.closePath()
    const gr = g.createLinearGradient(0, y - 26, 0, y + 26); gr.addColorStop(0, '#1a120c'); gr.addColorStop(0.5, '#3a1a14'); gr.addColorStop(1, '#1a120c'); g.fillStyle = gr; g.fill(); g.clip()
    const f = F[banner.side]
    drawFighter(g, { look: f.look, kind: f.kind, fx: f.fx, boss: f.boss }, banner.side === 0 ? x0 + bw * 0.22 : x0 + bw * 0.78, y + 70, { pose: 'attack', t, scale: 4.4, flip: banner.side === 1, noShadow: true, outfit: f.look?.outfit })
    g.restore()
    g.strokeStyle = '#d4a24a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, y - 22); g.lineTo(x0 + bw, y - 26); g.moveTo(x0, y + 26); g.lineTo(x0 + bw, y + 22); g.stroke()
    if (slide > 0.6) pixelText(g, banner.txt, banner.side === 0 ? W * 0.62 : W * 0.38, y + 7, '#fff3d0', 20)
  }
  function drawCardFly(g) {
    const k = (now() - cardFly.born) / 780
    const f = F[cardFly.side], r = cardFly.card?.rarity ?? 1, col = ['#c9a06a', '#4aa88a', '#e8b04a'][r - 1]
    if (k > 1) { burst(f.x, f.y - 40, 24, col, 2.2, 650, 3); cardFly = null; return }
    let x, y, sc, rot = 0
    if (k < 0.55) { const q = ease(k / 0.55); x = W / 2; y = lerp(H + 30, H / 2 - 6, q); sc = 1 + q * 0.5; rot = (1 - q) * 0.6 }
    else { const q = ease((k - 0.55) / 0.45); x = lerp(W / 2, f.x, q); y = lerp(H / 2 - 6, f.y - 40, q); sc = 1.5 - q * 1.2; rot = q * 0.8 }
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc, sc)
    g.fillStyle = 'rgba(255,220,140,.25)'; g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill()
    g.beginPath(); g.roundRect(-15, -21, 30, 42, 3); g.fillStyle = '#f6ecd0'; g.fill(); g.lineWidth = 2; g.strokeStyle = col; g.stroke()
    drawIcon(g, cardIconKind(cardFly.card), -8, -12, 1)
    g.restore()
    if (sc > 1.1) pixelText(g, cardFly.card?.name || '', x, y + 42, '#fff3d0', 13)
  }
  function drawPart(g, p) {
    g.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.6))
    g.fillStyle = p.color
    switch (p.kind) {
      case 'drop': g.beginPath(); g.ellipse(p.x, p.y, p.size * 0.7, p.size * 1.1, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, TAU); g.fill(); break
      case 'glyph': g.font = `900 ${p.size}px monospace`; g.textAlign = 'center'; g.fillText(p.ch, p.x, p.y); break
      case 'key': g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.roundRect(-p.size / 2, -p.size / 2, p.size, p.size, 0.8); g.fill(); g.fillStyle = INK; g.font = '900 3px monospace'; g.textAlign = 'center'; g.fillText(p.ch, 0, 1); g.restore(); break
      case 'page': case 'tag': g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size / 2, -p.size * 0.65, p.size, p.size * 1.3); g.fillStyle = 'rgba(42,29,22,.5)'; g.fillRect(-p.size / 3, -p.size * 0.3, p.size * 0.6, 0.5); g.fillRect(-p.size / 3, 0, p.size * 0.5, 0.5); g.restore(); break
      case 'leaf': g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, TAU); g.fill(); g.restore(); break
      case 'rock': g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.moveTo(-p.size, 0); g.lineTo(0, -p.size); g.lineTo(p.size, -0.3); g.lineTo(0.3, p.size); g.closePath(); g.fill(); g.restore(); break
      case 'smoke': g.globalAlpha *= 0.5; g.beginPath(); g.arc(p.x, p.y, p.size * (1.6 - p.life / p.max), 0, TAU); g.fill(); break
      case 'emoji': g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); g.fillStyle = INK; g.fillRect(p.x - p.size * 0.45, p.y - p.size * 0.3, 0.9, 0.9); g.fillRect(p.x + p.size * 0.2, p.y - p.size * 0.3, 0.9, 0.9); g.strokeStyle = INK; g.lineWidth = 0.5; g.beginPath(); p.mood === 1 ? g.arc(p.x, p.y + p.size * 0.6, p.size * 0.35, Math.PI + 0.3, -0.3) : g.arc(p.x, p.y + p.size * 0.1, p.size * 0.4, 0.3, Math.PI - 0.3); g.stroke(); break
      case 'ball': g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); g.strokeStyle = '#aaa'; g.lineWidth = 0.3; g.stroke(); break
      default: g.beginPath(); g.arc(p.x, p.y, p.size * 0.6, 0, TAU); g.fill()
    }
    g.globalAlpha = 1
  }
  function brushPath(g, cx, cy, r, w, a0, a1) {
    const n = 18
    g.beginPath()
    for (let i = 0; i <= n; i++) { const t = i / n, a = lerp(a0, a1, t), ww = w * Math.sin(t * Math.PI) ** 0.7; g.lineTo(cx + Math.cos(a) * (r + ww / 2), cy + Math.sin(a) * (r + ww / 2)) }
    for (let i = n; i >= 0; i--) { const t = i / n, a = lerp(a0, a1, t), ww = w * Math.sin(t * Math.PI) ** 0.7; g.lineTo(cx + Math.cos(a) * (r - ww / 2), cy + Math.sin(a) * (r - ww / 2)) }
    g.closePath()
  }
  function drawFx(g, e, t) {
    const age = now() - e.born - (e.delay || 0)
    if (age < 0) return
    const k = Math.min(1, age / e.dur)
    g.save(); g.globalAlpha = 1 - k * k
    switch (e.type) {
      case 'brush': { const sweep = 2.6 * Math.min(1, 0.5 + k * 2.2), a0 = (e.dir > 0 ? -1.6 : Math.PI - 1.0) + (e.rot || 0); g.translate(e.x - 10 * e.dir, e.y); brushPath(g, 0, 0, e.r, e.w * (1 - k * 0.4) + 2, a0, a0 + sweep * (e.dir > 0 ? 1 : 1)); g.fillStyle = e.color; g.fill(); brushPath(g, 0, 0, e.r, Math.max(1, e.w * 0.35), a0 + 0.2, a0 + sweep - 0.2); g.fillStyle = 'rgba(255,255,255,.85)'; g.fill(); g.globalAlpha *= 0.5; g.strokeStyle = INK; g.lineWidth = 0.6; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, e.r + e.w * 0.6 + i * 1.5, a0 + 0.3 + i * 0.2, a0 + sweep * 0.7); g.stroke() } break }
      case 'streak': g.fillStyle = e.color; g.fillRect(e.x + e.dir * e.len * k, e.y, e.len * (1 - k) * e.dir, 1.5); break
      case 'beam': { const x = lerp(e.x1, e.x2, ease(Math.min(1, k * 1.6))); const gr = g.createLinearGradient(e.x1, 0, x, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, e.color); g.fillStyle = gr; g.beginPath(); g.moveTo(e.x1, e.y - 2); g.lineTo(x, e.y - 6); g.lineTo(x + Math.sign(e.x2 - e.x1) * 10, e.y); g.lineTo(x, e.y + 6); g.lineTo(e.x1, e.y + 2); g.fill(); g.fillStyle = '#fff'; g.fillRect(Math.min(e.x1, x), e.y - 1, Math.abs(x - e.x1), 2); break }
      case 'ring': g.strokeStyle = e.color; g.lineWidth = (e.w || 2) * (1 - k * 0.6); g.beginPath(); const rr = e.r + e.grow * ease(k); e.flat ? g.ellipse(e.x, e.y, rr, rr * 0.28, 0, 0, TAU) : g.arc(e.x, e.y, rr, 0, TAU); g.stroke(); break
      case 'pillar': { const hgt = 140 * (1 - k); const gr = g.createLinearGradient(0, e.y - hgt, 0, e.y); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, e.color); g.fillStyle = gr; g.fillRect(e.x - 9, e.y - hgt, 18, hgt); break }
      case 'flashdot': g.fillStyle = '#fff'; g.beginPath(); g.arc(e.x, e.y, e.r * (1 - k * 0.5), 0, TAU); g.fill(); break
      case 'crack': g.globalAlpha = 1 - k; g.strokeStyle = INK; g.lineWidth = 1.4; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(e.x, e.y); let x = e.x, y = e.y; for (let j = 0; j < 4; j++) { x += i * 6 + rand(-2, 2); y += rand(0, 3); g.lineTo(x, y) } g.stroke() } break
      case 'crescent': g.translate(e.x, e.y); g.rotate(e.rot || 0); g.fillStyle = e.color; g.beginPath(); g.arc(0, 0, e.r * (0.8 + k * 0.4), -1.2, 1.2); g.arc(-e.r * 0.35, 0, e.r * 0.85, 1.1, -1.1, true); g.fill(); break
      case 'spiral': g.translate(e.x, e.y); g.rotate(k * 8); g.strokeStyle = e.color; g.lineWidth = 2.2; g.beginPath(); for (let a = 0; a < 12; a += 0.3) g.lineTo(Math.cos(a) * a * 2, Math.sin(a) * a * 1.4); g.stroke(); break
      case 'wind': { const x = lerp(e.x, e.to, ease(k)), sg = Math.sign(e.to - e.x); g.strokeStyle = e.color; g.lineWidth = 2.6; g.beginPath(); sg > 0 ? g.arc(x, e.y, 14, -1.1, 1.1) : g.arc(x, e.y, 14, Math.PI - 1.1, Math.PI + 1.1); g.stroke(); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - 30 * sg, e.y); g.lineTo(x - 6 * sg, e.y); g.stroke(); break }
      case 'proj': { g.globalAlpha = 1; const x = lerp(e.from.x, e.to.x, k), y = lerp(e.from.y, e.to.y, k) - Math.sin(k * Math.PI) * 16, sg = Math.sign(e.to.x - e.from.x)
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(lerp(e.from.x, x, 0.6), y + 2); g.lineTo(x, y); g.stroke()
        g.translate(x, y); g.rotate(age / 40)
        if (e.kind === 'bean') { g.fillStyle = e.color; g.beginPath(); g.ellipse(0, 0, 3, 2, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.5; g.stroke() }
        else if (e.kind === 'fish') { g.rotate(-age / 40); g.fillStyle = e.color; g.beginPath(); g.ellipse(0, 0, 5, 2.6, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(-4 * sg, 0); g.lineTo(-8 * sg, -3); g.lineTo(-8 * sg, 3); g.fill() }
        else if (e.kind === 'emoji') drawPart(g, { x: 0, y: 0, size: 4, life: 1, max: 1, color: '#ffd84a', kind: 'emoji', mood: 0 })
        else if (e.kind === 'moon') { g.fillStyle = '#e8e4ff'; g.beginPath(); g.arc(0, 0, 5, 0.8, Math.PI * 1.6); g.arc(2, -1, 4, Math.PI * 1.6, 0.8, true); g.fill() }
        else { g.fillStyle = e.color; star(g, 0, 0, 4.5, 1.6, 4) }
        break }
      case 'fall': { g.globalAlpha = 1; const y = lerp(e.y0, e.y1, ease(k)); if (e.bun) { g.fillStyle = e.color; g.beginPath(); g.ellipse(e.x, y, 9, 7, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke(); g.beginPath(); g.arc(e.x, y - 5, 2, 0, TAU); g.stroke() } else if (e.glyph) { pixelText(g, e.glyph, e.x, y, e.color, 18) } else { g.strokeStyle = e.color; g.lineWidth = 2.4; g.beginPath(); g.moveTo(e.x, y - 26); g.lineTo(e.x, y); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(e.x - 3, y - 4); g.lineTo(e.x, y + 4); g.lineTo(e.x + 3, y - 4); g.fill() } break }
      case 'pinned': { g.globalAlpha = 1 - k; const f = e.f; g.fillStyle = '#e0e6f0'; star(g, f.x + (f.side === 1 ? -6 : 6), f.y - f.lift - 40 + e.dy, 3, 1.2, 4); break }
      case 'ray': g.translate(e.x, e.y); g.rotate(e.a); const gr = g.createLinearGradient(0, 0, e.len, 0); gr.addColorStop(0, e.color); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, -1); g.lineTo(e.len * (0.5 + k * 0.5), -3); g.lineTo(e.len * (0.5 + k * 0.5), 3); g.lineTo(0, 1); g.fill(); break
      case 'xcross': g.lineCap = 'round'; for (const [c, s] of [[e.c1, 1], [e.c2, -1]]) { g.strokeStyle = c; g.lineWidth = 5 * (1 - k * 0.5); g.beginPath(); g.moveTo(e.x - 26 * s, e.y - 24); g.lineTo(e.x + 26 * s, e.y + 24); g.stroke() } g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(e.x - 26, e.y - 24); g.lineTo(e.x + 26, e.y + 24); g.moveTo(e.x + 26, e.y - 24); g.lineTo(e.x - 26, e.y + 24); g.stroke(); break
      case 'taiji': g.globalAlpha = 1 - k * 0.7; taijiDisc(g, e.x, e.y, e.r * (e.grow ? 0.4 + k : 1 + k * 0.4), age / 120); break
      case 'zap': g.strokeStyle = e.color; g.lineWidth = 1.6; g.beginPath(); g.moveTo(e.x1, e.y1); for (let i = 1; i <= 6; i++) g.lineTo(lerp(e.x1, e.x2, i / 6), e.y1 + rand(-5, 5)); g.stroke(); break
      case 'seal': { g.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2; const s = k < 0.1 ? 1.6 - k * 6 : 1; g.translate(e.x, e.y); g.scale(s, s); g.rotate(-0.12); g.fillStyle = 'rgba(200,40,50,.9)'; g.beginPath(); g.roundRect(-9, -9, 18, 18, 2); g.fill(); g.strokeStyle = '#fff3e0'; g.lineWidth = 1; g.strokeRect(-6.5, -6.5, 13, 13); g.fillStyle = '#fff3e0'; g.fillRect(-4, -4, 3, 8); g.fillRect(1, -4, 3, 3); g.fillRect(1, 1, 3, 3); break }
      case 'stroke': { g.globalAlpha = 1 - k * 0.8; const p = Math.min(1, k * 3); g.fillStyle = INK; g.beginPath(); g.moveTo(e.x - 40, e.y - 50); g.quadraticCurveTo(e.x - 10, e.y - 60 + 30 * p, e.x + 30 * p, e.y + 20 * p); g.lineTo(e.x + 30 * p - 8, e.y + 20 * p + 4); g.quadraticCurveTo(e.x - 18, e.y - 50 + 30 * p, e.x - 40, e.y - 44); g.fill(); break }
      case 'stamp': { const y = lerp(e.y - 80, e.y, ease(Math.min(1, k * 2.5))); g.globalAlpha = 1; g.fillStyle = '#ffcf4a'; g.beginPath(); g.roundRect(e.x - 16, y - 12, 32, 22, 3); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); g.fillStyle = '#7a4a2a'; g.fillRect(e.x - 3, y - 30, 6, 18); break }
      case 'alpaca': { g.globalAlpha = 1; const x = e.dir > 0 ? lerp(-20, W + 20, k) : lerp(W + 20, -20, k); for (let i = 0; i < 3; i++) { const ax = x - e.dir * i * 22, ay = e.y - Math.abs(Math.sin(age / 60 + i)) * 4; g.fillStyle = '#f6ead2'; g.beginPath(); g.ellipse(ax, ay, 9, 6, 0, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.7; g.stroke(); g.beginPath(); g.ellipse(ax + e.dir * 8, ay - 9, 3, 6, 0, 0, TAU); g.fill(); g.stroke(); g.fillStyle = INK; g.fillRect(ax + e.dir * 9, ay - 12, 0.9, 0.9) } break }
      case 'whaleSil': { const rise = Math.sin(Math.min(1, k * 1.4) * Math.PI), s = e.small ? 0.5 : 1; g.globalAlpha = 0.85 * (1 - k * 0.5); g.translate(e.x, e.y - rise * 70 * s); g.scale(s, s); const gr2 = g.createLinearGradient(0, -40, 0, 30); gr2.addColorStop(0, '#9ae4ff'); gr2.addColorStop(1, '#1f5a9a'); g.fillStyle = gr2; g.beginPath(); g.ellipse(0, 0, 60, 26, -0.2, 0, TAU); g.fill(); g.beginPath(); g.moveTo(-50, 8); g.lineTo(-82, -10); g.lineTo(-74, 18); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(34, -8, 3, 0, TAU); g.fill(); break }
      case 'sea': { const lvl = Math.sin(Math.min(1, k * 1.5) * Math.PI); g.globalAlpha = 0.5 * lvl; g.fillStyle = '#2a6ab8'; g.fillRect(-40, floor - 10 * lvl, W + 80, H); g.globalAlpha = 0.7 * lvl; g.strokeStyle = '#bfe6ff'; g.lineWidth = 1.4; g.beginPath(); for (let x = -40; x < W + 40; x += 8) g.lineTo(x, floor - 10 * lvl + Math.sin(x / 10 + age / 100) * 2); g.stroke(); break }
      case 'clone': { g.globalAlpha = (e.ghost ? 0.35 : 0.75) * (1 - k); const f = e.f; drawFighter(g, { look: f.look, kind: f.kind, fx: f.fx, boss: f.boss }, e.x, f.y, { pose: 'attack', t, scale: scale(f), flip: e.ghost ? f.side === 1 : f.side === 0, noShadow: true, outfit: f.look?.outfit }); break }
      case 'weapon': { g.globalAlpha = 1; const f = e.f, y = f.y - 36 * scale(f) - Math.sin(k * Math.PI) * 10; g.fillStyle = 'rgba(255,240,200,.25)'; g.beginPath(); g.arc(f.x, y, 16, 0, TAU); g.fill(); g.beginPath(); g.arc(f.x, y, 12, 0, TAU); g.fillStyle = '#f6ecd0'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#d4a24a'; g.stroke(); drawWeaponIcon(g, f.kind || 'fist', f.x - 8, y - 8, 1, f.look?.outfit?.weapon ? OUTFIT_COLORS[f.look.outfit.weapon] : undefined, f.fx); break }
      case 'weaponPop': { const f = e.f, y = f.y - 34 * scale(f); g.globalAlpha = 1 - k; drawWeaponIcon(g, e.kind, f.x - 8, y - 8 - k * 10, 1); break }
      case 'bubbleUp': case 'bubblePop': { const f = e.f, S = scale(f); g.strokeStyle = '#bfe6ff'; g.lineWidth = 2; g.beginPath(); g.ellipse(f.x, f.y - f.lift - 14 * S, (13 + (e.type === 'bubblePop' ? 6 * k : -4 * (1 - k))) * S, 16 * S, 0, 0, TAU); g.stroke(); break }
      case 'up': g.fillStyle = e.color; { const y = e.y - 22 * k; g.beginPath(); g.moveTo(e.x, y - 4); g.lineTo(e.x + 3, y); g.lineTo(e.x + 1, y); g.lineTo(e.x + 1, y + 4); g.lineTo(e.x - 1, y + 4); g.lineTo(e.x - 1, y); g.lineTo(e.x - 3, y); g.fill() } break
      case 'bolt': { g.fillStyle = '#fff6a0'; let x = e.x; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y < e.y - 40; y += 10) { x += (Math.floor(y / 10) % 2 ? 6 : -6); g.lineTo(x, y + 10) } g.lineTo(x + 4, e.y - 40); g.lineTo(e.x + 3, 0); g.fill(); break }
      case 'firewall': { const f = e.f, dir = f.side === 0 ? 1 : -1, x = f.x + dir * 22; g.globalAlpha = 1 - k; for (let i = 0; i < 7; i++) { const fh = 46 + Math.sin(age / 50 + i * 1.7) * 12 - Math.abs(i - 3) * 5, fx2 = x + (i - 3) * 3.4 * dir; const gr3 = g.createLinearGradient(0, f.y - fh, 0, f.y); gr3.addColorStop(0, 'rgba(255,220,90,0)'); gr3.addColorStop(0.4, 'rgba(255,160,60,.85)'); gr3.addColorStop(1, 'rgba(230,60,30,.95)'); g.fillStyle = gr3; g.beginPath(); g.moveTo(fx2 - 4, f.y); g.quadraticCurveTo(fx2 - 3, f.y - fh * 0.6, fx2 + Math.sin(age / 40 + i) * 2, f.y - fh); g.quadraticCurveTo(fx2 + 3, f.y - fh * 0.6, fx2 + 4, f.y); g.fill() } g.strokeStyle = 'rgba(255,220,140,.6)'; g.lineWidth = 0.6; for (let r = 0; r < 4; r++) { g.beginPath(); g.moveTo(x - 4, f.y - 10 - r * 10); g.lineTo(x + 4, f.y - 14 - r * 10); g.stroke() } break }
      case 'windmill': { const f = e.f, c = chest(f); g.translate(c.x, c.y); g.rotate(age / 30); g.strokeStyle = '#d9a05b'; g.lineWidth = 3; g.beginPath(); g.moveTo(-26, 0); g.lineTo(26, 0); g.stroke(); g.strokeStyle = 'rgba(255,233,168,.6)'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.stroke(); break }
      case 'bubble': { const f = e.f, x = f.x + (f.side === 0 ? 18 : -18), y = f.y - 110; g.globalAlpha = 1 - Math.max(0, k - 0.7) / 0.3; g.fillStyle = '#ffffff'; g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, 22, 15, 0, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.arc(x - 12, y + 18, 3, 0, TAU); g.fill(); g.stroke(); g.strokeStyle = '#3b5bdb'; g.lineWidth = 1; for (let i = 0; i < Math.floor(k * 10); i++) { g.beginPath(); g.moveTo(x - 14 + i * 3, y + 6); g.lineTo(x - 12 + i * 3, y - 6 + (i % 3) * 3); g.stroke() } if (k > 0.75) { g.fillStyle = '#ffd84a'; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill() } break }
      case 'speech': { const f = e.f, x = f.x + (e.i - 1.5) * 16, y = f.y - 100 - k * 30; g.globalAlpha = 1 - k; g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 0.8; g.beginPath(); g.roundRect(x - 9, y - 6, 18, 12, 4); g.fill(); g.stroke(); g.fillStyle = '#ff6a8a'; g.beginPath(); g.arc(x - 2, y - 1, 2, 0, TAU); g.arc(x + 2, y - 1, 2, 0, TAU); g.moveTo(x - 4, y); g.lineTo(x, y + 4); g.lineTo(x + 4, y); g.fill(); break }
      case 'fishOrbit': { const f = e.f, a = age / 120 + e.i * TAU / 4, x = f.x + Math.cos(a) * 22, y = f.y - 50 + Math.sin(a) * 10; g.fillStyle = hsl(e.i * 90 + 200, 80, 60); g.beginPath(); g.ellipse(x, y, 5, 2.6, 0, 0, TAU); g.fill(); break }
      case 'scrollOut': { const f = e.f, dir = f.side === 0 ? 1 : -1, len = 80 * ease(k); g.globalAlpha = 1; g.fillStyle = '#f6ecd0'; g.strokeStyle = '#c8643a'; g.lineWidth = 1; const x0 = chest(f).x; g.beginPath(); g.rect(dir > 0 ? x0 : x0 - len, chest(f).y - 6, len, 12); g.fill(); g.stroke(); g.fillStyle = INK; for (let i = 6; i < len - 4; i += 6) g.fillRect((dir > 0 ? x0 : x0 - len) + i, chest(f).y - 3, 1, 6); break }
      case 'ribbon': { const f = e.f, c = chest(f); g.globalAlpha = 1 - Math.max(0, k - 0.8) / 0.2; g.strokeStyle = '#f6ecd0'; g.lineWidth = 4; g.beginPath(); for (let a = 0; a < TAU * 2.2 * Math.min(1, k * 2.5); a += 0.2) g.lineTo(c.x + Math.cos(a) * 16, c.y - 30 + a * 4 + Math.sin(a) * 4); g.stroke(); g.strokeStyle = '#c8643a'; g.lineWidth = 0.8; g.stroke(); break }
      case 'fist': { g.translate(e.x, e.y); g.scale(e.dir, 1); g.fillStyle = '#ffe0c8'; g.strokeStyle = INK; g.lineWidth = 0.8; g.beginPath(); g.roundRect(-4, -3, 8, 6, 2); g.fill(); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-6 - i * 4, -2 + i * 2); g.lineTo(-14 - i * 4, -2 + i * 2); g.stroke() } break }
    }
    g.restore()
  }

  let prev = 0
  const speedRef = { v: 1 }
  const canvas = pixelCanvas(W, H, (g, t) => { const ms = t * 1000; const dt = prev ? Math.min(5000, ms - prev) * speedRef.v : 16; prev = ms; step(dt); draw(g, t) }, true)
  // _advance：调试用，手动推进画面时钟（不依赖浏览器帧率）
  const _advance = (ms) => { step(ms); const g = canvas.getContext('2d'); const R = canvas.width / W; g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, W, H); draw(g, clock / 1000) }
  return { canvas, run, fighters: F, setSpeed: (v) => { speedRef.v = v }, stop: () => { canvas.remove() }, _advance }
}

// ---------- 首页院子：大模型江湖的入口 ----------
export const YARD_SPOTS = [
  { key: 'pve', x: 0.16, y: 0.5, label: '闯关' },
  { key: 'pvp', x: 0.5, y: 0.8, label: '擂台' },
  { key: 'board', x: 0.85, y: 0.42, label: '武林大会' },
  { key: 'bag', x: 0.74, y: 0.88, label: '行囊' },
  { key: 'log', x: 0.28, y: 0.88, label: '告示' },
]
export function drawYard(g, W, H, t) {
  drawScene(g, 'village', W, H, t)
  const hz = horizonOf(H)
  // 山门（牌坊）
  const gx = W * 0.16
  g.lineWidth = 1; g.strokeStyle = INK
  g.fillStyle = '#9a2a22'; g.fillRect(gx - 26, hz - 54, 6, 58); g.fillRect(gx + 20, hz - 54, 6, 58)
  g.fillStyle = '#3a2418'; g.beginPath(); g.moveTo(gx - 40, hz - 56); g.quadraticCurveTo(gx, hz - 72, gx + 40, hz - 56); g.lineTo(gx + 34, hz - 62); g.quadraticCurveTo(gx, hz - 74, gx - 34, hz - 62); g.fill()
  g.fillStyle = '#e8c04a'; g.beginPath(); g.roundRect(gx - 12, hz - 52, 24, 10, 1.5); g.fill(); g.stroke()
  g.fillStyle = '#7a1a18'; g.beginPath(); g.ellipse(gx - 5, hz - 47, 2.5, 2.5, 0, 0, TAU); g.ellipse(gx + 5, hz - 47, 2.5, 2.5, 0, 0, TAU); g.fill()
  // 擂台
  const ax = W * 0.5, ay = H * 0.74
  g.fillStyle = '#6a4428'; g.fillRect(ax - 62, ay, 124, 12); g.fillStyle = '#9a6a3a'; g.fillRect(ax - 62, ay - 3, 124, 4)
  g.fillStyle = '#b8352c'; for (const x of [ax - 62, ax + 58]) g.fillRect(x, ay - 26, 4, 26)
  g.strokeStyle = '#efe0c0'; g.lineWidth = 1; for (const y of [ay - 18, ay - 9]) { g.beginPath(); g.moveTo(ax - 58, y); g.quadraticCurveTo(ax, y + 3, ax + 58, y); g.stroke() }
  // 大会旗
  const bx = W * 0.85, sway = Math.sin(t * 2.5) * 3
  g.fillStyle = '#5a3a22'; g.fillRect(bx, hz - 74, 2.5, 86)
  g.fillStyle = '#c8383a'; g.beginPath(); g.moveTo(bx + 2.5, hz - 74); g.quadraticCurveTo(bx + 18 + sway, hz - 70, bx + 30 + sway, hz - 72); g.lineTo(bx + 30 + sway, hz - 38); g.quadraticCurveTo(bx + 18 + sway, hz - 36, bx + 2.5, hz - 40); g.fill()
  g.fillStyle = '#f2d27a'; g.beginPath(); g.arc(bx + 16 + sway / 2, hz - 56, 6, 0, TAU); g.fill(); g.fillStyle = '#c8383a'; star(g, bx + 16 + sway / 2, hz - 56, 4, 1.6)
  // 告示牌
  const nx = W * 0.28, ny = H * 0.84
  g.fillStyle = '#5a3a22'; g.fillRect(nx - 14, ny - 6, 3, 18); g.fillRect(nx + 11, ny - 6, 3, 18)
  g.fillStyle = '#c9a06a'; g.beginPath(); g.roundRect(nx - 17, ny - 24, 34, 20, 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke()
  g.fillStyle = '#f6ecd0'; g.fillRect(nx - 13, ny - 21, 11, 14); g.fillRect(nx + 1, ny - 21, 12, 9); g.fillStyle = '#c8383a'; g.fillRect(nx - 10, ny - 12, 4, 3)
  // 行囊
  g.save(); g.translate(W * 0.74 - 14, H * 0.86 - 22); drawIcon(g, 'chest', 0, 0, 1.8); g.restore()
}
