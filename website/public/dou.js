// 「斗 · 大模型江湖」前端：以画面为主。开局选主角；首页是可以点的院子，闯关是路线图，切磋是擂台边的对手，行囊是换装人偶。
// 只负责展示和播放服务端算好的事件，不做任何结算。画面引擎在 dou-stage.js。
import { pixelCanvas, pixelText, drawScene, drawFighter, drawWeaponIcon, drawIcon, cardIconKind, createStage, drawYard, YARD_SPOTS, OUTFIT_COLORS } from '/dou-stage.js?v=472f7fbf'

const PICK_SECONDS = 20
const SPEEDS = [1, 2, 4]
let catalogCache = null

export async function mountDou(main, ctx) {
  const { api, h, navigate, toast, onLeave } = ctx
  const avatar = (p, size = 24) => ctx.avatar(p?.avatar || null, p?.nick || p?.name || p?.username || '', size)
  let left = false
  const timers = new Set()
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!left) fn() }, ms); timers.add(id); return id }
  onLeave(() => { left = true; for (const id of timers) clearTimeout(id); timers.clear(); document.querySelectorAll('.dou-dialog').forEach((d) => d.remove()) })
  const path = location.pathname.replace(/\/+$/, '')
  const [, tab = '', arg = ''] = path.match(/^\/dou(?:\/([^/]+))?(?:\/([^/]+))?$/) || []

  const [cat, home] = await Promise.all([catalogCache ? Promise.resolve(catalogCache) : api('/dou/catalog'), api('/dou/home')])
  catalogCache = cat
  if (left) return
  const C = {
    card: new Map(cat.cards.map((c) => [c.id, c])), weapon: new Map(cat.weapons.map((w) => [w.id, w])), outfit: new Map(cat.outfits.map((o) => [o.id, o])),
    passive: new Map(cat.passives.map((p) => [p.key, p])), role: new Map(cat.roles.map((r) => [r.key, r])),
  }
  const go = (p) => navigate(p)
  const root = h('div', { class: 'dou' })
  main.replaceChildren(root)
  const err = (e) => h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, '暂时打不开'), h('p', null, e.message))
  const iconCanvas = (paint, size = 16) => { const c = pixelCanvas(size, size, paint); c.classList.add('dou-ico'); return c }
  const weaponIco = (w, size = 16) => iconCanvas((g) => drawWeaponIcon(g, w?.kind, 0, 0, size / 16, undefined, w?.fx), size)
  const fxOf = (id) => C.weapon.get(id)?.fx ?? null
  const kindOf = (id) => C.weapon.get(id)?.kind ?? null
  const cardIco = (c, size = 16) => iconCanvas((g) => drawIcon(g, cardIconKind(c), 0, 0, size / 16), size)

  if (!home.joined) return renderIntro()
  const hero = home.hero
  if (!hero.role) return renderRolePick(false)
  const me = () => ({ look: { ...hero.look, role: hero.role || 'deepseek' }, kind: kindOf(hero.weapon), fx: fxOf(hero.weapon) })
  // 顶部：返回 + 头像等级经验 + 今日剩余次数（不放文字菜单）
  const pct = hero.next ? Math.round(hero.exp / hero.next * 100) : 100
  const top = h('header', { class: 'dou-top' },
    tab ? h('a', { class: 'dou-back', href: '/dou', 'data-link': '', 'aria-label': '回院子', title: '回院子' }, '‹') : h('span', { class: 'dou-seal', 'aria-hidden': 'true' }, '斗'),
    h('div', { class: 'dou-me' }, avatar(ctx.user, 26), h('b', { class: 'dou-lv' }, 'Lv' + hero.level), h('div', { class: 'dou-xp', title: hero.next ? `经验 ${hero.exp}/${hero.next}` : '已满级' }, h('i', { style: `width:${pct}%` }))),
    h('div', { class: 'dou-stamina', title: '今天剩余次数：闯关 / 切磋 / 武林大会' },
      ['pve', 'pvp', 'board'].map((k) => h('span', { class: 'dou-pip ' + k }, cat.daily[k] - hero.daily[k]))),
    home.owner && h('a', { class: 'dou-admin-link', href: '/dou/admin', 'data-link': '' }, '名册'))
  const body = h('div', { class: 'dou-body' })
  root.append(top, body)

  try {
    if (tab === 'b' && /^[a-f\d]{24}$/.test(arg)) return await renderReplay(arg)
    if (tab === '') return renderYard()
    if (tab === 'pve') return await renderPve()
    if (tab === 'pvp') return await renderPvp()
    if (tab === 'board') return await renderBoard()
    if (tab === 'bag') return renderBag()
    if (tab === 'log') return await renderLog()
    if (tab === 'admin' && home.owner) return await renderAdmin()
    body.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, '这里什么都没有')))
  } catch (e) { if (!left) body.replaceChildren(err(e)) }

  // ---------- 选主角：两张会动的角色卡 ----------
  function roleCards(onPick, current) {
    return h('div', { class: 'dou-roles' }, cat.roles.map((r) => {
      const fig = pixelCanvas(150, 170, (g, t) => {
        const bg = g.createLinearGradient(0, 0, 0, 170); bg.addColorStop(0, '#f6efe0'); bg.addColorStop(1, r.color + '55'); g.fillStyle = bg; g.fillRect(0, 0, 150, 170)
        g.globalAlpha = 0.18; g.fillStyle = r.color; g.beginPath(); g.arc(75, 70, 58, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1
        const cyc = t % 4
        drawFighter(g, { look: { role: r.key }, kind: 'sword', fx: 'code' }, 75, 158, { pose: cyc < 0.5 ? 'attack' : cyc > 3.2 ? 'win' : 'idle', t, scale: 4.2 })
      }, true)
      const p = C.passive.get(r.passive)
      return h('button', { class: 'dou-role' + (current === r.key ? ' on' : ''), type: 'button', style: `--rc:${r.color}`, onclick: () => onPick(r.key) },
        fig, h('b', null, r.name, h('small', null, '「' + r.nick + '」')), h('span', { class: 'dou-role-p' }, '✦ ' + (p?.name ?? '') + '：' + (p?.text ?? '')),
        h('span', { class: 'dou-role-s' }, r.skills.map((x) => h('i', null, x.name))))
    }))
  }
  function renderRolePick(change) {
    const box = h('section', { class: 'dou-pick-role' }, h('h2', null, change ? '换一位主角' : '选你的主角'), h('p', { class: 'dou-note' }, '等级、物品和卡组都跟着你，随时可以再换'),
      roleCards(async (key) => {
        try { await api('/dou/role', { method: 'PUT', body: { role: key } }); go('/dou') } catch (e) { toast(e.message, 'err') }
      }, hero?.role))
    if (change) return dialog('dou-role-dlg', '换主角', box)
    root.replaceChildren(box)
  }

  // ---------- 未开启：一段小演示 + 选主角入门 ----------
  function renderIntro() {
    const W = 320, H = 180
    const demo = pixelCanvas(W, H, (g, t) => {
      drawScene(g, 'village', W, H, t)
      const k = (t % 3) / 3, hit = k > 0.45 && k < 0.6, lunge = k > 0.3 && k < 0.6
      drawFighter(g, { look: { role: 'deepseek' }, kind: 'sword', fx: 'code' }, 110 + (lunge ? 60 * Math.sin((k - 0.3) / 0.3 * Math.PI) : 0), 150, { pose: lunge ? 'attack' : 'idle', t, scale: 3 })
      drawFighter(g, { look: { role: 'doubao' }, kind: 'staff', fx: 'flash' }, 220 + (hit ? 6 : 0), 150, { pose: hit ? 'hit' : 'idle', t, scale: 3, flip: true, flash: hit && k < 0.5 })
      if (hit) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(205, 108, 20, -1.9, 0.9); g.stroke(); pixelText(g, String(30 + (Math.floor(t) * 7) % 40), 222, 70, '#ffffff', 14) }
    }, true)
    demo.classList.add('dou-intro-art')
    root.append(h('section', { class: 'dou-intro' }, demo,
      h('div', { class: 'dou-intro-cta' },
        h('h1', null, '斗'),
        h('p', null, '大模型江湖：从小号练起，一路挑战各派掌门，满 52 级上武林大会'),
        h('small', null, '选一位主角就能开始；只有自己开启才有角色，随时可以退出')),
      roleCards(async (key) => {
        try { await api('/dou/join', { method: 'POST', body: { role: key } }); go('/dou') } catch (x) { toast(x.message, 'err') }
      })))
  }

  // ---------- 院子（首页） ----------
  function renderYard() {
    const tall = innerWidth < 600, W = tall ? 240 : 384, H = tall ? 340 : 216 // 手机用竖版院子
    const yard = pixelCanvas(W, H, (g, t) => {
      drawYard(g, W, H, t)
      drawFighter(g, me(), W * 0.5, H * 0.66, { pose: Math.floor(t / 3) % 3 === 2 && (t % 3) < 0.4 ? 'attack' : 'idle', t, scale: 3, outfit: hero.outfit })
    }, true)
    const wrap = h('div', { class: 'dou-yard' }, yard)
    for (const s of YARD_SPOTS) {
      const locked = s.key === 'board' && hero.level < cat.board_level && !home.board
      wrap.append(h('a', { class: 'dou-spot' + (locked ? ' locked' : ''), href: '/dou/' + s.key, 'data-link': '', style: `left:${s.x * 100}%;top:${s.y * 100}%` },
        h('span', null, s.label), s.key === 'log' && home.defended_today ? h('i', { class: 'dou-dot' }, home.defended_today) : null))
    }
    wrap.style.setProperty('--rc', C.role.get(hero.role)?.color || '#b4322a')
    wrap.append(h('button', { class: 'dou-spot dou-self', type: 'button', style: 'left:50%;top:52%', 'aria-label': '我的招式', onclick: openSheet }, h('span', null, '我')))
    body.replaceChildren(...[wrap, !hero.active && h('div', { class: 'dou-paused' }, '你暂时退出了，别人看不到你 ', h('button', { class: 'btn sm', type: 'button', onclick: toggleActive }, '重新开启'))].filter(Boolean))
  }
  function openSheet() {
    const w = C.weapon.get(hero.weapon), p = C.passive.get(hero.passive)
    const skills = [...cat.base_skills, ...(w ? cat.weapon_skills[w.kind] : []), ...hero.exclusive]
    const fig = pixelCanvas(96, 96, (g, t) => { drawScene(g, 'library', 96, 96, t); drawFighter(g, me(), 48, 86, { pose: Math.floor(t) % 4 === 0 ? 'attack' : 'idle', t, scale: 2.4, outfit: hero.outfit }) }, true)
    const d = dialog('dou-sheet', '我的招式',
      h('div', { class: 'dou-sheet-top' }, fig, h('div', null,
        h('div', { class: 'dou-chip-row' }, w && h('span', { class: 'dou-chip' }, weaponIco(w, 16), w.name), p && h('span', { class: 'dou-chip', title: p.text }, '✦ ' + p.name)),
        p && h('p', { class: 'dou-note' }, p.text),
        h('div', { class: 'dou-chip-row' }, h('span', { class: 'dou-chip' }, `切磋 ${hero.wins}胜 ${hero.losses}负`), home.board && h('span', { class: 'dou-chip' }, `大会第 ${home.board.rank}`)))),
      h('div', { class: 'dou-skillgrid' }, skills.map((s) => skillTile(s))),
      h('div', { class: 'dou-sheet-foot' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { d.close(); renderRolePick(true) } }, '换主角'), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { d.close(); toggleActive() } }, hero.active ? '暂时退出' : '重新开启')))
  }
  function skillTile(s) {
    const locked = s.unlock && hero.level < s.unlock
    const kind = s.heal ? 'potion' : s.shield ? 'shield' : s.mp ? 'orb' : s.stun ? 'star' : s.bleed ? 'drop' : s.hits > 2 ? 'wind' : s.power >= 2 ? 'bolt' : 'sword'
    return h('div', { class: 'dou-skill' + (locked ? ' locked' : ''), title: locked ? `${s.unlock} 级解锁` : s.name }, iconCanvas((g) => drawIcon(g, kind, 0, 0, 2), 32), h('b', null, s.name), locked ? h('small', null, 'Lv' + s.unlock) : s.power ? h('small', null, '×' + s.power) : null)
  }
  async function toggleActive() {
    if (hero.active && !(await ctx.confirm?.('暂时退出后，你会从对手列表和武林大会下线（大会名次不保留），等级和物品都还在。确定吗？'))) return
    try { await api(hero.active ? '/dou/leave' : '/dou/join', { method: 'POST', body: {} }); go('/dou') } catch (e) { toast(e.message, 'err') }
  }
  function dialog(cls, label, ...kids) {
    const d = h('dialog', { class: 'dou-dialog ' + cls, 'aria-label': label })
    d.append(h('button', { class: 'dou-x', type: 'button', 'aria-label': '关闭', onclick: () => d.close() }, '×'), ...kids.flat().filter(Boolean))
    d.addEventListener('click', (e) => { if (e.target === d) d.close() })
    d.addEventListener('close', () => d.remove())
    document.body.append(d); d.showModal()
    return d
  }

  // ---------- 闯关：路线图 ----------
  async function renderPve() {
    const { stages } = await api('/dou/stages')
    if (left) return
    const byCh = new Map()
    for (const s of stages) { if (!byCh.has(s.ch)) byCh.set(s.ch, []); byCh.get(s.ch).push(s) }
    const current = stages.find((s) => s.open && !s.wins)?.ch ?? 13
    const map = h('div', { class: 'dou-map' })
    for (const ch of cat.chapters) {
      const ss = byCh.get(ch.n) || [], open = ss.some((s) => s.open), cleared = ss.every((s) => s.wins > 0)
      const W = 192, H = 108
      const art = pixelCanvas(W, H, (g, t) => {
        drawScene(g, ch.scene, W, H, t)
        drawFighter(g, { look: { hue: ch.n * 27, foe: 'b' + ch.n, boss: true }, kind: ch.boss_kind, boss: true }, W * 0.78, H * 0.92, { pose: cleared ? 'ko' : 'idle', t, scale: 1.7, flip: true })
        if (!open) { g.fillStyle = '#0d0a08b0'; g.fillRect(0, 0, W, H) }
      }, ch.n === current)
      const nodes = h('div', { class: 'dou-nodes' }, ss.map((s) => h('button', {
        class: 'dou-node' + (s.k === 4 ? ' is-boss' : '') + (s.wins ? ' won' : '') + (s.open && !s.wins ? ' next' : ''), type: 'button', disabled: !s.open || !hero.active,
        title: (s.k === 4 ? ch.boss : ch.mooks[s.k - 1]) + ` · Lv${s.level}`, 'aria-label': (s.k === 4 ? ch.boss : ch.mooks[s.k - 1]),
        onclick: () => fight({ kind: 'pve', stage: s.id }),
      }, s.k === 4 ? '★' : s.k)))
      map.append(h('section', { class: 'dou-isle' + (open ? '' : ' locked') + (cleared ? ' cleared' : '') + (ch.n === current ? ' current' : ''), id: 'ch' + ch.n },
        art, h('div', { class: 'dou-isle-name' }, h('b', null, ch.n), ch.name), nodes,
        h('div', { class: 'dou-loot', title: '首杀掉落' }, weaponIco(C.weapon.get(ch.weapon), 16), ch.outfit && h('span', { class: 'dou-swatch', style: `background:${OUTFIT_COLORS[ch.outfit]}` }))))
    }
    body.replaceChildren(map)
    requestAnimationFrame(() => document.getElementById('ch' + current)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }

  // ---------- 切磋：擂台边的一排对手 ----------
  async function renderPvp() {
    const { list } = await api('/dou/opponents')
    if (left) return
    const W = 384, H = 216
    const xs = list.map((_, i) => 0.12 + i * 0.19)
    const ring = pixelCanvas(W, H, (g, t) => {
      drawScene(g, 'arena', W, H, t)
      list.forEach((o, i) => drawFighter(g, { look: o.look, kind: (o.weapon ? kindOf(o.weapon) : o.kind) ?? null, fx: fxOf(o.weapon) }, W * xs[i], H * 0.84, { pose: 'idle', t: t + i, scale: 2.4, flip: true }))
    }, true)
    const wrap = h('div', { class: 'dou-ring' }, ring, list.map((o, i) => h('button', {
      class: 'dou-opp-btn' + (o.npc ? ' npc' : ''), type: 'button', disabled: !hero.active, style: `left:${xs[i] * 100}%`,
      onclick: () => fight(o.npc ? { kind: 'pvp', npc: o.npc } : { kind: 'pvp', target: o.user_id }),
    }, h('span', { class: 'dou-plate' }, o.npc ? null : avatar(o, 16), h('b', null, o.name), h('small', null, 'Lv' + o.level)))))
    body.replaceChildren(wrap, h('div', { class: 'dou-under' }, h('button', { class: 'dou-round-btn light', type: 'button', 'aria-label': '换一批', title: '换一批', onclick: () => renderPvp().catch((e) => toast(e.message, 'err')) }, '↻')))
  }

  // ---------- 武林大会：领奖台 + 榜 ----------
  async function renderBoard() {
    const b = await api('/dou/board')
    if (left) return
    const can = hero.level >= cat.board_level
    const W = 384, H = 160
    const podium = b.list.slice(0, 3)
    const stage = pixelCanvas(W, H, (g, t) => {
      drawScene(g, 'board', W, H, t)
      const pos = [[0.5, 0.74, 3], [0.3, 0.82, 2.4], [0.7, 0.85, 2.2]]
      podium.forEach((r, i) => { const [x, y, s] = pos[i]; g.fillStyle = ['#e8c04a', '#c9ccd2', '#c8864a'][i]; g.fillRect(W * x - 22, H * y, 44, H); drawFighter(g, { look: r.look, kind: kindOf(r.weapon), fx: fxOf(r.weapon) }, W * x, H * y, { pose: i === 0 ? 'win' : 'idle', t: t + i, scale: s }) })
    }, true)
    body.replaceChildren(...[
      h('div', { class: 'dou-board-stage' }, stage),
      !b.me && h('div', { class: 'dou-under' }, h('button', { class: 'dou-big-btn', type: 'button', disabled: !can || !hero.active, onclick: async () => {
        try { await api('/dou/board/join', { method: 'POST', body: {} }); renderBoard() } catch (e) { toast(e.message, 'err') }
      } }, can ? '挂榜' : `Lv${cat.board_level} 开放`)),
      b.list.length && h('ol', { class: 'dou-board' }, b.list.map((r) => h('li', { class: b.me && r.rank === b.me.rank ? 'me' : '' },
        h('span', { class: 'dou-rank' }, r.rank), avatar(r, 24), h('b', null, r.name), h('small', null, 'Lv' + r.level),
        r.can ? h('button', { class: 'dou-fight-btn', type: 'button', onclick: () => fight({ kind: 'board', target: r.user_id }), 'aria-label': '挑战', title: '挑战' }, '斗') : h('span')))),
    ].filter(Boolean))
  }

  // ---------- 行囊：换装人偶 ----------
  function renderBag() {
    const own = new Set(home.items.map((i) => i.item_id))
    let weapon = hero.weapon, deck = [...hero.deck], outfit = { ...hero.outfit }, slot = null
    const doll = pixelCanvas(128, 128, (g, t) => { drawScene(g, 'academy', 128, 128, t); drawFighter(g, { look: me().look, kind: kindOf(weapon), fx: fxOf(weapon) }, 64, 118, { pose: Math.floor(t * 0.7) % 3 === 0 ? 'attack' : 'idle', t, scale: 3.4, outfit }) }, true)
    const slotBtns = h('div', { class: 'dou-slots' })
    const tray = h('div', { class: 'dou-tray' })
    const count = h('span', { class: 'dou-count' })
    const drawSlots = () => slotBtns.replaceChildren(...cat.outfit_slots.map(([k, name]) => {
      const it = outfit[k] ? C.outfit.get(outfit[k]) : null
      return h('button', { class: 'dou-slot' + (slot === k ? ' on' : '') + (it ? ' has' : ''), type: 'button', title: it ? `${name}：${it.name}` : name, onclick: () => { slot = slot === k ? null : k; drawSlots(); drawTray() } },
        h('span', { class: 'dou-swatch', style: it ? `background:${OUTFIT_COLORS[it.id]}` : '' }), h('small', null, name))
    }))
    const drawTray = () => {
      if (!slot) { tray.replaceChildren(); return }
      tray.replaceChildren(...cat.outfits.filter((o) => o.slot === slot).map((o) => h('button', { class: 'dou-tile' + (outfit[slot] === o.id ? ' on' : ''), type: 'button', disabled: !own.has(o.id), title: own.has(o.id) ? o.name : '获得：' + o.note,
        onclick: () => { if (outfit[slot] === o.id) delete outfit[slot]; else outfit[slot] = o.id; drawSlots(); drawTray() } }, h('span', { class: 'dou-swatch big', style: `background:${OUTFIT_COLORS[o.id]}` }), h('small', null, own.has(o.id) ? o.name : '？'))))
    }
    const rack = h('div', { class: 'dou-rack' }, cat.weapons.map((w) => h('button', { class: 'dou-tile' + (w.id === weapon ? ' on' : ''), type: 'button', disabled: !own.has(w.id), title: own.has(w.id) ? `${w.name} · 攻 +${w.atk}` : '还没得到',
      onclick: (e) => { weapon = w.id; rack.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on') } }, weaponIco(w, 32), h('small', null, own.has(w.id) ? w.name : '？'))))
    const sync = () => { count.textContent = `${deck.length}/${hero.deck_size}` }
    const cards = h('div', { class: 'dou-hand' }, cat.cards.filter((c) => own.has(c.id)).map((c) => {
      const b = h('button', { class: 'dou-mini-card r' + c.rarity + (deck.includes(c.id) ? ' on' : ''), type: 'button', title: c.text, onclick: () => {
        if (deck.includes(c.id)) deck = deck.filter((x) => x !== c.id)
        else if (deck.length >= hero.deck_size) return toast(`现在最多带 ${hero.deck_size} 张`, 'err')
        else deck.push(c.id)
        b.classList.toggle('on', deck.includes(c.id)); sync()
      } }, cardIco(c, 32), h('b', null, c.name))
      return b
    }))
    drawSlots(); sync()
    body.replaceChildren(h('div', { class: 'dou-bag' },
      h('div', { class: 'dou-doll' }, doll, slotBtns, tray),
      h('div', { class: 'dou-bag-side' },
        h('h3', null, '兵器架'), rack,
        h('h3', null, '卡组 ', count), cards,
        h('button', { class: 'dou-big-btn', type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true
          try { await api('/dou/loadout', { method: 'PUT', body: { weapon, deck, outfit } }); Object.assign(hero, { weapon, deck, outfit }); toast('换好了', 'ok') } catch (x) { toast(x.message, 'err') }
          b.disabled = false
        } }, '穿上'))))
  }

  // ---------- 战报：小画面卡片，点开回放 ----------
  async function renderLog() {
    const { list } = await api('/dou/reports')
    if (left) return
    body.replaceChildren(list.length ? h('div', { class: 'dou-reports' }, list.map((r) => {
      const fig = pixelCanvas(64, 40, (g) => {
        drawScene(g, r.kind === 'board' || r.kind === 'auto' ? 'board' : 'arena', 64, 40)
        drawFighter(g, me(), 20, 36, { pose: r.won ? 'win' : 'ko', scale: 1 })
        drawFighter(g, { look: r.other.look || {}, kind: r.other.kind, fx: fxOf(r.other.weapon), boss: r.other.boss }, 44, 36, { pose: r.won ? 'ko' : 'win', scale: 1, flip: true })
      })
      return h('a', { class: 'dou-report ' + (r.won ? 'won' : 'lost'), href: '/dou/b/' + r.id, 'data-link': '' }, fig,
        h('b', null, r.won ? '胜' : '负'), h('span', { class: 'dou-plate' }, r.other.npc ? null : avatar(r.other, 14), r.other.name), !r.attacking && h('i', { class: 'dou-dot', title: '别人来挑战你' }, '守'))
    })) : h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, '还没有战报')))
  }

  // ---------- 站长名册（管理用，保留表格） ----------
  async function renderAdmin() {
    const { list } = await api('/dou/admin/heroes')
    if (left) return
    body.replaceChildren(h('section', { class: 'dou-card' },
      h('h2', null, '名册（只有站长能看到）'),
      h('p', { class: 'dou-note' }, '头像是人物的标「人物」交给生图，猫狗等标「非人物」。配置 JSON：passive（wind / iron / edge / cat / spring / fury / thorn）、skills（最多 3 个，依次 10 / 25 / 40 级解锁）、sheet（/assets/dou/heroes/<随机串>.png）、hue（0–359）。'),
      h('table', { class: 'dou-admin' }, h('thead', null, h('tr', null, ['头像', '名字', '等级', '头像类型', '配置', ''].map((x) => h('th', null, x)))),
        h('tbody', null, list.map((r) => {
          const kind = h('select', null, [['pending', '待标注'], ['person', '人物'], ['other', '非人物']].map(([v, l]) => h('option', { value: v, selected: r.avatar_kind === v }, l)))
          const cfg = h('textarea', { rows: 3, spellcheck: false }, JSON.stringify(r.config))
          return h('tr', null, h('td', null, r.avatar ? h('img', { src: r.avatar, alt: '', width: 48, height: 48, loading: 'lazy' }) : '—'), h('td', null, r.nick || r.name || r.username), h('td', null, r.level + (r.active ? '' : '（已退出）')),
            h('td', null, kind), h('td', null, cfg),
            h('td', null, h('button', { class: 'btn sm', type: 'button', onclick: async () => {
              let config; try { config = JSON.parse(cfg.value || '{}') } catch { return toast('配置不是合法的 JSON', 'err') }
              try { await api('/dou/admin/roles/' + r.user_id, { method: 'PUT', body: { avatar_kind: kind.value, config } }); toast('已保存', 'ok') } catch (e) { toast(e.message, 'err') }
            } }, '保存')))
        })))))
  }

  // ---------- 对战 ----------
  async function fight(req) {
    try {
      const b = await api('/dou/battle', { method: 'POST', body: req })
      if (left) return
      if (req.kind === 'pve') hero.daily.pve++; else if (req.kind === 'pvp') hero.daily.pvp++; else hero.daily.board++
      playBattle(b)
    } catch (e) { toast(e.message, 'err') }
  }
  async function renderReplay(id) {
    const b = await api('/dou/battle/' + id)
    if (left) return
    playBattle(b, true)
  }

  function playBattle(first, replay = false) {
    const sides = first.sides.map((s) => ({ ...s, hp: s.max }))
    const stage = createStage({ scene: first.scene, sides, cards: C.card, weapons: C.weapon })
    const queue = [...first.events]
    let speed = Number(localStorage.getItem('dou:speed')) || 1, pending = first.pending, result = first.result, done = false, busy = false
    stage.setSpeed(speed)
    const id = first.id
    const bars = sides.map((s, i) => h('div', { class: 'dou-hp s' + i },
      h('div', { class: 'dou-plate' }, s.npc ? null : avatar(s, 18), h('b', null, s.name), h('small', null, 'Lv' + s.level)),
      h('div', { class: 'dou-hpbar' }, h('i', { class: 'lag' }), h('i', { class: 'cur' }))))
    const logBox = h('ol', { class: 'dou-battle-log', hidden: true })
    const speedBtn = h('button', { class: 'dou-round-btn', type: 'button', 'aria-label': '速度', title: '速度', onclick: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; localStorage.setItem('dou:speed', speed); stage.setSpeed(speed); speedBtn.textContent = speed + '×' } }, speed + '×')
    const logBtn = h('button', { class: 'dou-round-btn', type: 'button', 'aria-label': '战斗记录', title: '战斗记录', onclick: () => { logBox.hidden = !logBox.hidden } }, '≡')
    const overlay = h('div', { class: 'dou-overlay', hidden: true })
    stage.canvas.classList.add('dou-arena')
    const dlg = h('dialog', { class: 'dou-dialog dou-battle-dlg', 'aria-label': '对战' },
      h('div', { class: 'dou-battle-top' }, bars[0], h('span', { class: 'dou-vs' }, 'VS'), bars[1]),
      h('div', { class: 'dou-stagebox' }, stage.canvas, overlay),
      h('div', { class: 'dou-battle-ctl' }, speedBtn, logBtn, h('button', { class: 'dou-round-btn', type: 'button', 'aria-label': '离开', title: '离开', onclick: () => close() }, '×')),
      logBox)
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    document.body.append(dlg)
    dlg.showModal()
    function close() {
      if (!done && pending && !replay && !confirm('还没打完，离开后会按推荐自动选卡打完。确定离开？')) return
      done = true; stage.stop(); dlg.close(); dlg.remove()
      go(replay ? '/dou/log' : location.pathname)
    }
    const setBar = (i) => {
      const s = sides[i], p = Math.max(0, s.hp / s.max * 100), el = bars[i].querySelector('.dou-hpbar')
      el.querySelector('.cur').style.width = p + '%'
      later(() => { el.querySelector('.lag').style.width = p + '%' }, 380 / speed)
      el.classList.toggle('low', p < 30)
    }
    const log = (txt) => { logBox.prepend(h('li', null, txt)); while (logBox.children.length > 80) logBox.lastChild.remove() }
    function apply(e) {
      if (typeof e.hp === 'number' && e.s !== undefined) { sides[e.s].hp = e.hp; later(() => setBar(e.s), e.k === 'hit' ? 80 / speed : 0) }
      if (e.k === 'start') e.hp.forEach((v, i) => { sides[i].hp = v; sides[i].max = e.max[i]; setBar(i) })
      if (e.k === 'act') log(`${sides[e.s].name}：${e.n}`)
      if (e.k === 'card') log(`${sides[e.s].name} 出牌「${C.card.get(e.id)?.name ?? ''}」`)
      if (e.k === 'hit') log(`${sides[e.s].name} -${e.d}${e.c ? '（暴击）' : ''}`)
      return stage.run(e)
    }
    function step() {
      if (done || left || busy) return
      if (queue.length) { busy = true; const ms = apply(queue.shift()); later(() => { busy = false; step() }, ms / speed); return }
      if (pending && !replay) return showPick()
      if (result) return showResult()
    }
    function showPick() {
      const p = pending
      let remain = PICK_SECONDS, picked = false
      const ring = h('i', { class: 'dou-timer', style: '--p:1' })
      const send = async (idx, el) => {
        if (picked) return
        picked = true
        if (el) el.classList.add('chosen')
        overlay.querySelectorAll('.dou-bigcard').forEach((b) => { if (b !== el) b.classList.add('gone') })
        later(async () => {
          overlay.hidden = true
          try {
            const r = await api(`/dou/battle/${id}/pick`, { method: 'POST', body: { n: p.n, pick: idx } })
            pending = r.pending; result = r.result; queue.push(...r.events); step()
          } catch (e) { toast(e.message, 'err'); done = true }
        }, 380)
      }
      overlay.replaceChildren(h('div', { class: 'dou-pickbox' }, ring,
        h('div', { class: 'dou-offer' }, p.offer.map((cid, i) => {
          const c = C.card.get(cid)
          return h('button', { class: 'dou-bigcard r' + (c?.rarity ?? 1), type: 'button', style: `--i:${i}`, title: c?.text ?? '', onclick: (e) => send(i, e.currentTarget) },
            i === p.auto && h('em', { title: '推荐' }, '★'), cardIco(c, 48), h('b', null, c?.name ?? cid), h('span', null, c?.text ?? ''))
        }))))
      overlay.hidden = false
      const tick = () => { if (picked || left) return; remain--; ring.style.setProperty('--p', remain / PICK_SECONDS); if (remain <= 0) send(-1); else later(tick, 1000) }
      later(tick, 1000)
    }
    function showResult() {
      done = true
      const win = replay ? null : result.winner === 0, r = result.reward
      const loot = []
      if (r) {
        for (const it of r.items) { const w = C.weapon.get(it), o = C.outfit.get(it), c = C.card.get(it); loot.push(h('div', { class: 'dou-loot-item', title: (w || o || c)?.name }, w ? weaponIco(w, 32) : c ? cardIco(c, 32) : h('span', { class: 'dou-swatch big', style: `background:${OUTFIT_COLORS[it]}` }), h('small', null, (w || o || c)?.name ?? it))) }
        for (const a of r.achievements) loot.push(h('div', { class: 'dou-loot-item ach' }, h('span', { class: 'dou-medal' }, '✦'), h('small', null, cat.achievements[a]?.name ?? a)))
      }
      const gain = r ? [r.exp && h('span', null, '经验 +' + r.exp), r.levelUp && h('span', { class: 'up' }, '升级 Lv' + r.level), r.points && h('span', null, (r.points > 0 ? '积分 +' : '积分 ') + r.points), r.rank && h('span', { class: 'up' }, '第 ' + r.rank + ' 名')].filter(Boolean) : []
      overlay.replaceChildren(h('div', { class: 'dou-result ' + (win === false ? 'lose' : 'win') }, ...[
        h('h2', null, replay ? (result.winner === 0 ? '攻方胜' : '守方胜') : win ? '胜' : '败'),
        gain.length && h('div', { class: 'dou-gain' }, gain),
        loot.length && h('div', { class: 'dou-loot-row' }, loot),
        h('button', { class: 'dou-big-btn', type: 'button', onclick: () => close() }, '好'),
      ].filter(Boolean)))
      overlay.hidden = false
    }
    later(step, 300)
  }
}
