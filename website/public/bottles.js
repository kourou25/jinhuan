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
  const person = (u, size) => link('bt-person', '/u/' + encodeURIComponent(u.username), avatar(u.avatar, u.name, size), h('span', null, u.name))
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
    navigate(`/bottles/b/${r.bottle.id}?d=1`)
  })
  const quotaText = (st) => [st.draw_left ? `今天还能免费捞 ${st.draw_left} 个` : st.draw_price ? `再捞一个 ${fmt(st.draw_price)} D币` : '今天不能再捞了',
    st.throw_left ? `免费扔 ${st.throw_left} 个` : st.throw_price ? `再扔一个 ${fmt(st.throw_price)} D币` : '今天不能再扔了'].join('，')

  async function report(url) {
    const v = await askChoice('举报', '管理员会看到内容和原因，看不到是谁举报的。', [...REPORT_REASONS.map((r) => [r, r, 'btn-ghost']), ['', '取消', 'btn-ghost']])
    if (!v) return
    await api(url, { method: 'POST', body: { reason: v } })
    toast('已提交举报', 'ok')
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
        b.mine && !b.expired && b.state === 'ok' && (b.sunk ? '已沉底，不会再被捞到' : `漂到 ${dayText(b.expires_day)}`)].filter(Boolean)
      el.replaceChildren(...[
        h('header', { class: 'bt-head' },
          b.anon ? h('span', { class: 'bt-face' }, mark('md')) : avatar(b.user.avatar, b.user.name, 40),
          h('div', { class: 'bt-who' },
            h('div', { class: 'bt-name' }, b.anon ? h('strong', null, b.nick) : link('', '/u/' + encodeURIComponent(b.user.username), h('strong', null, b.user.name)), badgeChip(b.badge), b.mine && h('span', { class: 'bt-tag' }, '我')),
            h('div', { class: 'bt-meta' }, [dayText(b.day), b.mood].filter(Boolean).join(' · ')))),
        full ? h('div', { class: 'bt-body' }, b.body) : link('bt-body', href, b.body),
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
    ta.value = keep.get(DRAFT)
    const count = h('span', { class: 'bt-note' })
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; const n = [...ta.value.trim()].length; count.textContent = `${n} / ${st.max}`; count.classList.toggle('over', n > st.max); keep.set(DRAFT, ta.value) }
    ta.addEventListener('input', fit)
    const nick = h('input', { class: 'input', maxlength: 12, value: st.nick, 'aria-label': '这个瓶子的昵称' })
    const badge = h('input', { type: 'checkbox', checked: true })
    const face = h('div', { class: 'bt-identity' })
    const paintFace = () => face.replaceChildren(...(anon ? [
      h('div', { class: 'bt-row' }, nick, btn('btn btn-ghost sm', '换一个', async () => { nick.value = (await api('/bottles')).nick })),
      h('label', { class: 'bt-check' }, badge, '昵称后面显示徽章'),
      h('p', { class: 'bt-note' }, '昵称只用在这一个瓶子上。每次都用同一个昵称，别人可能会认出是同一个人。')] : [
      h('div', { class: 'bt-row' }, person({ username: user.username, name: user.nick || user.name || user.username, avatar: user.avatar }, 28)),
      h('p', { class: 'bt-note' }, '会显示你的昵称和头像，扔出去以后不能改回匿名。')]))
    paintFace()
    const field = (label, ...kids) => h('div', { class: 'bt-field' }, h('div', { class: 'bt-label' }, label), ...kids)
    const OP = crypto.randomUUID() // 整个页面一个编号：中途断线重试也只会扔出一个
    const send = btn('btn btn-primary', st.throw_price ? `扔进海里（${fmt(st.throw_price)} D币）` : '扔进海里', async () => {
      const r = await paid(st, 'throw', (op, price) => api('/bottles', { method: 'POST', body: { op, body: ta.value, mood, days, anon, nick: anon ? nick.value : '', show_badge: badge.checked, price } }), OP)
      if (!r) return
      keep.set(DRAFT, ''); LISTS.clear()
      toast('瓶子漂走了', 'ok')
      // 写完的表单不留在历史里：从瓶子返回就是写之前的页面
      if (!left) navigate('/bottles/b/' + r.bottle.id, { replace: true })
    })
    page('扔一个瓶子',
      h('div', { class: 'bt-card bt-compose' }, ta, h('div', { class: 'bt-foot' }, h('span', { class: 'grow' }), count)),
      field('身份', chips('身份', [[true, '匿名'], [false, '实名']], () => anon, (v) => { anon = v; paintFace() }), face),
      field('心情（可不选）', chips('心情', st.moods.map((m) => [m, m]), () => mood, (v) => { mood = mood === v ? '' : v })),
      field('漂多久', chips('有效期', st.days.map((d) => [d, `${d} 天`]), () => days, (v) => { days = v }), h('p', { class: 'bt-note' }, '过了有效期，别人捞不到，你自己一直能看到。')),
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
        r.user ? person(r.user, 28) : h('span', { class: 'bt-person host' }, mark('sm'), h('span', null, b.mine ? '瓶主（我）' : '瓶主')),
        r.user && r.host && h('span', { class: 'bt-tag' }, '瓶主'),
        h('div', { class: 'bt-reply-main' },
          r.reply_to && h('p', { class: 'bt-to' }, '回复 ' + r.reply_to.name),
          h('p', { class: 'bt-reply-body' }, r.body),
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
    const ta = h('textarea', { class: 'input', rows: 2, 'aria-label': '回信', placeholder: b.mine && b.anon ? '以「瓶主」的身份回信，不会显示你是谁' : '写一封回信，会显示你的昵称和头像' })
    let op = crypto.randomUUID()
    const form = h('div', { class: 'bt-form' }, to, ta, h('div', { class: 'bt-go end' }, btn('btn btn-primary sm', '寄出', async () => {
      const r = await api(`/bottles/${id}/replies`, { method: 'POST', body: { op, body: ta.value, reply_to: replyTo?.id ?? null, as_host: b.mine } })
      op = crypto.randomUUID(); ta.value = ''; replyTo = null; paintTo()
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
        h('p', { class: 'bt-meta' }, [r.kind === 'bottle' ? '瓶子' : r.host ? '瓶主的回信' : `${r.name} 的回信`, `${r.n} 人举报`, r.hidden && '已自动隐藏'].filter(Boolean).join(' · ')),
        h('div', { class: 'bt-body' }, r.body),
        r.reasons.length > 0 && h('p', { class: 'bt-meta' }, '原因：' + [...new Set(r.reasons)].join('、')),
        h('div', { class: 'bt-acts' }, btn('bt-act', '保留', done('keep')), btn('bt-act danger', '删除', done('delete')), link('bt-act', '/bottles/b/' + r.bottle_id, '打开瓶子'),
          st.owner && r.host && btn('bt-act', '查看作者', async (x) => {
            if (await askChoice('查看作者？', '这次查看会留下记录。', [['yes', '查看', 'btn-primary'], ['no', '算了', 'btn-ghost']]) !== 'yes') return
            const { author } = await api(`/bottles/${r.bottle_id}/author`, { method: 'POST', body: {} })
            who.textContent = author ? `作者：${author.name}（@${author.username}）` : '作者账号已不存在'
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
