// 「好久不见」：把很久没来的朋友的照片挂在串灯下，说声想你，或者送份礼物
const GIFT_ICON = { candy: '🍬', tea: '🧋', postcard: '💌', lamp: '💡', scarf: '🧣', ticket: '🎫', dinner: '🍲' }
const PLANE = '<svg viewBox="0 0 64 40"><path d="M2 20 62 3 40 37 28 25Z" fill="#fff"/><path d="M62 3 28 25l-2 13 7-8Z" fill="#e9d6bd"/></svg>'
const rnd = (n) => { let x = Math.abs(Number(n)) % 2147483647 || 1; x = (x * 48271) % 2147483647; return () => (x = (x * 48271) % 2147483647) / 2147483647 }
const money = (n) => Number(n).toLocaleString('zh-CN')
const uuid = () => crypto.randomUUID?.() || ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16))

export function createMiss({ body, home, api, h, icon, toast, onLeave, avatar, fmtTime, confirm, openDialog, fail, isLeft }) {
  const giftTotal = (p) => Object.values(p.gifts).reduce((a, b) => a + b, 0)
  const photo = (p, size) => h('span', { class: 'am-photo' }, avatar(p.avatar, p.name, size))

  // ---------- 照片墙 ----------
  async function wall() {
    let data
    try { data = await api('/autumn/miss') } catch (e) { if (!isLeft()) fail(e, wall); return }
    if (isLeft()) return
    const people = data.people
    const field = h('div', { class: 'am-field' })
    const planes = h('div', { class: 'am-planes', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { html: PLANE, style: { '--t': [18, 46, 74][i] + '%', '--d': [26, 34, 30][i] + 's', '--w': [-3, -17, -24][i] + 's' } })))
    const card = h('div', { class: 'am-hello' }, h('span', { class: 'am-stamp', 'aria-hidden': 'true' }, h('b', null, '尽欢'), h('i', null, '想念')),
      h('h2', null, '好久不见'), h('p', null, '想你了，有空回来坐坐。'), h('small', null, people.length ? `正在想念 ${people.length} 位朋友` : '朋友们都在，真好'))
    const scene = h('section', { class: 'am-scene', 'aria-label': '好久不见' }, h('div', { class: 'am-sun', 'aria-hidden': 'true' }), planes, h('div', { class: 'am-stage' }, card, field))

    const polaroid = (p) => {
      const r = rnd(p.id), badge = h('span', { class: 'am-badge' })
      const draw = () => { const g = giftTotal(p); badge.replaceChildren(...[p.misses > 0 && h('span', null, icon('heart', 'i tiny'), p.misses), g > 0 && h('span', null, '🎁', g)].filter(Boolean)); badge.hidden = !p.misses && !g }
      draw()
      return h('button', { class: `am-card t${p.tier}`, type: 'button', 'aria-label': `想念${p.name}`, style: { '--r': (r() * 5 - 2.5).toFixed(2) + 'deg', '--d': (4 + r() * 3).toFixed(1) + 's', '--w': (-r() * 4).toFixed(1) + 's' }, onclick: () => open(p, draw) },
        h('span', { class: 'am-clip', 'aria-hidden': 'true' }), photo(p, 120), h('span', { class: 'am-name' }, p.name), badge)
    }
    const cards = people.map(polaroid)
    let last = ''
    // 每根串灯挂几张，照片跟着绳子的弧度垂下来
    const layout = () => {
      const w = field.clientWidth, per = Math.max(2, Math.min(6, Math.floor(w / 172)))
      if (!w || last === String(per)) return
      last = String(per)
      const rows = []
      for (let i = 0, n = per; i < cards.length; i += n, n = per) rows.push(cards.slice(i, i + n))
      field.replaceChildren(...rows.map((row, k) => {
        const n = row.length, bulbs = per * 2 + 1
        // 大照片放中间
        const line = []
        row.forEach((c, i) => (i % 2 ? line.push(c) : line.unshift(c)))
        const sag = (x) => 34 * (1 - (2 * x - 1) ** 2)
        return h('div', { class: 'am-row', style: { '--n': n } },
          h('span', { class: 'am-string', 'aria-hidden': 'true', html: `<svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d="M0 3Q50 71 100 3" fill="none" vector-effect="non-scaling-stroke"/></svg>` }),
          Array.from({ length: bulbs }, (_, i) => { const x = (i + 0.5) / bulbs; return h('i', { class: 'am-bulb', 'aria-hidden': 'true', style: { left: (x * 100).toFixed(2) + '%', top: (3 + sag(x)).toFixed(1) + 'px', '--w': (((i * 7 + k * 3) % 10) / -3).toFixed(1) + 's' } }) }),
          line.map((c, i) => h('div', { class: 'am-slot', style: { '--y': (sag((i + 0.5) / n) - 2).toFixed(1) + 'px' } }, c)))
      }))
    }
    const ro = new ResizeObserver(layout)
    onLeave(() => ro.disconnect())

    function open(p, redraw) {
      const count = h('strong', null, String(p.misses)), shelf = h('div', { class: 'am-shelf' })
      const drawShelf = () => { const g = data.gifts.filter((x) => p.gifts[x.key]); shelf.replaceChildren(...(g.length ? g.map((x) => h('span', { title: x.name }, h('i', { 'aria-hidden': 'true' }, GIFT_ICON[x.key] || '🎁'), h('b', null, '×' + p.gifts[x.key]), h('span', { class: 'sr-only' }, x.name))) : [h('span', { class: 'muted' }, '还没有人送过礼物')])) }
      drawShelf()
      const miss = h('button', { class: 'btn btn-primary', type: 'button', disabled: p.missed, onclick: async () => {
        miss.disabled = true
        try { const r = await api(`/autumn/miss/${p.id}/hello`, { method: 'POST', body: {} }); p.misses = r.misses; p.missed = true; count.textContent = r.misses; miss.textContent = '今天说过了'; redraw() } catch (e) { miss.disabled = false; toast(e.message, 'err') }
      } }, p.missed ? '今天说过了' : '说声想你')
      const d = openDialog('am-letter', '想念' + p.name, h('div', { class: 'am-letter-top' }, h('div', { class: 'am-big' }, h('span', { class: 'am-tape', 'aria-hidden': 'true' }), photo(p, 160), h('span', { class: 'am-name' }, p.name)),
        h('div', { class: 'am-letter-text' }, h('p', { class: 'am-words' }, p.words), h('p', null, p.joined.replace('-', ' 年 ') + ' 月来到尽欢'), h('p', null, `一起热闹过 ${p.days} 天`), h('p', null, '被想念 ', count, ' 次'))),
        h('h3', null, '收到的礼物'), shelf,
        h('div', { class: 'am-acts' }, miss, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { d.close(); give(p, () => redraw()) } }, '送份礼物'), h('a', { class: 'btn btn-ghost', href: '/u/' + encodeURIComponent(p.username), 'data-link': '', onclick: () => d.close() }, '看看 TA 发过的图')))
    }

    // 送礼：同一次操作用同一个请求编号，没收到结果时只能重试核对，不会重复扣款
    async function give(p, redraw) {
      let pick = data.gifts[0], nonce = uuid(), busy = false, unknown = false, balance = null
      const bal = h('span', { class: 'muted' }, '正在读取余额…'), note = h('textarea', { class: 'input', rows: 2, maxlength: 80, placeholder: '写句话给 TA（可不写，只有 TA 回来后能看到）', 'aria-label': '留言' })
      const list = h('div', { class: 'am-gifts', role: 'radiogroup', 'aria-label': '选择礼物' }), send = h('button', { class: 'btn btn-primary', type: 'button' }), tip = h('p', { class: 'am-tip', role: 'status' })
      const draw = () => {
        list.replaceChildren(...data.gifts.map((g) => h('button', { type: 'button', role: 'radio', class: g === pick ? 'on' : '', 'aria-checked': String(g === pick), disabled: busy || unknown, onclick: () => { pick = g; draw() } }, h('i', { 'aria-hidden': 'true' }, GIFT_ICON[g.key] || '🎁'), h('span', null, h('strong', null, g.name), h('small', null, g.text)), h('b', null, money(g.price) + ' D币'))))
        note.disabled = busy || unknown
        const short = balance !== null && balance < pick.price
        send.disabled = busy || balance === null || (short && !unknown)
        send.textContent = busy ? '正在送出…' : unknown ? '重试核对' : short ? 'D币不够' : `送出 · ${money(pick.price)} D币`
        if (balance !== null) bal.textContent = `我的余额 ${money(balance)} D币`
      }
      const load = async () => { try { balance = (await api('/autumn/miss/wallet')).balance } catch (e) { bal.textContent = e.message } draw() }
      send.onclick = async () => {
        if (busy) return
        if (!unknown && !await confirm(`送给「${p.name}」${pick.name}\n花费 ${money(pick.price)} D币，从你的钱包扣除，付给站长账户，送出后不退。\n确认送出？`)) return
        busy = true; tip.textContent = ''; draw()
        try {
          const r = await api(`/autumn/miss/${p.id}/gift`, { method: 'POST', body: { gift: pick.key, price: pick.price, note: note.value, nonce, confirm: true } })
          if (!r.duplicate || unknown) { p.gifts[pick.key] = (p.gifts[pick.key] || 0) + 1; redraw() }
          balance = r.balance; nonce = uuid(); unknown = false; note.value = ''
          tip.textContent = `${GIFT_ICON[pick.key] || ''} ${pick.name}已经寄出，等 TA 回来就能看到`
        } catch (e) {
          if (e.status >= 400 && e.status < 500 && e.status !== 408) { unknown = false; nonce = uuid(); tip.textContent = e.message; if (e.code === 'balance_insufficient') load() }
          else { unknown = true; tip.textContent = '没收到结果，点「重试核对」，不会重复扣款' }
        }
        busy = false; draw()
      }
      draw()
      openDialog('am-give', '送份礼物', h('h2', null, `送给 ${p.name}`), list, note, tip, h('div', { class: 'am-pay' }, bal, send))
      load()
    }

    const opt = h('input', { type: 'checkbox', role: 'switch' })
    opt.checked = home.opt_out
    opt.addEventListener('change', async () => {
      opt.disabled = true
      try { home.opt_out = (await api('/autumn/miss/opt-out', { method: 'PUT', body: { on: opt.checked } })).opt_out; toast(home.opt_out ? '以后不会展示你' : '已恢复默认', 'ok') } catch (e) { opt.checked = !opt.checked; toast(e.message, 'err') }
      opt.disabled = false
    })
    body.replaceChildren(scene, h('footer', { class: 'au-foot' },
      h('p', null, `常来的朋友如果有 ${data.idle_days} 天没露面，照片会挂在这里。每天更新一次，本人一回来就会取下。`),
      h('a', { class: 'btn btn-ghost sm', href: '/autumn/mine', 'data-link': '' }, '寄给我的', home.fresh_gifts > 0 && h('i', { class: 'am-dot' }, String(home.fresh_gifts))),
      h('label', { class: 'au-switch' }, opt, h('span', null, '以后不展示我')),
      home.owner && h('button', { class: 'btn btn-ghost sm', type: 'button', onclick: threshold }, '调整名单门槛')))
    ro.observe(field); layout()
  }

  async function threshold() {
    let d
    try { d = await api('/autumn/miss/config') } catch (e) { return toast(e.message, 'err') }
    const box = h('div', { class: 'au-th' })
    const draw = () => box.replaceChildren(h('table', null,
      h('thead', null, h('tr', null, h('th', null, '活跃天数 \\ 分数'), d.scores.map((s) => h('th', null, '≥' + s)))),
      h('tbody', null, d.peaks.map((p, i) => h('tr', null, h('th', null, `≥${p} 天`), d.scores.map((s, j) => {
        const on = d.config.peak === p && d.config.score === s
        return h('td', null, h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), onclick: async () => {
          try { await api('/autumn/miss/config', { method: 'PUT', body: { peak: p, score: s } }); d.config = { peak: p, score: s }; draw(); wall() } catch (e) { toast(e.message, 'err') }
        } }, d.table[i][j] + ' 人'))
      }))))))
    draw()
    openDialog('au-cfg', '名单门槛', h('h2', null, '名单门槛'), h('p', { class: 'muted' }, '行：任意 30 天内至少活跃几天。列：发言数 + 发图数 × 5 + 评论数。格子里是当前会展示的人数，点一下就采用。'), box)
  }

  // ---------- 寄给我的 / 我送出的 ----------
  async function mine() {
    let d
    try { d = await api('/autumn/miss/mine') } catch (e) { if (!isLeft()) fail(e, mine); return }
    if (isLeft()) return
    const person = (p) => h('a', { class: 'au-who', href: '/u/' + encodeURIComponent(p.username), 'data-link': '' }, avatar(p.avatar, p.name, 24), h('span', null, p.name))
    const item = (g, got) => {
      const el = h('article', { class: 'am-item' + (g.fresh ? ' fresh' : '') }, h('i', { 'aria-hidden': 'true' }, GIFT_ICON[g.gift] || '🎁'), h('div', null, h('strong', null, g.gift_name), g.note && h('p', null, g.note),
        h('footer', null, h('span', { class: 'muted' }, got ? '来自' : '送给'), person(g.person), h('time', { class: 'muted' }, fmtTime(g.at)), !got && h('span', { class: 'muted' }, money(g.price) + ' D币'), h('span', { class: 'grow' }),
          got && h('button', { class: 'btn-text sm', type: 'button', onclick: async () => { if (!await confirm('收起这份礼物？以后不再显示。')) return; try { await api('/autumn/miss/mine/' + g.id, { method: 'DELETE' }); el.remove() } catch (e) { toast(e.message, 'err') } } }, '收起'))))
      return el
    }
    body.replaceChildren(h('section', { class: 'am-mine' }, h('a', { class: 'au-back', href: '/autumn', 'data-link': '' }, icon('chevL', 'i tiny'), '返回好久不见'),
      h('div', { class: 'am-hello flat' }, h('h2', null, '寄给我的'), h('p', null, d.misses || d.received.length ? `你不在的时候，大家想了你 ${d.misses} 次，寄来 ${d.received.length} 份礼物。` : '还没有收到。你一直在，大家还没来得及想你。')),
      d.received.length > 0 && h('div', { class: 'am-list' }, d.received.map((g) => item(g, true))),
      h('h3', null, '我送出的'), d.sent.length ? h('div', { class: 'am-list' }, d.sent.map((g) => item(g, false))) : h('p', { class: 'muted' }, '还没有送过礼物')))
    if (d.received.some((g) => g.fresh)) api('/autumn/miss/mine/seen', { method: 'POST', body: {} }).then(() => home.onSeen?.()).catch(() => {})
  }
  return { wall, mine }
}
