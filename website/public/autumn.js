// 「死如秋叶」板块：好久不见（autumn-miss.js）、图文栏目。栏目名称、分类、规则都由服务端按权限下发，这里不写死。
const uuid = () => crypto.randomUUID?.() || ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16))
const LEAF = '<svg viewBox="0 0 24 24"><path d="M20.5 3.5C11 3.2 4 8.2 4 15.2c0 1.3.2 2.4.6 3.3C8 13.500 11.500 11 16 9c-4 2.800-7.300 6.300-9.800 11.500.9.3 1.800.5 2.800.5 7.500 0 11.800-7.500 11.500-17.500Z"/></svg>'
const FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-1.500 4L16 12H5"/></svg>'
const plain = (t) => t.replace(/```[\s\S]*?```/g, '').replace(/^#{1,3}\s+/gm, '').replace(/^>\s?/gm, '').replace(/\*\*|~~|`/g, '').replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, '$1').replace(/^\s*[-*+]\s+/gm, '').replace(/\s+/g, ' ').trim()

export async function mountAutumn(main, ctx) {
  const { user, api, h, icon, navigate, toast, onLeave, richText, avatar, fmtTime, confirm } = ctx
  let left = false
  const dialogs = new Set()
  onLeave(() => { left = true; for (const d of dialogs) d.remove(); dialogs.clear() })
  const path = location.pathname.replace(/\/+$/, '')
  const [, key = 'miss', sub = '', arg = ''] = path.match(/^\/autumn(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/) || []
  const leafIcon = (cls = '') => h('span', { class: 'au-leaf ' + cls, html: LEAF, 'aria-hidden': 'true' })
  const notFound = () => main.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, '这里什么都没有'), h('p', null, '页面不存在'), h('div', { class: 'empty-acts' }, h('a', { class: 'btn btn-primary sm', href: '/autumn', 'data-link': '' }, '回死如秋叶'))))

  const home = await api('/autumn/home')
  if (left) return
  home.onSeen = () => { home.fresh_gifts = 0; if (user) user.miss_gifts = 0 }
  const missPage = key === 'miss' || key === 'mine'
  if (!missPage && !home.boards.some(([k]) => k === key)) return notFound()
  const root = h('div', { class: 'au au-' + (missPage ? 'miss' : 'board') })
  const head = h('header', { class: 'au-head' },
    h('div', { class: 'au-brand' }, leafIcon(), h('h1', null, '死如秋叶'), h('p', null, missPage ? '想你了，有空回来坐坐' : '生如夏花之绚烂，死如秋叶之静美')),
    h('nav', { class: 'au-tabs', 'aria-label': '死如秋叶栏目' }, home.boards.map(([k, label]) =>
      h('a', { href: k === 'miss' ? '/autumn' : '/autumn/' + k, 'data-link': '', class: k === key || (k === 'miss' && missPage) ? 'on' : '', 'aria-current': k === key ? 'page' : null }, label))))
  const body = h('div', { class: 'au-body' }, h('div', { class: 'au-loading', role: 'status' }, '正在打开…'))
  root.append(head, body)
  main.replaceChildren(root)

  function openDialog(cls, label, ...kids) {
    const d = h('dialog', { class: 'au-dialog ' + cls, 'aria-label': label })
    d.append(h('button', { class: 'au-x', type: 'button', 'aria-label': '关闭', onclick: () => d.close() }, icon('close')), ...kids.flat().filter(Boolean))
    d.addEventListener('click', (e) => { if (e.target === d) d.close() })
    d.addEventListener('close', () => { dialogs.delete(d); d.remove() })
    dialogs.add(d); document.body.append(d); d.showModal()
    return d
  }
  const fail = (e, retry) => body.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, '暂时打不开'), h('p', null, e.message), h('div', { class: 'empty-acts' }, h('button', { class: 'btn btn-primary sm', type: 'button', onclick: retry }, '重试'))))

  if (missPage) {
    if (sub || path === '/autumn/miss') return notFound()
    const { createMiss } = await import('/autumn-miss.js?v=472f7fbf')
    if (left) return
    const miss = createMiss({ body, home, api, h, icon, toast, onLeave, avatar, fmtTime, confirm, openDialog, fail, isLeft: () => left })
    return key === 'mine' ? miss.mine() : miss.wall()
  }
  return board()

  // ==================== 图文栏目 ====================
  async function board() {
    const base = '/autumn/' + key
    let cfg
    try { cfg = await api(base + '/config') } catch (e) { if (!left) e.status === 404 ? notFound() : fail(e, board); return }
    if (left) return
    const strict = cfg.confirms.length > 0, catName = new Map(cfg.categories)
    if (strict && !sessionStorage.getItem('au:ok:' + user.id)) {
      body.replaceChildren(h('section', { class: 'au-gate' }, leafIcon(), h('h2', null, cfg.label), h('p', null, '请先确认下面的内容。'), rulesList(),
        h('div', { class: 'au-gate-acts' }, h('a', { class: 'btn btn-ghost', href: '/autumn', 'data-link': '' }, '离开'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { sessionStorage.setItem('au:ok:' + user.id, '1'); go() } }, '我已年满 18 周岁'))))
      return
    }
    return go()

    function go() {
      if (!sub) return list()
      if (sub === 'new' && !arg) return editor()
      if (sub === 'reports' && !arg && cfg.mod) return reports()
      if (sub === 'p' && /^[a-f0-9]{20}$/.test(arg)) return detail(arg)
      return notFound()
    }
    function rulesList() { return h('ul', { class: 'au-rules' }, cfg.rules.map((r) => h('li', null, r))) }
    function who(p, size = 26) {
      return p.author ? h('a', { class: 'au-who', href: '/u/' + encodeURIComponent(p.author.username), 'data-link': '' }, avatar(p.author.avatar, p.author.name, size), h('span', null, p.author.name))
        : h('span', { class: 'au-who anon' }, h('span', { class: 'au-anon-av', style: { width: size + 'px', height: size + 'px' } }, leafIcon()), h('span', null, p.op === true ? '匿名楼主' : '匿名'))
    }
    function dayText(at) { const d = new Date((at + 28800) * 1000).toISOString().slice(0, 10), t = new Date(Date.now() + 288e5).toISOString().slice(0, 10); return d === t ? '今天' : d }
    function when(p) { return h('time', { class: 'muted' }, p.anon ? dayText(p.at) : fmtTime(p.at)) }
    function picture(m, attrs = {}) {
      const img = h('img', { src: m.u, loading: 'lazy', decoding: 'async', alt: '', width: m.w || null, height: m.h || null, ...attrs })
      img.addEventListener('error', () => img.replaceWith(h('span', { class: 'au-img-bad' }, '图片已不可用')))
      return img
    }

    async function list() {
      const q = new URLSearchParams(location.search), st = { category: catName.has(q.get('category')) ? q.get('category') : '', mine: q.get('mine') === '1' }
      const chips = h('div', { class: 'au-chips', role: 'group', 'aria-label': '分类' }), grid = h('div', { class: 'au-grid' }), more = h('button', { class: 'btn btn-ghost au-more', type: 'button', hidden: true, onclick: () => load() }, '再看一些')
      const pick = (patch) => {
        Object.assign(st, patch)
        const s = new URLSearchParams(Object.entries({ category: st.category, mine: st.mine ? '1' : '' }).filter(([, v]) => v)).toString()
        history.replaceState(history.state, '', base + (s ? '?' + s : '')); draw(); next = ''; load(true)
      }
      const chip = (label, on, fn) => h('button', { class: 'au-chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), onclick: fn }, label)
      const draw = () => chips.replaceChildren(chip('全部', !st.category && !st.mine, () => pick({ category: '', mine: false })), ...cfg.categories.map(([k, l]) => chip(l, st.category === k, () => pick({ category: k, mine: false }))), chip('我发的', st.mine, () => pick({ mine: !st.mine, category: '' })))
      let next = '', seq = 0
      async function load(reset) {
        const my = ++seq
        more.disabled = true
        try {
          const r = await api(`${base}/posts?` + new URLSearchParams(Object.entries({ category: st.category, mine: st.mine ? '1' : '', before: next }).filter(([, v]) => v)))
          if (left || my !== seq) return
          if (reset) grid.replaceChildren()
          grid.append(...r.items.map((p, i) => card(p, reset && i === 0 && !st.mine && r.items.length > 2)))
          if (!grid.childElementCount) grid.append(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, '这里还没有落笔'), h('p', null, st.mine ? '你还没有发过' : '写下第一篇吧')))
          next = r.next; more.hidden = !next
        } catch (e) { if (my === seq && !left) toast(e.message, 'err') }
        more.disabled = false
      }
      draw()
      body.replaceChildren(h('div', { class: 'au-bar' }, h('p', { class: 'au-intro' }, cfg.intro), h('div', { class: 'au-bar-acts' }, cfg.mod && h('a', { class: 'btn btn-ghost sm', href: base + '/reports', 'data-link': '' }, '处理举报'), h('a', { class: 'btn btn-primary sm', href: base + '/new', 'data-link': '' }, icon('pen', 'i tiny'), '写一篇'))), chips, grid, more)
      load(true)
    }
    function card(p, lead) {
      const href = `${base}/p/${p.pid}`
      return h('article', { class: `au-card c-${p.category}${lead ? ' lead' : ''}${p.cover ? ' pic' : ''}` },
        p.cover && h('a', { class: 'au-cover' + (strict ? ' veil' : ''), href, 'data-link': '', tabindex: '-1', 'aria-hidden': 'true' }, picture(p.cover), p.media_count > 1 && h('i', null, p.media_count + ' 图')),
        h('div', { class: 'au-card-main' }, h('span', { class: 'au-cat' }, catName.get(p.category) || ''), h('h2', null, h('a', { href, 'data-link': '' }, p.title)), p.excerpt && h('p', { class: 'au-ex' }, plain(p.excerpt)),
          p.link_count > 0 && h('span', { class: 'au-res-n' }, icon('link', 'i tiny'), `${p.link_count} 个资源`),
          h('footer', null, who(p, 22), when(p), h('span', { class: 'grow' }), h('span', { class: 'au-n' }, icon('heart', 'i tiny'), p.likes), h('span', { class: 'au-n' }, icon('chat', 'i tiny'), p.comments))))
    }

    async function detail(pid) {
      let p
      try { p = (await api(`${base}/posts/${pid}`)).post } catch (e) { if (!left) e.status === 404 ? notFound() : fail(e, () => detail(pid)); return }
      if (left) return
      const like = h('button', { class: 'au-like', type: 'button' })
      const drawLike = () => { like.className = 'au-like' + (p.liked ? ' on' : ''); like.setAttribute('aria-pressed', String(p.liked)); like.replaceChildren(icon('heart'), String(p.likes)) }
      like.onclick = async () => { like.disabled = true; try { Object.assign(p, await api(`${base}/posts/${pid}/like`, { method: 'PUT', body: { on: !p.liked } })); drawLike() } catch (e) { toast(e.message, 'err') } like.disabled = false }
      drawLike()
      const gallery = p.media.length > 0 && h('div', { class: 'au-pics n' + Math.min(p.media.length, 4) }, p.media.map((m, i) => {
        const b = h('button', { type: 'button', class: strict ? 'veil' : '', 'aria-label': strict ? '点击显示图片' : '看大图', onclick: () => { if (b.classList.contains('veil')) { b.classList.remove('veil'); b.setAttribute('aria-label', '看大图') } else lightbox(p.media, i) } }, picture(m))
        return b
      }))
      const comments = h('section', { class: 'au-comments', 'aria-label': '评论' })
      body.replaceChildren(h('article', { class: 'au-article c-' + p.category },
        h('a', { class: 'au-back', href: base, 'data-link': '' }, icon('chevL', 'i tiny'), '返回' + cfg.label),
        h('header', null, h('span', { class: 'au-cat' }, catName.get(p.category) || ''), h('h1', null, p.title), h('div', { class: 'au-by' }, who(p, 30), when(p), p.mine && p.anon && h('span', { class: 'au-mine' }, '你的匿名帖，只有你看得到这个标记'))),
        p.body && h('div', { class: 'au-prose md' }, richText(p.body, { md: true })), gallery,
        p.links.length > 0 && h('section', { class: 'au-links', 'aria-label': '资源' }, p.links.map((l) => h('a', { class: 'au-link', href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow', referrerpolicy: 'no-referrer' },
          h('span', { class: 'au-link-ic', 'aria-hidden': 'true' }, (new URL(l.url).hostname.replace(/^www\./, '')[0] || '?').toUpperCase()), h('span', { class: 'au-link-t' }, h('strong', null, l.title), l.note && h('span', null, l.note), h('small', null, new URL(l.url).hostname)), icon('ext', 'i tiny')))),
        h('div', { class: 'au-acts' }, like, h('span', { class: 'grow' }), !p.mine && h('button', { class: 'btn-text sm', type: 'button', onclick: () => report(pid) }, h('span', { class: 'i tiny', html: FLAG }), '举报'),
          p.can_delete && h('button', { class: 'btn-text sm danger', type: 'button', onclick: async () => { if (!await confirm('删除这篇？图片会一并删除，不能恢复。')) return; try { await api(`${base}/posts/${pid}`, { method: 'DELETE' }); toast('已删除', 'ok'); navigate(base) } catch (e) { toast(e.message, 'err') } } }, p.mine ? '删除' : '移除'))), comments)
      drawComments(comments, p)
    }
    function drawComments(box, p) {
      const listEl = h('div', { class: 'au-clist' }), more = h('button', { class: 'btn-text', type: 'button', hidden: true }, '更多评论')
      let next = '', rid = uuid()
      const load = async (reset) => {
        try {
          const r = await api(`${base}/posts/${p.pid}/comments` + (next && !reset ? '?after=' + next : ''))
          if (left) return
          if (reset) listEl.replaceChildren()
          listEl.append(...r.items.map((c) => h('div', { class: 'au-c' + (c.op ? ' op' : '') }, h('div', { class: 'au-c-head' }, who(c, 26), c.op && !c.anon && h('span', { class: 'au-op' }, '楼主'), when(c), h('span', { class: 'grow' }),
            !c.mine && h('button', { class: 'btn-text sm', type: 'button', onclick: () => report(p.pid, c.cid) }, '举报'),
            c.can_delete && h('button', { class: 'btn-text sm danger', type: 'button', onclick: async () => { if (!await confirm('删除这条评论？')) return; try { await api(`${base}/posts/${p.pid}/comments/${c.cid}`, { method: 'DELETE' }); load(true) } catch (e) { toast(e.message, 'err') } } }, '删除')), h('div', { class: 'au-c-body' }, richText(c.body, { md: 'lite' })))))
          if (!listEl.childElementCount) listEl.append(h('p', { class: 'muted' }, '还没有评论'))
          next = r.next; more.hidden = !next
        } catch (e) { if (!left) toast(e.message, 'err') }
      }
      more.onclick = () => load()
      const ta = h('textarea', { class: 'input', rows: 3, maxlength: 2000, 'aria-label': '评论', placeholder: p.mine && p.anon ? '你会以「匿名楼主」的身份回复' : '说说你的想法…' }), send = h('button', { class: 'btn btn-primary sm', type: 'submit' }, '发表')
      box.replaceChildren(h('h2', null, '评论'), h('form', { class: 'au-cform', onsubmit: async (e) => {
        e.preventDefault()
        if (!ta.value.trim()) return
        send.disabled = true
        try { await api(`${base}/posts/${p.pid}/comments`, { method: 'POST', body: { body: ta.value, request_id: rid } }); rid = uuid(); ta.value = ''; next = ''; await load(true) } catch (err) { toast(err.message, 'err') }
        send.disabled = false
      } }, ta, h('div', { class: 'row-end' }, p.mine && p.anon && h('span', { class: 'muted sm' }, '匿名身份回复'), h('span', { class: 'grow' }), send)), listEl, more)
      load(true)
    }
    function report(pid, cid) {
      let reason = ''
      const note = h('textarea', { class: 'input', rows: 3, maxlength: 300, placeholder: '补充说明（可不填）', 'aria-label': '补充说明' }), send = h('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, '提交举报')
      const d = openDialog('au-report', '举报', h('h2', null, cid ? '举报评论' : '举报这篇'), h('form', { onsubmit: async (e) => {
        e.preventDefault(); send.disabled = true
        try { const r = await api(`${base}/posts/${pid}/report`, { method: 'POST', body: { reason, note: note.value, ...(cid ? { cid } : {}) } }); d.close(); toast(r.hidden ? '已举报，内容已先隐藏等待处理' : '已举报，管理员会处理', 'ok'); if (r.hidden && !cid) navigate(base) } catch (err) { send.disabled = false; toast(err.message, 'err') }
      } }, h('div', { class: 'au-reasons' }, cfg.reasons.map(([k, l]) => h('label', null, h('input', { type: 'radio', name: 'r', value: k, onchange: () => { reason = k; send.disabled = false } }), l))), note, h('div', { class: 'row-end' }, send)))
    }
    function lightbox(media, start) {
      let i = start
      const stage = h('div', { class: 'au-lb-img' })
      const show = () => stage.replaceChildren(picture(media[i], { loading: 'eager', width: null, height: null }))
      const nav = (n) => { i = (i + n + media.length) % media.length; show() }
      show()
      const d = openDialog('au-lb', '查看图片', stage, media.length > 1 && h('button', { class: 'au-lb-nav l', type: 'button', 'aria-label': '上一张', onclick: () => nav(-1) }, icon('chevL')), media.length > 1 && h('button', { class: 'au-lb-nav r', type: 'button', 'aria-label': '下一张', onclick: () => nav(1) }, icon('chevR')))
      d.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') nav(-1); if (e.key === 'ArrowRight') nav(1) })
      stage.addEventListener('click', (e) => { if (e.target === stage) d.close() })
    }

    // ---------- 写一篇 ----------
    function editor() {
      const rid = uuid(), shots = [], linkRows = []
      let category = cfg.categories[0][0], busy = false
      const title = h('input', { class: 'input au-title', maxlength: 80, placeholder: '标题', required: true, 'aria-label': '标题' })
      const ta = h('textarea', { class: 'input au-ta', rows: 14, maxlength: 20000, 'aria-label': '正文', placeholder: '写下你的体会。空一行就是新的一段；上面的按钮可以加小标题、引用和列表。' })
      const count = h('span', { class: 'muted sm' })
      const preview = h('div', { class: 'au-prose md au-preview', hidden: true })
      const onText = () => { count.textContent = [...ta.value].length + ' 字' }
      ta.addEventListener('input', onText); onText()
      const wrapLine = (mark) => { const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1; ta.setRangeText(mark, s, s, 'end'); ta.focus(); onText() }
      const wrap = (m) => { const a = ta.selectionStart, b = ta.selectionEnd; ta.setRangeText(m + (ta.value.slice(a, b) || '文字') + m, a, b, 'select'); ta.focus(); onText() }
      const tool = (label, ic, fn) => h('button', { class: 'btn-icon', type: 'button', title: label, 'aria-label': label, onclick: fn }, icon(ic))
      const pv = h('button', { class: 'btn-text sm', type: 'button', 'aria-pressed': 'false', onclick: () => { const on = preview.hidden; preview.hidden = !on; ta.hidden = on; pv.textContent = on ? '继续写' : '预览'; pv.setAttribute('aria-pressed', String(on)); if (on) preview.replaceChildren(...richText(ta.value || '还没有内容', { md: true }).flat(Infinity)) } }, '预览')
      const cats = h('div', { class: 'au-chips', role: 'group', 'aria-label': '分类' })
      const drawCats = () => cats.replaceChildren(...cfg.categories.map(([k, l]) => h('button', { class: 'au-chip' + (k === category ? ' on' : ''), type: 'button', 'aria-pressed': String(k === category), onclick: () => { category = k; drawCats() } }, l)))
      drawCats()
      const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, class: 'sr-only', tabindex: '-1' })
      const tray = h('div', { class: 'au-tray' })
      const drawTray = () => tray.replaceChildren(...shots.map((s, i) => h('figure', { class: s.err ? 'err' : s.out ? '' : 'up' }, h('img', { src: s.url, alt: '' }), h('figcaption', null, s.err || (s.out ? '' : '上传中')),
        h('button', { type: 'button', 'aria-label': '移除这张', onclick: () => { URL.revokeObjectURL(s.url); shots.splice(i, 1); drawTray() } }, icon('close', 'i tiny')))), ...(shots.length < 9 ? [h('button', { class: 'au-add', type: 'button', onclick: () => fileIn.click() }, icon('image'), h('span', null, '加图片'), h('small', null, `${shots.length}/9`))] : []))
      const addFiles = (files) => {
        for (const f of files) {
          if (shots.length >= 9) { toast('最多 9 张图片', 'err'); break }
          if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { toast('只支持 PNG / JPG / GIF / WebP', 'err'); continue }
          const s = { url: URL.createObjectURL(f) }
          shots.push(s)
          s.job = (async () => {
            const { file, w, ht } = await slim(f), fd = new FormData()
            fd.append('file', file); fd.append('nonce', uuid())
            const r = await api(`${base}/uploads`, { method: 'POST', body: fd })
            s.out = { key: r.key, w, h: ht }
          })().catch((e) => { s.err = e.message }).finally(() => { if (!left) drawTray() })
        }
        drawTray()
      }
      fileIn.addEventListener('change', () => { addFiles([...fileIn.files]); fileIn.value = '' })
      ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); addFiles(fs) } })
      onLeave(() => shots.forEach((s) => URL.revokeObjectURL(s.url)))
      const linksEl = h('div', { class: 'au-ledit' })
      const drawLinks = () => linksEl.replaceChildren(...linkRows.map((l, i) => h('div', { class: 'au-lrow' }, l.url, l.title, l.note, h('button', { class: 'btn-icon', type: 'button', 'aria-label': '移除这个资源', onclick: () => { linkRows.splice(i, 1); drawLinks() } }, icon('close')))),
        ...(linkRows.length < 8 ? [h('button', { class: 'btn btn-ghost sm', type: 'button', onclick: () => { linkRows.push({ url: h('input', { class: 'input', type: 'url', placeholder: 'https://', 'aria-label': '资源链接', maxlength: 2048 }), title: h('input', { class: 'input', placeholder: '名称', 'aria-label': '资源名称', maxlength: 80 }), note: h('input', { class: 'input', placeholder: '一句话说明', 'aria-label': '资源说明', maxlength: 160 }) }); drawLinks(); linkRows.at(-1).url.focus() } }, icon('plus', 'i tiny'), '加一个资源链接')] : []))
      drawTray(); drawLinks()
      const anon = h('input', { type: 'checkbox', role: 'switch' })
      const checks = cfg.confirms.map((t) => { const i = h('input', { type: 'checkbox', required: true }); return { i, el: h('label', { class: 'au-check' }, i, h('span', null, t)) } })
      const pub = h('button', { class: 'btn btn-primary', type: 'submit' }, '发布')
      body.replaceChildren(h('form', { class: 'au-editor', onsubmit: async (e) => {
        e.preventDefault()
        if (busy) return
        busy = true; pub.disabled = true; pub.textContent = '发布中…'
        try {
          await Promise.all(shots.map((s) => s.job))
          if (shots.some((s) => s.err)) throw new Error('有图片没传上去，请移除后重试')
          const r = await api(`${base}/posts`, { method: 'POST', body: { request_id: rid, title: title.value, body: ta.value, category, anon: anon.checked, media: shots.map((s) => s.out),
            links: linkRows.filter((l) => l.url.value.trim()).map((l) => ({ url: l.url.value, title: l.title.value, note: l.note.value })), ...(checks.length ? { confirms: checks.map((x) => x.i.checked), rules_version: cfg.rules_version } : {}) } })
          toast('发布了', 'ok'); navigate(`${base}/p/${r.pid}`, { replace: true })
        } catch (err) { toast(err.message, 'err'); busy = false; pub.disabled = false; pub.textContent = '发布' }
      } }, h('a', { class: 'au-back', href: base, 'data-link': '' }, icon('chevL', 'i tiny'), '返回' + cfg.label), h('h2', null, '写一篇'),
      strict && h('section', { class: 'au-notice' }, h('strong', null, '发布规则'), rulesList()), cats, title,
      h('div', { class: 'au-tools' }, tool('小标题', 'heading', () => wrapLine('## ')), tool('引用', 'quote', () => wrapLine('> ')), tool('列表', 'list', () => wrapLine('- ')), tool('加粗', 'bold', () => wrap('**')), h('span', { class: 'grow' }), count, pv), ta, preview,
      h('h3', null, '图片'), h('p', { class: 'muted sm' }, '会自动去掉拍摄地点、设备等信息。'), fileIn, tray, h('h3', null, '资源'), linksEl,
      !strict && h('section', { class: 'au-notice soft' }, rulesList()),
      h('label', { class: 'au-switch' }, anon, h('span', null, '匿名发布', h('small', null, '其他人看不到是谁发的，时间只显示到天，你在这篇下面的回复显示为「匿名楼主」。仅在处理举报时，站长可以查看作者，并会留下记录。'))),
      checks.map((x) => x.el), h('div', { class: 'row-end' }, pub)))
    }
    // 画到画布上重新编码：缩小体积，顺带去掉拍摄信息（服务端还会再清一次）。动图原样上传
    async function slim(f) {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => { throw new Error('图片打不开，请换一张') })
      const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), ht = Math.max(1, Math.round(bmp.height * k))
      if (f.type === 'image/gif') { const r = { file: f, w: bmp.width, ht: bmp.height }; bmp.close(); return r }
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = ht
      cv.getContext('2d').drawImage(bmp, 0, 0, w, ht); bmp.close()
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/webp', 0.86))
      if (!blob) throw new Error('图片处理失败，请换一张')
      return { file: new File([blob], 'image', { type: blob.type }), w, ht }
    }

    // ---------- 处理举报 ----------
    async function reports() {
      let d
      try { d = await api(base + '/reports') } catch (e) { if (!left) fail(e, reports); return }
      if (left) return
      const act = async (r, action) => { try { await api(`${base}/reports/${r.id}`, { method: 'POST', body: { action } }); toast('已处理', 'ok'); reports() } catch (e) { toast(e.message, 'err') } }
      body.replaceChildren(h('section', { class: 'au-reports' }, h('a', { class: 'au-back', href: base, 'data-link': '' }, icon('chevL', 'i tiny'), '返回' + cfg.label), h('h2', null, '待处理的举报'),
        d.items.length ? d.items.map((r) => {
          const name = h('span', { class: 'au-mine' })
          return h('article', { class: 'au-rep' }, h('header', null, h('strong', null, r.reason), h('span', { class: 'muted' }, `${r.kind === 'post' ? '帖子' : '评论'} · 举报人 ${r.reporter} · ${fmtTime(r.at)}`), r.hidden && h('span', { class: 'au-op' }, '已先隐藏')),
            r.note && h('p', null, '说明：', r.note), h('blockquote', null, h('b', null, r.title), h('p', null, r.body), r.media.length > 0 && h('div', { class: 'au-pics' }, r.media.map((m) => { const b = h('button', { type: 'button', class: 'veil', onclick: () => b.classList.remove('veil') }, picture(m)); return b }))),
            h('div', { class: 'row-end' }, r.anon && d.owner && h('button', { class: 'btn-text sm', type: 'button', onclick: async (e) => { if (!await confirm('查看这条匿名内容的作者？本次查看会留下记录。')) return; const b = e.target; try { const x = await api(`${base}/reports/${r.id}/reveal`, { method: 'POST', body: {} }); name.textContent = `作者：${x.name}（@${x.username}）`; b.remove() } catch (err) { toast(err.message, 'err') } } }, '查看匿名作者'), name, h('span', { class: 'grow' }),
              h('button', { class: 'btn btn-ghost sm', type: 'button', onclick: () => act(r, 'keep') }, '保留'), h('button', { class: 'btn btn-primary sm', type: 'button', onclick: async () => { if (await confirm('移除这条内容？不能恢复。')) act(r, 'remove') } }, '移除')))
        }) : h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, '没有待处理的举报'))))
    }
  }
}
