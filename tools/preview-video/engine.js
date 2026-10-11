/**
 * Animation engine for preview scenes (adapted from op-frontend's promo-video tool).
 *
 * Every animation is a CSS animation queued with A(node, keyframes, start, duration);
 * finalize() applies them, and render.mjs pauses and seeks all of them to each frame's
 * time — so the video is frame-exact no matter how slow a frame is to draw. A scene page
 * defines its beat grid (`at(bar, beat)`), its keyframes/CSS, then calls finalize() last.
 */
const EASE = 'cubic-bezier(.2,.8,.2,1)'
const C = window.CAPTURE
const root = document.getElementById('root')
const queued = new Map()

/** Creates an element; `style` is an object of inline styles / CSS vars. */
function el(tag, cls, parent, style = {}, html = '') {
  const node = document.createElement(tag)
  if (cls) {
    node.className = cls
  }
  for (const [k, v] of Object.entries(style)) {
    node.style.setProperty(k, v)
  }
  if (html) {
    node.innerHTML = html
  }
  ;(parent ?? root).appendChild(node)
  return node
}

/** Queues one CSS animation on a node; several per node are comma-joined at the end. */
function A(node, name, start, dur, { ease = EASE, iter = 1, fill = 'both' } = {}) {
  const list = queued.get(node) ?? []
  list.push(`${name} ${dur}s ${ease} ${start}s ${iter} normal ${fill}`)
  queued.set(node, list)
  return node
}

let keyframeId = 0
const keyframeSheet = document.createElement('style')
document.head.appendChild(keyframeSheet)

/** Transform tween with generated keyframes; remembers the node's last transform. */
function tween(node, to, t, dur, ease = 'cubic-bezier(.45,0,.2,1)') {
  const name = `tw${keyframeId++}`
  const from = node.tAt ?? 'none'
  keyframeSheet.textContent += `@keyframes ${name} { from { transform: ${from}; } to { transform: ${to}; } }\n`
  A(node, name, t, dur, { ease, fill: node.tMoved ? 'forwards' : 'both' })
  node.tMoved = true
  node.tAt = to
}

/**
 * An app window showing captures. Coordinates inside (`cam`) are in the window's own
 * screen pixels; `k` converts capture CSS pixels (C.size) to them.
 */
function appWindow(parent, shot, x, y, w) {
  const h = Math.round((w * C.size.h) / C.size.w)
  const node = el('div', 'appwin', parent, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`
  })
  const view = el('div', 'view', node)
  const cam = el('div', 'abs', view, {
    left: '0',
    top: '0',
    width: `${w}px`,
    height: `${h}px`,
    'transform-origin': '0 0'
  })
  const win = { node, view, cam, w, h, k: w / C.size.w }
  showShot(win, shot)
  return win
}

/**
 * Stacks capture `shot` into the window; it appears at `t` (instantly unless `fade`).
 * The shot it covers is hidden once the new one is fully shown, so a window only ever
 * paints one or two full-size captures — hundreds of stacked 2400px images would make
 * the browser drop tiles and render blank frames. Shots must be added in time order.
 */
function showShot(win, shot, t, fade = 0.01) {
  const img = el('img', '', win.cam, { position: 'absolute', left: '0', top: '0', width: '100%' })
  img.src = `assets/${C.shots[shot] ?? shot}`
  if (t !== undefined) {
    A(img, 'show', t, fade, { ease: 'linear' })
    if (win.top && t >= (win.topT ?? -Infinity)) {
      A(win.top, 'hide', t + fade + 0.03, 0.001, { ease: 'linear', fill: 'forwards' })
    }
  }
  win.top = img
  win.topT = t ?? -Infinity
  return img
}

/**
 * Pushes the window's camera in on a capture point: (cx, cy) in capture CSS pixels,
 * `s` the zoom. Clamped so the frame never shows past the capture's edges.
 */
function focus(win, cx, cy, s, t, dur = 0.7, ease = 'cubic-bezier(.65,0,.25,1)') {
  const { w, h, k } = win
  const tx = Math.min(0, Math.max(w - s * w, w / 2 - s * cx * k))
  const ty = Math.min(0, Math.max(h - s * h, h / 2 - s * cy * k))
  tween(win.cam, `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s})`, t, dur, ease)
}

/** Applies every queued animation and exposes the hooks render.mjs drives. Call once, last. */
function finalize(duration) {
  window.PREVIEW_DURATION = duration
  for (const [node, list] of queued) {
    node.style.animation = list.join(', ')
  }
  /** Called by render.mjs: wait for fonts + images, then freeze every animation for seeking. */
  window.previewReady = async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)))
    for (const a of document.getAnimations()) {
      a.pause()
    }
  }
  /** Seeks the whole piece to `t` seconds. */
  window.previewSeek = (t) => {
    for (const a of document.getAnimations()) {
      a.currentTime = t * 1000
    }
  }
  if (!location.search.includes('play')) {
    window.previewReady()
  }
}
