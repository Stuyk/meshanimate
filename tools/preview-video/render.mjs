/**
 * Renders a preview scene to an MP4 with its music, frame-accurately (adapted from
 * op-frontend's promo-video tool).
 *
 * Every CSS animation in the scene is paused and seeked to each frame's time, screenshotted,
 * and the frames are encoded with ffmpeg. Frames are split across several browser processes.
 *
 *   node tools/preview-video/render.mjs                    scene-sizzle.html → meshanimate-sizzle.mp4
 *   node tools/preview-video/render.mjs --fps 30           faster draft
 *   node tools/preview-video/render.mjs --stills 2,9.5     PNG stills at those seconds (.stills/)
 *   node tools/preview-video/render.mjs --remix            rebuild only the audio onto the last render
 *
 * The scene declares its own music (window.PREVIEW_MUSIC, a file in the repo root, plus
 * PREVIEW_MUSIC_START) because its beat grid is measured from that exact track, and may
 * declare PREVIEW_SFX cues (files under PREVIEW_SFX_ROOT) mixed under the music.
 *
 * Env: PREVIEW_OUT (output path), PREVIEW_WORKERS (browser processes), PREVIEW_SFX_ROOT
 * (sound library, default /media/stuyk/Side2/sounds).
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const FRAMES = join(HERE, '.frames')
const SOUNDTRACK = join(HERE, '.soundtrack.wav')
const SFX_ROOT = process.env.PREVIEW_SFX_ROOT ?? '/media/stuyk/Side2/sounds'

const { values } = parseArgs({
  options: {
    scene: { type: 'string', default: 'sizzle' },
    fps: { type: 'string', default: '60' },
    stills: { type: 'string' },
    remix: { type: 'boolean' }
  }
})
const fps = Number(values.fps)
const workers = Number(
  process.env.PREVIEW_WORKERS ?? Math.max(2, Math.min(12, availableParallelism() - 4))
)
const sceneFile = `scene-${values.scene}.html`
const out = process.env.PREVIEW_OUT ?? join(HERE, `meshanimate-${values.scene}.mp4`)

async function openScene(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(`file://${join(HERE, sceneFile)}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => window.previewReady())
  return page
}

let rendered = 0
async function renderSlice(start, end, total) {
  const browser = await chromium.launch()
  try {
    const page = await openScene(browser)
    for (let f = start; f < end; f++) {
      await page.evaluate((t) => window.previewSeek(t), f / fps)
      await page.screenshot({
        path: join(FRAMES, `${String(f).padStart(5, '0')}.jpg`),
        type: 'jpeg',
        quality: 95
      })
      if (++rendered % 300 === 0) {
        console.log(`${rendered}/${total} frames`)
      }
    }
  } finally {
    await browser.close()
  }
}

async function renderStills(browser, times) {
  const dir = join(HERE, '.stills')
  mkdirSync(dir, { recursive: true })
  const page = await openScene(browser)
  for (const t of times) {
    await page.evaluate((s) => window.previewSeek(s), t)
    await page.screenshot({ path: join(dir, `t${t.toFixed(2)}.png`) })
  }
  console.log(`stills → ${dir}`)
}

function ffmpeg(args) {
  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
    p.on('exit', (code) =>
      code === 0 ? ok() : fail(new Error(`ffmpeg failed: ${args.slice(0, 6).join(' ')}…`))
    )
  })
}

/** Music (from its start point, faded out) + SFX cues → limited stereo soundtrack. */
async function buildSoundtrack(meta) {
  const cues = (meta.sfx ?? []).filter((cue) => {
    const ok = existsSync(join(SFX_ROOT, cue.file))
    if (!ok) {
      console.warn(`missing sfx, skipped: ${cue.file}`)
    }
    return ok
  })
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo'
  const fade = meta.fade ?? 1.5
  const lines = [
    `[0:a]${fmt},atrim=0:${meta.duration},afade=t=in:d=0.04,afade=t=out:st=${(meta.duration - fade).toFixed(2)}:d=${fade}[music]`
  ]
  cues.forEach((cue, i) => {
    lines.push(
      `[${i + 1}:a]${fmt},volume=${cue.gain}dB,adelay=${Math.round(cue.start * 1000)}:all=1[s${i}]`
    )
  })
  const limit = 'alimiter=limit=0.79:level=false[out]'
  if (cues.length) {
    lines.push(
      `${cues.map((_, i) => `[s${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:dropout_transition=0[sfx]`
    )
    lines.push(`[music][sfx]amix=inputs=2:normalize=0:duration=first,${limit}`)
  } else {
    lines.push(`[music]${limit}`)
  }
  const script = join(HERE, '.soundtrack.filter')
  writeFileSync(script, lines.join(';\n'))
  await ffmpeg([
    '-ss',
    String(meta.musicStart ?? 0),
    '-i',
    join(REPO, meta.music),
    ...cues.flatMap((cue) => ['-i', join(SFX_ROOT, cue.file)]),
    '-filter_complex_script',
    script,
    '-map',
    '[out]',
    '-t',
    String(meta.duration),
    '-c:a',
    'pcm_s16le',
    SOUNDTRACK
  ])
  rmSync(script, { force: true })
  console.log(`soundtrack: music + ${cues.length} sfx cues`)
}

async function encode(duration) {
  await ffmpeg([
    '-framerate',
    String(fps),
    '-i',
    join(FRAMES, '%05d.jpg'),
    '-i',
    SOUNDTRACK,
    '-t',
    String(duration),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '17',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-movflags',
    '+faststart',
    out
  ])
}

async function remux() {
  const tmp = out.replace(/\.mp4$/, '.remix.mp4')
  await ffmpeg([
    '-i',
    out,
    '-i',
    SOUNDTRACK,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-movflags',
    '+faststart',
    tmp
  ])
  renameSync(tmp, out)
}

const browser = await chromium.launch()
try {
  if (values.stills) {
    await renderStills(browser, values.stills.split(',').map(Number))
  } else {
    const probe = await openScene(browser)
    const meta = await probe.evaluate(() => ({
      duration: window.PREVIEW_DURATION,
      music: window.PREVIEW_MUSIC,
      musicStart: window.PREVIEW_MUSIC_START,
      fade: window.PREVIEW_FADE,
      sfx: window.PREVIEW_SFX
    }))
    await probe.close()
    await buildSoundtrack(meta)
    if (values.remix) {
      await remux()
      console.log(`audio remixed → ${out}`)
    } else {
      const total = Math.round(meta.duration * fps)
      rmSync(FRAMES, { recursive: true, force: true })
      mkdirSync(FRAMES)
      const size = Math.ceil(total / workers)
      const started = performance.now()
      console.log(`${total} frames across ${workers} browser processes`)
      await Promise.all(
        Array.from({ length: workers }, (_, i) =>
          renderSlice(i * size, Math.min(total, (i + 1) * size), total)
        )
      )
      console.log(`${total} frames in ${((performance.now() - started) / 1000).toFixed(0)}s`)
      await encode(meta.duration)
      rmSync(FRAMES, { recursive: true, force: true })
      console.log(`video → ${out}`)
    }
  }
} finally {
  await browser.close()
}
