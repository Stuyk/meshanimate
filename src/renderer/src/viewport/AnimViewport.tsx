import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { AnimEngine, type GhostSpec } from './animEngine'
import { studio } from '../anim/studio'
import { commitLivePose } from '../anim/actions'
import type { LightingMode } from './scene'
import { formatGrid } from './snap'
import { MagnetIcon } from '../components/icons'
import { t } from '../i18n'

export interface AnimViewportHandle {
  engine: AnimEngine
}

export interface AnimViewportProps {
  lightingMode: LightingMode
  onReady: (handle: AnimViewportHandle) => void
}

/** Frames the onion skin should show around `frame`, nearest first. */
function ghostFrames(frame: number): { before: number[]; after: number[] } {
  const o = studio.onion()
  const clip = studio.activeClip()
  if (!clip) {
    return { before: [], after: [] }
  }
  if (o.mode === 'keys') {
    const keyFrames = clip.keys.map((k) => k.frame)
    return {
      before: keyFrames
        .filter((f) => f < frame)
        .reverse()
        .slice(0, o.before),
      after: keyFrames.filter((f) => f > frame).slice(0, o.after)
    }
  }
  const before: number[] = []
  const after: number[] = []
  for (let i = 1; i <= o.before; i++) {
    const f = frame - i * o.step
    if (f >= 0) {
      before.push(f)
    }
  }
  for (let i = 1; i <= o.after; i++) {
    const f = frame + i * o.step
    if (f < clip.length) {
      after.push(f)
    }
  }
  return { before, after }
}

export default function AnimViewport(props: AnimViewportProps): JSX.Element {
  let canvas!: HTMLCanvasElement
  let overlay!: HTMLCanvasElement
  let navCanvas!: HTMLCanvasElement
  let engine: AnimEngine | null = null
  let playClock = 0

  onMount(() => {
    engine = new AnimEngine(canvas, overlay, navCanvas, {
      onTick: (dt) => {
        const clip = studio.activeClip()
        if (!studio.playing() || !clip) {
          playClock = 0
          return
        }
        playClock += dt * clip.fps
        if (playClock < 1) {
          return
        }
        const steps = Math.floor(playClock)
        playClock -= steps
        const [lo, hi] = studio.playSpan()
        const next = studio.frame() + steps
        if (next <= hi) {
          studio.setFrame(next)
          return
        }
        if (studio.loop()) {
          // A whole cycle whose last frame repeats its first (how Blender walk
          // cycles are usually keyed) would show that pose twice per loop
          // and hitch; wrap past the duplicate instead.
          const whole = lo === 0 && hi === clip.length - 1
          const start = whole && studio.isSeamless(clip) ? lo + 1 : lo
          const span = hi - start + 1
          studio.setFrame(start + ((next - start) % span))
          return
        }
        studio.setFrame(hi)
        studio.setPlaying(false)
      },
      onPoseChanging: () => {
        studio.bumpPose()
        studio.setUnkeyed(true)
      },
      onPoseEdited: commitLivePose,
      onSelectJoint: (name) => studio.setSelectedJoint(name),
      getSelectedJoint: () => studio.selectedJoint(),
      getIkChain: () => studio.ikChain(),
      getSnap: () => studio.snap(),
      onViewPlane: (name) => studio.setViewPlane(name)
    })
    props.onReady({ engine })
  })

  onCleanup(() => engine?.dispose())

  createEffect(
    on(
      () => studio.rig(),
      (rig) => {
        engine?.setRig(rig)
        engine?.setMeshOpacity(studio.display().meshOpacity)
      }
    )
  )

  // The figure always shows the clip's pose at the playhead.
  createEffect(() => {
    const rig = studio.rig()
    const clip = studio.activeClip()
    const frame = studio.frame()
    if (!engine || !rig) {
      return
    }
    engine.applyPose(clip ? studio.poseAt(clip, frame) : rig.rest)
    studio.setUnkeyed(false)
    studio.bumpPose()
  })

  createEffect(() => {
    const rig = studio.rig()
    const clip = studio.activeClip()
    const o = studio.onion()
    const d = studio.display()
    if (!engine || !rig || !clip) {
      return
    }
    const specs: GhostSpec[] = []
    // The first-frame ghost stays put whatever the playhead does, even
    // during playback and with onion skin off, so the starting pose is
    // always there to come back to.
    const pinFirst = d.showFirstFrame && studio.frame() !== 0
    if (pinFirst) {
      specs.push({
        pose: studio.poseAt(clip, 0),
        color: d.firstFrameColor,
        opacity: Math.max(0.22, o.opacity)
      })
    }
    if (!o.enabled || studio.playing()) {
      engine.setGhosts(specs)
      return
    }
    const ghosts = ghostFrames(studio.frame())
    // Don't draw frame 0 twice when it's also an onion neighbour.
    const before = pinFirst ? ghosts.before.filter((f) => f !== 0) : ghosts.before
    const after = ghosts.after
    const fade = (i: number, n: number): number => o.opacity * (1 - (i / Math.max(n, 1)) * 0.6)
    before.forEach((f, i) =>
      specs.push({
        pose: studio.poseAt(clip, f),
        color: studio.display().onionBefore,
        opacity: fade(i, before.length)
      })
    )
    after.forEach((f, i) =>
      specs.push({
        pose: studio.poseAt(clip, f),
        color: studio.display().onionAfter,
        opacity: fade(i, after.length)
      })
    )
    engine.setGhosts(specs)
  })

  createEffect(() => {
    const d = studio.display()
    engine?.setOverlayStyle({
      showSkeleton: d.showSkeleton,
      jointSize: d.jointSize,
      showHidden: d.showHidden
    })
    engine?.setMeshOpacity(d.meshOpacity)
  })

  createEffect(() => engine?.setTool(studio.tool()))

  createEffect(() => {
    studio.rig()
    engine?.setSnap(studio.snap())
  })

  createEffect(
    on([() => studio.selectedJoint(), () => studio.rig(), () => studio.playing()], () => {
      engine?.syncGizmo()
    })
  )

  createEffect(() => engine?.setLightingMode(props.lightingMode))

  createEffect(() => {
    const req = studio.focusRequest()
    if (req) {
      engine?.frameBone(req.bone)
    }
  })

  // Reference layer: the canvas turns see-through while one is shown.
  let video: HTMLVideoElement | undefined
  const refShown = (): boolean => !!studio.rig() && !!studio.reference()?.visible
  createEffect(() => engine?.setSeeThrough(refShown()))
  // Videos are loaded whole into a blob: the local-file protocol doesn't serve
  // byte ranges, and without them Chromium can't seek a video to a frame.
  const [videoUrl, setVideoUrl] = createSignal<string | null>(null)
  createEffect(
    on(
      () => {
        const ref = studio.reference()
        return ref?.kind === 'video' ? ref.path : null
      },
      (path) => {
        const old = videoUrl()
        if (old) {
          URL.revokeObjectURL(old)
        }
        setVideoUrl(null)
        if (!path) {
          return
        }
        void fetch(window.api.assetUrl(path))
          .then((r) => r.blob())
          .then((blob) => {
            if (studio.reference()?.path === path) {
              setVideoUrl(URL.createObjectURL(blob))
            }
          })
      }
    )
  )
  onCleanup(() => {
    const url = videoUrl()
    if (url) {
      URL.revokeObjectURL(url)
    }
  })

  // A reference video follows the playhead frame by frame, for rotoscoping.
  const syncVideo = (): void => {
    const ref = studio.reference()
    const clip = studio.activeClip()
    if (!video || !ref || ref.kind !== 'video' || !clip) {
      return
    }
    const t = Math.max(0, (studio.frame() - ref.offset) / clip.fps)
    const end = Number.isFinite(video.duration) ? video.duration : t
    if (Math.abs(video.currentTime - t) > 0.5 / clip.fps) {
      video.currentTime = Math.min(t, end)
    }
  }
  createEffect(
    on(
      [() => studio.reference(), () => studio.activeClip(), () => studio.frame(), videoUrl],
      syncVideo
    )
  )

  let navDown: { x: number; y: number; moved: boolean } | null = null
  const onNavDown = (e: PointerEvent): void => {
    e.stopPropagation()
    navDown = { x: e.clientX, y: e.clientY, moved: false }
    const move = (ev: PointerEvent): void => {
      if (!navDown) {
        return
      }
      const dx = ev.clientX - navDown.x
      const dy = ev.clientY - navDown.y
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        navDown.moved = true
      }
      engine?.navCubeOrbit(dx, dy)
      navDown.x = ev.clientX
      navDown.y = ev.clientY
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (navDown && !navDown.moved) {
        engine?.navCubeClick(ev.clientX, ev.clientY)
      }
      navDown = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div class="relative w-full h-full overflow-hidden bg-[var(--bg-main)]">
      <Show when={refShown() && studio.reference()}>
        {(ref) => (
          <div
            class="absolute inset-0 pointer-events-none flex items-center justify-center"
            style={{ opacity: ref().opacity }}
          >
            <Show
              when={ref().kind === 'video'}
              fallback={
                <img
                  src={window.api.assetUrl(ref().path)}
                  class="max-w-full max-h-full object-contain"
                  alt=""
                />
              }
            >
              <video
                ref={video}
                src={videoUrl() ?? undefined}
                onLoadedData={syncVideo}
                class="max-w-full max-h-full object-contain"
                muted
                preload="auto"
                playsinline
              />
            </Show>
          </div>
        )}
      </Show>
      <canvas ref={canvas} class="absolute inset-0 w-full h-full block outline-none" />
      <canvas ref={overlay} class="absolute inset-0 w-full h-full pointer-events-none" />
      <canvas
        ref={navCanvas}
        class="absolute top-3 right-3 w-24 h-24 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
        onPointerDown={onNavDown}
        title={t('viewport.navCube')}
      />
      <Show when={studio.rig()}>
        <button
          type="button"
          onClick={() => studio.setSnap({ enabled: !studio.snap().enabled })}
          title={
            studio.snap().enabled
              ? t('snap.titleOn', {
                  plane: t(`snap.planes.${studio.viewPlane()}`).toLowerCase(),
                  grid: formatGrid(studio.snap().grid),
                  angle: studio.snap().angle
                })
              : t('snap.titleOff')
          }
          class={`absolute top-[116px] right-3 flex items-center gap-1.5 h-6 px-2 rounded-[var(--ui-radius)] border text-[10px] font-semibold cursor-pointer select-none transition-colors ${
            studio.snap().enabled
              ? 'bg-[var(--accent-color)]/15 border-[var(--accent-color)]/60 text-[var(--text-main)]'
              : 'bg-zinc-900/80 border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
          }`}
        >
          <MagnetIcon size={12} class={studio.snap().enabled ? 'text-[var(--accent-color)]' : ''} />
          <Show when={studio.snap().enabled} fallback={t('snap.badgeOff')}>
            {t('snap.badgeOn', {
              plane: t(`snap.planes.${studio.viewPlane()}`),
              grid: formatGrid(studio.snap().grid),
              angle: studio.snap().angle
            })}
          </Show>
        </button>
      </Show>
    </div>
  )
}
