import { communityClass, communitySkinCatalog, installCommunitySkinStyles, loadCommunitySkins } from '/community-skins.js?v=20261126'

const SITE_REPO = 'https://github.com/kourou25/jinhuan'
const SKIN_REPO = 'https://github.com/kourou25/meme-hall-skins'
const PARTS = { bubble: '气泡', title: '称号', badge: '徽章', reply: '回应框', frame: '头像框' }
const KINDS = { feature: '新功能', fix: '修复', polish: '体验优化', art: '美术', community: '社区' }
const SKIN_CHANGES = { added: '上新', updated: '更新', renamed: '更名', removed: '下架' }
const STARLIGHT = 'shiratori-starlight'
const PAGE_SIZE = 12
const SHORT_SAMPLE = '晚安，明天见！'
const LONG_SAMPLE = '今晚的流星来得比平时晚一些。我在窗边多等了一会儿，发现楼下的灯一盏盏亮了起来。要是明天放晴，我们就一起去河边散步吧。'
const PREVIEW_DOCUMENT = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/community-hub.css?v=20261126"><body class="ch-stage"></body></html>'
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' })
const gitLogin = value => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(value)
const skinId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,47}$/.test(value)
const gitSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const positiveIssue = value => /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null

function el(tag, props, ...children) {
  const { dataset, labelledBy, ...assign } = props || {}
  const node = Object.assign(document.createElement(tag), assign)
  if (dataset) Object.assign(node.dataset, dataset)
  if (labelledBy) node.setAttribute('aria-labelledby', labelledBy)
  node.append(...children.filter(child => child != null))
  return node
}

function roadLink(tab, query = {}) {
  const params = new URLSearchParams({ tab, ...query })
  return '/road?' + params.toString()
}

function internalLink(label, href, className) {
  return el('a', { href, className, dataset: { link: '' } }, label)
}

function externalLink(label, href, className = 'ch-link') {
  return el('a', { href, className, target: '_blank', rel: 'noopener noreferrer' }, label)
}

function button(label, onclick, className = 'btn btn-ghost') {
  return el('button', { type: 'button', className, onclick }, label)
}

function state(message, action) {
  return el('div', { className: 'ch-state', role: 'status' }, el('p', null, message), action)
}

function partsOf(skin) {
  return Object.keys(PARTS).filter(kind => skin.components?.[kind])
}

function appendPaged(list, items, draw) {
  let index = 0
  const more = button('显示更多', () => addPage(true), 'btn btn-ghost ch-more')
  function addPage(focus) {
    const rows = items.slice(index, index + PAGE_SIZE).map(draw)
    list.append(...rows)
    index += rows.length
    more.hidden = index >= items.length
    if (focus && rows.length) {
      rows[0].tabIndex = -1
      rows[0].focus({ preventScroll: true })
      rows[0].scrollIntoView({ block: 'nearest' })
    }
  }
  addPage(false)
  return more
}

function previewSample(skin, length) {
  const has = kind => Boolean(skin.components?.[kind])
  const cls = kind => has(kind) ? communityClass(skin.id, kind) : ''
  return el('div', { className: 'ch-stage-chat' },
    el('div', { className: 'ch-stage-person' },
      el('span', { className: 'cskin-frame-wrap' + cls('frame') }, el('span', { className: 'ch-stage-avatar', ariaHidden: 'true' }, '欢')),
      el('strong', null, '尽欢'),
      has('title') ? el('span', { className: 'ch-stage-title' + cls('title') }, el('span', { className: 'cskin-title-name' }, skin.name)) : null,
      has('badge') ? el('span', { className: 'ch-stage-badge' + cls('badge'), role: 'img', ariaLabel: '套装徽章' }) : null),
    el('div', { className: 'ch-stage-bubble cm-text' + cls('bubble') }, length === 'long' ? LONG_SAMPLE : SHORT_SAMPLE),
    has('reply') ? el('div', { className: 'ch-stage-reply rp-form' + cls('reply') }, '回应框预览') : null)
}

function skinPreview(skin) {
  let theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  let length = 'short'
  let previewDoc
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const frame = el('iframe', { className: 'ch-preview', title: `${skin.name}聊天样式预览`, referrerPolicy: 'no-referrer' })
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.dataset.previewLength = length
  const renderSample = () => previewDoc?.body.replaceChildren(previewSample(skin, length))
  frame.addEventListener('load', () => {
    previewDoc = frame.contentDocument
    if (!previewDoc?.body) return
    previewDoc.documentElement.dataset.theme = theme
    installCommunitySkinStyles(previewDoc, [skin])
    renderSample()
  }, { once: true })
  frame.srcdoc = PREVIEW_DOCUMENT

  const switcher = (label, attribute, choices, current, select) => {
    const group = el('div', { className: 'segs small', role: 'group', ariaLabel: label })
    for (const [value, text] of choices) {
      const choice = button(text, () => {
        select(value)
        for (const item of group.children) {
          const on = item.dataset[attribute] === value
          item.classList.toggle('on', on)
          item.ariaPressed = String(on)
        }
      }, 'seg' + (current === value ? ' on' : ''))
      choice.dataset[attribute] = value
      choice.ariaPressed = String(current === value)
      group.append(choice)
    }
    return group
  }
  const lengths = switcher('消息长度', 'previewLength', [['short', '短句'], ['long', '长句']], length, value => {
    length = value
    frame.dataset.previewLength = value
    const bubble = previewDoc?.querySelector('.ch-stage-bubble')
    if (bubble) bubble.textContent = value === 'long' ? LONG_SAMPLE : SHORT_SAMPLE
  })
  const themes = switcher('预览主题', 'previewTheme', [['light', '日间'], ['dark', '夜间']], theme, value => {
    theme = value
    if (previewDoc) previewDoc.documentElement.dataset.theme = value
  })
  const replayMessage = el('span', { className: 'ch-preview-motion', role: 'status' })
  const replay = button('重播动效', () => {
    if (motion.matches) {
      replayMessage.textContent = '系统已开启减少动态效果。'
      return
    }
    // 重建预览元素会从头播放发布样式里的动画及前后装饰。
    renderSample()
  }, 'btn btn-ghost sm ch-replay')
  replay.dataset.previewReplay = ''
  return el('div', { className: 'ch-tryout' },
    el('div', { className: 'ch-preview-controls' }, lengths, themes, replay, replayMessage), frame)
}

function shareButton(skin) {
  const status = el('span', { className: 'ch-share-status', role: 'status' })
  const share = button('复制分享链接', async () => {
    const url = new URL(roadLink('skins', { skin: skin.id }), location.origin).href
    try {
      await navigator.clipboard.writeText(url)
      status.replaceChildren('链接已复制。')
    } catch {
      const input = el('input', { className: 'input', value: url, readOnly: true, ariaLabel: '装扮分享链接' })
      status.replaceChildren(input)
      input.select()
    }
  })
  return [share, status]
}

function skinDetail(skin, { archived, source, onFeedback, onWear, syncAvailable }) {
  const labels = partsOf(skin).map(kind => PARTS[kind])
  const byline = el('p', { className: 'ch-byline' },
    skin.author ? el('span', null, '作者 ', gitLogin(skin.github) ? externalLink(skin.author, 'https://github.com/' + skin.github) : skin.author) : null,
    skin.license ? el('span', null, '许可 ' + skin.license) : null)
  const [share, shareStatus] = shareButton(skin)
  const actions = el('div', { className: 'ch-actions' },
    !archived && onWear ? button('去装扮设置', () => onWear(), 'btn btn-primary') : null,
    onFeedback ? button('反馈这套装扮', () => onFeedback(skin.id, source || undefined)) : null,
    syncAvailable ? internalLink('查看作品更新', roadLink('updates', { skin: skin.id }), 'btn btn-ghost') : null,
    share,
    source ? externalLink('查看发布源文件', `${SKIN_REPO}/tree/${source}/submissions/${skin.id}`, 'btn btn-ghost') : null,
    shareStatus)
  return el('article', { className: 'ch-detail', labelledBy: 'ch-skin-name' },
    el('header', { className: 'ch-detail-head' },
      el('div', null, el('h3', { id: 'ch-skin-name', textContent: skin.name }), byline),
      archived ? el('span', { className: 'ch-label' }, '已下架') : null),
    labels.length ? el('ul', { className: 'ch-parts', ariaLabel: '套装包含' }, ...labels.map(label => el('li', null, label))) : null,
    skinPreview(skin), actions,
    archived ? el('p', { className: 'ch-note' }, '这里保留已归档气泡的预览。曾获得的气泡仍可在装扮设置中使用。') :
      skin.components?.bubble ? el('p', { className: 'ch-note' }, '气泡需先在限定气泡池获得。套装中其他部件可在装扮设置佩戴。') : null)
}

function skinList(entries, selectedId) {
  const list = el('ul', { className: 'ch-skin-list' })
  const selectedIndex = entries.findIndex(item => item.id === selectedId)
  const shown = selectedIndex >= PAGE_SIZE ? [entries[selectedIndex], ...entries.filter(item => item.id !== selectedId)] : entries
  const more = appendPaged(list, shown, skin => {
    const label = partsOf(skin).map(kind => PARTS[kind]).join('、')
    const link = internalLink(el('span', { className: 'ch-skin-row' },
      el('strong', null, skin.name), el('small', null, [skin.author, label].filter(Boolean).join(' · '))),
    roadLink('skins', { skin: skin.id }), 'ch-skin-link')
    if (selectedId === skin.id) link.ariaCurrent = 'true'
    return el('li', null, link)
  })
  return el('aside', { className: 'ch-catalog', labelledBy: 'ch-catalog-title' },
    el('h3', { id: 'ch-catalog-title' }, '已发布作品'), list, more)
}

async function renderSkins(root, { skin, onFeedback, onWear, syncAvailable }) {
  const content = el('div', null)
  root.append(el('header', { className: 'ch-head' },
    el('div', null, el('h2', null, '装扮工坊'), el('p', null, '试穿群友创作的聊天装扮，也可以投稿自己的作品。')),
    externalLink('去投稿', SKIN_REPO, 'btn btn-primary')), content)
  const load = async (force = false) => {
    content.setAttribute('aria-busy', 'true')
    content.replaceChildren(state('正在读取装扮目录…'))
    try {
      await loadCommunitySkins(force)
      const { entries, archived, source } = communitySkinCatalog()
      const activeSkin = skin ? entries.find(item => item.id === skin) : entries.find(item => item.id === STARLIGHT) || entries[0]
      const archivedSkin = !activeSkin && skin ? archived.find(item => item.id === skin) : null
      const selected = activeSkin || archivedSkin
      const detail = selected ? skinDetail(selected, { archived: Boolean(archivedSkin), source: activeSkin ? source : '', onFeedback, onWear, syncAvailable }) :
        skin ? state('这套装扮不在已发布目录中。', internalLink('查看装扮工坊', roadLink('skins'), 'btn btn-ghost')) : state('现在还没有已发布的装扮。')
      content.replaceChildren(el('div', { className: 'ch-layout' }, detail, entries.length ? skinList(entries, selected?.id) : null))
    } catch {
      content.replaceChildren(state('装扮目录暂时无法读取。', button('重新读取', () => void load(true))))
    } finally {
      content.removeAttribute('aria-busy')
    }
  }
  await load()
}

const feedCache = new Map()
function readFeed(path, force) {
  const ongoing = feedCache.get(path)
  if (ongoing?.promise) return ongoing.promise
  if (!force && ongoing?.until > Date.now()) return Promise.resolve(ongoing.data)
  const promise = fetch(path, { credentials: 'omit', cache: force ? 'reload' : 'default', signal: AbortSignal.timeout(16000) })
    .then(response => {
      if (!response.ok) throw Error('更新记录暂时不可用')
      return response.json()
    }).then(data => {
      if (!Array.isArray(data?.updates)) throw Error('更新记录格式无效')
      feedCache.set(path, { data, until: Date.now() + 60000 })
      return data
    }).catch(error => {
      feedCache.delete(path)
      throw error
    })
  feedCache.set(path, { promise })
  return promise
}

function updateDate(value) {
  const date = typeof value === 'number' && value > 0 ? new Date(value < 1e12 ? value * 1000 : value) :
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null
  return date && Number.isFinite(date.getTime()) ?
    el('time', { dateTime: typeof value === 'string' ? value : date.toISOString() }, dateFormat.format(date)) : null
}

function updateCard(update, highlighted, syncAvailable) {
  const label = Object.hasOwn(KINDS, update.kind) ? KINDS[update.kind] : ''
  return el('li', { className: 'ch-update' + (highlighted ? ' ch-update-target' : ''), id: 'ch-issue-' + update.issue },
    el('article', null,
      el('header', null, label ? el('span', { className: 'ch-label' }, label) : null, el('h4', null, update.title)),
      el('p', null, update.body),
      el('div', { className: 'ch-meta' }, updateDate(update.date),
        gitLogin(update.author) ? externalLink('@' + update.author, 'https://github.com/' + update.author) : null,
        externalLink('需求 #' + update.issue, `${SITE_REPO}/issues/${update.issue}`),
        syncAvailable ? internalLink('查看关联反馈', roadLink('feedback', { issue: update.issue }), 'ch-link') : null)))
}

function issueBacklink(issue) {
  const targetText = el('span')
  const node = el('p', { className: 'ch-notice' }, targetText, ' ',
    externalLink('打开 GitHub Issue', `${SITE_REPO}/issues/${issue}`))
  targetText.textContent = `来自需求 #${issue}。`
  return {
    node,
    show(found) { targetText.textContent = found ? `已定位需求 #${issue}。` : `更新记录里暂时没有需求 #${issue}。` },
  }
}

function drawSiteUpdates(content, { updates, stale }, { kind, issue, skin, syncAvailable }, backlink, retry) {
  const records = updates.filter(item => positiveIssue(item?.issue) && typeof item.title === 'string' && typeof item.body === 'string').reverse()
  const counts = new Map()
  for (const record of records) if (Object.hasOwn(KINDS, record.kind)) counts.set(record.kind, (counts.get(record.kind) || 0) + 1)
  const selected = counts.has(kind) ? kind : ''
  const target = issue ? records.find(record => Number(record.issue) === issue) : null
  const query = { ...(issue ? { issue } : {}), ...(skin ? { skin } : {}) }
  const filters = el('nav', { className: 'ch-filters', ariaLabel: '按更新分类筛选' })
  for (const [value, label, count] of [['', '全部', records.length], ...Object.entries(KINDS).filter(([value]) => counts.has(value)).map(([value, label]) => [value, label, counts.get(value)])]) {
    const link = internalLink(el('span', null, label, ' ', el('small', null, String(count))), roadLink('updates', value ? { ...query, kind: value } : query), 'ch-filter')
    if (value === selected) link.ariaCurrent = 'true'
    filters.append(link)
  }
  const list = el('ol', { className: 'ch-timeline' })
  const shown = selected ? records.filter(item => item.kind === selected) : records
  const ordered = target ? [target, ...shown.filter(item => item !== target)] : shown
  const more = appendPaged(list, ordered, record => updateCard(record, record === target, syncAvailable))
  backlink?.show(Boolean(target))
  content.replaceChildren(
    stale ? el('div', { className: 'ch-notice ch-notice-actions', role: 'status' }, el('span', null, 'GitHub 暂时连不上，下面是最近一次读到的内容。'), button('重新读取', retry, 'btn btn-ghost sm')) : null,
    counts.size ? filters : null,
    ordered.length ? list : state('还没有更新记录。'),
    ordered.length ? more : null)
}

function skinUpdateCard(update, pending) {
  const name = update.kind === 'renamed' && typeof update.previous_name === 'string' ? `${update.previous_name} → ${update.name}` : update.name
  return el('li', null,
    el('div', { className: 'ch-skin-change-head' }, el('span', { className: 'ch-label' }, SKIN_CHANGES[update.kind]), updateDate(update.published_at)),
    pending || update.kind === 'removed' ? el('strong', null, name) : internalLink(name, roadLink('skins', { skin: update.id }), 'ch-link'),
    el('div', { className: 'ch-meta' }, externalLink(pending ? '查看仓库提交' : '查看发布提交', `${SKIN_REPO}/commit/${update.source}`)))
}

function drawSkinUpdates(content, { updates, pending, pending_source_available }, skin) {
  const matches = item => gitSha(item?.source) && skinId(item.id) && Object.hasOwn(SKIN_CHANGES, item.kind) &&
    typeof item.name === 'string' && (!skin || item.id === skin)
  const published = updates.filter(matches)
  const waiting = Array.isArray(pending) ? pending.filter(matches) : []
  const section = (label, changes, pending) => {
    if (!changes.length) return null
    const list = el('ol', { className: 'ch-changes' })
    return el('section', { className: 'ch-changes-group' }, el('h4', null, label), list,
      appendPaged(list, changes, update => skinUpdateCard(update, pending)))
  }
  const sections = [
    section('已上线', published, false) || state(skin ? '这件作品暂无已上线的变更记录。' : '暂无已发布的装扮变更。'),
    section('待主站同步', waiting, true),
    pending_source_available === false ? el('p', { className: 'ch-note', role: 'status' }, '暂时无法核对待同步投稿。') : null,
  ]
  content.replaceChildren(...sections.filter(Boolean))
}

async function drawFeed(content, path, label, draw, force = false) {
  content.setAttribute('aria-busy', 'true')
  content.replaceChildren(state(`正在读取${label}…`))
  const retry = () => void drawFeed(content, path, label, draw, true)
  try {
    draw(await readFeed(path, force), retry)
  } catch {
    content.replaceChildren(state(`${label}暂时无法读取。`, button('重新读取', retry, 'btn btn-ghost sm')))
  } finally {
    content.removeAttribute('aria-busy')
  }
}

async function renderUpdates(root, { kind, issue, skin, syncAvailable }) {
  const issueNumber = positiveIssue(issue)
  const selectedSkin = skinId(skin) ? skin : ''
  const backlink = issueNumber ? issueBacklink(issueNumber) : null
  const features = el('div', null)
  const submissions = externalLink('查看装扮投稿仓库', SKIN_REPO, syncAvailable ? 'ch-link' : 'btn btn-ghost')
  const header = el('header', { className: 'ch-head' },
    el('div', null, el('h2', null, '更新记录'), el('p', null, syncAvailable ? '查看站点更新和社区装扮的发布进度。' : '查看站点已上线的更新。')),
    el('div', { className: 'ch-actions' },
      externalLink('在 GitHub 提需求', `${SITE_REPO}/issues/new/choose`, 'btn btn-primary'),
      syncAvailable ? null : submissions))
  const siteSection = el('section', { className: 'ch-updates', labelledBy: 'ch-features-title' },
    el('h3', { id: 'ch-features-title' }, '站点更新'), backlink?.node, features)
  const loadSiteUpdates = () => drawFeed(features, '/api/community-updates', '站点更新',
    (data, retry) => drawSiteUpdates(features, data, { kind, issue: issueNumber, skin: syncAvailable ? selectedSkin : '', syncAvailable }, backlink, retry))
  if (!syncAvailable) {
    root.append(header)
    if (selectedSkin) root.append(el('p', { className: 'ch-notice' }, '当前站点暂未提供作品更新记录。', ' ',
      internalLink('返回作品', roadLink('skins', { skin: selectedSkin }), 'ch-link')))
    root.append(siteSection)
    return loadSiteUpdates()
  }
  const commits = el('div', null)
  const restoreQuery = { ...(Object.hasOwn(KINDS, kind) ? { kind } : {}), ...(issueNumber ? { issue: issueNumber } : {}) }
  const skinSection = el('aside', { className: 'ch-catalog', labelledBy: 'ch-changes-title' },
    el('h3', { id: 'ch-changes-title' }, '装扮变更'),
    selectedSkin ? el('p', { className: 'ch-notice' }, '正在查看这件作品的变更。', ' ',
      internalLink('查看全部装扮变更', roadLink('updates', restoreQuery), 'ch-link')) : null,
    commits,
    el('div', { className: 'ch-participate' }, submissions))
  root.append(header,
    el('div', { className: 'ch-layout' }, ...(selectedSkin ? [skinSection, siteSection] : [siteSection, skinSection])))
  await Promise.all([
    loadSiteUpdates(),
    drawFeed(commits, '/api/community-skins/updates', '装扮变更', data => drawSkinUpdates(commits, data, selectedSkin)),
  ])
}

export async function renderCommunityPanel(container, options) {
  const root = el('div', { className: 'ch-panel' })
  const settings = { ...options, syncAvailable: options.syncAvailable === true }
  container.replaceChildren(root)
  if (settings.tab === 'skins') await renderSkins(root, settings)
  else if (settings.tab === 'updates') await renderUpdates(root, settings)
}
