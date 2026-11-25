const statusText = {
  pending: '等待投递', delivering: '投递中', delivered: '已送达', failed: '投递失败', cancelled: '已取消',
}

export function groupChatBots({ h, api, groupId, onChange }) {
  const path = '/chat/groups/' + groupId + '/bots'
  const status = h('p', { class: 'gp-note muted', role: 'status' })
  const secrets = h('div', { class: 'gp-sec', hidden: true })
  const list = h('div', { class: 'gp-list' })
  const name = h('input', { class: 'input', required: true, maxlength: 24, placeholder: '如 值班提醒' })
  const callback = h('input', { class: 'input', type: 'url', maxlength: 500, placeholder: 'https://hooks.example.com/jinhuan' })
  const commands = h('input', { class: 'input', placeholder: 'status, help', maxlength: 400 })
  const field = (label, input) => h('label', { class: 'gp-bot-field' }, h('span', null, label), input)
  const button = (label, onclick) => h('button', { class: 'btn btn-ghost sm', type: 'button', onclick }, label)
  let loaded = false, busy = false
  const submit = h('button', { class: 'btn btn-primary sm', type: 'submit' }, '安装机器人')
  const form = h('form', { class: 'gp-sec gp-bot-form', onsubmit: event => {
    event.preventDefault()
    change(async () => {
      const data = await api(path, { method: 'POST', body: {
        name: name.value, callback_url: callback.value,
        commands: commands.value.trim().split(/[\s,，]+/).filter(Boolean).map(command => command.replace(/^\//, '').toLowerCase()),
      } })
      form.reset()
      showCredentials(data)
      return '机器人已安装'
    })
  } }, field('机器人名称', name), h('details', null, h('summary', null, '接收群里的指令'),
    h('div', { class: 'gp-bot-form' }, field('HTTPS 回调地址', callback), field('指令，以逗号分隔', commands))), submit)
  const element = h('div', { class: 'gp-bots' }, form, status, secrets, list)

  function showCredentials(data) {
    const values = [['推送地址', data.push_url], ['推送 Token', data.push_token], ['回调签名密钥', data.signing_secret]]
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
    const { bots } = await api(path)
    if (!element.isConnected) return
    list.replaceChildren(...(bots.length ? bots.map(botRow) : [h('p', { class: 'gp-empty muted' }, '本群还没有机器人')]))
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
      h('strong', null, bot.name), h('p', { class: 'muted gp-note' }, '@' + bot.username + (bot.enabled ? ' · 已启用' : ' · 已暂停')),
      bot.commands.length > 0 && h('p', { class: 'gp-note' }, bot.commands.map(command => '/' + command).join(' · ')),
      h('div', { class: 'gp-files-controls' },
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
              new Date(item.created_at * 1000).toLocaleString(), ' · /' + item.command,
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
