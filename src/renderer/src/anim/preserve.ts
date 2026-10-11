import type { ClipSource } from './studio'
import type { Clip, Easing, JointPose, Pose } from './types'
import { IDENTITY_JOINT } from './pose'

/** Close enough to count as the same value Blender stored (it keeps 32-bit floats). */
const EPS = 1e-5

function sameJoint(a: JointPose, b: JointPose): boolean {
  const close = (x: number[], y: number[]): boolean => x.every((v, i) => Math.abs(v - y[i]) < EPS)
  const flipped = b.r.map((v) => -v)
  if (!close(a.r, b.r) && !close(a.r, flipped)) {
    return false
  }
  return close(a.p, b.p) && close(a.s ?? [1, 1, 1], b.s ?? [1, 1, 1])
}

/** The keys' frames and easings, to tell retiming apart from posing. */
export function keyTiming(keys: { frame: number; easing: Easing }[]): string {
  return JSON.stringify(keys.map((k) => [k.frame, k.easing]))
}

/**
 * Bones of an edited clip that can keep their original Blender curves: every
 * key still holds exactly what Blender evaluates for that bone at that frame,
 * so nothing about the bone changed. Saving then rewrites only the other
 * bones, and imported animation isn't reshaped by edits elsewhere.
 *
 * Returns null when the clip has to be rewritten whole: an original key was
 * moved, deleted or re-eased, or the clip's start or length changed, then
 * every bone's timing is in play.
 */
export function preservedBones(clip: Clip, src: ClipSource, rest: Pose): Set<string> | null {
  if (src.baked.length === 0 || clip.start !== src.start || clip.length !== src.length) {
    return null
  }
  const current = new Map(clip.keys.map((k) => [k.frame, k.easing]))
  const original = JSON.parse(src.timing) as [number, Easing][]
  if (original.some(([frame, easing]) => current.get(frame) !== easing)) {
    return null
  }
  const keep = new Set<string>()
  for (const bone of Object.keys(rest)) {
    const unchanged = clip.keys.every((k) => {
      const truth = src.baked[k.frame]?.[bone] ?? rest[bone] ?? IDENTITY_JOINT
      return sameJoint(k.pose[bone] ?? rest[bone] ?? IDENTITY_JOINT, truth)
    })
    if (unchanged) {
      keep.add(bone)
    }
  }
  return keep
}
