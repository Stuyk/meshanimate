import { loadRig, type BlendMeta, type Rig } from './rig'
import { createClip, keysFingerprint, type ClipSource } from './studio'
import { keyTiming, preservedBones } from './preserve'
import { uid, type Clip } from './types'
import { t } from '../i18n'

export interface BlendDocument {
  rig: Rig
  clips: Clip[]
  sources: Map<string, ClipSource>
  activeClipId: string
}

/** Opens a .blend: Blender reads it, the app builds the rig and one clip per action. */
export async function openBlendDocument(blendPath: string): Promise<BlendDocument> {
  const res = await window.api.openBlend(blendPath)
  if (!res.ok || !res.glbPath || !res.metaJson) {
    throw new Error(res.error ?? t('errors.blenderCouldNotRead'))
  }
  const meta = JSON.parse(res.metaJson) as BlendMeta
  if (meta.error) {
    throw new Error(meta.error)
  }
  const rig = await loadRig(window.api.assetUrl(res.glbPath), meta, blendPath)

  const clips: Clip[] = []
  const sources = new Map<string, ClipSource>()
  for (const action of meta.actions) {
    const clip: Clip = {
      id: uid('clip'),
      name: action.name,
      start: action.start,
      fps: meta.fps,
      length: action.length,
      keys: action.keys.map((k) => ({
        id: uid('key'),
        frame: k.frame,
        easing: k.easing,
        pose: k.pose
      }))
    }
    clips.push(clip)
    sources.set(clip.id, {
      action: action.name,
      start: action.start,
      length: action.length,
      keys: keysFingerprint(clip),
      timing: keyTiming(clip.keys),
      baked: action.baked,
      inNla: !!action.inNla
    })
  }
  if (clips.length === 0) {
    clips.push(createClip('Action', rig.rest, meta.frameStart, meta.fps))
  }
  const active = clips.find((c) => c.name === meta.activeAction) ?? clips[0]
  return { rig, clips, sources, activeClipId: active.id }
}

export interface SavePayload {
  armature: string
  fps: number
  clips: {
    name: string
    source: string | null
    start: number
    length: number
    keys: unknown[]
    /** Bones whose existing Blender curves stay as they are. */
    preserve?: string[]
  }[]
  renames: [string, string][]
  deleted: string[]
  /** Every clip's action; any without an NLA track on the armature gets one. */
  nla: string[]
}

/**
 * What changed since the file was read: clips whose keys, length or start
 * moved are rewritten, renamed-only clips are just renamed, removed clips
 * delete their action. Untouched actions are not sent at all.
 */
export function buildSavePayload(
  rig: Rig,
  clips: Clip[],
  sources: Map<string, ClipSource>
): { payload: SavePayload; changes: number } {
  const payload: SavePayload = {
    armature: rig.meta.armature,
    fps: clips[0]?.fps ?? rig.meta.fps,
    clips: [],
    renames: [],
    deleted: [],
    nla: clips.map((c) => c.name)
  }
  const live = new Set(clips.map((c) => c.id))
  for (const clip of clips) {
    const src = sources.get(clip.id)
    if (src && keysFingerprint(clip) === src.keys) {
      if (clip.name !== src.action) {
        payload.renames.push([src.action, clip.name])
      }
      continue
    }
    const kept = src ? preservedBones(clip, src, rig.rest) : null
    payload.clips.push({
      name: clip.name,
      source: src?.action ?? null,
      ...(kept && kept.size > 0 ? { preserve: [...kept] } : {}),
      start: clip.start,
      length: clip.length,
      // Every bone in every key, so the saved action is self-contained and
      // plays the same whatever pose the rig happens to be in.
      keys: clip.keys.map((k) => ({
        frame: k.frame,
        easing: k.easing,
        pose: Object.fromEntries(Object.keys(rig.rest).map((n) => [n, k.pose[n] ?? rig.rest[n]]))
      }))
    })
  }
  for (const [id, src] of sources) {
    if (!live.has(id)) {
      payload.deleted.push(src.action)
    }
  }
  const fpsChanged = Math.abs(payload.fps - rig.meta.fps) > 1e-6
  // Clips whose action isn't in the NLA editor yet still need a save to put it there.
  const missingTracks = clips.filter((c) => !sources.get(c.id)?.inNla).length
  const changes =
    payload.clips.length +
    payload.renames.length +
    payload.deleted.length +
    (fpsChanged ? 1 : 0) +
    missingTracks
  return { payload, changes }
}

/**
 * After a save, the file on disk is the new baseline. Blender re-reads it so
 * every clip previews exactly what was written, including the curves of
 * bones a save preserved, and so later edits are compared with what's
 * really in the file.
 */
export async function sourcesFromDisk(
  blendPath: string,
  clips: Clip[]
): Promise<Map<string, ClipSource> | null> {
  const res = await window.api.openBlend(blendPath)
  if (!res.ok || !res.metaJson) {
    return null
  }
  const meta = JSON.parse(res.metaJson) as BlendMeta
  const byName = new Map(meta.actions.map((a) => [a.name, a]))
  const next = new Map<string, ClipSource>()
  for (const clip of clips) {
    const action = byName.get(clip.name)
    if (!action) {
      continue
    }
    next.set(clip.id, {
      action: action.name,
      start: clip.start,
      length: clip.length,
      keys: keysFingerprint(clip),
      timing: keyTiming(clip.keys),
      baked: action.baked,
      inNla: !!action.inNla
    })
  }
  return next
}

export interface MergeResult {
  clips: Clip[]
  sources: Map<string, ClipSource>
  /** Clips edited here whose action also changed on disk; this app's version won. */
  conflicts: string[]
  keptMine: number
}

/**
 * Combines the file as it is now on disk with unsaved work here: clips edited
 * (or added, renamed, deleted) in MeshAnimate keep their edits, everything
 * else takes the disk version, so work done in Blender meanwhile isn't lost.
 * Where both sides changed the same action, this app's version wins and the
 * clip is reported as a conflict.
 */
export function mergeWithDisk(
  mine: Clip[],
  mySources: Map<string, ClipSource>,
  disk: BlendDocument
): MergeResult {
  const freshByAction = new Map<string, { clip: Clip; src: ClipSource }>()
  for (const clip of disk.clips) {
    const src = disk.sources.get(clip.id)
    if (src) {
      freshByAction.set(src.action, { clip, src })
    }
  }
  const live = new Set(mine.map((c) => c.id))
  const deleted = new Set([...mySources].filter(([id]) => !live.has(id)).map(([, s]) => s.action))
  const edited = mine.filter((c) => {
    const s = mySources.get(c.id)
    return !s || keysFingerprint(c) !== s.keys || c.name !== s.action
  })

  const replaced = new Map<string, Clip>()
  const sources = new Map<string, ClipSource>()
  const added: Clip[] = []
  const conflicts: string[] = []
  for (const clip of edited) {
    const origin = mySources.get(clip.id)
    const fresh = origin ? freshByAction.get(origin.action) : undefined
    if (!fresh) {
      added.push(clip)
      continue
    }
    if (fresh.src.keys !== origin!.keys) {
      conflicts.push(clip.name)
    }
    replaced.set(origin!.action, clip)
    sources.set(clip.id, fresh.src)
  }

  const clips: Clip[] = []
  for (const clip of disk.clips) {
    const action = disk.sources.get(clip.id)?.action
    if (action && deleted.has(action)) {
      continue
    }
    const mineInstead = action ? replaced.get(action) : undefined
    if (mineInstead) {
      clips.push(mineInstead)
      continue
    }
    clips.push(clip)
    const src = disk.sources.get(clip.id)
    if (src) {
      sources.set(clip.id, src)
    }
  }
  const taken = new Set(clips.map((c) => c.name))
  for (const clip of added) {
    let name = clip.name
    for (let n = 2; taken.has(name); n++) {
      name = `${clip.name} ${n}`
    }
    taken.add(name)
    clips.push(name === clip.name ? clip : { ...clip, name })
  }
  return { clips, sources, conflicts, keptMine: edited.length }
}
