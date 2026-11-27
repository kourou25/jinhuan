// 漂流瓶（2026-11-25 改版）。每一步都有自己的地址，用浏览器历史一步步返回：
//   /bottles 首页 · /new 写 · /b/编号 看一个瓶子（?d=1 刚捞到的，可以接着捞）· /mine?tab= 我的 · /admin 管理
// 匿名瓶的接口不返回作者：user 为 null，只有这个瓶子自己的昵称和徽章；瓶主的回信显示「瓶主」。
const keep = {
  get(k) { try { return sessionStorage.getItem(k) || '' } catch { return '' } },
  set(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k) } catch {} },
}
const REPORT_REASONS = ['人身攻击或骚扰', '泄露他人隐私', '广告或诈骗', '违法或危险内容', '其他']
const TABS = [['thrown', '我扔的'], ['drawn', '今日已捞'], ['liked', '我赞过'], ['replied', '我回过'], ['kept', '我收藏']]
const EMPTY = { thrown: '还没有扔过瓶子。', drawn: '今天还没有捞过瓶子。', liked: '还没有赞过瓶子。', replied: '还没有回过信。', kept: '还没有收藏瓶子。' }
// 列表的内容和滚动位置（按账号分开），返回时接着看
const LISTS = new Map()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function mountBottles(main, ctx) {
  const { h, icon, avatar, toast, navigate, askChoice, onLeave, isPop, user } = ctx
  let left = false
  onLeave(() => { left = true })
  const path = location.pathname.replace(/\/+$/, ''), params = new URLSearchParams(location.search)
  const DRAFT = 'bottle:draft:' + user.id, MOOD = 'bottle:mood'
  const say = (e) => toast(e.message, 'err')
  const fmt = (n) => Number(n).toLocaleString('zh-CN')

  // 服务重启的几秒里 nginx 回 502：能安全重试的请求自动再试几次（带操作编号的 POST 不会重复扣款或重复发）
  async function api(url, opts = {}) {
    const safe = !opts.method || opts.method === 'GET' || opts.method === 'PUT' || !!opts.body?.op
    for (let i = 0; ; i++) {
      try { return await ctx.api(url, opts) } catch (e) {
        if (!safe || i >= 3 || !(e.status === undefined || [502, 503, 504].includes(e.status))) throw e
        await wait(800 * 2 ** i)
      }
    }
  }

  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const dayText = (d) => {
    if (d === today()) return '今天'
    const [y, m, dd] = d.split('-').map(Number)
    return (y === Number(today().slice(0, 4)) ? '' : y + ' 年 ') + `${m} 月 ${dd} 日`
  }
  const btn = (cls, label, fn, attrs = {}) => {
    const el = h('button', { class: cls, type: 'button', ...attrs }, label)
    el.addEventListener('click', async () => { if (el.disabled) return; el.disabled = true; try { await fn(el) } catch (e) { say(e) } finally { el.disabled = false } })
    return el
  }
  const link = (cls, href, ...kids) => h('a', { class: cls, href, 'data-link': '' }, ...kids)
  // 小程序里没有站内账号的人没有主页
  // 匿名身份：这个瓶子里的昵称和像素头像
  const pixel = (src, size) => h('img', { class: 'bt-pixel', src, alt: '', width: size, height: size })
  const anonPerson = (u, size, tag) => h('span', { class: 'bt-person anon' }, pixel(u.avatar, size), h('span', null, u.name), h('span', { class: 'bt-tag' }, tag || '匿名'))
  const person = (u, size) => u.anon ? anonPerson(u, size) : u.username ? link('bt-person', '/u/' + encodeURIComponent(u.username), avatar(u.avatar, u.name, size), h('span', null, u.name))
    : h('span', { class: 'bt-person' }, avatar(null, u.name, size), h('span', null, u.name))
  const mark = (cls) => icon('bottle', 'i bt-mark ' + cls)
  const waves = () => h('div', { class: 'bt-waves', 'aria-hidden': 'true' })
  const chips = (label, list, cur, pick) => {
    const box = h('div', { class: 'bt-chips', role: 'group', 'aria-label': label })
    const paint = () => box.replaceChildren(...list.map(([v, text]) => h('button', { class: 'bt-chip' + (v === cur() ? ' on' : ''), type: 'button', 'aria-pressed': String(v === cur()), onclick: () => { pick(v); paint() } }, text)))
    paint()
    return box
  }
  const back = () => btn('bt-back', [icon('chevL', 'i tiny'), '返回'], async () => { history.state?.inApp ? history.back() : navigate('/bottles', { replace: true }) })
  // 首页没有返回键，其余页面都有
  const page = (title, ...kids) => main.replaceChildren(h('div', { class: 'bt-page' },
    title ? h('header', { class: 'bt-bar' }, back(), h('h1', null, title)) : h('h1', { class: 'sr-only' }, '漂流瓶'), ...kids))

  // ---------- 付费：先显示价格，确认过的价格才会带给服务端 ----------
  async function confirmPrice(st, kind) {
    const price = st[kind + '_price'], verb = kind === 'draw' ? '捞' : '扔'
    if (price === null) { toast(`今天付费${verb}的次数也用完了，明天再来`); return false }
    if (!price) return 0
    const v = await askChoice('今天的免费次数用完了', `再${verb}一个要 ${fmt(price)} D币（余额 ${fmt(st.balance)}），下一个要 ${fmt(price * 2)}。每天 0 点恢复免费次数和价格。`,
      [['yes', `花 ${fmt(price)} D币${verb}一个`, 'btn-primary'], ['no', '算了', 'btn-ghost']])
    return v === 'yes' ? price : false
  }
  // 返回 null 表示用户没确认；价格变了就拿新价格再问一次
  async function paid(st, kind, send, op = crypto.randomUUID()) {
    for (let i = 0; i < 3; i++) {
      const price = await confirmPrice(st, kind)
      if (price === false) return null
      try { return await send(op, price) } catch (e) {
        if (e.code !== 'price') throw e
        Object.assign(st, await api('/bottles'))
      }
    }
    throw new Error('价格刚刚变了，请再试一次')
  }
  const drawButton = (st, label, mood, cls = 'btn btn-primary') => btn(cls, label, async () => {
    const r = await paid(st, 'draw', (op, price) => api('/bottles/draw', { method: 'POST', body: { op, mood: mood(), price } }))
    if (!r || left) return
    Object.assign(st, r)
    if (!r.bottle) return toast(mood() ? `没有捞到「${mood()}」的新瓶子，换个心情试试` : '海面上暂时没有新的瓶子，晚点再来')
    LISTS.delete(user.id + '/drawn')
    // 在「捞到的瓶子」上再捞：替换这一页，返回键直接回到捞之前的页面，不用一个个退
    navigate(`/bottles/b/${r.bottle.id}?d=1`, { replace: params.get('d') === '1' })
  })
  const quotaText = (st) => [st.draw_left ? `今天还能免费捞 ${st.draw_left} 个` : st.draw_price ? `再捞一个 ${fmt(st.draw_price)} D币` : '今天不能再捞了',
    st.throw_left ? `免费扔 ${st.throw_left} 个` : st.throw_price ? `再扔一个 ${fmt(st.throw_price)} D币` : '今天不能再扔了'].join('，')

  async function report(url) {
    const v = await askChoice('举报', '管理员会看到内容和原因，看不到是谁举报的。', [...REPORT_REASONS.map((r) => [r, r, 'btn-ghost']), ['', '取消', 'btn-ghost']])
    if (!v) return
    await api(url, { method: 'POST', body: { reason: v } })
    toast('已提交举报', 'ok')
  }


  // ---------- 正文：表情 [包名:表情名] 显示成图 ----------
  const STK = /\[([a-z]+):([a-z0-9_]+)\]/g
  const rich = (text) => {
    const out = []; let last = 0
    for (const m of (text || '').matchAll(STK)) { out.push(text.slice(last, m.index), ctx.sticker(m[1], m[2], 'stk bt-stk')); last = m.index + m[0].length }
    out.push((text || '').slice(last))
    return out
  }
  // ---------- 图片 / 实况 / 视频 ----------
  // 图片点开看大图；视频直接在瓶子里播；实况点一下（鼠标移上去）播一遍再回到静图
  const viewAt = (items, i) => ctx.openViewer({ id: -1, image: items[0].u, images: items.map((x) => ({ u: x.u, w: x.w, h: x.h, ...(x.v ? { v: x.v } : {}), ...(x.k ? { k: x.k } : {}) })), image_count: items.length, title: '', seen_at: 1 }, i)
  const videoCell = (m) => {
    const live = m.k === 'l'
    const v = h('video', { class: 'bt-v', poster: m.t, 'aria-label': live ? '实况' : '视频' })
    v.preload = 'none'; v.playsInline = true; v.controls = !live; v.muted = live; v.src = m.v
    const tag = h('span', { class: 'bt-media-tag' }, live ? '实况' : '▶ 视频')
    const cell = h('div', { class: 'bt-media-cell bt-vid' + (live ? ' live' : '') }, v, tag)
    if (m.w && m.h) cell.style.setProperty('--ratio', `${m.w} / ${m.h}`)
    v.addEventListener('play', () => { tag.hidden = !live; document.querySelectorAll('video.bt-v').forEach((x) => { if (x !== v && !x.paused) x.pause() }) })
    v.addEventListener('error', () => { tag.hidden = false; tag.textContent = '这个视频播放不了' })
    cell.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!live) { if (v.paused && e.target === v) v.play().catch(() => {}); return } // 点画面任意处开始播，暂停用播放器自己的按钮
      e.preventDefault()
      v.currentTime = 0; v.play().catch(() => {}) // 点一下从头播一遍（鼠标移上去已在播也一样）
    })
    if (live) {
      v.addEventListener('ended', () => v.load()) // 回到静图
      cell.addEventListener('mouseenter', () => { if (matchMedia('(hover: hover)').matches && v.paused) { v.currentTime = 0; v.play().catch(() => {}) } })
      cell.addEventListener('mouseleave', () => { if (matchMedia('(hover: hover)').matches && !v.paused) { v.pause(); v.load() } })
    }
    return cell
  }
  const mediaGrid = (items) => items?.length > 0 && h('div', { class: 'bt-media n' + Math.min(items.length, 3) }, items.map((m, i) => m.v ? videoCell(m)
    : h('button', { class: 'bt-media-cell', type: 'button', 'aria-label': '看大图', onclick: (e) => { e.preventDefault(); e.stopPropagation(); viewAt(items, i) } },
      h('img', { src: m.t, alt: '', loading: 'lazy' }), m.k === 'g' ? h('span', { class: 'bt-media-tag' }, 'GIF') : null)))

  // 重新绘制一遍再上传：顺带丢掉照片里的拍摄信息（地点、设备）。PNG / WebP 保留透明，用 WebP
  async function redraw(file, edge, thumb = false) {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, edge / Math.max(bmp.width, bmp.height)), lim = Math.min(1, Math.sqrt(16e6 / (bmp.width * bmp.height * k * k)))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * k * lim)); c.height = Math.max(1, Math.round(bmp.height * k * lim))
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height)
    const w = bmp.width, hh = bmp.height
    bmp.close?.()
    const type = !thumb && /png|webp/.test(file.type) ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise((r) => c.toBlob(r, type, thumb ? 0.78 : 0.9))
    if (!blob) throw new Error('图片处理失败')
    return { file: new File([blob], (thumb ? 'thumb' : 'photo') + (type === 'image/webp' ? '.webp' : '.jpg'), { type }), w, h: hh }
  }
  const up = async (f) => (await ctx.uploadFile(f, 'bottle')).key
  const isVideo = (f) => /^video\//.test(f.type) || /\.(mov|mp4|webm)$/i.test(f.name || '')
  const isImage = (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type) || /\.(jpe?g|png|gif|webp)$/i.test(f.name || '')
  const base = (f) => (f.name || '').replace(/\.[^.]+$/, '').toLowerCase()
  async function prepare(it) {
    const { file, pair } = it
    if (pair) { // iPhone 实况：同名的 JPG + MOV
      const [still, thumb] = await Promise.all([redraw(file, 4096), redraw(file, 720, true)])
      it.preview = URL.createObjectURL(thumb.file); paintTray()
      const [poster, t, key] = await Promise.all([up(still.file), up(thumb.file), up(pair)])
      return { key, poster, thumb: t, w: still.w, h: still.h, kind: 'l' }
    }
    if (isVideo(file)) {
      const url = URL.createObjectURL(file), meta = await ctx.probeMedia(file, url).catch(() => ({}))
      URL.revokeObjectURL(url)
      if (meta.bad || !meta.poster) throw new Error('视频截不到封面，请换 MP4 或 WebM')
      it.preview = URL.createObjectURL(meta.poster); paintTray()
      const [poster, key] = await Promise.all([up(meta.poster), up(file)])
      return { key, poster, w: meta.w, h: meta.h }
    }
    if (/jpe?g/i.test(file.type || file.name)) { // 安卓动态照片：视频接在 JPG 后面
      const motion = await ctx.splitMotion(file).catch(() => null)
      if (motion) { it.pair = motion.video; it.file = motion.still; return prepare(it) }
    }
    const thumb = await redraw(file, 720, true)
    it.preview = URL.createObjectURL(thumb.file); paintTray()
    if (file.type === 'image/gif') { const [key, t] = await Promise.all([up(file), up(thumb.file)]); return { key, thumb: t, w: thumb.w, h: thumb.h } }
    const full = await redraw(file, 4096)
    const [key, t] = await Promise.all([up(full.file), up(thumb.file)])
    return { key, thumb: t, w: full.w, h: full.h }
  }
  let paintTray = () => {}
  // 编辑区：表情 + 图片 / 实况 / 视频（每个不超过 20MB）
  function editor(ta, max) {
    const items = []
    const input = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' })
    const tray = h('div', { class: 'bt-tray' })
    const myPaint = () => tray.replaceChildren(...items.map((it) => h('span', { class: 'bt-tray-it ' + it.state, title: it.err || it.file.name },
      it.preview ? h('img', { src: it.preview, alt: '' }) : h('span', { class: 'bt-tray-ph' }, isVideo(it.file) ? '视频' : '图片'),
      it.state !== 'ok' && h('span', { class: 'bt-tray-state' }, it.state === 'up' ? '上传中' : '失败'),
      h('button', { class: 'bt-tray-x', type: 'button', 'aria-label': '移除', onclick: () => { items.splice(items.indexOf(it), 1); if (it.preview) URL.revokeObjectURL(it.preview); paint() } }, '×'))))
    const paint = () => { paintTray = myPaint; myPaint() }
    const add = (files) => {
      const list = [...files], used = new Set()
      for (const f of list) {
        if (used.has(f)) continue
        if (items.length >= max) { toast(`最多 ${max} 个图片或视频`); break }
        if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '')) { toast('HEIC 浏览器看不了：iPhone 可在 设置 → 相机 → 格式 选「兼容性最佳」'); continue }
        if (!isImage(f) && !isVideo(f)) { toast(`「${f.name}」格式不支持`); continue }
        if (f.size > 20 * 1024 * 1024) { toast(`「${f.name}」太大了，单个最多 20MB`); continue }
        // 同名的图 + 视频算一张实况
        const pair = isImage(f) && list.find((x) => x !== f && isVideo(x) && base(x) === base(f) && !used.has(x))
        if (pair) used.add(pair)
        if (isVideo(f) && list.some((x) => x !== f && isImage(x) && base(x) === base(f))) continue
        used.add(f)
        const it = { file: f, pair: pair || null, state: 'up' }
        it.job = prepare(it).then((out) => { it.out = out; it.state = 'ok' }).catch((e) => { it.state = 'err'; it.err = e.message; toast(e.message) }).finally(paint)
        items.push(it)
      }
      paint()
    }
    input.addEventListener('change', () => { add(input.files); input.value = '' })
    ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); add(fs) } })
    const insert = (k) => { ctx.insertAtCursor(ta, k.includes(':') ? `[${k}]` : k); ta.dispatchEvent(new Event('input')) }
    const bar = h('div', { class: 'bt-tools' },
      h('button', { class: 'bt-tool', type: 'button', 'aria-label': '表情', onclick: (e) => ctx.openPop(e.currentTarget, ctx.emojiBoard((k) => { ctx.closePop(); insert(k) }), { key: 'bt-emoji', cls: 'pop-stk' }) }, icon('smile'), h('span', null, '表情')),
      h('button', { class: 'bt-tool', type: 'button', onclick: () => input.click() }, icon('image'), h('span', null, '图片 / 实况 / 视频')), input)
    return {
      el: h('div', { class: 'bt-editor' }, tray, bar),
      async media() {
        await Promise.all(items.map((it) => it.job))
        const bad = items.find((it) => it.state !== 'ok')
        if (bad) throw new Error(`「${bad.file.name}」没传上去：${bad.err || '请重试'}`)
        return items.map((it) => it.out)
      },
      clear() { items.splice(0).forEach((it) => it.preview && URL.revokeObjectURL(it.preview)); paint() },
      count: () => items.length,
    }
  }

  // ---------- 帖子样式的瓶子 ----------
  const badgeChip = (b) => b && h('span', { class: 'bt-badge ' + b.key, title: b.from, tabindex: '0', 'aria-label': `徽章 ${b.name}：${b.from}` }, b.name)
  function card(b, { full = false, onGone, onChange } = {}) {
    const el = h('article', { class: 'bt-card' + (full ? ' full' : '') })
    const href = '/bottles/b/' + b.id
    const draw = () => {
      const toggle = (key, route, ic, label, n) => btn('bt-act' + (b[key] ? ' on ' + route : ''), [icon(ic), h('span', null, n || '')], async () => {
        b = (await api(`/bottles/${b.id}/${route}`, { method: b[key] ? 'DELETE' : 'PUT' })).bottle
        onChange?.(b); draw()
      }, { 'aria-pressed': String(b[key]), 'aria-label': label + (n ? `，${n}` : ''), title: label })
      const still = (ic, label, n) => h('span', { class: 'bt-act still', title: label, 'aria-label': `${label}，${n}` }, icon(ic), h('span', null, n))
      const replies = [icon('chat'), h('span', null, b.replies || '')]
      const notes = [b.expired && '已过有效期', b.state === 'hidden' && '被举报，等待管理员处理', b.state === 'removed' && '已被管理员收走',
        b.mine && b.mini === false && '只在尽欢站内',
        b.mine && !b.expired && b.state === 'ok' && (b.sunk ? '已沉底，不会再被捞到' : `漂到 ${dayText(b.expires_day)}`)].filter(Boolean)
      el.replaceChildren(...[
        h('header', { class: 'bt-head' },
          b.anon ? pixel(b.avatar, 40) : avatar(b.user.avatar, b.user.name, 40),
          h('div', { class: 'bt-who' },
            h('div', { class: 'bt-name' }, b.anon ? h('strong', null, b.nick) : link('', '/u/' + encodeURIComponent(b.user.username), h('strong', null, b.user.name)), badgeChip(b.badge), b.mine && h('span', { class: 'bt-tag' }, '我')),
            h('div', { class: 'bt-meta' }, [dayText(b.day), b.mood].filter(Boolean).join(' · ')))),
        b.body && (full ? h('div', { class: 'bt-body' }, rich(b.body)) : link('bt-body', href, rich(b.body))),
        mediaGrid(b.media),
        notes.length > 0 && h('p', { class: 'bt-meta' }, notes.join(' · ')),
        h('footer', { class: 'bt-acts' },
          b.mine ? still('heart', '喜欢', b.likes) : toggle('liked', 'like', 'heart', '喜欢', b.likes),
          b.mine ? still('poop', '不喜欢', b.poops) : toggle('pooped', 'poop', 'poop', b.pooped ? '取消不喜欢' : '不喜欢，少让别人捞到', 0),
          full ? h('span', { class: 'bt-act still', title: '回信' }, replies) : h('a', { class: 'bt-act', href, 'data-link': '', title: '回信', 'aria-label': `回信，${b.replies}` }, replies),
          !b.mine && toggle('kept', 'keep', 'bookmark', b.kept ? '取消收藏' : '收藏', 0),
          h('span', { class: 'grow' }),
          b.mine && b.anon && b.badge && full && btn('bt-act quiet', b.show_badge ? '隐藏徽章' : '显示徽章', async () => { b = (await api(`/bottles/${b.id}/badge`, { method: 'PUT', body: { on: !b.show_badge } })).bottle; draw() }),
          !b.mine && btn('bt-act quiet', '举报', () => report(`/bottles/${b.id}/report`)),
          (b.mine || user.is_admin) && b.state !== 'removed' && btn('bt-act quiet', '删除', async () => {
            const v = await askChoice('删除这个瓶子？', b.mine ? '删掉以后谁都看不到，也找不回来。今天的次数和 D币不会退回。' : '所有人都将看不到这个瓶子。', [['yes', '删除', 'btn-ghost danger'], ['no', '算了', 'btn-ghost']])
            if (v !== 'yes') return
            await api('/bottles/' + b.id, { method: 'DELETE' })
            toast('已删除', 'ok'); LISTS.clear()
            onGone ? onGone(el) : history.state?.inApp ? history.back() : navigate('/bottles', { replace: true })
          }))].filter(Boolean))
    }
    draw()
    return el
  }

  // ---------- 首页：捞 ----------
  async function home() {
    const [st, drawn] = await Promise.all([api('/bottles'), api('/bottles/mine?tab=drawn')])
    if (left) return
    let mood = st.moods.includes(keep.get(MOOD)) ? keep.get(MOOD) : ''
    page('',
      h('section', { class: 'bt-hero' }, mark('xl'), waves(),
        h('div', { class: 'bt-go' }, drawButton(st, '捞一个', () => mood), link('btn btn-ghost', '/bottles/new', '扔一个')),
        chips('按心情捞', [['', '随便'], ...st.moods.map((m) => [m, m])], () => mood, (v) => { mood = v; keep.set(MOOD, v) }),
        h('p', { class: 'bt-note' }, quotaText(st))),
      h('nav', { class: 'bt-tabs', 'aria-label': '我的瓶子' }, TABS.map(([k, label]) => link('bt-tab', '/bottles/mine?tab=' + k, label)),
        st.admin && link('bt-tab', '/bottles/admin', st.reports ? `管理 ${st.reports}` : '管理')),
      h('section', { class: 'bt-list', 'aria-label': '今日已捞' },
        drawn.items.length ? drawn.items.slice(0, 5).map((b) => card(b)) : h('p', { class: 'bt-empty' }, '有人把心里的话装进了瓶子，捞一个看看。')),
      drawn.items.length > 5 && h('div', { class: 'bt-go' }, link('btn btn-ghost', '/bottles/mine?tab=drawn', '看今天捞到的全部')))
  }

  // ---------- 写 ----------
  async function compose() {
    const st = await api('/bottles')
    if (left) return
    let mood = '', days = st.default_days, anon = true
    const ta = h('textarea', { class: 'bt-write', rows: 6, 'aria-label': '瓶子里的话', placeholder: '心情、句子、想法，都可以。' })
    const ed = editor(ta, 9)
    ta.value = keep.get(DRAFT)
    const count = h('span', { class: 'bt-note' })
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; const n = [...ta.value.trim().replace(STK, '□')].length; count.textContent = `${n} / ${st.max}`; count.classList.toggle('over', n > st.max); keep.set(DRAFT, ta.value) }
    ta.addEventListener('input', fit)
    const nick = h('input', { class: 'input', maxlength: 10, value: st.nick, 'aria-label': '这个瓶子的昵称（最多 10 个字）' })
    let faceSrc = st.avatar
    const faceBox = h('span', { class: 'bt-face-pick' }, pixel(faceSrc, 44))
    const badge = h('input', { type: 'checkbox', checked: true })
    const mini = h('input', { type: 'checkbox', checked: true })
    const face = h('div', { class: 'bt-identity' })
    const paintFace = () => face.replaceChildren(...(anon ? [
      h('div', { class: 'bt-row' }, faceBox, nick),
      h('div', { class: 'bt-row' }, btn('btn btn-ghost sm', '换头像', async () => { faceSrc = (await api('/bottles/roll')).avatar; faceBox.replaceChildren(pixel(faceSrc, 44)) }), btn('btn btn-ghost sm', '换昵称', async () => { nick.value = (await api('/bottles/roll')).nick })),
      h('label', { class: 'bt-check' }, badge, '昵称后面显示徽章'),
      h('p', { class: 'bt-note' }, '头像来自 1 群匿名系统，昵称最多 10 个字，都只用在这一个瓶子上。每次都用同一个，别人可能会认出是同一个人。')] : [
      h('div', { class: 'bt-row' }, person({ username: user.username, name: user.nick || user.name || user.username, avatar: user.avatar }, 28)),
      h('p', { class: 'bt-note' }, '会显示你的昵称和头像，扔出去以后不能改回匿名。')]))
    paintFace()
    const field = (label, ...kids) => h('div', { class: 'bt-field' }, h('div', { class: 'bt-label' }, label), ...kids)
    const OP = crypto.randomUUID() // 整个页面一个编号：中途断线重试也只会扔出一个
    const send = btn('btn btn-primary', st.throw_price ? `扔进海里（${fmt(st.throw_price)} D币）` : '扔进海里', async () => {
      const media = await ed.media() // 先等附件都传完
      const r = await paid(st, 'throw', (op, price) => api('/bottles', { method: 'POST', body: { op, body: ta.value, media, mood, days, anon, nick: anon ? nick.value : '', avatar: anon ? faceSrc : undefined, show_badge: badge.checked, mini: mini.checked, price } }), OP)
      if (!r) return
      keep.set(DRAFT, ''); LISTS.clear(); ed.clear()
      toast('瓶子漂走了', 'ok')
      // 写完的表单不留在历史里：从瓶子返回就是写之前的页面
      if (!left) navigate('/bottles/b/' + r.bottle.id, { replace: true })
    })
    page('扔一个瓶子',
      h('div', { class: 'bt-card bt-compose' }, ta, ed.el, h('div', { class: 'bt-foot' }, h('span', { class: 'grow' }), count)),
      field('身份', chips('身份', [[true, '匿名'], [false, '实名']], () => anon, (v) => { anon = v; paintFace() }), face),
      field('心情（可不选）', chips('心情', st.moods.map((m) => [m, m]), () => mood, (v) => { mood = mood === v ? '' : v })),
      field('漂多久', chips('有效期', st.days.map((d) => [d, `${d} 天`]), () => days, (v) => { days = v }), h('p', { class: 'bt-note' }, '过了有效期，别人捞不到，你自己一直能看到。')),
      field('在哪里漂', h('label', { class: 'bt-check' }, mini, '同时公开到 L 站小程序'), h('p', { class: 'bt-note' }, '公开后 linux.do 论坛的用户在小程序里也能捞到这个瓶子、喜欢和回信。不勾就只在尽欢站内漂。扔出去以后不能改。')),
      h('div', { class: 'bt-go' }, send),
      h('p', { class: 'bt-note center' }, [st.throw_left ? `今天还能免费扔 ${st.throw_left} 个。` : '', st.reward ? `每有一个人喜欢或回信，第二天各得 ${fmt(st.reward)} D币（每天最多 10 份）。` : ''].join('')))
    fit(); ta.focus({ preventScroll: true })
  }

  // ---------- 我的 ----------
  async function mine() {
    const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'thrown', key = user.id + '/' + tab
    const saved = isPop ? LISTS.get(key) : null
    let items = saved?.items || [], cursor = saved?.cursor || '', y = saved?.y || 0
    const list = h('div', { class: 'bt-list' }), more = h('div', { class: 'bt-go' })
    const add = (rows) => list.append(...rows.map((b) => card(b, { onGone: (el) => { items = items.filter((x) => x.id !== b.id); el.remove() }, onChange: (n) => { items = items.map((x) => (x.id === n.id ? n : x)) } })))
    const paint = () => {
      more.replaceChildren(...(cursor ? [btn('btn btn-ghost', '更早的', load)] : []))
      if (!list.children.length) list.replaceChildren(h('p', { class: 'bt-empty' }, EMPTY[tab]))
    }
    const load = async () => {
      const r = await api(`/bottles/mine?tab=${tab}` + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
      if (left) return
      items.push(...r.items); cursor = r.next || ''
      add(r.items); paint()
    }
    const track = () => { if (!left) y = scrollY }
    onLeave(() => { removeEventListener('scroll', track); LISTS.set(key, { items, cursor, y }) })
    page('我的瓶子',
      // 切换标签不往历史里加，返回直接回到进来之前的页面
      h('nav', { class: 'bt-tabs', 'aria-label': '我的瓶子' }, TABS.map(([k, label]) => h('a', { class: 'bt-tab' + (k === tab ? ' on' : ''), href: '/bottles/mine?tab=' + k, 'aria-current': k === tab ? 'page' : null,
        onclick: (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); if (k !== tab) navigate('/bottles/mine?tab=' + k, { replace: true }) } }, label))),
      list, more)
    if (saved) { add(items); paint(); const top = y; requestAnimationFrame(() => { if (!left) scrollTo(0, top) }) } else await load()
    if (!left) addEventListener('scroll', track, { passive: true })
  }

  // ---------- 看一个瓶子 ----------
  async function single(id) {
    const [st, d] = await Promise.all([api('/bottles'), api('/bottles/' + id)])
    if (left) return
    let b = d.bottle, replyTo = null
    const likes = h('div', { class: 'bt-likes' })
    const paintLikes = () => {
      if (!b.likes) return likes.replaceChildren()
      const load = async (cursor) => {
        const r = await api(`/bottles/${id}/likes` + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''))
        likes.querySelector('.bt-more')?.remove()
        likes.append(...r.items.map((u) => person(u, 22)))
        if (r.next) likes.append(btn('bt-act bt-more', '更多', () => load(r.next)))
      }
      const open = btn('bt-act', `${b.likes} 人喜欢`, async () => { open.remove(); await load('') })
      likes.replaceChildren(open)
    }
    const list = h('div', { class: 'bt-replies' }), more = h('div', { class: 'bt-go' })
    const row = (r) => {
      const name = r.user?.name || '瓶主'
      const el = h('div', { class: 'bt-reply' },
        r.user?.anon ? anonPerson(r.user, 28, r.host ? (b.mine ? '瓶主（我）' : '瓶主') : r.mine ? '匿名（我）' : '匿名')
          : r.user ? person(r.user, 28) : h('span', { class: 'bt-person host' }, mark('sm'), h('span', null, b.mine ? '瓶主（我）' : '瓶主')),
        r.user && !r.user.anon && r.host && h('span', { class: 'bt-tag' }, '瓶主'),
        h('div', { class: 'bt-reply-main' },
          r.reply_to && h('p', { class: 'bt-to' }, '回复 ' + r.reply_to.name),
          r.body && h('p', { class: 'bt-reply-body' }, rich(r.body)),
          mediaGrid(r.media),
          h('div', { class: 'bt-acts' }, h('span', { class: 'bt-meta' }, dayText(r.day)),
            b.state === 'ok' && h('button', { class: 'bt-act quiet', type: 'button', onclick: () => { replyTo = { id: r.id, name }; paintTo(); ta.focus() } }, '回复'),
            !r.mine && btn('bt-act quiet', '举报', () => report(`/bottles/replies/${r.id}/report`)),
            (r.mine || user.is_admin) && btn('bt-act quiet', '删除', async () => {
              if (await askChoice('删除这封回信？', '删掉以后找不回来。', [['yes', '删除', 'btn-ghost danger'], ['no', '算了', 'btn-ghost']]) !== 'yes') return
              await api('/bottles/replies/' + r.id, { method: 'DELETE' }); el.remove()
            }))))
      return el
    }
    const addPage = (items, next) => {
      list.append(...items.map(row))
      more.replaceChildren(...(next ? [btn('btn btn-ghost', '后面的回信', async () => { const r = await api(`/bottles/${id}/replies?after=${next}`); addPage(r.replies, r.next) })] : []))
    }
    const to = h('div', { class: 'bt-to' })
    const paintTo = () => to.replaceChildren(...(replyTo ? [h('span', null, '回复 ' + replyTo.name), h('button', { class: 'bt-act quiet', type: 'button', onclick: () => { replyTo = null; paintTo() } }, '取消')] : []))
    const ta = h('textarea', { class: 'input', rows: 2, 'aria-label': '回信' })
    // 匿名回信：同一个人在同一个瓶子里固定一个匿名身份，第一次匿名回信前可以换
    let anonReply = false, alias = d.my_alias, pickNick = null, pickFace = null
    const who = h('div', { class: 'bt-identity' })
    const paintWho = () => {
      ta.placeholder = b.mine && b.anon ? '以「瓶主」的身份回信，不会显示你是谁' : anonReply ? '匿名回信，别人看到的是下面的昵称和头像' : '写一封回信，会显示你的昵称和头像'
      if (b.mine || !anonReply) return who.replaceChildren()
      if (alias) return who.replaceChildren(h('div', { class: 'bt-row' }, pixel(alias.avatar, 28), h('span', null, alias.nick), h('span', { class: 'bt-note' }, '你在这个瓶子里的匿名身份')))
      const nickIn = h('input', { class: 'input sm', maxlength: 10, value: pickNick || st.nick, 'aria-label': '匿名昵称（最多 10 个字）', oninput: (e) => { pickNick = e.target.value } })
      pickNick = nickIn.value; pickFace = pickFace || st.avatar
      const faceBox = h('span', null, pixel(pickFace, 28))
      who.replaceChildren(h('div', { class: 'bt-row' }, faceBox, nickIn,
        btn('btn btn-ghost sm', '换头像', async () => { pickFace = (await api('/bottles/roll')).avatar; faceBox.replaceChildren(pixel(pickFace, 28)) }),
        btn('btn btn-ghost sm', '换昵称', async () => { nickIn.value = pickNick = (await api('/bottles/roll')).nick })))
    }
    const mode = !b.mine && chips('回信身份', [[false, '实名回信'], [true, '匿名回信']], () => anonReply, (v) => { anonReply = v; paintWho() })
    paintWho()
    let op = crypto.randomUUID()
    const red = editor(ta, 3)
    const form = h('div', { class: 'bt-form' }, mode, who, to, ta, red.el, h('div', { class: 'bt-go end' }, btn('btn btn-primary sm', '寄出', async () => {
      const r = await api(`/bottles/${id}/replies`, { method: 'POST', body: { op, body: ta.value, media: await red.media(), reply_to: replyTo?.id ?? null, as_host: b.mine, anon: anonReply, nick: anonReply && !alias ? pickNick : undefined, avatar: anonReply && !alias ? pickFace : undefined } })
      if (anonReply && !alias && r.reply?.user?.anon) { alias = { nick: r.reply.user.name, avatar: r.reply.user.avatar }; paintWho() }
      op = crypto.randomUUID(); ta.value = ''; red.clear(); replyTo = null; paintTo()
      list.querySelector('.bt-empty')?.remove()
      list.append(row(r.reply))
    })))
    const again = params.get('d') === '1' && h('div', { class: 'bt-go' },
      drawButton(st, st.draw_price ? `再捞一个（${fmt(st.draw_price)} D币）` : '再捞一个', () => keep.get(MOOD)), link('btn btn-ghost', '/bottles/new', '扔一个'))
    page(params.get('d') === '1' ? '捞到一个瓶子' : b.mine ? '我的瓶子' : '漂流瓶',
      card(b, { full: true, onChange: (n) => { b = n; paintLikes() } }), likes, again,
      h('section', { class: 'bt-mail', 'aria-label': '回信' }, b.state === 'ok' && form, list, more))
    paintLikes(); addPage(d.replies, d.next)
    if (!d.replies.length) list.append(h('p', { class: 'bt-empty' }, '还没有回信。'))
  }

  // ---------- 管理 ----------
  async function admin() {
    const [st, d] = await Promise.all([api('/bottles'), api('/bottles/reports')])
    if (left) return
    const list = h('div', { class: 'bt-list' })
    const empty = () => { if (!list.children.length) list.replaceChildren(h('p', { class: 'bt-empty' }, '没有待处理的举报。')) }
    list.append(...d.items.map((r) => {
      const who = h('span', { class: 'bt-meta' })
      const done = (action) => async () => { await api('/bottles/reports', { method: 'POST', body: { kind: r.kind, id: r.id, action } }); el.remove(); empty() }
      const el = h('article', { class: 'bt-card' },
        h('p', { class: 'bt-meta' }, [r.kind === 'bottle' ? '瓶子' : r.host ? '瓶主的回信' : r.anon_reply ? `匿名回信（${r.alias || '匿名'}）` : `${r.name} 的回信`, `${r.n} 人举报`, r.hidden && '已自动隐藏'].filter(Boolean).join(' · ')),
        h('div', { class: 'bt-body' }, r.body),
        r.reasons.length > 0 && h('p', { class: 'bt-meta' }, '原因：' + [...new Set(r.reasons)].join('、')),
        h('div', { class: 'bt-acts' }, btn('bt-act', '保留', done('keep')), btn('bt-act danger', '删除', done('delete')), link('bt-act', '/bottles/b/' + r.bottle_id, '打开瓶子'),
          st.owner && (r.host || r.anon_reply) && btn('bt-act', '查看作者', async (x) => {
            if (await askChoice('查看作者？', '这次查看会留下记录。', [['yes', '查看', 'btn-primary'], ['no', '算了', 'btn-ghost']]) !== 'yes') return
            const { author } = await api(r.kind === 'reply' && r.anon_reply ? `/bottles/replies/${r.id}/author` : `/bottles/${r.bottle_id}/author`, { method: 'POST', body: {} })
            who.textContent = !author ? '作者账号已不存在' : author.sub ? `作者：${author.name}（没有站内账号）` : `作者：${author.name}（@${author.username}）`
            if (author?.sub) {
              const block = btn('bt-act danger', author.blocked ? '解除封禁' : '封禁这个编号', async () => {
                author.blocked = (await api('/bottles/mini-users/' + author.sub, { method: 'PUT', body: { blocked: !author.blocked } })).blocked
                block.textContent = author.blocked ? '解除封禁' : '封禁这个编号'
              })
              x.after(block)
            }
            x.remove()
          }), who))
      return el
    }))
    empty()
    const kids = [list]
    if (st.owner) {
      const [cfg, log] = await Promise.all([api('/bottles/settings'), api('/bottles/author-log')])
      if (left) return
      const area = (label, rows) => { const ta = h('textarea', { class: 'input', rows: 5, 'aria-label': label }); ta.value = rows.join('\n'); return ta }
      const words = area('另外要拦的词，一行一个', cfg.words), allow = area('放行的词，一行一个', cfg.allow)
      let source = cfg.reward_source
      kids.push(h('section', { class: 'bt-form' }, h('h2', { class: 'bt-h2' }, '敏感词'),
        h('p', { class: 'bt-note' }, '国家领导人和政治敏感词已经内置，瓶子、回信、昵称都会检查。另外要拦的词，一行一个：'), words,
        h('p', { class: 'bt-note' }, '误拦了的词填在这里放行，一行一个：'), allow,
        h('div', { class: 'bt-go end' }, btn('btn btn-primary sm', '保存', async () => { const r = await api('/bottles/settings', { method: 'PUT', body: { words: words.value.split('\n'), allow: allow.value.split('\n') } }); words.value = r.words.join('\n'); allow.value = r.allow.join('\n'); toast('已保存', 'ok') }))))
      kids.push(h('section', { class: 'bt-form' }, h('h2', { class: 'bt-h2' }, '互动奖励来源'),
        chips('奖励来源', [['off', '不发'], ['owner', '站长账户出'], ['system', '系统新增']], () => source, (v) => { source = v; api('/bottles/settings', { method: 'PUT', body: { reward_source: v } }).then(() => toast('已保存', 'ok')).catch(say) }),
        h('p', { class: 'bt-note' }, `每份 1,000 D币，次日合并到账；每人每天最多得 10 份。「不发」期间的互动不补。因站长余额不足没发的：${fmt(cfg.reward_short)} 份（不补发）。`)))
      kids.push(h('section', { class: 'bt-form' }, h('h2', { class: 'bt-h2' }, '查看作者的记录'),
        log.items.length ? h('ul', { class: 'bt-log' }, log.items.map((x) => h('li', null, new Date(x.at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ' · 瓶子 ' + x.bottle_id))) : h('p', { class: 'bt-note' }, '还没有查看过。')))
    }
    page('管理', ...kids)
  }

  const m = path.match(/^\/bottles\/b\/(\d+)$/)
  if (m) return single(m[1])
  if (path === '/bottles/new') return compose()
  if (path === '/bottles/mine') return mine()
  if (path === '/bottles/admin') return admin()
  return home()
}
