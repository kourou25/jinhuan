// 应用管理页：已授权的应用（撤销）、我的应用（登记 / 修改 / 重置密钥 / 删除）、站长审核
(() => {
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  const STATUS = { pending: '待审核', active: '已启用', rejected: '未通过', disabled: '已停用' }
  const SCOPE = { openid: '账号身份', profile: '昵称和头像', email: '邮箱' }
  const time = (t) => t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'
  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { const e = new Error(data.error || '请求失败（' + res.status + '）'); e.status = res.status; throw e }
    return data
  }
  const icon = (a) => a.icon_url ? `<img class="oauth-app-icon" src="${esc(a.icon_url)}" alt="" referrerpolicy="no-referrer">` : `<div class="oauth-app-icon oauth-app-letter">${esc([...(a.name || '?')][0])}</div>`
  const tag = (s) => `<span class="oauth-tag ${esc(s)}">${esc(STATUS[s] || s)}</span>`
  let me = null, apps = []

  function showSecret(clientId, secret, note) {
    const box = $('secret-box')
    box.hidden = false
    box.innerHTML = `<strong>${esc(note)}</strong><div>client_id：<code>${esc(clientId)}</code></div>` + (secret ? `<div>client_secret（只显示这一次，请立即保存）：<code>${esc(secret)}</code></div>` : '')
    box.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function loadGrants() {
    const { grants } = await api('/api/oauth/grants')
    $('grant-empty').hidden = grants.length > 0
    $('grant-list').innerHTML = grants.map((g) => `<li>${icon(g)}<div class="oauth-grow"><strong>${esc(g.name)}</strong>${g.status !== 'active' ? tag(g.status) : ''}
      <div class="oauth-hint">权限：${g.scope.split(' ').map((s) => esc(SCOPE[s] || s)).join('、')} · 授权于 ${time(g.created_at)} · 最近使用 ${time(g.last_used_at)}</div></div>
      <button class="oauth-btn oauth-danger" data-revoke="${esc(g.client_id)}" data-name="${esc(g.name)}">撤销</button></li>`).join('')
  }

  async function loadApps() {
    ({ apps } = await api('/api/oauth/apps'))
    $('app-list').innerHTML = apps.map((a) => `<li>${icon(a)}<div class="oauth-grow"><strong>${esc(a.name)}</strong>${tag(a.status)}<span class="oauth-tag">${a.client_type === 'public' ? 'public' : 'confidential'}</span>
      <div class="oauth-hint">client_id：<code>${esc(a.client_id)}</code></div>
      <div class="oauth-hint">回调：${a.redirect_uris.map((u) => `<code>${esc(u)}</code>`).join('<br>')}</div>
      ${a.review_note ? `<div class="oauth-hint">审核备注：${esc(a.review_note)}</div>` : ''}
      <div class="oauth-row"><button class="oauth-btn oauth-secondary" data-edit="${esc(a.client_id)}">修改</button>
      ${a.client_type === 'confidential' ? `<button class="oauth-btn oauth-secondary" data-rotate="${esc(a.client_id)}">重置密钥</button>` : ''}
      <button class="oauth-btn oauth-danger" data-delete="${esc(a.client_id)}" data-name="${esc(a.name)}">删除</button></div></div></li>`).join('')
  }

  async function loadAdmin() {
    const { apps: list } = await api('/api/oauth/admin/apps')
    $('admin-empty').hidden = list.length > 0
    $('admin-list').innerHTML = list.map((a) => `<li>${icon(a)}<div class="oauth-grow"><strong>${esc(a.name)}</strong>${tag(a.status)}<span class="oauth-tag">${esc(a.client_type)}</span>
      <div class="oauth-hint">开发者：@${esc(a.owner_username || a.owner_id)} · ${a.grant_count} 人授权 · 主页 <a href="${esc(a.homepage)}" target="_blank" rel="noopener noreferrer">${esc(a.homepage)}</a></div>
      ${a.description ? `<div class="oauth-hint">${esc(a.description)}</div>` : ''}
      <div class="oauth-hint">回调：${a.redirect_uris.map((u) => `<code>${esc(u)}</code>`).join('<br>')}</div>
      <div class="oauth-row">
        ${a.status !== 'active' ? `<button class="oauth-btn" data-review="approve" data-id="${esc(a.client_id)}">${a.status === 'disabled' ? '重新启用' : '通过'}</button>` : ''}
        ${a.status === 'pending' ? `<button class="oauth-btn oauth-secondary" data-review="reject" data-id="${esc(a.client_id)}">不通过</button>` : ''}
        ${a.status === 'active' ? `<button class="oauth-btn oauth-secondary" data-review="disable" data-id="${esc(a.client_id)}">停用</button>` : ''}
        <label class="oauth-hint"><input type="checkbox" data-email="${esc(a.client_id)}" ${a.email_allowed ? 'checked' : ''}> 允许 email</label>
      </div></div></li>`).join('')
  }

  function resetForm() {
    const f = $('app-form')
    f.reset(); f.client_id.value = ''
    $('form-title').textContent = '登记新应用'; $('form-submit').textContent = '提交审核'; $('form-cancel').hidden = true; $('form-error').textContent = ''
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return
    try {
      if (b.dataset.revoke) {
        if (!confirm(`撤销对「${b.dataset.name}」的授权？`)) return
        await api('/api/oauth/grants/' + b.dataset.revoke, { method: 'DELETE' }); await loadGrants()
      } else if (b.dataset.delete) {
        if (!confirm(`删除应用「${b.dataset.name}」？所有用户的授权和令牌都会失效，无法恢复。`)) return
        await api('/api/oauth/apps/' + b.dataset.delete, { method: 'DELETE' }); await loadApps()
      } else if (b.dataset.rotate) {
        if (!confirm('重置后旧密钥立即失效，确定？')) return
        const r = await api('/api/oauth/apps/' + b.dataset.rotate + '/secret', { method: 'POST' })
        showSecret(b.dataset.rotate, r.client_secret, '已生成新密钥')
      } else if (b.dataset.edit) {
        const a = apps.find((x) => x.client_id === b.dataset.edit), f = $('app-form')
        f.client_id.value = a.client_id; f.name.value = a.name; f.homepage.value = a.homepage; f.icon_url.value = a.icon_url || ''
        f.description.value = a.description || ''; f.redirect_uris.value = a.redirect_uris.join('\n'); f.client_type.value = a.client_type
        $('form-title').textContent = '修改「' + a.name + '」'; $('form-submit').textContent = '保存'; $('form-cancel').hidden = false
        f.scrollIntoView({ behavior: 'smooth' })
      } else if (b.id === 'form-cancel') resetForm()
      else if (b.dataset.review) {
        const note = b.dataset.review === 'approve' ? '' : (prompt('备注（开发者可见，可留空）') ?? null)
        if (note === null) return
        await api('/api/oauth/admin/apps/' + b.dataset.id, { method: 'POST', body: JSON.stringify({ action: b.dataset.review, note }) }); await loadAdmin()
      }
    } catch (e) { alert(e.message) }
  })

  document.addEventListener('change', async (ev) => {
    const el = ev.target
    try {
      if (el.dataset?.email) await api('/api/oauth/admin/apps/' + el.dataset.email, { method: 'POST', body: JSON.stringify({ email_allowed: el.checked }) })
      else if (el.id === 'email-scope') await api('/api/oauth/admin/settings', { method: 'PUT', body: JSON.stringify({ email_scope: el.checked ? 'on' : 'off' }) })
    } catch (e) { el.checked = !el.checked; alert(e.message) }
  })

  $('app-form').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const f = ev.target, id = f.client_id.value
    const body = { name: f.name.value, homepage: f.homepage.value, icon_url: f.icon_url.value, description: f.description.value, redirect_uris: f.redirect_uris.value.split(/\r?\n/), client_type: f.client_type.value }
    $('form-submit').disabled = true; $('form-error').textContent = ''
    try {
      if (id) {
        const r = await api('/api/oauth/apps/' + id, { method: 'PUT', body: JSON.stringify(body) })
        if (r.client_secret) showSecret(id, r.client_secret, '已改为有服务端应用，生成了密钥')
        else if (r.status === 'pending') showSecret(id, null, '已保存，回调地址或类型有变化，需要重新审核')
      } else {
        const r = await api('/api/oauth/apps', { method: 'POST', body: JSON.stringify(body) })
        showSecret(r.client_id, r.client_secret, '已提交，等待站长审核')
      }
      resetForm(); await loadApps()
    } catch (e) { $('form-error').textContent = e.message } finally { $('form-submit').disabled = false }
  })

  async function main() {
    $('discovery').textContent = location.origin + '/.well-known/openid-configuration'
    try { me = await api('/api/oauth/me') } catch (e) {
      $('status').innerHTML = e.status === 401 ? `请先 <a href="/login?next=${encodeURIComponent('/oauth-apps')}">登录</a>。` : esc(e.message)
      return
    }
    $('status').hidden = true; $('content').hidden = false
    if (me.newbie) { $('newbie-note').hidden = false; $('app-form').hidden = true }
    await Promise.all([loadGrants(), loadApps()])
    if (me.owner) { $('admin').hidden = false; $('email-scope').checked = me.email_scope; await loadAdmin() }
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView()
  }
  main()
})()
