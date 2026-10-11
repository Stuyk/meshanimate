/**
 * Plain-data animation model. Everything here is JSON-safe so a clip can be
 * snapshotted for undo, written to a .meshanim file and read back unchanged.
 */

export type Easing = 'bezier' | 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'step'

export const EASING_OPTIONS: { value: Easing; label: string; title: string }[] = [
  {
    value: 'bezier',
    label: 'Auto',
    title: "Blender's default: smooth Bézier with auto-clamped handles"
  },
  { value: 'linear', label: 'Linear', title: 'Constant speed between this key and the next' },
  { value: 'easeInOut', label: 'Ease In-Out', title: 'Slow out of this key, slow into the next' },
  { value: 'easeIn', label: 'Ease In', title: 'Start slow, arrive fast' },
  { value: 'easeOut', label: 'Ease Out', title: 'Start fast, settle slowly' },
  { value: 'step', label: 'Hold', title: 'Hold this pose until the next key (Constant)' }
]

export type Quat = [number, number, number, number]
export type Vec3 = [number, number, number]

/**
 * One bone's pose channels — Blender's matrix_basis: location, rotation (as a
 * quaternion, x y z w) and scale relative to the bone's rest pose. Identity
 * means "at rest".
 */
export interface JointPose {
  r: Quat
  p: Vec3
  /** Scale, stored only when it isn't 1,1,1 — absent means unscaled. */
  s?: Vec3
}

export const UNIT_SCALE: Vec3 = [1, 1, 1]

/** Joint name → local transform. Joints missing from a pose sit at rest. */
export type Pose = Record<string, JointPose>

/**
 * A whole-figure pose pinned to a frame, Pivot-style: a key always records
 * every joint, so moving one key in time moves the entire pose with it.
 * `easing` shapes the in-betweens from this key to the next one.
 */
export interface PoseKey {
  id: string
  frame: number
  pose: Pose
  easing: Easing
}

export interface Clip {
  id: string
  /** Becomes the Blender action name on save. */
  name: string
  /** Blender frame that clip frame 0 lands on (usually the scene start, 1). */
  start: number
  fps: number
  /** Frame count; frames run 0 … length − 1. */
  length: number
  /** Kept sorted by frame, at most one key per frame. */
  keys: PoseKey[]
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}
