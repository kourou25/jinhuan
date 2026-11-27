const statusText = {
  pending: '等待投递', delivering: '投递中', delivered: '已送达', failed: '投递失败', cancelled: '已取消',
}

export function groupChatBots({ h, api, groupId, onChange }) {
  const path = '/chat/groups/' + groupId + '/bots'
  const status = h('p', { class: 'gp-note muted', role: 'status' })
  const secrets = h('div', { class: 'gp-sec', hidden: true })
  const configuration = h('div', { class: 'gp-sec', hidden: true })
  const list = h('div', { class: 'gp-list' })
  const name = h('input', { class: 'input', required: true, maxlength: 24, placeholder: '如 值班提醒' })
  const callback = h('input', { class: 'input', type: 'url', maxlength: 500, placeholder: 'https://hooks.example.com/jinhuan' })
  const commands = h('textarea', { class: 'input', rows: 5, placeholder: '/status 查看服务状态\n/提醒 设置群提醒' })
  const gallery = h('input', { type: 'checkbox' })
  const mentions = h('input', { type: 'checkbox' })
  const field = (label, input) => h('label', { class: 'gp-bot-field' }, h('span', null, label), input)
  const button = (label, onclick) => h('button', { class: 'btn btn-ghost sm', type: 'button', onclick }, label)
  let loaded = false, busy = false, editing = null
  const submit = h('button', { class: 'btn btn-primary sm', type: 'submit' }, '登记回调')
  const cancel = button('取消编辑', resetForm)
  cancel.hidden = true
  function resetForm() {
    editing = null
    form.reset()
    name.readOnly = false
    submit.textContent = '登记回调'
    cancel.hidden = true
  }
  const form = h('form', { class: 'gp-sec gp-bot-form', onsubmit: event => {
    event.preventDefault()
    change(async () => {
      const descriptions = Object.fromEntries(commands.value.trim().split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        const [, command, description = ''] = /^\/?(\S+)(?:\s+(.+))?$/.exec(line)
        return [command.toLowerCase(), description]
      }))
      const edit = editing
      const data = await api(edit ? path + '/' + edit : path, { method: edit ? 'PATCH' : 'POST', body: {
        name: name.value, callback_url: callback.value, commands: Object.keys(descriptions), descriptions,
        gallery_access: gallery.checked, accept_mentions:mentions.checked,
      } })
      resetForm()
      if (data.push_token || data.signing_secret) showCredentials(data)
      return edit ? '回调已更新' : '回调已登记'
    })
  } }, field('回调名称', name), field('HTTPS 回调地址', callback), field('命令和描述，每行一条', commands),
    h('label', { class: 'gp-inline' }, mentions, '接收艾特机器人后的对话（每群一项）'),
    h('label', { class: 'gp-inline' }, gallery, '允许此回调使用我的图库读取权限'), h('div', { class: 'gp-inline' }, submit, cancel))
  const element = h('div', { class: 'gp-bots' }, configuration, form, status, secrets, list)

  function showCredentials(data) {
    const values = [['推送地址', data.push_url], ['附件上传地址', data.upload_url], ['推送 Token', data.push_token], ['回调签名密钥', data.signing_secret]]
    secrets.hidden = false
    secrets.replaceChildren(
      h('p', { class: 'gp-note' }, '凭证仅在签发时显示，请复制到接收端。'),
      ...values.filter(([, value]) => value).map(([label, value]) => field(label, h('div', { class: 'gp-inline' },
        h('input', { class: 'input', readonly: true, value, 'aria-label': label }),
        button('复制', async () => {
          try { await navigator.clipboard.writeText(value); status.textContent = '已复制' }
          catch { status.textContent = '请选中文本后复制' }
        })))),
      button('收起并清除凭证', () => { secrets.replaceChildren(); secrets.hidden = true }))
  }

  async function load() {
    const { bots, identity, can_edit_doc } = await api(path)
    if (!element.isConnected) return
    configuration.hidden = !identity && !can_edit_doc
    configuration.replaceChildren()
    if (identity) configuration.append(h('strong', null, '本群机器人 @' + identity.username))
    if (identity?.doc_post_id) configuration.append(h('p', { class: 'gp-note' },
        h('a', { href: '/m/' + identity.doc_post_id, 'data-link': '' }, '查看对接说明')))
    if (can_edit_doc) {
      const doc = h('input', { class: 'input', type: 'url', placeholder: location.origin + '/m/123',
        value: identity?.doc_post_id ? location.origin + '/m/' + identity.doc_post_id : '' })
      configuration.append(h('form', { class: 'gp-bot-form', onsubmit: event => {
        event.preventDefault()
        change(async () => { await api(path + '/doc', { method: 'PUT', body: { url: doc.value } }); return '对接说明已保存' })
      } }, field('/doc 站内帖子链接', doc), h('button', { class: 'btn sm', type: 'submit' }, '保存链接')))
    }
    list.replaceChildren(...(bots.length ? bots.map(botRow) : [h('p', { class: 'gp-empty muted' }, '本群还没有回调')]))
    loaded = true
  }

  async function change(action) {
    if (busy) return
    busy = true
    submit.disabled = true
    status.textContent = '正在保存…'
    try {
      const message = await action()
      onChange()
      await load()
      status.textContent = message
    } catch (error) { status.textContent = error.message }
    finally { busy = false; submit.disabled = false }
  }

  function botRow(bot) {
    const url = path + '/' + bot.id
    const logs = h('div', { class: 'gp-bot-logs', hidden: true })
    return h('section', { class: 'gp-sec gp-bot-item' },
      h('strong', null, bot.name), h('p', { class: 'muted gp-note' }, '维护者 @' + bot.maintainer + (bot.enabled && bot.active_owner ? ' · 已启用' : ' · 未启用')),
      bot.accept_mentions && h('p', { class: 'gp-note' }, '@机器人后输入文字 · 对话'),
      ...bot.commands.map(command=>h('p', { class: 'gp-note' }, '/' + command + (bot.descriptions[command] ? ' · ' + bot.descriptions[command] : ''))),
      bot.own && h('div', { class: 'gp-files-controls' },
        button('编辑', () => {
          editing = bot.id
          name.value = bot.name
          name.readOnly = true
          callback.value = bot.callback_url || ''
          commands.value = bot.commands.filter(command=>!['help','doc'].includes(command))
            .map(command=>'/' + command + (bot.descriptions[command] ? ' ' + bot.descriptions[command] : '')).join('\n')
          gallery.checked = bot.gallery_access
          mentions.checked = bot.accept_mentions
          submit.textContent = '保存回调'
          cancel.hidden = false
          callback.focus()
        }),
        button(bot.enabled ? '暂停' : '启用', () => change(async () => {
          await api(url, { method: 'PATCH', body: { enabled: !bot.enabled } })
          return bot.enabled ? '机器人已暂停' : '机器人已启用'
        })),
        button('轮换凭证', () => {
          if (!confirm('轮换此机器人的凭证？接入服务需要更新 Token 和回调签名密钥。')) return
          change(async () => { showCredentials(await api(url + '/rotate', { method: 'POST' })); return '凭证已轮换' })
        }),
        bot.callback_url && button('投递记录', async () => {
          if (!logs.hidden) { logs.hidden = true; return }
          logs.hidden = false
          logs.textContent = '正在读取记录…'
          try {
            const { items } = await api(url + '/deliveries')
            logs.replaceChildren(...(items.length ? items.map(item => h('p', { class: 'gp-note' },
              new Date(item.created_at * 1000).toLocaleString(), item.command ? ' · /' + item.command : ' · 艾特对话',
              ' · ' + statusText[item.state], ' · ' + item.attempts + ' 次', item.error ? ' · ' + item.error : ''))
              : [h('p', { class: 'gp-note muted' }, '暂无投递记录')]))
          } catch (error) { logs.textContent = error.message }
        }),
        button('移除', () => {
          if (!confirm('移除「' + bot.name + '」？它将无法继续向本群发消息。')) return
          change(async () => {
            await api(url, { method: 'DELETE' })
            secrets.hidden = true
            secrets.replaceChildren()
            return '机器人已移除'
          })
        })), logs)
  }

  async function open() {
    if (loaded || busy) return
    try { await load() }
    catch (error) { list.replaceChildren(h('p', { class: 'gp-note muted' }, error.message), button('重试', open)) }
  }
  return { element, open }
}
