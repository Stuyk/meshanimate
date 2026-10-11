import { batch, createMemo, createRoot, createSignal } from 'solid-js'
import type { Rig } from './rig'
import {
  alignHemispheres,
  clonePose,
  normalizeRotations,
  posesDiffer,
  sampleClip,
  sortKeys
} from './pose'
import { uid, type Clip, type Easing, type Pose, type PoseKey } from './types'
import type { SnapSettings, ViewPlaneName } from '../viewport/snap'
import { preservedBones } from './preserve'
import { t } from '../i18n'

const SNAP_KEY = 'meshanimate:snap'
const REFERENCE_KEY = 'meshanimate:reference'

export interface Reference {
  path: string
  kind: 'image' | 'video'
  opacity: number
  visible: boolean
  /** Video only: which clip frame shows the video's first frame. */
  offset: number
}
const DEFAULT_SNAP: SnapSettings = { enabled: true, grid: 0.05, angle: 15 }

function loadSnap(): SnapSettings {
  try {
    const saved = JSON.parse(
      localStorage.getItem(SNAP_KEY) ?? 'null'
    ) as Partial<SnapSettings> | null
    return { ...DEFAULT_SNAP, ...(saved ?? {}) }
  } catch {
    return DEFAULT_SNAP
  }
}

export type PoseTool = 'pose' | 'rotate' | 'move'
export type OnionMode = 'frames' | 'keys'

export interface OnionSettings {
  enabled: boolean
  before: number
  after: number
  /** Frames between ghosts in 'frames' mode. */
  step: number
  mode: OnionMode
  opacity: number
}

export interface DisplaySettings {
  showSkeleton: boolean
  jointSize: number
  /** 1 = solid mesh; lower lets the skeleton show through. */
  meshOpacity: number
  /** Also draw bones hidden in Blender (by the bone or its bone collections). */
  showHidden: boolean
  onionBefore: string
  onionAfter: string
  /** Pin a ghost of the clip's first frame, visible at every frame. */
  showFirstFrame: boolean
  firstFrameColor: string
  /** Auto-key state a session starts with. */
  autoKeyDefault: boolean
}

const DISPLAY_KEY = 'meshanimate:display'
export const DEFAULT_DISPLAY: DisplaySettings = {
  showSkeleton: true,
  jointSize: 1,
  meshOpacity: 1,
  showHidden: false,
  onionBefore: '#ff5c5c',
  onionAfter: '#3fa9ff',
  showFirstFrame: false,
  firstFrameColor: '#3ddc84',
  autoKeyDefault: true
}

function loadDisplay(): DisplaySettings {
  try {
    const saved = JSON.parse(
      localStorage.getItem(DISPLAY_KEY) ?? 'null'
    ) as Partial<DisplaySettings> | null
    return { ...DEFAULT_DISPLAY, ...(saved ?? {}) }
  } catch {
    return DEFAULT_DISPLAY
  }
}

/**
 * A clip as it was read from the .blend. Saving compares against this, so only
 * actions that actually changed are rewritten, everything else in the file
 * stays exactly as Blender wrote it.
 */
export interface ClipSource {
  /** The Blender action this clip came from. */
  action: string
  start: number
  length: number
  /** Fingerprint of the keys as loaded. */
  keys: string
  /** Blender's own per-frame evaluation, shown while the keys are untouched. */
  baked: Pose[]
  /** Frames and easings of the keys as read, to tell retiming from posing. */
  timing: string
  /** The action already has a track in the armature's NLA editor. */
  inNla: boolean
}

const HISTORY_LIMIT = 150

export function keysFingerprint(clip: Clip): string {
  return JSON.stringify([
    clip.start,
    clip.length,
    clip.keys.map((k) => [k.frame, k.easing, k.pose])
  ])
}

export function createClip(
  name: string,
  rest: Pose | null,
  start = 1,
  fps = 24,
  length = 48
): Clip {
  return {
    id: uid('clip'),
    name,
    start,
    fps,
    length,
    keys: rest ? [{ id: uid('key'), frame: 0, pose: clonePose(rest), easing: 'bezier' }] : []
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Studio is derived from this
function createStudio() {
  const [rig, setRig] = createSignal<Rig | null>(null, { equals: false })
  const [sources, setSources] = createSignal<Map<string, ClipSource>>(new Map())
  const [clips, setClipsRaw] = createSignal<Clip[]>([])
  const [activeClipId, setActiveClipId] = createSignal<string>('')
  const [frame, setFrameRaw] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [loop, setLoop] = createSignal(true)
  const [selectedJoint, setSelectedJoint] = createSignal<string | null>(null)
  const [selectedKeyIds, setSelectedKeyIds] = createSignal<string[]>([])
  const [autoKey, setAutoKey] = createSignal(loadDisplay().autoKeyDefault)
  const [ikChain, setIkChain] = createSignal(1)
  const [tool, setTool] = createSignal<PoseTool>('pose')
  const [onion, setOnion] = createSignal<OnionSettings>({
    enabled: true,
    before: 2,
    after: 1,
    step: 2,
    mode: 'keys',
    opacity: 0.28
  })
  const [display, setDisplayRaw] = createSignal<DisplaySettings>(loadDisplay())
  function setDisplay(next: DisplaySettings): void {
    setDisplayRaw(next)
    try {
      localStorage.setItem(DISPLAY_KEY, JSON.stringify(next))
    } catch {
      // Preference only.
    }
  }
  /** Bumped whenever the live rig pose changes, so readouts can follow it. */
  const [poseTick, setPoseTick] = createSignal(0)
  /** The rig has been posed since the last key was written. */
  const [unkeyed, setUnkeyed] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [clipboardPose, setClipboardPose] = createSignal<Pose | null>(null)
  const [snap, setSnapRaw] = createSignal<SnapSettings>(loadSnap())
  /** Reference image or video shown behind the model (per file, never saved into it). */
  const [reference, setReferenceRaw] = createSignal<Reference | null>(null)
  function setReference(next: Reference | null): void {
    setReferenceRaw(next)
    const path = rig()?.blendPath
    if (!path) {
      return
    }
    try {
      localStorage.setItem(`${REFERENCE_KEY}:${path}`, JSON.stringify(next))
    } catch {
      // Convenience only.
    }
  }
  /** Brings back the reference last used with this .blend. */
  function restoreReference(blendPath: string): void {
    try {
      const saved = localStorage.getItem(`${REFERENCE_KEY}:${blendPath}`)
      setReferenceRaw(saved ? (JSON.parse(saved) as Reference | null) : null)
    } catch {
      setReferenceRaw(null)
    }
  }
  /** Ask the viewport to frame a bone (double-click in the skeleton list). */
  const [focusRequest, setFocusRequest] = createSignal<{ bone: string; n: number } | null>(null)
  function focusBone(bone: string): void {
    setFocusRequest({ bone, n: (focusRequest()?.n ?? 0) + 1 })
  }
  /** The axis plane snapping uses from the current camera angle. */
  const [viewPlane, setViewPlane] = createSignal<ViewPlaneName>('Front')
  function setSnap(patch: Partial<SnapSettings>): void {
    const next = { ...snap(), ...patch }
    setSnapRaw(next)
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(next))
    } catch {
      // Preference only.
    }
  }

  const activeClip = createMemo<Clip | null>(
    () => clips().find((c) => c.id === activeClipId()) ?? clips()[0] ?? null
  )

  const undoStack: string[] = []
  const redoStack: string[] = []
  const [historyTick, setHistoryTick] = createSignal(0)

  function snapshot(): string {
    return JSON.stringify({ clips: clips(), activeClipId: activeClipId() })
  }

  function restore(s: string): void {
    const parsed = JSON.parse(s) as { clips: Clip[]; activeClipId: string }
    batch(() => {
      setClipsRaw(parsed.clips)
      setActiveClipId(parsed.activeClipId)
      const ids = new Set(parsed.clips.flatMap((c) => c.keys.map((k) => k.id)))
      setSelectedKeyIds((sel) => sel.filter((id) => ids.has(id)))
      setUnkeyed(false)
      setDirty(true)
    })
  }

  /** Every edit to the animation data goes through here, so it can be undone. */
  function edit(mutate: (clips: Clip[]) => Clip[]): void {
    undoStack.push(snapshot())
    if (undoStack.length > HISTORY_LIMIT) {
      undoStack.shift()
    }
    redoStack.length = 0
    batch(() => {
      setClipsRaw(mutate(clips()))
      setDirty(true)
      setHistoryTick((n) => n + 1)
    })
  }

  function editActive(mutate: (clip: Clip) => Clip): void {
    const id = activeClip()?.id
    if (!id) {
      return
    }
    edit((all) => all.map((c) => (c.id === id ? mutate(c) : c)))
  }

  function undo(): boolean {
    const prev = undoStack.pop()
    if (!prev) {
      return false
    }
    redoStack.push(snapshot())
    restore(prev)
    setHistoryTick((n) => n + 1)
    return true
  }

  function redo(): boolean {
    const next = redoStack.pop()
    if (!next) {
      return false
    }
    undoStack.push(snapshot())
    restore(next)
    setHistoryTick((n) => n + 1)
    return true
  }

  const canUndo = (): boolean => (historyTick(), undoStack.length > 0)
  const canRedo = (): boolean => (historyTick(), redoStack.length > 0)

  function clearHistory(): void {
    undoStack.length = 0
    redoStack.length = 0
    setHistoryTick((n) => n + 1)
  }

  /** Preview ranges per clip: playback stays between these frames. Not saved. */
  const [ranges, setRanges] = createSignal<Record<string, [number, number]>>({})

  /** The active clip's playback span: its preview range, or the whole clip. */
  function playSpan(): [number, number] {
    const clip = clips().find((c) => c.id === activeClipId()) ?? clips()[0]
    if (!clip) {
      return [0, 0]
    }
    const r = ranges()[clip.id]
    return r ? [Math.max(0, r[0]), Math.min(clip.length - 1, r[1])] : [0, clip.length - 1]
  }

  function previewRange(): [number, number] | null {
    const id = activeClip()?.id
    return id ? (ranges()[id] ?? null) : null
  }

  function setPreviewRange(range: [number, number] | null): void {
    const clip = activeClip()
    if (!clip) {
      return
    }
    const next = { ...ranges() }
    if (!range) {
      delete next[clip.id]
    } else {
      const lo = Math.max(0, Math.min(range[0], range[1]))
      const hi = Math.min(clip.length - 1, Math.max(range[0], range[1]))
      next[clip.id] = [lo, Math.max(hi, lo + 1)]
    }
    setRanges(next)
  }

  /** Sets one end of the preview range at the playhead ([ and ]). */
  function setRangeEnd(end: 'in' | 'out'): void {
    const [lo, hi] = playSpan()
    const f = frame()
    setPreviewRange(end === 'in' ? [f, Math.max(hi, f + 1)] : [Math.min(lo, f - 1), f])
  }

  /** Play/pause. Pressing play outside the span, or at its end, starts from its beginning. */
  function togglePlay(): void {
    if (playing()) {
      setPlaying(false)
      return
    }
    const [lo, hi] = playSpan()
    if (frame() < lo || frame() >= hi) {
      setFrame(lo)
    }
    setPlaying(true)
  }

  const seamCache = new WeakMap<PoseKey[], boolean>()
  /**
   * The clip's last frame is the same pose as its first. This is how cycles are
   * usually keyed in Blender. Looping playback skips the duplicate, and
   * half-cycle mirroring measures the cycle without it.
   */
  function isSeamless(clip: Clip): boolean {
    const cached = seamCache.get(clip.keys)
    if (cached !== undefined) {
      return cached
    }
    const r = rig()
    const result =
      !!r && clip.length > 2 && !posesDiffer(poseAt(clip, 0), poseAt(clip, clip.length - 1), r.rest)
    seamCache.set(clip.keys, result)
    return result
  }

  /** Run before the frame or clip changes, so pending edits land where they were made. */
  const beforeChange: (() => void)[] = []
  function onBeforeChange(fn: () => void): void {
    beforeChange.push(fn)
  }

  function setFrame(f: number): void {
    beforeChange.forEach((fn) => fn())
    // Looked up directly rather than through the memo, which can lag inside a batch.
    const clip = clips().find((c) => c.id === activeClipId()) ?? clips()[0]
    const max = clip ? clip.length - 1 : 0
    setFrameRaw(Math.max(0, Math.min(max, Math.round(f))))
  }

  function keyAtFrame(f: number): PoseKey | undefined {
    return activeClip()?.keys.find((k) => k.frame === f)
  }

  /** Writes `pose` as the key at frame `f`, replacing any key already there. */
  function setKey(f: number, pose: Pose): void {
    editActive((clip) => {
      // Same quaternion hemisphere as the neighbouring key, so Blender's
      // per-channel interpolation doesn't spin the long way round.
      const before = [...clip.keys].reverse().find((k) => k.frame < f)
      const after = clip.keys.find((k) => k.frame > f)
      const aligned = alignHemispheres(normalizeRotations(pose), (before ?? after)?.pose)
      const existing = clip.keys.find((k) => k.frame === f)
      const keys = existing
        ? clip.keys.map((k) => (k.frame === f ? { ...k, pose: aligned } : k))
        : sortKeys([
            ...clip.keys,
            { id: uid('key'), frame: f, pose: aligned, easing: inheritedEasing(clip, f) }
          ])
      return { ...clip, keys }
    })
    setUnkeyed(false)
  }

  /** A new key takes the easing of the key before it, so a smooth clip stays smooth. */
  function inheritedEasing(clip: Clip, f: number): Easing {
    let easing: Easing = 'bezier'
    for (const k of clip.keys) {
      if (k.frame > f) {
        break
      }
      easing = k.easing
    }
    return easing
  }

  function deleteKeys(ids: string[]): void {
    if (ids.length === 0) {
      return
    }
    const drop = new Set(ids)
    editActive((clip) => ({ ...clip, keys: clip.keys.filter((k) => !drop.has(k.id)) }))
    setSelectedKeyIds((sel) => sel.filter((id) => !drop.has(id)))
  }

  /**
   * Shifts keys in time. Keys already sitting on a destination frame are
   * overwritten: dropping a pose onto another one replaces it. With `copy`,
   * the originals stay where they were.
   */
  function moveKeys(ids: string[], delta: number, copy: boolean): void {
    const clip = activeClip()
    if (!clip || ids.length === 0 || (delta === 0 && !copy)) {
      return
    }
    const moving = new Set(ids)
    const movers = clip.keys.filter((k) => moving.has(k.id))
    const lo = Math.min(...movers.map((k) => k.frame))
    const hi = Math.max(...movers.map((k) => k.frame))
    const d = Math.max(-lo, Math.min(clip.length - 1 - hi, delta))
    if (d === 0) {
      return
    }
    const moved = movers.map((k) => ({
      ...k,
      id: copy ? uid('key') : k.id,
      frame: k.frame + d,
      pose: copy ? clonePose(k.pose) : k.pose
    }))
    const landing = new Set(moved.map((k) => k.frame))
    editActive((c) => {
      const kept = c.keys.filter((k) => (copy || !moving.has(k.id)) && !landing.has(k.frame))
      return { ...c, keys: sortKeys([...kept, ...moved]) }
    })
    setSelectedKeyIds(moved.map((k) => k.id))
  }

  function setEasing(ids: string[], easing: Easing): void {
    const target = new Set(ids)
    editActive((clip) => ({
      ...clip,
      keys: clip.keys.map((k) => (target.has(k.id) ? { ...k, easing } : k))
    }))
  }

  function updateClipMeta(patch: Partial<Pick<Clip, 'name' | 'length'>>): void {
    editActive((clip) => {
      const next = { ...clip, ...patch }
      if (patch.length !== undefined) {
        next.length = Math.max(2, Math.min(10000, Math.round(patch.length)))
        next.keys = clip.keys.filter((k) => k.frame < next.length)
      }
      return next
    })
    setFrame(frame())
  }

  /** Frame rate is the Blender scene's, so it is shared by every clip. */
  function setFps(fps: number): void {
    const value = Math.max(1, Math.min(120, Math.round(fps)))
    edit((all) => all.map((c) => ({ ...c, fps: value })))
  }

  /** Clip names become Blender action names, which must be unique. */
  function uniqueName(base: string, exceptId?: string): string {
    const taken = new Set(
      clips()
        .filter((c) => c.id !== exceptId)
        .map((c) => c.name)
    )
    let name = base
    for (let n = 2; taken.has(name); n++) {
      name = `${base} ${n}`
    }
    return name
  }

  function addClip(name: string, rest: Pose | null): void {
    const current = activeClip()
    const clip = createClip(uniqueName(name), rest, current?.start ?? 1, current?.fps ?? 24)
    edit((all) => [...all, clip])
    setActiveClipId(clip.id)
    setFrameRaw(0)
    setSelectedKeyIds([])
  }

  function duplicateClip(id: string): void {
    const src = clips().find((c) => c.id === id)
    if (!src) {
      return
    }
    const copy: Clip = {
      ...src,
      id: uid('clip'),
      name: uniqueName(t('clips.copyName', { name: src.name })),
      keys: src.keys.map((k) => ({ ...k, id: uid('key'), pose: clonePose(k.pose) }))
    }
    edit((all) => [...all, copy])
    setActiveClipId(copy.id)
  }

  function deleteClip(id: string): void {
    if (clips().length <= 1) {
      return
    }
    const remaining = clips().filter((c) => c.id !== id)
    edit(() => remaining)
    if (activeClipId() === id) {
      setActiveClipId(remaining[0].id)
      setFrame(0)
    }
  }

  function renameClip(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    const unique = uniqueName(trimmed, id)
    edit((all) => all.map((c) => (c.id === id ? { ...c, name: unique } : c)))
  }

  function selectClip(id: string): void {
    beforeChange.forEach((fn) => fn())
    batch(() => {
      setActiveClipId(id)
      setSelectedKeyIds([])
      setFrame(frame())
    })
  }

  /**
   * The pose a clip shows at a frame. While a clip's keys are exactly as they
   * came from Blender, Blender's own per-frame evaluation is shown, so the
   * preview matches Blender even for curves this app can't edit (hand-tuned
   * handles, F-curve modifiers, keys on separate channels).
   */
  // Cached per source as well as per clip: a save swaps in a new source for
  // the same keys, and the old answers must not survive it.
  const fingerprints = new WeakMap<PoseKey[], string>()
  const keptBones = new WeakMap<ClipSource, WeakMap<Clip, Set<string> | null>>()
  function poseAt(clip: Clip, f: number): Pose {
    const r = rig()
    const rest = r?.rest ?? {}
    const src = sources().get(clip.id)
    if (!src || !Number.isInteger(f) || !src.baked[f]) {
      return sampleClip(clip, f, rest)
    }
    let fingerprint = fingerprints.get(clip.keys)
    if (fingerprint === undefined || clip.length !== src.length || clip.start !== src.start) {
      fingerprint = keysFingerprint(clip)
      fingerprints.set(clip.keys, fingerprint)
    }
    if (fingerprint === src.keys) {
      return src.baked[f]
    }
    // Edited: bones the edit didn't touch keep Blender's exact curves on
    // save, so they keep showing them here too.
    let perClip = keptBones.get(src)
    if (!perClip) {
      perClip = new WeakMap()
      keptBones.set(src, perClip)
    }
    if (!perClip.has(clip)) {
      perClip.set(clip, preservedBones(clip, src, rest))
    }
    const kept = perClip.get(clip)
    const pose = sampleClip(clip, f, rest)
    if (!kept || kept.size === 0) {
      return pose
    }
    const out: Pose = { ...pose }
    for (const bone of kept) {
      out[bone] = src.baked[f][bone] ?? rest[bone]
    }
    return out
  }

  /** Replaces the whole document (a .blend opened or restored). */
  function resetDocument(
    next: Clip[],
    activeId?: string,
    nextSources?: Map<string, ClipSource>
  ): void {
    batch(() => {
      if (nextSources) {
        setSources(nextSources)
      }
      setClipsRaw(next)
      setActiveClipId(activeId ?? next[0]?.id ?? '')
      setFrameRaw(0)
      setPlaying(false)
      setSelectedKeyIds([])
      setSelectedJoint(null)
      setUnkeyed(false)
      setDirty(false)
    })
    clearHistory()
  }

  return {
    rig,
    setRig,
    sources,
    setSources,
    onBeforeChange,
    poseAt,
    setFps,
    clips,
    activeClip,
    activeClipId,
    frame,
    setFrame,
    playing,
    setPlaying,
    togglePlay,
    playSpan,
    previewRange,
    setPreviewRange,
    setRangeEnd,
    isSeamless,
    loop,
    setLoop,
    selectedJoint,
    setSelectedJoint,
    selectedKeyIds,
    setSelectedKeyIds,
    autoKey,
    setAutoKey,
    ikChain,
    setIkChain,
    tool,
    setTool,
    onion,
    setOnion,
    display,
    setDisplay,
    poseTick,
    bumpPose: () => setPoseTick((n) => n + 1),
    unkeyed,
    setUnkeyed,
    dirty,
    setDirty,
    clipboardPose,
    setClipboardPose,
    snap,
    setSnap,
    reference,
    setReference,
    focusRequest,
    focusBone,
    restoreReference,
    viewPlane,
    setViewPlane,
    undo,
    redo,
    canUndo,
    canRedo,
    keyAtFrame,
    setKey,
    deleteKeys,
    moveKeys,
    setEasing,
    updateClipMeta,
    addClip,
    duplicateClip,
    deleteClip,
    renameClip,
    selectClip,
    resetDocument
  }
}

export type Studio = ReturnType<typeof createStudio>

/** App-wide singleton; lives for the life of the window. */
export const studio: Studio = createRoot(() => createStudio())
