export const REM_BUBBLE_KEY = 'preset:rem-dual-form'
export const REM_SKIN_NAME = '蕾姆双形态'
const FORM_NAMES = { white: '白花誓约', black: '鬼角夜巡' }

export function remTitle(h, attrs, form) {
  return h('div', { ...attrs, class: `rm-titles ${attrs.class}`, role: 'img', 'aria-label': FORM_NAMES[form] },
    h('span', { class: 'rm-title rm-pearl', 'aria-hidden': 'true' },
      h('i', { class: 'rm-title-art' }), FORM_NAMES.white, h('i', { class: 'rm-petal' })),
    h('span', { class: 'rm-title rm-night', 'aria-hidden': 'true' },
      h('i', { class: 'rm-title-art' }), FORM_NAMES.black, h('i', { class: 'rm-pin' })))
}

export function remBubble(h, attrs, content, text = '') {
  const nativeColor = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text)
  return h('div', { ...attrs, class: `cm-text rm-bubble ${attrs.class}` },
    h('div', { class: 'rm-panel rm-pearl', 'aria-hidden': 'true' }, h('i', { class: 'rm-petal rm-bubble-petal' })),
    h('div', { class: 'rm-panel rm-night', 'aria-hidden': 'true' }, h('i', { class: 'rm-pin rm-bubble-pin' })),
    h('div', { class: 'rm-art', 'aria-hidden': 'true' },
      h('div', { class: 'rm-face rm-pearl' }, h('i', { class: 'rm-portrait' })),
      h('div', { class: 'rm-face rm-night' }, h('i', { class: 'rm-portrait' }))),
    h('div', { class: nativeColor ? 'rm-copy rm-copy-native' : 'rm-copy' }, content))
}

function playRemTransition(scope) {
  const doc = scope.ownerDocument
  const win = doc.defaultView
  if (doc.hidden || doc.documentElement.dataset.bubbleMotion === 'pause' ||
      win.matchMedia('(prefers-reduced-motion: reduce)').matches || !scope.querySelector('.rm-worn')) return
  if (scope.hasAttribute('data-rem-enter')) return

  const lifetime = new win.AbortController()
  const stop = () => {
    lifetime.abort()
    win.clearTimeout(timeout)
    scope.removeAttribute('data-rem-enter')
  }
  const timeout = win.setTimeout(stop, 1200)
  const finish = event => { if (event.target === scope) stop() }
  scope.addEventListener('animationend', finish, { signal: lifetime.signal })
  scope.addEventListener('animationcancel', finish, { signal: lifetime.signal })
  scope.setAttribute('data-rem-enter', '')
}

export function animateRemMessage(row) {
  const scope = row.querySelector('[data-rem-form]')
  if (!scope) return
  const doc = row.ownerDocument
  const win = doc.defaultView
  if (doc.hidden || !scope.querySelector('.rm-worn')) return
  if (row.dataset.bubbleLive === 'true') {
    playRemTransition(scope)
    return
  }

  const lifetime = new win.AbortController()
  const timeout = win.setTimeout(() => lifetime.abort(), 450)
  doc.addEventListener('bubblevisibilitychange', () => {
    if (!row.isConnected || row.dataset.bubbleLive !== 'true') return
    lifetime.abort()
    win.clearTimeout(timeout)
    playRemTransition(scope)
  }, { signal: lifetime.signal })
}

export function swapRemPreview(container) {
  for (const scope of container.querySelectorAll('[data-rem-preview]')) {
    if (scope.hasAttribute('data-rem-enter')) continue
    scope.dataset.remForm = scope.dataset.remForm === 'black' ? 'white' : 'black'
    scope.querySelector('.rm-titles').setAttribute('aria-label', FORM_NAMES[scope.dataset.remForm])
    playRemTransition(scope)
  }
}
