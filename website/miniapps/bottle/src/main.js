// 漂流瓶 linux.do 小程序。只用平台 SDK，不加载外部资源；页面之间用自己的返回栈。
// 发瓶子一律匿名；喜欢和回信实名：有 L 站编号的人用平台的 user.getById 显示 L 站昵称和头像（平台按编号给，改不了），
// 没有 L 站编号的人显示服务器给的昵称和头像。
import { getSDK } from '@discourse-mini-app/sdk'

const root = document.getElementById('app')
const SVG = 'http://www.w3.org/2000/svg'
const BOTTLE = [
  ['glass', 'M11 3h1v1h-1zM10 4h3v1h-3zM6 5h6v1h-6zM5 6h2v1h-2zM9 6h3v1h-3zM4 7h2v1h-2zM10 7h2v1h-2zM3 8h2v1h-2zM9 8h3v1h-3zM2 9h2v1h-2zM8 9h3v1h-3zM2 10h3v1h-3zM7 10h3v1h-3zM2 11h8v1h-8zM3 12h5v1h-5z'],
  ['paper', 'M7 6h2v1h-2zM6 7h4v1h-4zM5 8h4v1h-4zM4 9h4v1h-4zM5 10h2v1h-2z'],
  ['cork', 'M12 0h2v1h-2zM11 1h4v1h-4zM12 2h4v1h-4zM13 3h2v1h-2z'],
  ['wave', 'M0 14h2v1h-2zM5 14h2v1h-2zM10 14h2v1h-2zM15 14h1v1h-1zM2 15h3v1h-3zM7 15h3v1h-3zM12 15h3v1h-3z'],
  ['ink', 'M11 2h1v1h-1zM10 3h1v1h-1zM12 3h1v1h-1zM6 4h4v1h-4zM13 4h1v1h-1zM5 5h1v1h-1zM12 5h1v1h-1zM4 6h1v1h-1zM12 6h1v1h-1zM3 7h1v1h-1zM12 7h1v1h-1zM2 8h1v1h-1zM12 8h1v1h-1zM1 9h1v1h-1zM11 9h1v1h-1zM1 10h1v1h-1zM10 10h1v1h-1zM1 11h1v1h-1zM10 11h1v1h-1zM2 12h1v1h-1zM8 12h2v1h-2zM3 13h5v1h-5z'],
]
const ICONS = {
  heart: 'M12 20.3s-7.8-4.7-7.8-10.5A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.8 2.7c0 5.8-7.8 10.5-7.8 10.5Z',
  chat: 'M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12Z',
  bookmark: 'M6.5 3.5h11v17L12 16.4l-5.5 4.1Z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0',
}
const POOP = 'M7 1h2v1h-2zM6 2h1v1h-1zM8 2h2v1h-2zM7 3h4v1h-4zM6 4h6v1h-6zM5 5h8v1h-8zM5 6h8v1h-8zM4 7h10v1h-10zM3 8h3v1h-3zM7 8h2v1h-2zM10 8h3v1h-3zM3 9h3v1h-3zM7 9h2v1h-2zM10 9h3v1h-3zM2 10h12v1h-12zM2 11h5v1h-5zM9 11h5v1h-5zM1 12h14v1h-14zM1 13h15v1h-15zM2 14h12v1h-12z'

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'value') el.value = v
    else if (k === 'checked') el.checked = !!v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
  return el
}
function svg(box, cls, paths) {
  const s = document.createElementNS(SVG, 'svg')
  s.setAttribute('viewBox', box); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true')
  for (const [c, d] of paths) { const p = document.createElementNS(SVG, 'path'); if (c) p.setAttribute('class', c); p.setAttribute('d', d); s.append(p) }
  return s
}
const mark = (cls) => svg('0 0 16 16', 'px ' + cls, BOTTLE)
const icon = (n) => n === 'poop' ? svg('0 0 16 16', 'ic px solid', [['', POOP]]) : svg('0 0 24 24', 'ic', [['', ICONS[n]]])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const fmt = (n) => Number(n).toLocaleString('zh-CN')
const uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('')
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-')
}

let sdk, st, mood = '', me = null
const REASONS = ['人身攻击或骚扰', '泄露他人隐私', '广告或诈骗', '违法或危险内容', '其他']
const TABS = [['thrown', '我扔的'], ['drawn', '今日已捞'], ['liked', '我赞过'], ['replied', '我回过'], ['kept', '我收藏']]
const VERB = { like: '喜欢了你的瓶子', reply: '回信了你的瓶子', re: '回复了你的回信' }

// 服务重启的几秒里会 502：读取和带操作编号 / 可重复的写入自动再试
async function call(kind, route, data = {}) {
  for (let i = 0; ; i++) {
    let res, err
    try {
      res = kind === 'read' ? await sdk.http.request('read', { query: { route, ...data } }) : await sdk.http.request('write', { json: { route, payload: data } })
    } catch (e) { err = e }
    if (res && res.status >= 200 && res.status < 300) return res.body
    const again = err ? err.code === 'TIMEOUT' : [502, 504].includes(res.status)
    if (again && i < 3 && !/\/(report|delete)$/.test(route)) { await wait(800 * 2 ** i); continue }
    const e = new Error(err ? (err.code === 'PERMISSION_DENIED' ? '没有获得网络授权' : '网络不通，请稍后再试') : res.body?.error || '请求失败，请稍后再试')
    e.code = res?.body?.code; throw e
  }
}
const read = (route, q) => call('read', route, q), write = (route, p) => call('write', route, p)

// ---------- 人：L 站资料由平台按编号给；同一个人只查一次，最多 4 个同时查 ----------
const profiles = new Map(), avatars = new Map()
let busy = 0
const queue = []
const slot = () => (busy < 4 ? (busy++, Promise.resolve()) : new Promise((r) => queue.push(r)))
const free = () => { const next = queue.shift(); next ? next() : busy-- }
function lookup(lid) {
  if (me && lid === me.id) return Promise.resolve(me)
  if (!profiles.has(lid)) profiles.set(lid, (async () => {
    if (!sdk.permissions.has('user.lookup')) return null
    await slot()
    try { return await sdk.user.getById(lid) } catch { return null } finally { free() }
  })())
  return profiles.get(lid)
}
function avatarOf(key) {
  if (!avatars.has(key)) avatars.set(key, read('/avatar', { k: key }).then((d) => {
    const bin = atob(d.b64), bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: d.mime }))
  }).catch(() => null))
  return avatars.get(key)
}
const initials = (name) => [...(name || '?')][0].toUpperCase()
// 返回 [头像, 名字]；先显示首字，平台资料回来后换成 L 站头像和昵称
function who(u, size = 'sm') {
  const face = h('span', { class: 'face ' + size, 'aria-hidden': 'true' }, initials(u.name || 'L'))
  const name = h('strong', { class: 'who' }, u.name || (u.lid ? 'L站用户' : '已注销用户'))
  const show = (src) => { if (src) face.replaceChildren(h('img', { src, alt: '' })) }
  if (u.lid) lookup(u.lid).then((p) => {
    if (!p) return
    name.textContent = p.name || p.username
    if (p.name && p.username && p.name !== p.username) name.title = '@' + p.username
    face.textContent = p.initials || initials(p.name || p.username)
    show(p.avatarUrl)
  })
  else if (u.avatar) avatarOf(u.avatar).then(show)
  if (u.anon) face.classList.add('pixel')
  return [face, name]
}
// 匿名身份：像素头像 + 昵称
function pixelFace(key, size = 'sm') {
  const face = h('span', { class: 'face pixel ' + size, 'aria-hidden': 'true' })
  if (key) avatarOf(key).then((src) => { if (src) face.replaceChildren(h('img', { src, alt: '' })) })
  return face
}


// ---------- 表情、图片、视频 ----------
const blobOf = (d) => { const bin = atob(d.b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes }
const stickers = new Map(), thumbs = new Map()
function stickerUrl(k) {
  if (!stickers.has(k)) stickers.set(k, read('/sticker', { k }).then((d) => URL.createObjectURL(new Blob([blobOf(d)], { type: d.mime }))).catch(() => null))
  return stickers.get(k)
}
// 图片按原始字节取回，转成 Blob 显示
async function fileBytes(k) {
  const r = await sdk.http.request('file', { query: { k }, responseType: 'bytes', timeoutMs: 60000 })
  if (r.status !== 200) throw new Error('图片打不开')
  return new Blob([r.body], { type: r.headers?.['content-type'] || '' })
}
function thumbUrl(key) {
  if (!thumbs.has(key)) thumbs.set(key, fileBytes(key).then((b) => URL.createObjectURL(b)).catch(() => null))
  return thumbs.get(key)
}
const STK = /\[([a-z]+):([a-z0-9_]+)\]/g
function rich(text) {
  const out = []; let last = 0
  for (const m of (text || '').matchAll(STK)) {
    out.push(text.slice(last, m.index))
    const span = h('span', { class: 'stk' }, m[0])
    stickerUrl(m[1] + ':' + m[2]).then((src) => { if (src) span.replaceChildren(h('img', { src, alt: m[0] })) })
    out.push(span); last = m.index + m[0].length
  }
  out.push((text || '').slice(last))
  return out
}
const keyOf = (url) => (url || '').replace(/^\/img\//, '')
// 视频 / 实况：服务器给分片节目单，交给平台播放器
let playing = null
async function playVideo(m) {
  if (!sdk.permissions.has('video.play') || !sdk.permissions.has('video.stream')) return toast('需要允许播放视频')
  toast('正在准备视频…')
  const r = await read('/vprog', { k: keyOf(m.v) })
  if (!r.playable) return toast('这个视频的格式暂时播放不了')
  if (playing) await sdk.video.stop(playing).catch(() => {})
  try { playing = (await sdk.video.playProgram({ program: r.program }, { volume: 1 })).handle } catch (e) { playing = null; toast(e?.code === 'BROWSER_UNSUPPORTED' ? '这台设备播放不了这个视频的编码' : '视频播放失败') }
}
function mediaGrid(items) {
  if (!items?.length) return null
  return h('div', { class: 'media n' + Math.min(items.length, 3) }, items.map((m) => {
    const video = m.k === 'v' || m.k === 'l'
    const cell = h('button', { class: 'media-cell', type: 'button', 'aria-label': m.k === 'v' ? '播放视频' : m.k === 'l' ? '播放实况' : '看大图',
      onclick: () => { if (video) playVideo(m).catch((e) => toast(e.message)); else thumbUrl(keyOf(m.u)).then((src) => src && zoom(src)) } },
      m.k === 'v' ? h('span', { class: 'media-tag' }, '▶ 视频') : m.k === 'l' ? h('span', { class: 'media-tag' }, '实况') : m.k === 'g' ? h('span', { class: 'media-tag' }, 'GIF') : null)
    thumbUrl(keyOf(m.t)).then((src) => { if (src) cell.prepend(h('img', { src, alt: '' })) })
    return cell
  }))
}
function zoom(src) {
  const box = h('div', { class: 'zoom', role: 'dialog', 'aria-label': '看大图', onclick: () => box.remove() }, h('img', { src, alt: '' }))
  root.append(box)
}

// ---------- 发图片 / 视频：图片在本机重新绘制（丢掉拍摄地点等信息）再上传 ----------
async function redraw(file, edge, thumb = false) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, edge / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height)
  const w = bmp.width, hh = bmp.height
  bmp.close?.()
  const type = !thumb && /png|webp/.test(file.type) ? 'image/webp' : 'image/jpeg'
  const blob = await new Promise((r) => c.toBlob(r, type, thumb ? 0.78 : 0.88))
  if (!blob) throw new Error('图片处理失败')
  return { file: new File([blob], (thumb ? 'thumb' : 'photo') + (type === 'image/webp' ? '.webp' : '.jpg'), { type }), w, h: hh }
}
// 视频封面：本机截第一帧；截不到就画一张带播放符号的封面
async function posterOf(file) {
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
    await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; setTimeout(no, 6000) })
    v.currentTime = Math.min(0.1, (v.duration || 1) / 2)
    await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 1500) })
    const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k)
    if (!c.width || !c.height) throw new Error()
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
    if (!blob) throw new Error()
    return { file: new File([blob], 'poster.jpg', { type: 'image/jpeg' }), w: v.videoWidth, h: v.videoHeight }
  } catch {
    const c = document.createElement('canvas'); c.width = 720; c.height = 720
    const g = c.getContext('2d'); g.fillStyle = '#20313a'; g.fillRect(0, 0, 720, 720)
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.moveTo(300, 250); g.lineTo(300, 470); g.lineTo(480, 360); g.closePath(); g.fill()
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
    return { file: new File([blob], 'poster.jpg', { type: 'image/jpeg' }), w: null, h: null }
  } finally { URL.revokeObjectURL(url) }
}
async function uploadOne(file) {
  const form = new FormData()
  form.append('file', file, file.name || 'file')
  form.append('nonce', uuid().replaceAll('-', ''))
  const r = await sdk.http.request('upload', { body: form, timeoutMs: 180000 })
  if (r.status !== 200) throw new Error(r.body?.error || '上传失败')
  return r.body.key
}
const isVideo = (f) => /^video\//.test(f.type) || /\.(mov|mp4|webm)$/i.test(f.name || '')
const isImage = (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type) || /\.(jpe?g|png|gif|webp)$/i.test(f.name || '')
const baseName = (f) => (f.name || '').replace(/\.[^.]+$/, '').toLowerCase()
async function prepare(it, paint) {
  const { file, pair } = it
  if (pair || isVideo(file)) { // 实况（同名的图 + 视频）或视频
    const still = pair ? await redraw(file, 2560) : await posterOf(file)
    const thumb = pair ? await redraw(file, 720, true) : still
    it.preview = URL.createObjectURL(thumb.file); paint()
    const video = pair || file
    const [poster, t, key] = await Promise.all([uploadOne(still.file), thumb === still ? null : uploadOne(thumb.file), uploadOne(video)])
    return { key, poster, ...(t ? { thumb: t } : {}), w: still.w, h: still.h, ...(pair ? { kind: 'l' } : {}) }
  }
  const thumb = await redraw(file, 720, true)
  it.preview = URL.createObjectURL(thumb.file); paint()
  if (file.type === 'image/gif') { const [key, t] = await Promise.all([uploadOne(file), uploadOne(thumb.file)]); return { key, thumb: t, w: thumb.w, h: thumb.h } }
  const big = await redraw(file, 2560)
  const [key, t] = await Promise.all([uploadOne(big.file), uploadOne(thumb.file)])
  return { key, thumb: t, w: big.w, h: big.h }
}
function attacher(max) {
  const items = []
  const input = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm', class: 'hide' })
  const tray = h('div', { class: 'tray' })
  const paint = () => tray.replaceChildren(...items.map((it) => h('span', { class: 'tray-it ' + it.state },
    it.preview ? h('img', { src: it.preview, alt: '' }) : h('span', { class: 'tray-ph' }, isVideo(it.file) ? '视频' : '图片'),
    it.state !== 'ok' && h('span', { class: 'tray-state' }, it.state === 'up' ? '上传中' : '失败'),
    h('button', { class: 'tray-x', type: 'button', 'aria-label': '移除', onclick: () => { items.splice(items.indexOf(it), 1); if (it.preview) URL.revokeObjectURL(it.preview); paint() } }, '×'))))
  input.addEventListener('change', () => {
    const list = [...input.files], used = new Set()
    input.value = ''
    for (const f of list) {
      if (used.has(f)) continue
      if (items.length >= max) { toast(`最多 ${max} 个图片或视频`); break }
      if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '')) { toast('HEIC 格式看不了：iPhone 可在 设置 → 相机 → 格式 选「兼容性最佳」'); continue }
      if (!isImage(f) && !isVideo(f)) { toast(`「${f.name}」格式不支持`); continue }
      if (f.size > 20 * 1024 * 1024) { toast(`「${f.name}」太大了，单个最多 20MB`); continue }
      const pair = isImage(f) && list.find((x) => x !== f && isVideo(x) && baseName(x) === baseName(f) && !used.has(x))
      if (pair) used.add(pair)
      if (isVideo(f) && list.some((x) => x !== f && isImage(x) && baseName(x) === baseName(f))) continue
      used.add(f)
      const it = { file: f, pair: pair || null, state: 'up' }
      it.job = prepare(it, paint).then((out) => { it.out = out; it.state = 'ok' }).catch((e) => { it.state = 'err'; it.err = e.message; toast(e.message) }).finally(paint)
      items.push(it)
    }
    paint()
  })
  return {
    el: h('div', { class: 'attach' }, tray, btn('btn sm', '图片 / 实况 / 视频', () => input.click()), input),
    async media() {
      await Promise.all(items.map((it) => it.job))
      const bad = items.find((it) => it.state !== 'ok')
      if (bad) throw new Error(`「${bad.file.name}」没传上去：${bad.err || '请重试'}`)
      return items.map((it) => it.out)
    },
    clear() { items.splice(0).forEach((it) => it.preview && URL.revokeObjectURL(it.preview)); paint() },
  }
}

let toastTimer
function toast(text) {
  const el = document.getElementById('toast')
  el.textContent = text; el.hidden = false
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true }, 2600)
}
const btn = (cls, label, fn, attrs) => {
  const el = h('button', { class: cls, type: 'button', ...attrs }, label)
  el.addEventListener('click', async () => { if (el.disabled) return; el.disabled = true; try { await fn(el) } catch (e) { toast(e.message) } finally { el.disabled = false } })
  return el
}
function ask(title, text, choices) {
  return new Promise((done) => {
    const end = (v) => { box.remove(); done(v) }
    const box = h('div', { class: 'sheet', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title, onclick: (e) => { if (e.target === box) end(null) }, onkeydown: (e) => { if (e.key === 'Escape') end(null) } },
      h('div', { class: 'sheet-card' }, h('h2', null, title), h('p', null, text), h('div', { class: 'go' }, choices.map(([v, label, cls]) => h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick: () => end(v) }, label)))))
    root.append(box); box.querySelector('button').focus()
  })
}
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const dayText = (d) => { if (d === today()) return '今天'; const [, m, dd] = d.split('-').map(Number); return `${m} 月 ${dd} 日` }
const ago = (t) => { const s = Date.now() / 1000 - t; return s < 60 ? '刚刚' : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : s < 86400 ? `${Math.floor(s / 3600)} 小时前` : dayText(new Date((t + 28800) * 1000).toISOString().slice(0, 10)) }
function chips(label, list, cur, pick) {
  const box = h('div', { class: 'chips', role: 'group', 'aria-label': label })
  const paint = () => box.replaceChildren(...list.map(([v, t]) => h('button', { class: 'chip' + (v === cur() ? ' on' : ''), type: 'button', 'aria-pressed': String(v === cur()), onclick: () => { pick(v); paint() } }, t)))
  paint()
  return box
}
// 长文字先收起，点「展开」看全
function clamp(cls, text, lines) {
  const el = h('p', { class: cls + ' clamp', style: null }, rich(text))
  el.dataset.lines = String(lines)
  requestAnimationFrame(() => {
    if (el.scrollHeight <= el.clientHeight + 2) return el.classList.remove('clamp')
    el.after(h('button', { class: 'more', type: 'button', onclick: (e) => { el.classList.remove('clamp'); e.currentTarget.remove() } }, '展开'))
  })
  return el
}

// ---------- 返回栈：每一步都能一步步退 ----------
const stack = []
let visit = 0
const go = (view, { replace = false, fresh = false } = {}) => { if (replace) stack.pop(); else if (stack.length) stack[stack.length - 1].y = scrollY; stack.push({ view, y: 0, fresh }); return show() }
const back = () => { if (stack.length > 1) stack.pop(); return show() }
async function show() {
  const top = stack[stack.length - 1], id = ++visit
  main.replaceChildren(h('p', { class: 'note center' }, '加载中…'))
  try {
    const { title, body } = await top.view()
    if (id !== visit) return
    main.replaceChildren(...[title && h('header', { class: 'bar' }, h('button', { class: 'back', type: 'button', onclick: back }, '‹ 返回'), h('h1', null, title)), ...body].filter(Boolean))
    scrollTo(0, top.y)
  } catch (e) {
    if (id === visit) main.replaceChildren(h('div', { class: 'empty' }, h('p', null, e.message), h('div', { class: 'go' }, stack.length > 1 && h('button', { class: 'btn', type: 'button', onclick: back }, '返回'), h('button', { class: 'btn primary', type: 'button', onclick: show }, '重试'))))
  }
}

// ---------- 次数：每天免费的用完就明天再来 ----------
async function paid(kind, send, op = uuid()) {
  if (st[kind + '_price'] === null) { toast('今天的次数用完了，明天再来'); return null }
  return send(op, 0)
}
const drawBtn = (label) => btn('btn primary', label, async () => {
  const r = await paid('draw', (op, price) => write('/draw', { op, mood, price }))
  if (!r) return
  const { bottle, ...q } = r
  Object.assign(st, q)
  if (!bottle) return toast(mood ? `没有捞到「${mood}」的新瓶子` : '海面上暂时没有新的瓶子，晚点再来')
  // 在「捞到的瓶子」上再捞：替换这一页，返回直接回到捞之前的页面
  await go(single(bottle.id, true), { replace: !!stack[stack.length - 1]?.fresh, fresh: true })
})
async function report(route) {
  const v = await ask('举报', '管理员会看到内容和原因，看不到是谁举报的。', [...REASONS.map((r) => [r, r]), ['', '取消']])
  if (v) { await write(route, { reason: v }); toast('已提交举报') }
}
const confirmDelete = (what) => ask(`删除这${what}？`, '删掉以后谁都看不到，也找不回来。', [['yes', '删除', 'danger'], ['no', '算了']]).then((v) => v === 'yes')

function card(b, { full = false } = {}) {
  const el = h('article', { class: 'card' })
  const draw = () => {
    const toggle = (key, act, label, n) => btn('act' + (b[key] ? ' on ' + act : ''), [icon({ like: 'heart', poop: 'poop', keep: 'bookmark' }[act]), h('span', null, n || '')], async () => {
      b = (await write(`/b/${b.id}/${act}`, { on: !b[key] })).bottle; draw()
    }, { 'aria-pressed': String(b[key]), 'aria-label': label + (n ? `，${n}` : '') })
    const still = (n, label, v) => h('span', { class: 'act', 'aria-label': `${label}，${v}` }, icon(n), h('span', null, v))
    const notes = [b.expired && '已过有效期', b.state === 'hidden' && '被举报，等待处理', b.state === 'removed' && '已被管理员收走', b.mine && !b.expired && b.state === 'ok' && (b.sunk ? '已沉底，不会再被捞到' : `漂到 ${dayText(b.expires_day)}`)].filter(Boolean)
    const open = () => go(single(b.id))
    el.replaceChildren(...[
      h('header', { class: 'head' }, ...(b.anon ? [pixelFace(b.avatar_key, 'md'), h('strong', { class: 'who' }, b.nick)] : who(b.user, 'md')), h('div', { class: 'meta' },
        b.badge && h('span', { class: 'badge ' + b.badge.key, title: b.badge.from }, b.badge.name), b.mine && h('span', { class: 'tag' }, '我'),
        h('span', { class: 'note' }, [dayText(b.day), b.mood].filter(Boolean).join(' · ')))),
      b.body && (full ? h('div', { class: 'text' }, rich(b.body)) : h('button', { class: 'text clip', type: 'button', onclick: open }, rich(b.body))),
      mediaGrid(b.media),
      notes.length > 0 && h('p', { class: 'note' }, notes.join(' · ')),
      h('footer', { class: 'acts' },
        b.mine ? still('heart', '喜欢', b.likes) : toggle('liked', 'like', '喜欢', b.likes),
        b.mine ? still('poop', '不喜欢', b.poops) : toggle('pooped', 'poop', '不喜欢，少让别人捞到', 0),
        full ? still('chat', '回信', b.replies) : h('button', { class: 'act', type: 'button', 'aria-label': `回信，${b.replies}`, onclick: open }, icon('chat'), h('span', null, b.replies || '')),
        !b.mine && toggle('kept', 'keep', '收藏', 0),
        h('span', { class: 'grow' }),
        b.mine && full && b.badge && btn('act quiet', b.show_badge ? '隐藏徽章' : '显示徽章', async () => { b = (await write(`/b/${b.id}/badge`, { on: !b.show_badge })).bottle; draw() }),
        b.mine ? b.state !== 'removed' && btn('act quiet', '删除', async () => {
          if (!await confirmDelete('个瓶子')) return
          await write(`/b/${b.id}/delete`); toast('已删除'); await (full ? back() : show())
        }) : btn('act quiet', '举报', () => report(`/b/${b.id}/report`)))].filter(Boolean))
  }
  draw()
  return el
}

// ---------- 页面 ----------
const home = () => async () => {
  const [s, drawn] = await Promise.all([read('/state'), read('/mine', { tab: 'drawn' })])
  st = s
  const quota = [st.draw_left ? `今天还能捞 ${st.draw_left} 个` : '今天不能再捞了', st.throw_left ? `扔 ${st.throw_left} 个` : '今天不能再扔了'].join('，')
  return { body: [
    h('header', { class: 'top' }, h('h1', null, '漂流瓶'), h('button', { class: 'bell', type: 'button', 'aria-label': st.unread ? `提醒，${st.unread} 条未读` : '提醒', onclick: () => go(notifPage()) }, icon('bell'), st.unread > 0 && h('i', { class: 'dot' }, st.unread > 29 ? '30+' : st.unread))),
    h('section', { class: 'hero' }, mark('xl'), h('div', { class: 'waves', 'aria-hidden': 'true' }),
      h('div', { class: 'go' }, drawBtn('捞一个'), btn('btn', '扔一个', () => go(compose()))),
      chips('按心情捞', [['', '随便'], ...st.moods.map((m) => [m, m])], () => mood, (v) => { mood = v }),
      h('p', { class: 'note center' }, quota),
      st.blocked && h('p', { class: 'note center' }, st.blocked),
      h('p', { class: 'note center' }, '瓶子匿名；喜欢和回信会显示你的 L 站昵称和头像。')),
    h('nav', { class: 'tabs', 'aria-label': '我的瓶子' }, TABS.map(([k, label]) => h('button', { class: 'tab', type: 'button', onclick: () => go(mine(k)) }, label))),
    h('section', { class: 'list' }, drawn.items.length ? drawn.items.slice(0, 5).map((b) => card(b)) : h('p', { class: 'empty' }, '有人把心里的话装进了瓶子，捞一个看看。')),
  ] }
}

const notifPage = () => async () => {
  const d = await read('/notifs')
  if (d.unread) write('/notifs/read', {}).catch(() => {})
  const row = (n) => {
    const [face, name] = n.user ? who(n.user, 'sm') : [mark('sm'), h('strong', { class: 'who host' }, '瓶主')]
    return h('button', { class: 'notif' + (n.unread ? ' unread' : ''), type: 'button', onclick: () => go(single(n.bottle)) }, face,
      h('span', { class: 'notif-main' }, h('span', { class: 'line' }, name, ' ', VERB[n.kind] || '互动了'),
        n.body && h('span', { class: 'quote' }, n.body),
        h('span', { class: 'note' }, `「${n.bottle_text}」 · ${ago(n.at)}`)))
  }
  return { title: '提醒', body: [h('div', { class: 'list tight' }, d.items.length ? d.items.map(row) : h('p', { class: 'empty' }, '最近 30 天没有新的互动。'))] }
}

const mine = (tab) => async () => {
  const list = h('div', { class: 'list' }), more = h('div', { class: 'go' })
  let cursor = ''
  const load = async () => {
    const r = await read('/mine', { tab, ...(cursor ? { cursor } : {}) })
    list.append(...r.items.map((b) => card(b)))
    cursor = r.next || ''
    more.replaceChildren(...(cursor ? [btn('btn', '更早的', load)] : []))
    if (!list.children.length) list.append(h('p', { class: 'empty' }, '这里还是空的。'))
  }
  await load()
  return { title: '我的瓶子', body: [h('nav', { class: 'tabs' }, TABS.map(([k, label]) => h('button', { class: 'tab' + (k === tab ? ' on' : ''), type: 'button', 'aria-current': k === tab ? 'page' : null, onclick: () => { if (k !== tab) go(mine(k), { replace: true }) } }, label))), list, more] }
}

let draft = ''
const compose = () => async () => {
  st = { ...st, ...(await read('/state')) }
  let feel = '', days = st.default_days
  const op = uuid()
  const ta = h('textarea', { class: 'write', rows: 6, 'aria-label': '瓶子里的话', placeholder: '心情、句子、想法，都可以。', value: draft })
  const count = h('span', { class: 'note' })
  const fit = () => { draft = ta.value; const n = [...draft.trim()].length; count.textContent = `${n} / ${st.max}`; count.classList.toggle('over', n > st.max) }
  ta.addEventListener('input', fit); fit()
  const nick = h('input', { class: 'input', maxlength: 10, value: st.nick, 'aria-label': '这个瓶子的昵称（最多 10 个字）' })
  let face = { path: st.avatar, key: st.avatar_key }
  const faceBox = h('span', null, pixelFace(face.key, 'md'))
  const badge = h('input', { type: 'checkbox', checked: true })
  const field = (label, ...kids) => h('div', { class: 'field' }, h('div', { class: 'label' }, label), ...kids)
  const att = attacher(9)
  return { title: '扔一个瓶子', body: [
    h('div', { class: 'card' }, ta, att.el, h('div', { class: 'count' }, count)),
    field('匿名身份', h('div', { class: 'row' }, faceBox, nick),
      h('div', { class: 'row' }, btn('btn sm', '换头像', async () => { const r = await read('/roll'); face = { path: r.avatar, key: r.avatar_key }; faceBox.replaceChildren(pixelFace(face.key, 'md')) }), btn('btn sm', '换昵称', async () => { nick.value = (await read('/roll')).nick })),
      h('label', { class: 'check' }, badge, '昵称后面显示徽章'),
      h('p', { class: 'note' }, '头像和昵称随机生成，昵称最多 10 个字，都只用在这一个瓶子上。')),
    field('心情（可不选）', chips('心情', st.moods.map((m) => [m, m]), () => feel, (v) => { feel = feel === v ? '' : v })),
    field('漂多久', chips('有效期', st.days.map((d) => [d, `${d} 天`]), () => days, (v) => { days = v })),
    h('div', { class: 'go' }, btn('btn primary', '扔进海里', async () => {
      const media = await att.media()
      const r = await paid('throw', (o, price) => write('/throw', { op: o, body: ta.value, media, mood: feel, days, nick: nick.value, avatar: face.path, show_badge: badge.checked, price }), op)
      if (!r) return
      draft = ''; att.clear(); toast('瓶子漂走了')
      await go(single(r.bottle.id), { replace: true })
    })),
    h('p', { class: 'note center' }, '匿名发布。被举报时，管理员可以查到发布者。')] }
}

const FOLD = 3
const single = (id, fresh = false) => async () => {
  const [s, d] = await Promise.all([read('/state'), read(`/b/${id}`)])
  st = s
  const b = d.bottle
  let to = null, op = uuid(), shown = d.replies.length
  const list = h('div', { class: 'replies' }), more = h('div', { class: 'go' }), target = h('div', { class: 'to' })
  const ta = h('textarea', { class: 'input', rows: 2, 'aria-label': '回信' })
  const att = attacher(3)
  // 匿名回信：同一个人在同一个瓶子里固定一个匿名身份，第一次匿名回信前可以换
  let anonReply = false, alias = d.my_alias, pick = { nick: st.nick, path: st.avatar, key: st.avatar_key }
  const ident = h('div', { class: 'ident' })
  const paintIdent = () => {
    ta.placeholder = b.mine && b.anon ? '以「瓶主」的身份回信，不会显示你是谁' : anonReply ? '匿名回信，别人看到的是上面的昵称和头像' : '写一封回信，会显示你的 L 站昵称和头像'
    if (b.mine || !anonReply) return ident.replaceChildren()
    if (alias) return ident.replaceChildren(h('div', { class: 'row' }, pixelFace(alias.avatar_key), h('span', null, alias.nick), h('span', { class: 'note' }, '你在这个瓶子里的匿名身份')))
    const nickIn = h('input', { class: 'input', maxlength: 10, value: pick.nick, 'aria-label': '匿名昵称（最多 10 个字）', oninput: (e) => { pick.nick = e.target.value } })
    const faceBox = h('span', null, pixelFace(pick.key))
    ident.replaceChildren(h('div', { class: 'row' }, faceBox, nickIn),
      h('div', { class: 'row' }, btn('btn sm', '换头像', async () => { const r = await read('/roll'); pick = { ...pick, path: r.avatar, key: r.avatar_key }; faceBox.replaceChildren(pixelFace(pick.key)) }),
        btn('btn sm', '换昵称', async () => { nickIn.value = pick.nick = (await read('/roll')).nick })))
  }
  const mode = !b.mine && chips('回信身份', [[false, '实名回信'], [true, '匿名回信']], () => anonReply, (v) => { anonReply = v; paintIdent() })
  const paintTo = () => target.replaceChildren(...(to ? [h('span', null, '回复 ' + to.name), h('button', { class: 'act quiet', type: 'button', onclick: () => { to = null; paintTo() } }, '取消')] : []))
  const row = (r) => {
    const [face, name] = r.user ? who(r.user, 'sm') : [mark('sm'), h('strong', { class: 'who host' }, b.mine ? '瓶主（我）' : '瓶主')]
    const tag = r.host ? (b.mine ? '瓶主（我）' : '瓶主') : r.user?.anon ? (r.mine ? '匿名（我）' : '匿名') : null
    const el = h('div', { class: 'reply' }, face, h('div', { class: 'reply-main' },
      h('div', { class: 'reply-head' }, name, r.user && tag && h('span', { class: 'tag' }, tag), h('span', { class: 'note' }, dayText(r.day))),
      r.reply_to && h('p', { class: 'note' }, '回复 ' + r.reply_to.name),
      r.body && clamp('rbody', r.body, 4),
      mediaGrid(r.media),
      h('div', { class: 'reply-acts' },
        b.state === 'ok' && h('button', { class: 'act quiet', type: 'button', onclick: () => { to = { id: r.id, name: name.textContent }; paintTo(); ta.focus() } }, '回复'),
        r.mine ? btn('act quiet', '删除', async () => { if (!await confirmDelete('封回信')) return; await write(`/replies/${r.id}/delete`); el.remove() })
          : btn('act quiet', '举报', () => report(`/replies/${r.id}/report`)))))
    return el
  }
  // 回信多时先收起，只露最前面几封
  const rows = d.replies.map(row)
  const hidden = rows.slice(FOLD)
  hidden.forEach((el) => { el.hidden = true })
  list.append(...rows)
  const fold = hidden.length > 0 && h('button', { class: 'fold', type: 'button', onclick: (e) => { hidden.forEach((el) => { el.hidden = false }); e.currentTarget.remove(); paintMore(d.next) } }, `展开其余 ${hidden.length}${d.next ? '+' : ''} 封回信`)
  const paintMore = (next) => more.replaceChildren(...(next ? [btn('btn sm', '后面的回信', async () => { const r = await read(`/b/${id}/replies`, { after: String(next) }); list.append(...r.replies.map(row)); shown += r.replies.length; paintMore(r.next) })] : []))
  if (!hidden.length) paintMore(d.next)
  if (!d.replies.length) list.append(h('p', { class: 'empty small' }, '还没有回信。'))
  paintIdent()
  return { title: fresh ? '捞到一个瓶子' : b.mine ? '我的瓶子' : '漂流瓶', body: [
    card(b, { full: true }),
    fresh && h('div', { class: 'go' }, drawBtn('再捞一个'), btn('btn', '扔一个', () => go(compose()))),
    h('section', { class: 'card mail', 'aria-label': '回信' }, h('div', { class: 'mail-head' }, `回信 ${b.replies || ''}`),
      b.state === 'ok' && h('div', { class: 'compose-reply' }, mode, ident, target, ta, att.el, h('div', { class: 'go end' }, btn('btn primary sm', '寄出', async () => {
        const media = await att.media()
        const r = await write(`/b/${id}/reply`, { op, body: ta.value, media, reply_to: to?.id ?? null, as_host: b.mine, anon: anonReply, nick: anonReply && !alias ? pick.nick : undefined, avatar: anonReply && !alias ? pick.path : undefined })
        if (anonReply && !alias && r.reply?.user?.anon) { alias = { nick: r.reply.user.name, avatar_key: r.reply.user.avatar }; paintIdent() }
        op = uuid(); ta.value = ''; att.clear(); to = null; paintTo()
        list.querySelector('.empty')?.remove(); list.append(row(r.reply))
      }))), list, fold, more)].filter(Boolean) }
}

// ---------- 启动 ----------
const main = h('main', { id: 'main' })
root.replaceChildren(main, h('div', { id: 'toast', class: 'toast', role: 'status', hidden: true }))
const theme = (t) => { document.documentElement.dataset.theme = t?.mode === 'dark' ? 'dark' : 'light' }
async function start() {
  try {
    sdk = getSDK(); await sdk.ready
    if (sdk.permissions.has('theme.read')) { theme(await sdk.theme.get().catch(() => null)); sdk.theme.onChange(theme) }
    me = sdk.permissions.has('user.read') ? await sdk.user.getCurrent().catch(() => null) : null
    if (!me || !sdk.permissions.has('network.request')) main.replaceChildren(h('p', { class: 'empty' }, '登录论坛并允许网络权限后，就可以捞瓶子、扔瓶子。'))
    else {
      // 把论坛资料告诉服务器，用来显示你的回信（名字后面会带论坛编号）
      write('/profile', { username: me.username, name: me.name }).catch(() => {})
      await go(home())
    }
  } catch (e) { main.replaceChildren(h('p', { class: 'empty' }, e.message)) } finally { await sdk?.lifecycle.ready().catch(() => {}) }
}
start()
