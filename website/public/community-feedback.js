export const COMMUNITY_REPO = 'https://github.com/kourou25/jinhuan'

export function communityHref(tab, params = {}) {
  const query = new URLSearchParams({ tab })
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  return '/road?' + query
}

export function feedbackWork(skin, source) {
  if (typeof skin !== 'string' || !/^[a-z0-9][a-z0-9-]{2,47}$/.test(skin)) return null
  const validSource = typeof source === 'string' && /^[a-f0-9]{40}$/.test(source)
  return { skin, source: validSource ? source : null }
}

export function issueNumber(value) {
  const n = Number(value)
  return /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(n) ? n : null
}

export function publicIssueFields({ h, field }, draft = {}) {
  const title = h('input', { class: 'input', required: true, minlength: 2, maxlength: 120 })
  const body = h('textarea', { class: 'input', rows: 4, maxlength: 4000 })
  const previewTitle = h('strong', { class: 'rd-body' })
  const previewBody = h('p', { class: 'rd-body' })
  const preview = () => {
    previewTitle.textContent = title.value.trim() || '（无标题）'
    previewBody.textContent = body.value.trim() || '（无正文）'
  }
  title.addEventListener('input', () => { title.setCustomValidity(''); preview() })
  body.addEventListener('input', preview)
  const fill = (titleText, bodyText) => {
    title.value = titleText || ''
    body.value = bodyText || ''
    title.setCustomValidity('')
    preview()
  }
  fill(draft.title, draft.body)
  const el = h('div', { class: 'community-issue-fields' },
    h('p', { class: 'muted sm' }, '下方标题和正文会以纯文本公开。站内附件和群聊原文需要从站内查看。'),
    field('公开标题', title),
    field('公开正文', body),
    h('details', null, h('summary', null, '预览公开内容'), previewTitle, previewBody))
  const show = (shown) => {
    el.hidden = !shown
    title.disabled = body.disabled = !shown
  }
  const value = () => {
    const text = title.value.trim()
    title.setCustomValidity(text.length >= 2 ? '' : '公开标题至少 2 个字')
    return title.reportValidity() ? { title: text, body: body.value.trim() } : null
  }
  return { el, title, fill, show, value }
}

export function createFeedbackGithub(api) {
  const attempts = new Map()
  const get = (id) => attempts.get(id)
  const sync = (id, payload) => {
    const previous = get(id)
    if (previous?.promise) return previous.promise
    const attempt = { payload: payload.reconcile ? previous?.payload : payload, status: 'pending' }
    attempts.set(id, attempt)
    attempt.promise = (async () => {
      try {
        const data = await api(`/road/${id}/github`, { method: 'POST', body: payload })
        attempt.issue = issueNumber(data.github_issue)
        attempt.status = data.github_sync_status || 'failed'
        attempt.error = data.error
      } catch (error) {
        attempt.status = error.github_sync_status || previous?.status
        attempt.issue = issueNumber(error.github_issue)
        attempt.error = error.message
      } finally {
        attempt.promise = null
      }
      return attempt
    })()
    return attempt.promise
  }
  return { get, sync }
}
