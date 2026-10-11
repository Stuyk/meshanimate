/**
 * Captures the real MeshAnimate app for the preview video. The capture tells one story:
 * open a .blend and play one of its actions, make a new clip and key a walk cycle in side
 * view (contact pose, mirror to half-cycle, passing pose), play it back — then refine that
 * same walk with IK and snapping, retime it with onion skin and the first-frame ghost, save. Every frame is the app's real
 * state; drags are recorded as smooth flipbooks with the pointer's exact position per
 * frame, and every clicked control's on-screen box is recorded so the video's cursor only
 * ever lands where the app was really clicked.
 *
 *   npm run build                                   # the capture drives out/ (the built app)
 *   npm run preview:capture -- path/to/robot.blend  # xvfb wrapper; or run under a desktop
 *
 * The shots are written for the sample robot rig (its clip and bone names). Works on a
 * copy of the .blend in .work/ with a throwaway Electron profile, so neither the real
 * file nor your preferences are touched. Writes assets/* and assets/capture.js.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const ASSETS = join(HERE, 'assets')
const WORK = join(HERE, '.work')
const W = 1600
const H = 1000
/** Captured at 1.5× so zoomed shots in the 1080p video stay sharp. */
const SCALE = 1.5

const source = resolve(process.argv[2] ?? join(REPO, 'robot.blend'))
if (!existsSync(source)) {
  console.error(
    `No .blend to capture: ${source}\nUsage: node tools/preview-video/capture.mjs path/to/rig.blend`
  )
  process.exit(1)
}
rmSync(ASSETS, { recursive: true, force: true })
rmSync(join(WORK, 'profile'), { recursive: true, force: true })
mkdirSync(ASSETS, { recursive: true })
mkdirSync(join(WORK, 'profile'), { recursive: true })
const BLEND = join(WORK, 'robot.blend')
copyFileSync(source, BLEND)

const app = await electron.launch({
  executablePath: join(REPO, 'node_modules/electron/dist/electron'),
  args: [
    REPO,
    '--no-sandbox',
    `--user-data-dir=${join(WORK, 'profile')}`,
    `--force-device-scale-factor=${SCALE}`
  ]
})
const win = await app.firstWindow()
await app.evaluate(
  ({ BrowserWindow }, [w, h]) => {
    const bw = BrowserWindow.getAllWindows()[0]
    bw.unmaximize()
    bw.setContentSize(w, h)
    bw.setPosition(0, 0)
  },
  [W, H]
)
await win.waitForTimeout(1500)
const ev = (fn, arg) => win.evaluate(fn, arg)

const CAPTURE = { size: { w: W, h: H }, shots: {}, boxes: {}, seqs: {}, points: {} }

async function settle(ms = 350) {
  await ev(() => document.querySelectorAll('[title="Dismiss"]').forEach((b) => b.click()))
  await win.waitForTimeout(ms)
}

async function shot(name, { jpg = false } = {}) {
  const file = `${name}.${jpg ? 'jpg' : 'png'}`
  await win.screenshot({ path: join(ASSETS, file), ...(jpg ? { type: 'jpeg', quality: 90 } : {}) })
  CAPTURE.shots[name] = file
  return file
}

/** Records the CSS-pixel box of the first element matching `selector` (optionally by text or title prefix). */
async function mark(name, selector, { text, title } = {}) {
  const box = await ev(
    ([sel, text, title]) => {
      const el = [...document.querySelectorAll(sel)].find(
        (e) =>
          (!text || e.textContent?.trim().startsWith(text)) &&
          (!title || (e.getAttribute('title') ?? '').startsWith(title))
      )
      if (!el) {
        return null
      }
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    },
    [selector, text, title]
  )
  if (!box) {
    throw new Error(`mark: nothing matches ${selector} ${text ?? ''} ${title ?? ''}`)
  }
  CAPTURE.boxes[name] = box
  return box
}

const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Screen position (CSS px) of a bone's tail or head. */
function bonePoint(bone, where = 'tail') {
  return ev(
    ([bone, where]) => {
      const h = window.__meshanimate
      const rig = h.studio.rig()
      const eng = h.engine()
      const j = rig.jointByName.get(bone)
      const p =
        where === 'tail'
          ? j.localToWorld(rig.tails.get(bone).clone())
          : j.getWorldPosition(new h.THREE.Vector3())
      const v = p.project(eng.sceneHandle.camera)
      const r = eng.sceneHandle.renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    },
    [bone, where]
  )
}

/** Screen position of a clip frame on the timeline ruler. */
function rulerPoint(frame) {
  return ev((frame) => {
    const ruler = [...document.querySelectorAll('div')].find(
      (d) => d.style.height === '24px' && d.className.includes('cursor-ew-resize')
    )
    const r = ruler.getBoundingClientRect()
    const scroller = ruler.parentElement.parentElement
    const len = window.__meshanimate.studio.activeClip().length
    const ppf = Math.max(4, (scroller.clientWidth - 24) / len)
    return { x: r.left + 12 + frame * ppf + ppf / 2, y: r.top + r.height / 2 }
  }, frame)
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * A real drag recorded as a smooth flipbook: mouse down on `from`, an eased curve to
 * `to` (bowed by `bow` px for a natural arc), mouse up — a frame shot at every step
 * with the pointer's exact position. A few frames after release show the settled result.
 */
async function drag(name, from, to, { frames = 40, bow = 0, after = 6 } = {}) {
  const seq = []
  const record = async (p, pressed) => {
    seq.push({
      file: await shot(`${name}-${String(seq.length).padStart(2, '0')}`, { jpg: true }),
      x: p.x,
      y: p.y,
      pressed
    })
  }
  await win.mouse.move(from.x, from.y)
  await win.waitForTimeout(120)
  await record(from, false)
  await win.mouse.down()
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  for (let i = 1; i <= frames; i++) {
    const t = ease(i / frames)
    const bend = Math.sin(Math.PI * t) * bow
    const p = { x: from.x + dx * t + nx * bend, y: from.y + dy * t + ny * bend }
    await win.mouse.move(p.x, p.y)
    await win.waitForTimeout(16)
    await record(p, true)
  }
  await win.mouse.up()
  await win.waitForTimeout(250)
  for (let i = 0; i < after; i++) {
    await record(to, false)
  }
  CAPTURE.seqs[name] = seq
  return seq
}

const view = (x, y, z) =>
  ev(
    ([x, y, z]) =>
      window.__meshanimate
        .engine()
        .sceneHandle.controls.snapToDirection(new window.__meshanimate.THREE.Vector3(x, y, z), 1),
    [x, y, z]
  )

// ---------------------------------------------------------------------------
// 1 · Start screen → open
// ---------------------------------------------------------------------------
await ev(() =>
  document.querySelectorAll('button').forEach((b) => b.title === 'Close (Esc)' && b.click())
)
await win.waitForTimeout(800)
await shot('start')
await mark('openButton', 'button', { text: 'Open .blend' })
await ev((p) => window.__meshanimate.openBlend(p), BLEND)
await ev(() => {
  const s = window.__meshanimate.studio
  s.setSnap({ enabled: false, grid: 0.05, angle: 15 })
  s.setOnion({ ...s.onion(), enabled: false, mode: 'keys', before: 1, after: 1, opacity: 0.34 })
})
await view(0.85, 0.2, 1)
await win.mouse.move(1000, 300)
await win.waitForTimeout(1200)
// The load toast says what came in: bones, IK chains, actions.
await shot('opened')
await mark('openToast', 'span.font-medium', { text: 'robot.blend:' })
await settle(300)
await mark('clips', 'aside .m-2')

// Click a Blender action in the list: it plays with its own keys.
const runRow = await mark('runRow', 'aside span.font-medium', { text: 'run-full' })
await win.mouse.click(centre(runRow).x, centre(runRow).y)
await win.mouse.move(centre(runRow).x + 40, centre(runRow).y + 30)
await settle(500)
CAPTURE.points.runKey0 = await rulerPoint(0)
const runFull = []
for (let f = 0; f < 19; f++) {
  await ev((f) => window.__meshanimate.studio.setFrame(f), f)
  await win.waitForTimeout(40)
  runFull.push({ file: await shot(`runfull-${String(f).padStart(2, '0')}`, { jpg: true }) })
}
CAPTURE.seqs.runFull = runFull

// ---------------------------------------------------------------------------
// 2 · New clip, side view, then the walk's contact pose at frame 0
// ---------------------------------------------------------------------------
await mark('newClip', 'button', { title: 'New clip' })
await win.mouse.click(centre(CAPTURE.boxes.newClip).x, centre(CAPTURE.boxes.newClip).y)
await ev(() => {
  const s = window.__meshanimate.studio
  s.updateClipMeta({ length: 25 })
  s.renameClip(s.activeClipId(), 'walk-cycle')
})
await mark('restPose', 'button', { text: 'Rest pose' })
await win.mouse.click(centre(CAPTURE.boxes.restPose).x, centre(CAPTURE.boxes.restPose).y)
await view(0.25, 0.12, 1)
await win.mouse.move(700, 450)
await settle(700)
await shot('newclip')
await mark('timeline', 'div.flex.flex-col.bg-\\[var\\(--bg-panel\\)\\]')

// Side view (numpad 3), pulled in closer on the figure.
await win.keyboard.press('Numpad3')
await win.waitForTimeout(600)
await win.mouse.move(720, 460)
for (let i = 0; i < 3; i++) {
  await win.mouse.wheel(0, -100)
  await win.waitForTimeout(80)
}
await settle(700)
/** Screen px per probe px: offsets below were tuned on the unzoomed side view. */
const u = ((await bonePoint('Shin.L')).y - (await bonePoint('Root', 'head')).y) / 287

/** A real drag that isn't filmed (sets up a shot). */
async function quietDrag(from, to) {
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await win.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12)
    await win.waitForTimeout(16)
  }
  await win.mouse.up()
  await win.waitForTimeout(200)
}
const rel = (p, dx, dy) => ({ x: p.x + dx * u, y: p.y + dy * u })

// Hips down a touch, so the legs can reach a long stride.
let p = await bonePoint('Root', 'head')
await quietDrag(p, rel(p, 0, 16))
await win.mouse.move(1000, 300)
await settle(300)
await shot('side')

// Contact: front foot forward (the rig faces left), back foot behind, arms opposite.
// This rig's ankles rest ~57 px behind the hips, so the stride is centred on the hips.
p = await bonePoint('Shin.L')
await drag('stepL', p, rel(p, -150, -2), { frames: 30, bow: 18 * u })
p = await bonePoint('Shin.R')
await drag('stepR', p, rel(p, 35, -10), { frames: 26, bow: -10 * u })
p = await bonePoint('UpperArm.R')
await drag('swingR', p, rel(p, -34, -8), { frames: 20, after: 3 })
p = await bonePoint('UpperArm.L')
await drag('swingL', p, rel(p, 34, -8), { frames: 20, after: 3 })

// The cycle's last frame repeats its first, as Blender cycles are keyed.
await ev(() => {
  const s = window.__meshanimate.studio
  s.setSelectedJoint(null)
  s.setFrame(0)
  s.setKey(24, s.poseAt(s.activeClip(), 0))
  s.setFrame(0)
})
await settle(300)
await shot('contact')
for (const f of [0, 6, 12, 18, 24]) {
  CAPTURE.points[`key${f}`] = await rulerPoint(f)
}

// ---------------------------------------------------------------------------
// 3 · Mirror to half-cycle, then the passing pose in between
// ---------------------------------------------------------------------------
await win.keyboard.press('Shift+M')
await win.waitForTimeout(400)
await shot('mirrored')
await settle(200)
let a = await rulerPoint(0)
let b = await rulerPoint(12)
await drag('scrub12', a, b, { frames: 24, after: 4 })

await ev(() => {
  const s = window.__meshanimate.studio
  s.setOnion({ ...s.onion(), enabled: true, mode: 'keys', before: 1, after: 1 })
})
a = await rulerPoint(12)
b = await rulerPoint(6)
await drag('scrub6', a, b, { frames: 20, after: 4 })
p = await bonePoint('Shin.R')
await drag('lift', p, rel(p, -12, -50), { frames: 28, bow: -12 * u })
p = await bonePoint('Root', 'head')
await drag('rise', p, rel(p, 0, -13), { frames: 20, after: 4 })
await win.mouse.move(1000, 300)
await win.keyboard.press('Shift+M')
await win.waitForTimeout(400)
await shot('mirrored2')
await settle(200)

// ---------------------------------------------------------------------------
// 4 · Play the cycle back
// ---------------------------------------------------------------------------
await ev(() => {
  const s = window.__meshanimate.studio
  s.setOnion({ ...s.onion(), enabled: false })
  s.setSelectedJoint(null)
  s.setFrame(0)
})
await settle(300)
await mark('play', 'button', { title: 'Play (Space)' })
const play = []
for (let f = 0; f < 24; f++) {
  await ev((f) => window.__meshanimate.studio.setFrame(f), f)
  await win.waitForTimeout(40)
  play.push({ file: await shot(`play-${String(f).padStart(2, '0')}`, { jpg: true }) })
}
CAPTURE.seqs.play = play

// ---------------------------------------------------------------------------
// 5 · Blender IK on the walk's contact pose: snap on, drop the hips, place a foot
// ---------------------------------------------------------------------------
await ev(() => window.__meshanimate.studio.setFrame(0))
await win.mouse.move(1000, 300)
await settle(300)
await shot('ikStart')
await win.keyboard.press('s')
await win.waitForTimeout(400)
await shot('snapOn')
await mark('snapBadge', 'button', { title: 'Snapping in the' })
p = await bonePoint('Root', 'head')
await drag('ikHips', p, rel(p, 0, 34), { frames: 30, bow: 0 })
p = await bonePoint('Shin.L')
await drag('ikFoot', p, rel(p, -40, 0), { frames: 28, bow: 14 * u })
// Put the walk back the way it was for the chapters after this one.
await ev(() => {
  const s = window.__meshanimate.studio
  s.undo()
  s.undo()
  s.setSnap({ enabled: false })
})

// ---------------------------------------------------------------------------
// 6 · Timing on the walk: retime the passing key, onion skin, first-frame ghost
// ---------------------------------------------------------------------------
await view(0.85, 0.2, 1)
await win.mouse.move(720, 460)
for (let i = 0; i < 3; i++) {
  await win.mouse.wheel(0, 100)
  await win.waitForTimeout(80)
}
await ev(() => {
  const s = window.__meshanimate.studio
  s.setSelectedJoint(null)
  s.setFrame(9)
})
await win.mouse.move(1000, 300)
await settle(500)
await shot('timingStart')
const keyBox = await mark('key7', 'div', { title: 'Key @ 7' })
const k = centre(keyBox)
const dest = await rulerPoint(4)
await drag('retime', k, { x: dest.x, y: k.y }, { frames: 24, after: 4 })
CAPTURE.points.key4 = { x: dest.x, y: k.y }
await ev(() => window.__meshanimate.studio.setFrame(9))
await win.mouse.move(1000, 300)
await settle(300)
await mark('onionButton', 'button', { title: 'Onion skin (O)' })
await mark('ghostButton', 'button', { title: 'First-frame ghost' })
await shot('ghostsOff')
// Real clicks on the timeline buttons.
let c = centre(CAPTURE.boxes.onionButton)
await win.mouse.click(c.x, c.y)
await win.mouse.move(c.x, c.y + 60)
await win.waitForTimeout(300)
await shot('onionOn')
c = centre(CAPTURE.boxes.ghostButton)
await win.mouse.click(c.x, c.y)
await win.mouse.move(c.x, c.y + 60)
await win.waitForTimeout(300)
await shot('ghostOn')
// Scrub on: the first frame stays pinned as a ghost.
a = await rulerPoint(9)
b = await rulerPoint(20)
await drag('ghostScrub', a, b, { frames: 30, after: 4 })

// ---------------------------------------------------------------------------
// 7 · Save into the .blend
// ---------------------------------------------------------------------------
await ev(() => {
  const s = window.__meshanimate.studio
  s.setOnion({ ...s.onion(), enabled: false })
  s.setDisplay({ ...s.display(), showFirstFrame: false })
  s.setFrame(12)
})
await win.mouse.move(1000, 300)
await settle(300)
await ev(() =>
  [...document.querySelectorAll('aside span.font-medium')]
    .find((e) => e.textContent.startsWith('walk-cycle'))
    .scrollIntoView({ block: 'nearest' })
)
await win.waitForTimeout(200)
await shot('beforeSave')
await mark('fileName', 'span', { title: 'robot.blend' })
await ev(() => window.__meshanimate.save())
await win.waitForTimeout(400)
await shot('saved')
await mark('toast', 'span.font-medium', { text: 'Saved' })
await mark('newRow', 'aside span.font-medium', { text: 'walk-cycle' })

writeFileSync(join(ASSETS, 'capture.js'), `window.CAPTURE = ${JSON.stringify(CAPTURE)};\n`)
await ev(() => window.__meshanimate.studio.setDirty(false))
await app.close()
console.log(`captured ${Object.keys(CAPTURE.shots).length} images → ${ASSETS}`)
