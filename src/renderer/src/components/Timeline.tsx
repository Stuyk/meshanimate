import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { studio } from '../anim/studio'
import { mirrorToHalfCycle } from '../anim/actions'
import { jointDiffers } from '../anim/pose'
import { readPose } from '../anim/rig'
import { EASING_OPTIONS, type Easing, type PoseKey } from '../anim/types'
import {
  SkipBackIcon,
  SkipForwardIcon,
  StepBackIcon,
  StepForwardIcon,
  PlayIcon,
  PauseIcon,
  RepeatIcon,
  FitIcon,
  DiamondIcon,
  TrashIcon,
  GhostIcon,
  FlagIcon,
  KeyIcon,
  BoneIcon,
  CopyIcon,
  PasteIcon
} from './icons'
import { IconButton, NumberInput, SegmentedControl, Select } from './ui'
import { t } from '../i18n'

const LABEL_W = 132
const RULER_H = 24
const ROW_H = 30

/** Jumps the playhead to the previous/next key, or the clip ends if there are none. */
export function stepToKey(dir: -1 | 1): void {
  const clip = studio.activeClip()
  if (!clip) {
    return
  }
  const f = studio.frame()
  const frames = clip.keys.map((k) => k.frame)
  const target =
    dir < 0
      ? ([...frames].reverse().find((k) => k < f) ?? 0)
      : (frames.find((k) => k > f) ?? clip.length - 1)
  studio.setPlaying(false)
  studio.setFrame(target)
}

/** Keys the rig's live pose at the playhead (K). */
export function keyCurrentPose(): void {
  const rig = studio.rig()
  if (rig) {
    studio.setKey(studio.frame(), readPose(rig))
  }
}

interface MenuState {
  x: number
  y: number
  keyId: string | null
  frame: number
}

export default function Timeline(): JSX.Element {
  let scroller!: HTMLDivElement
  const [width, setWidth] = createSignal(800)
  const [zoom, setZoom] = createSignal(1)
  const [dragDelta, setDragDelta] = createSignal(0)
  const [dragCopy, setDragCopy] = createSignal(false)
  const [menu, setMenu] = createSignal<MenuState | null>(null)

  onMount(() => {
    const ro = new ResizeObserver(() => setWidth(scroller.clientWidth))
    ro.observe(scroller)
    onCleanup(() => ro.disconnect())
  })

  const clip = (): ReturnType<typeof studio.activeClip> => studio.activeClip()
  /** Frames are shown in Blender's numbering: clip frame 0 is the action's start frame. */
  const start = (): number => clip()?.start ?? 0
  const bf = (f: number): number => f + start()
  const length = (): number => clip()?.length ?? 1
  const pxPerFrame = createMemo(() => {
    const fit = (width() - 24) / Math.max(length(), 1)
    return Math.max(4, fit * zoom())
  })
  const xOf = (f: number): number => 12 + f * pxPerFrame() + pxPerFrame() / 2
  const contentWidth = (): number => 24 + length() * pxPerFrame()

  const frameAt = (clientX: number): number => {
    const rect = scroller.getBoundingClientRect()
    const x = clientX - rect.left + scroller.scrollLeft - 12
    return Math.max(0, Math.min(length() - 1, Math.floor(x / pxPerFrame())))
  }

  /** Label every Nth frame so numbers never collide. */
  const labelStep = createMemo(() => {
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500]
    return steps.find((s) => s * pxPerFrame() >= 34) ?? 1000
  })

  /** Minor ticks only once frames are wide enough to tell apart. */
  const ticks = createMemo(() => {
    const every = pxPerFrame() >= 8 ? 1 : labelStep()
    // First tick on a round Blender frame number.
    const first = every === 1 ? 0 : (every - (start() % every)) % every
    const out: number[] = []
    for (let f = first; f < length(); f += every) {
      out.push(f)
    }
    return out
  })
  const labelled = (f: number): boolean => bf(f) % labelStep() === 0

  const selected = createMemo(() => new Set(studio.selectedKeyIds()))

  // --- scrubbing --------------------------------------------------------------

  const startScrub = (e: MouseEvent): void => {
    if (e.button !== 0) {
      return
    }
    studio.setPlaying(false)
    studio.setFrame(frameAt(e.clientX))
    const move = (ev: MouseEvent): void => studio.setFrame(frameAt(ev.clientX))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const [marquee, setMarquee] = createSignal<{ from: number; to: number } | null>(null)

  /**
   * Empty track: a click moves the playhead; a drag draws a box that selects
   * the keys under it (Shift adds to the selection).
   */
  const onTrackDown = (e: MouseEvent): void => {
    if (e.button !== 0) {
      return
    }
    studio.setPlaying(false)
    const additive = e.shiftKey
    const before = additive ? studio.selectedKeyIds() : []
    const startX = e.clientX
    let boxing = false
    const move = (ev: MouseEvent): void => {
      if (!boxing && Math.abs(ev.clientX - startX) < 4) {
        return
      }
      boxing = true
      const a = frameAt(Math.min(startX, ev.clientX))
      const b = frameAt(Math.max(startX, ev.clientX))
      setMarquee({ from: a, to: b })
      const inside = (clip()?.keys ?? []).filter((k) => k.frame >= a && k.frame <= b)
      studio.setSelectedKeyIds([...new Set([...before, ...inside.map((k) => k.id)])])
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setMarquee(null)
      if (!boxing) {
        if (!additive) {
          studio.setSelectedKeyIds([])
        }
        studio.setFrame(frameAt(ev.clientX))
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** Drags one end of the preview range along the ruler. */
  const dragRangeEdge = (e: MouseEvent, edge: 0 | 1): void => {
    e.stopPropagation()
    e.preventDefault()
    const move = (ev: MouseEvent): void => {
      const r = studio.previewRange()
      if (!r) {
        return
      }
      const f = frameAt(ev.clientX)
      studio.setPreviewRange(
        edge === 0 ? [Math.min(f, r[1] - 1), r[1]] : [r[0], Math.max(f, r[0] + 1)]
      )
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const fitTimeline = (): void => {
    setZoom(1)
    scroller.scrollLeft = 0
  }

  /** Double-clicking empty track inserts an in-between key from the current blend. */
  const onTrackDblClick = (e: MouseEvent): void => {
    const c = clip()
    const rig = studio.rig()
    if (!c || !rig) {
      return
    }
    const f = frameAt(e.clientX)
    if (!c.keys.some((k) => k.frame === f)) {
      studio.setKey(f, studio.poseAt(c, f))
    }
    studio.setFrame(f)
  }

  // --- key dragging -----------------------------------------------------------

  const onKeyDown = (e: MouseEvent, key: PoseKey): void => {
    if (e.button !== 0) {
      return
    }
    e.stopPropagation()
    studio.setPlaying(false)
    const sel = studio.selectedKeyIds()
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      studio.setSelectedKeyIds(
        sel.includes(key.id) ? sel.filter((id) => id !== key.id) : [...sel, key.id]
      )
      return
    }
    if (!sel.includes(key.id)) {
      studio.setSelectedKeyIds([key.id])
    }
    const startFrame = frameAt(e.clientX)
    let moved = false
    const move = (ev: MouseEvent): void => {
      const d = frameAt(ev.clientX) - startFrame
      moved = moved || d !== 0
      setDragDelta(d)
      setDragCopy(ev.altKey)
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = dragDelta()
      setDragDelta(0)
      setDragCopy(false)
      if (!moved) {
        studio.setSelectedKeyIds([key.id])
        studio.setFrame(key.frame)
        return
      }
      studio.moveKeys(studio.selectedKeyIds(), d, ev.altKey)
      studio.setFrame(key.frame + d)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onKeyContext = (e: MouseEvent, key: PoseKey | null): void => {
    e.preventDefault()
    e.stopPropagation()
    if (key && !studio.selectedKeyIds().includes(key.id)) {
      studio.setSelectedKeyIds([key.id])
    }
    setMenu({
      x: e.clientX,
      y: e.clientY,
      keyId: key?.id ?? null,
      frame: key?.frame ?? frameAt(e.clientX)
    })
  }

  const displayFrame = (k: PoseKey): number => {
    if (dragDelta() === 0 || !selected().has(k.id)) {
      return k.frame
    }
    return Math.max(0, Math.min(length() - 1, k.frame + dragDelta()))
  }

  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey) {
      return
    }
    e.preventDefault()
    setZoom((z) => Math.max(1, Math.min(40, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
  }

  // --- derived display -------------------------------------------------------

  const selectedEasing = createMemo<Easing | ''>(() => {
    const c = clip()
    const ids = selected()
    const eas = new Set(c?.keys.filter((k) => ids.has(k.id)).map((k) => k.easing))
    return eas.size === 1 ? [...eas][0] : ''
  })

  /** Keys where the selected joint actually moves, for the joint row. */
  const jointMarks = createMemo(() => {
    const c = clip()
    const rig = studio.rig()
    const name = studio.selectedJoint()
    if (!c || !rig || !name) {
      return []
    }
    return c.keys.map((k, i) => ({
      key: k,
      moves: jointDiffers(i === 0 ? rig.rest : c.keys[i - 1].pose, k.pose, name, rig.rest)
    }))
  })

  const onionBand = createMemo(() => {
    const o = studio.onion()
    if (!o.enabled || o.mode !== 'frames') {
      return null
    }
    const f = studio.frame()
    return {
      from: Math.max(0, f - o.before * o.step),
      to: Math.min(length() - 1, f + o.after * o.step)
    }
  })

  const keyAtPlayhead = (): PoseKey | undefined => studio.keyAtFrame(studio.frame())

  const deleteSelectedOrCurrent = (): void => {
    const ids = studio.selectedKeyIds()
    if (ids.length > 0) {
      studio.deleteKeys(ids)
      return
    }
    const k = keyAtPlayhead()
    if (k) {
      studio.deleteKeys([k.id])
    }
  }

  const btn = 'xs' as const

  return (
    <div
      class="flex flex-col bg-[var(--bg-panel)] border-t border-[var(--border-color)] select-none shrink-0"
      style={{ height: '176px' }}
    >
      {/* Transport + key tools */}
      <div class="h-10 min-h-10 px-2 flex items-center gap-1.5 bg-[var(--bg-panel-header)] border-b border-[var(--border-color)] overflow-x-auto overflow-y-hidden">
        <IconButton
          size={btn}
          tooltip={t('timeline.firstFrame')}
          onClick={() => studio.setFrame(0)}
        >
          <SkipBackIcon size={14} />
        </IconButton>
        <IconButton size={btn} tooltip={t('timeline.previousKey')} onClick={() => stepToKey(-1)}>
          <StepBackIcon size={14} />
        </IconButton>
        <IconButton
          size="sm"
          variant="primary"
          tooltip={studio.playing() ? t('timeline.pause') : t('timeline.play')}
          onClick={() => studio.togglePlay()}
        >
          <Show when={studio.playing()} fallback={<PlayIcon size={15} />}>
            <PauseIcon size={15} />
          </Show>
        </IconButton>
        <IconButton size={btn} tooltip={t('timeline.nextKey')} onClick={() => stepToKey(1)}>
          <StepForwardIcon size={14} />
        </IconButton>
        <IconButton
          size={btn}
          tooltip={t('timeline.lastFrame')}
          onClick={() => studio.setFrame(length() - 1)}
        >
          <SkipForwardIcon size={14} />
        </IconButton>
        <IconButton
          size={btn}
          toggled={studio.loop()}
          tooltip={studio.loop() ? t('timeline.looping') : t('timeline.playOnce')}
          onClick={() => studio.setLoop(!studio.loop())}
        >
          <RepeatIcon size={14} />
        </IconButton>
        <button
          type="button"
          onClick={() =>
            studio.previewRange() ? studio.setPreviewRange(null) : studio.setRangeEnd('in')
          }
          title={
            studio.previewRange()
              ? t('timeline.rangeSet', {
                  start: bf(studio.previewRange()![0]),
                  end: bf(studio.previewRange()![1])
                })
              : t('timeline.rangeUnset')
          }
          class={`h-6 px-1.5 rounded-[var(--ui-radius)] border text-[10px] font-mono font-bold cursor-pointer transition-colors ${
            studio.previewRange()
              ? 'bg-[var(--accent-color)]/15 border-[var(--accent-color)]/60 text-[var(--text-main)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
          }`}
        >
          <Show when={studio.previewRange()} fallback="[ ]">
            [{bf(studio.previewRange()![0])}-{bf(studio.previewRange()![1])}]
          </Show>
        </button>
        <IconButton size={btn} tooltip={t('timeline.fit')} onClick={fitTimeline}>
          <FitIcon size={14} />
        </IconButton>

        <div class="w-px h-5 bg-[var(--border-color)] mx-1" />

        <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span>{t('timeline.frame')}</span>
          <NumberInput
            class="w-16"
            value={bf(studio.frame())}
            step={1}
            precision={0}
            min={start()}
            max={bf(length() - 1)}
            onChange={(v) => studio.setFrame(v - start())}
            title={t('timeline.frameTitle')}
          />
          <span class="font-mono">/ {bf(length() - 1)}</span>
          <span class="ml-2">{t('timeline.length')}</span>
          <NumberInput
            class="w-16"
            value={length()}
            step={1}
            precision={0}
            min={2}
            max={10000}
            onChange={(v) => studio.updateClipMeta({ length: v })}
            title={t('timeline.lengthTitle')}
          />
          <span class="ml-2">{t('timeline.fps')}</span>
          <NumberInput
            class="w-14"
            value={clip()?.fps ?? 24}
            step={1}
            precision={0}
            min={1}
            max={120}
            onChange={(v) => studio.setFps(v)}
            title={t('timeline.fpsTitle')}
          />
          <span class="font-mono ml-1 tabular-nums">
            {t('units.seconds', { value: (studio.frame() / (clip()?.fps ?? 24)).toFixed(2) })}
          </span>
        </div>

        <div class="w-px h-5 bg-[var(--border-color)] mx-1" />

        <IconButton
          size={btn}
          variant={studio.unkeyed() ? 'primary' : 'default'}
          tooltip={t('timeline.keyPose')}
          onClick={keyCurrentPose}
        >
          <KeyIcon size={14} />
        </IconButton>
        <IconButton size={btn} tooltip={t('timeline.deleteKeys')} onClick={deleteSelectedOrCurrent}>
          <TrashIcon size={14} />
        </IconButton>
        <IconButton
          size={btn}
          tooltip={t('timeline.copyPose')}
          onClick={() => {
            const rig = studio.rig()
            if (rig) {
              studio.setClipboardPose(readPose(rig))
            }
          }}
        >
          <CopyIcon size={14} />
        </IconButton>
        <IconButton
          size={btn}
          disabled={!studio.clipboardPose()}
          tooltip={t('timeline.pastePose')}
          onClick={() => {
            const p = studio.clipboardPose()
            if (p) {
              studio.setKey(studio.frame(), p)
            }
          }}
        >
          <PasteIcon size={14} />
        </IconButton>
        <Select<Easing | ''>
          size="xs"
          class="w-[104px]"
          title={t('timeline.easingTitle')}
          value={selectedEasing()}
          disabled={studio.selectedKeyIds().length === 0}
          options={[
            { value: '', label: t('easing.placeholder'), disabled: true },
            ...EASING_OPTIONS.map((e) => ({ value: e, label: t(`easing.${e}.label`) }))
          ]}
          onChange={(v) => v && studio.setEasing(studio.selectedKeyIds(), v)}
        />
        <button
          type="button"
          onClick={() => studio.setAutoKey(!studio.autoKey())}
          title={t('timeline.autoKeyTitle')}
          class={`ml-1 flex items-center gap-1.5 h-6 px-2 rounded-[var(--ui-radius)] border text-[11px] font-medium cursor-pointer transition-colors ${
            studio.autoKey()
              ? 'bg-red-500/15 border-red-500/60 text-red-300'
              : 'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
          }`}
        >
          <span class={`w-2 h-2 rounded-full ${studio.autoKey() ? 'bg-red-500' : 'bg-zinc-600'}`} />
          {t('timeline.autoKey')}
        </button>

        <div class="w-px h-5 bg-[var(--border-color)] mx-1" />

        <IconButton
          size={btn}
          toggled={studio.display().showFirstFrame}
          tooltip={t('timeline.firstFrameGhost')}
          onClick={() =>
            studio.setDisplay({
              ...studio.display(),
              showFirstFrame: !studio.display().showFirstFrame
            })
          }
        >
          <FlagIcon size={14} />
        </IconButton>
        <IconButton
          size={btn}
          toggled={studio.onion().enabled}
          tooltip={t('timeline.onionSkin')}
          onClick={() => studio.setOnion({ ...studio.onion(), enabled: !studio.onion().enabled })}
        >
          <GhostIcon size={14} />
        </IconButton>
        <div
          class={`flex items-center gap-1 text-[11px] text-[var(--text-muted)] ${studio.onion().enabled ? '' : 'opacity-40 pointer-events-none'}`}
        >
          <span class="text-[#ff7a7a]" title={t('timeline.ghostsBeforeTitle')}>
            ◀
          </span>
          <NumberInput
            class="w-10"
            value={studio.onion().before}
            step={0.1}
            precision={0}
            min={0}
            max={10}
            onChange={(v) => studio.setOnion({ ...studio.onion(), before: v })}
            title={t('timeline.ghostsBefore')}
          />
          <NumberInput
            class="w-10"
            value={studio.onion().after}
            step={0.1}
            precision={0}
            min={0}
            max={10}
            onChange={(v) => studio.setOnion({ ...studio.onion(), after: v })}
            title={t('timeline.ghostsAfter')}
          />
          <span class="text-[#5ab4ff]" title={t('timeline.ghostsAfterTitle')}>
            ▶
          </span>
          <SegmentedControl
            size="xs"
            value={studio.onion().mode}
            onChange={(mode) => studio.setOnion({ ...studio.onion(), mode })}
            options={[
              {
                value: 'keys',
                label: t('timeline.onionKeys'),
                title: t('timeline.onionKeysTitle')
              },
              {
                value: 'frames',
                label: t('timeline.onionFrames'),
                title: t('timeline.onionFramesTitle')
              }
            ]}
          />
          <Show when={studio.onion().mode === 'frames'}>
            <span class="ml-1">{t('timeline.every')}</span>
            <NumberInput
              class="w-10"
              value={studio.onion().step}
              step={0.1}
              precision={0}
              min={1}
              max={24}
              onChange={(v) => studio.setOnion({ ...studio.onion(), step: v })}
              title={t('timeline.framesBetween')}
            />
          </Show>
        </div>
      </div>

      {/* Tracks */}
      <div class="flex flex-1 min-h-0">
        <div
          class="shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-panel-header)] text-[11px]"
          style={{ width: `${LABEL_W}px` }}
        >
          <div
            class="flex items-center px-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]"
            style={{ height: `${RULER_H}px` }}
          >
            {clip()?.name ?? t('timeline.noClip')}
          </div>
          <div
            class="flex items-center gap-1.5 px-2.5 font-semibold text-[var(--text-main)] border-b border-[var(--border-color)]"
            style={{ height: `${ROW_H}px` }}
            title={t('timeline.poseRowTitle')}
          >
            <DiamondIcon size={12} class="text-amber-400" />
            {t('timeline.poseRow')}
            <span class="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
              {clip()?.keys.length ?? 0}
            </span>
          </div>
          <div
            class="flex items-center gap-1.5 px-2.5 text-[var(--text-muted)] border-b border-[var(--border-color)]"
            style={{ height: `${ROW_H}px` }}
            title={t('timeline.jointRowTitle')}
          >
            <BoneIcon size={12} class="text-[var(--accent-color)] shrink-0" />
            <span class="truncate">{studio.selectedJoint() ?? t('timeline.noJoint')}</span>
          </div>
        </div>

        <div
          ref={scroller}
          class="relative flex-1 overflow-x-auto overflow-y-hidden dcc-scroll"
          onWheel={onWheel}
          onContextMenu={(e) => onKeyContext(e, null)}
        >
          <div
            class="relative h-full"
            style={{ width: `${contentWidth()}px`, 'min-width': '100%' }}
          >
            {/* Ruler */}
            <div
              class="absolute left-0 right-0 top-0 bg-[var(--bg-input)] border-b border-[var(--border-color)] cursor-ew-resize"
              style={{ height: `${RULER_H}px` }}
              onMouseDown={startScrub}
            >
              <Show when={studio.previewRange()}>
                {(r) => (
                  <>
                    <div
                      class="absolute top-0 bottom-0 bg-[var(--accent-color)]/20 border-x-2 border-[var(--accent-color)] pointer-events-none"
                      style={{
                        left: `${12 + r()[0] * pxPerFrame()}px`,
                        width: `${(r()[1] - r()[0] + 1) * pxPerFrame()}px`
                      }}
                    />
                    <For each={[0, 1] as const}>
                      {(edge) => (
                        <div
                          class="absolute top-0 bottom-0 w-2 -translate-x-1/2 cursor-ew-resize z-10"
                          style={{
                            left: `${12 + (edge === 0 ? r()[0] : r()[1] + 1) * pxPerFrame()}px`
                          }}
                          title={t('timeline.rangeEdge')}
                          onMouseDown={(e) => dragRangeEdge(e, edge)}
                        />
                      )}
                    </For>
                  </>
                )}
              </Show>
              <Show when={onionBand()}>
                {(band) => (
                  <div
                    class="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: `${12 + band().from * pxPerFrame()}px`,
                      width: `${(band().to - band().from + 1) * pxPerFrame()}px`,
                      background:
                        'linear-gradient(90deg, rgba(255,92,92,0.18), rgba(255,255,255,0.02) 50%, rgba(63,169,255,0.18))'
                    }}
                  />
                )}
              </Show>
              <For each={ticks()}>
                {(f) => (
                  <>
                    <div
                      class="absolute bottom-0 w-px pointer-events-none"
                      style={{
                        left: `${xOf(f)}px`,
                        height: labelled(f) ? '9px' : '4px',
                        background: labelled(f) ? '#62626e' : '#42424a'
                      }}
                    />
                    <Show when={labelled(f)}>
                      <span
                        class="absolute top-0.5 -translate-x-1/2 text-[10px] font-mono text-[var(--text-muted)] pointer-events-none"
                        style={{ left: `${xOf(f)}px` }}
                      >
                        {bf(f)}
                      </span>
                    </Show>
                  </>
                )}
              </For>
            </div>

            {/* Pose track */}
            <div
              class="absolute left-0 right-0 border-b border-[var(--border-color)] bg-[var(--bg-panel)]"
              style={{ top: `${RULER_H}px`, height: `${ROW_H}px` }}
              onMouseDown={onTrackDown}
              onDblClick={onTrackDblClick}
            >
              {/* Segment bars show each key's easing into the next */}
              <For each={clip()?.keys ?? []}>
                {(k, i) => {
                  const next = (): PoseKey | undefined => clip()?.keys[i() + 1]
                  return (
                    <Show when={next()}>
                      <div
                        class="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                          left: `${xOf(displayFrame(k))}px`,
                          width: `${Math.max(0, xOf(displayFrame(next()!)) - xOf(displayFrame(k)))}px`,
                          height: k.easing === 'step' ? '0px' : '4px',
                          'border-top':
                            k.easing === 'step' ? '2px dashed rgba(255,181,71,0.35)' : 'none',
                          background:
                            k.easing === 'step'
                              ? 'transparent'
                              : k.easing === 'linear'
                                ? 'rgba(255,181,71,0.22)'
                                : 'linear-gradient(90deg, rgba(255,181,71,0.08), rgba(255,181,71,0.32) 50%, rgba(255,181,71,0.08))'
                        }}
                      />
                    </Show>
                  )
                }}
              </For>
              <For each={clip()?.keys ?? []}>
                {(k) => {
                  const isSel = (): boolean => selected().has(k.id)
                  return (
                    <>
                      <Show when={isSel() && dragDelta() !== 0 && dragCopy()}>
                        <div
                          class="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-amber-400/50 pointer-events-none"
                          style={{ left: `${xOf(k.frame)}px` }}
                        />
                      </Show>
                      <div
                        class={`absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 cursor-pointer transition-transform hover:scale-125 ${
                          isSel()
                            ? 'bg-[var(--accent-color)] border-white shadow-[0_0_0_2px_rgba(0,132,255,0.35)]'
                            : 'bg-amber-400 border-[#1a1a1c]'
                        }`}
                        style={{ left: `${xOf(displayFrame(k))}px` }}
                        title={t('timeline.keyTitle', {
                          frame: bf(k.frame),
                          easing: t(`easing.${k.easing}.label`)
                        })}
                        onMouseDown={(e) => onKeyDown(e, k)}
                        onContextMenu={(e) => onKeyContext(e, k)}
                        onDblClick={(e) => e.stopPropagation()}
                      />
                    </>
                  )
                }}
              </For>
            </div>

            {/* Selected-joint track */}
            <div
              class="absolute left-0 right-0 border-b border-[var(--border-color)] bg-[var(--bg-main)]/40"
              style={{ top: `${RULER_H + ROW_H}px`, height: `${ROW_H}px` }}
              onMouseDown={onTrackDown}
            >
              <For each={jointMarks()}>
                {(m) => (
                  <div
                    class={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full cursor-pointer ${
                      m.moves
                        ? 'w-2.5 h-2.5 bg-[var(--accent-color)]'
                        : 'w-2 h-2 border border-[var(--text-muted)]/60'
                    }`}
                    style={{ left: `${xOf(displayFrame(m.key))}px` }}
                    title={t(m.moves ? 'timeline.jointMoves' : 'timeline.jointHolds', {
                      joint: studio.selectedJoint() ?? '',
                      frame: bf(m.key.frame)
                    })}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      studio.setPlaying(false)
                      studio.setFrame(m.key.frame)
                    }}
                  />
                )}
              </For>
            </div>

            {/* Outside the preview range */}
            <Show when={studio.previewRange()}>
              {(r) => (
                <>
                  <div
                    class="absolute bottom-0 left-0 bg-black/35 pointer-events-none"
                    style={{ top: `${RULER_H}px`, width: `${12 + r()[0] * pxPerFrame()}px` }}
                  />
                  <div
                    class="absolute bottom-0 right-0 bg-black/35 pointer-events-none"
                    style={{ top: `${RULER_H}px`, left: `${12 + (r()[1] + 1) * pxPerFrame()}px` }}
                  />
                </>
              )}
            </Show>

            {/* Box selection */}
            <Show when={marquee()}>
              {(m) => (
                <div
                  class="absolute bg-[var(--accent-color)]/15 border border-[var(--accent-color)]/70 pointer-events-none"
                  style={{
                    top: `${RULER_H + 2}px`,
                    height: `${ROW_H * 2 - 4}px`,
                    left: `${12 + m().from * pxPerFrame()}px`,
                    width: `${(m().to - m().from + 1) * pxPerFrame()}px`
                  }}
                />
              )}
            </Show>

            {/* Playhead */}
            <div
              class="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: `${xOf(studio.frame())}px` }}
            >
              <div class="absolute top-0 bottom-0 w-px bg-[var(--accent-color)] -translate-x-1/2" />
              <div class="absolute top-0 -translate-x-1/2 px-1 h-4 rounded-[2px] bg-[var(--accent-color)] text-[10px] font-mono font-bold text-white leading-4">
                {bf(studio.frame())}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Show when={menu()}>
        {(m) => (
          <>
            <div
              class="fixed inset-0 z-40"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu(null)
              }}
            />
            <div
              class="fixed z-50 min-w-[200px] p-1.5 bg-zinc-900/98 backdrop-blur-md border border-zinc-750/90 rounded-xl shadow-2xl shadow-black/80 text-xs"
              style={{ left: `${m().x}px`, top: `${m().y - 8}px`, transform: 'translateY(-100%)' }}
            >
              <Show
                when={m().keyId}
                fallback={
                  <MenuButton
                    label={t('timeline.insertKey', { frame: bf(m().frame) })}
                    onClick={() => {
                      const c = clip()
                      const rig = studio.rig()
                      if (c && rig) {
                        studio.setKey(m().frame, studio.poseAt(c, m().frame))
                      }
                      setMenu(null)
                    }}
                  />
                }
              >
                <div class="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {t('easing.heading')}
                </div>
                <For each={EASING_OPTIONS}>
                  {(e) => (
                    <MenuButton
                      label={t(`easing.${e}.label`)}
                      hint={t(`easing.${e}.title`)}
                      active={selectedEasing() === e}
                      onClick={() => {
                        studio.setEasing(studio.selectedKeyIds(), e)
                        setMenu(null)
                      }}
                    />
                  )}
                </For>
                <div class="my-1 border-t border-zinc-800" />
                <MenuButton
                  label={t('timeline.mirrorHalfCycle')}
                  hint={t('timeline.mirrorHalfCycleHint')}
                  onClick={() => {
                    const k = clip()?.keys.find((x) => x.id === m().keyId)
                    if (k) {
                      studio.setFrame(k.frame)
                      mirrorToHalfCycle()
                    }
                    setMenu(null)
                  }}
                />
                <MenuButton
                  label={t('timeline.copyPoseMenu')}
                  onClick={() => {
                    const k = clip()?.keys.find((x) => x.id === m().keyId)
                    if (k) {
                      studio.setClipboardPose(k.pose)
                    }
                    setMenu(null)
                  }}
                />
                <MenuButton
                  label={t('timeline.duplicateToPlayhead', { frame: bf(studio.frame()) })}
                  onClick={() => {
                    const k = clip()?.keys.find((x) => x.id === m().keyId)
                    if (k) {
                      studio.setKey(studio.frame(), k.pose)
                    }
                    setMenu(null)
                  }}
                />
                <MenuButton
                  label={t('common.delete')}
                  danger
                  onClick={() => {
                    studio.deleteKeys(studio.selectedKeyIds())
                    setMenu(null)
                  }}
                />
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

function MenuButton(props: {
  label: string
  hint?: string
  active?: boolean
  danger?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      title={props.hint}
      onClick={props.onClick}
      class={`flex items-center w-full h-7 px-2.5 rounded-lg text-left transition-colors cursor-pointer ${
        props.danger
          ? 'text-red-400 hover:bg-red-950/50'
          : props.active
            ? 'bg-blue-600/30 text-white'
            : 'text-zinc-200 hover:bg-blue-600 hover:text-white'
      }`}
    >
      {props.label}
    </button>
  )
}
