import {
  UNIT_SCALE,
  type Clip,
  type Easing,
  type JointPose,
  type Pose,
  type PoseKey,
  type Quat,
  type Vec3
} from './types'

/**
 * Interpolation here mirrors Blender's F-curve evaluation channel by channel,
 * so a clip previews exactly as Blender will play it once saved: every pose
 * channel (location xyz, quaternion wxyz, scale xyz) is its own curve,
 * interpolated independently, and the rotation is normalized afterwards.
 */

export const IDENTITY_JOINT: JointPose = { r: [0, 0, 0, 1], p: [0, 0, 0] }

/** Penner cubic easing, which is exactly Blender's "Cubic" interpolation. */
export function ease(easing: Easing, u: number): number {
  const t = Math.min(1, Math.max(0, u))
  switch (easing) {
    case 'step':
      return 0
    case 'easeIn':
      return t * t * t
    case 'easeOut':
      return 1 - Math.pow(1 - t, 3)
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'linear':
    case 'bezier':
    default:
      return t
  }
}

// ---------------------------------------------------------------------------
// Blender auto-clamped Bézier handles (BKE calchandleNurb_intern, F-curve path)
// ---------------------------------------------------------------------------

export interface Handles {
  lx: number
  ly: number
  rx: number
  ry: number
}

/** Blender scales auto handles by this; along the frame axis it works out to 1/2.5614 of the gap. */
const AUTO_HANDLE = 2.5614

/**
 * The handles Blender computes for an auto-clamped key at index i of a curve,
 * following its F-curve rules: reach is measured along the frame axis, peaks
 * and dips get flat handles, handles never overshoot a neighbour's value, and
 * the first and last keys are flat (constant extrapolation).
 */
export function autoClampedHandles(xs: number[], ys: number[], i: number): Handles {
  const x2 = xs[i]
  const y2 = ys[i]
  const n = xs.length
  if (n < 2) {
    return { lx: x2, ly: y2, rx: x2, ry: y2 }
  }
  if (i === 0 || i === n - 1) {
    // Blender mirrors the missing neighbour, so both sides reach the same distance.
    const gap = i === 0 ? xs[1] - x2 : x2 - xs[n - 2]
    const reach = gap / AUTO_HANDLE
    return { lx: x2 - reach, ly: y2, rx: x2 + reach, ry: y2 }
  }
  const x1 = xs[i - 1]
  const y1 = ys[i - 1]
  const x3 = xs[i + 1]
  const y3 = ys[i + 1]
  let lenA = x2 - x1 || 1
  let lenB = x3 - x2 || 1
  const tx = (x3 - x2) / lenB + (x2 - x1) / lenA
  const ty = (y3 - y2) / lenB + (y2 - y1) / lenA
  const len = tx * AUTO_HANDLE
  if (len === 0) {
    return { lx: x2, ly: y2, rx: x2, ry: y2 }
  }
  lenA = Math.min(lenA, 5 * lenB)
  lenB = Math.min(lenB, 5 * lenA)
  const a = lenA / len
  const b = lenB / len
  const h: Handles = { lx: x2 - tx * a, ly: y2 - ty * a, rx: x2 + tx * b, ry: y2 + ty * b }

  const ydiff1 = y1 - y2
  const ydiff2 = y3 - y2
  if ((ydiff1 <= 0 && ydiff2 <= 0) || (ydiff1 >= 0 && ydiff2 >= 0)) {
    // A peak or a dip: flat handles so the curve doesn't overshoot it.
    h.ly = y2
    h.ry = y2
    return h
  }
  let leftViolate = false
  let rightViolate = false
  if (ydiff1 <= 0 ? y1 > h.ly : y1 < h.ly) {
    h.ly = y1
    leftViolate = true
  }
  if (ydiff1 <= 0 ? y3 < h.ry : y3 > h.ry) {
    h.ry = y3
    rightViolate = true
  }
  if (leftViolate || rightViolate) {
    // Keep the pair of handles in line after clamping one of them.
    const h1x = h.lx - x2
    const h2x = x2 - h.rx
    if (leftViolate) {
      h.ry = y2 + ((y2 - h.ly) / h1x) * h2x
    } else {
      h.ly = y2 + ((y2 - h.ry) / h2x) * h1x
    }
  }
  return h
}

/** Value of one Bézier segment at frame x, solved the way Blender does. */
export function bezierAt(
  x0: number,
  y0: number,
  h0: Handles,
  x3: number,
  y3: number,
  h3: Handles,
  x: number
): number {
  let x1 = h0.rx
  let y1 = h0.ry
  let x2 = h3.lx
  let y2 = h3.ly
  // BKE_fcurve_correct_bezpart: handles may not reach past each other.
  const len = x3 - x0
  const len1 = Math.abs(x1 - x0)
  const len2 = Math.abs(x3 - x2)
  if (len1 + len2 > len && len1 + len2 > 0) {
    const fac = len / (len1 + len2)
    x1 = x0 + (x1 - x0) * fac
    y1 = y0 + (y1 - y0) * fac
    x2 = x3 - (x3 - x2) * fac
    y2 = y3 - (y3 - y2) * fac
  }
  // x(t) is monotonic once corrected; bisect for t.
  let lo = 0
  let hi = 1
  let t = 0.5
  for (let i = 0; i < 50; i++) {
    t = (lo + hi) / 2
    const mt = 1 - t
    const xt = mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3
    if (xt < x) {
      lo = t
    } else {
      hi = t
    }
  }
  const mt = 1 - t
  return mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** A joint's channels as a flat list in Blender order: loc xyz, quat wxyz, scale xyz. */
function channels(j: JointPose): number[] {
  const s = j.s ?? UNIT_SCALE
  return [j.p[0], j.p[1], j.p[2], j.r[3], j.r[0], j.r[1], j.r[2], s[0], s[1], s[2]]
}

function fromChannels(c: number[], scaled: boolean): JointPose {
  const len = Math.hypot(c[3], c[4], c[5], c[6]) || 1
  const out: JointPose = {
    p: [c[0], c[1], c[2]],
    r: [c[4] / len, c[5] / len, c[6] / len, c[3] / len]
  }
  if (scaled) {
    out.s = [c[7], c[8], c[9]]
  }
  return out
}

function jointOf(pose: Pose, rest: Pose, name: string): JointPose {
  return pose[name] ?? rest[name] ?? IDENTITY_JOINT
}

/** Index of the last key at or before `frame`, or −1. Keys are sorted. */
export function keyIndexAtOrBefore(keys: PoseKey[], frame: number): number {
  let found = -1
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].frame > frame) {
      break
    }
    found = i
  }
  return found
}

/** Straight per-channel blend between two poses, as Blender's linear interpolation does. */
export function blendPoses(a: Pose, b: Pose, t: number, rest: Pose): Pose {
  const out: Pose = {}
  for (const name of Object.keys(rest)) {
    const ja = jointOf(a, rest, name)
    const jb = jointOf(b, rest, name)
    const ca = channels(ja)
    const cb = channels(jb)
    out[name] = fromChannels(
      ca.map((v, i) => v + (cb[i] - v) * t),
      !!(ja.s || jb.s)
    )
  }
  return out
}

/**
 * The pose at any (possibly fractional) frame. Before the first key the first
 * key holds and after the last the last key holds — Blender's constant
 * extrapolation, and how a Pivot figure stays put once you stop keying it.
 */
export function sampleClip(clip: Clip, frame: number, rest: Pose): Pose {
  const keys = clip.keys
  if (keys.length === 0) {
    return rest
  }
  const i = keyIndexAtOrBefore(keys, frame)
  if (i < 0) {
    return keys[0].pose
  }
  const k0 = keys[i]
  const k1 = keys[i + 1]
  if (!k1 || frame === k0.frame) {
    return k0.pose
  }
  const u = (frame - k0.frame) / (k1.frame - k0.frame)
  if (k0.easing !== 'bezier') {
    return blendPoses(k0.pose, k1.pose, ease(k0.easing, u), rest)
  }

  // A Bézier segment's handles depend on the keys either side of it.
  const lo = Math.max(0, i - 1)
  const hi = Math.min(keys.length - 1, i + 2)
  const window = keys.slice(lo, hi + 1)
  const xs = window.map((k) => k.frame)
  const at = i - lo
  const out: Pose = {}
  for (const name of Object.keys(rest)) {
    const span = window.map((k) => jointOf(k.pose, rest, name))
    const cs = span.map(channels)
    const values: number[] = []
    for (let c = 0; c < 10; c++) {
      const ys = cs.map((v) => v[c])
      const h0 = autoClampedHandles(xs, ys, at)
      const h1 = autoClampedHandles(xs, ys, at + 1)
      values.push(bezierAt(xs[at], ys[at], h0, xs[at + 1], ys[at + 1], h1, frame))
    }
    out[name] = fromChannels(
      values,
      span.some((j) => !!j.s)
    )
  }
  return out
}

/** Whether a joint moves between two poses, for the per-joint timeline row. */
export function jointDiffers(a: Pose, b: Pose, name: string, rest: Pose): boolean {
  const ca = channels(jointOf(a, rest, name))
  const cb = channels(jointOf(b, rest, name))
  // q and −q are the same rotation.
  const dot = Math.abs(ca[3] * cb[3] + ca[4] * cb[4] + ca[5] * cb[5] + ca[6] * cb[6])
  if (dot < 0.99999) {
    return true
  }
  return [0, 1, 2, 7, 8, 9].some((i) => Math.abs(ca[i] - cb[i]) > 1e-5)
}

export function posesDiffer(a: Pose, b: Pose, rest: Pose): boolean {
  return Object.keys(rest).some((n) => jointDiffers(a, b, n, rest))
}

export function cloneJoint(j: JointPose): JointPose {
  const out: JointPose = { r: [...j.r] as Quat, p: [...j.p] as Vec3 }
  if (j.s) {
    out.s = [...j.s] as Vec3
  }
  return out
}

export function clonePose(pose: Pose): Pose {
  const out: Pose = {}
  for (const [name, j] of Object.entries(pose)) {
    out[name] = cloneJoint(j)
  }
  return out
}

/**
 * Flips quaternion signs in `pose` to match `ref`, joint by joint. Blender
 * interpolates the four quaternion channels independently and never flips a
 * sign itself, so a key in the other hemisphere from its neighbour spins the
 * long way round. Applied only to keys this app writes: keys read from
 * Blender keep their signs, since a long spin may be exactly what was keyed.
 */
export function alignHemispheres(pose: Pose, ref: Pose | undefined): Pose {
  if (!ref) {
    return pose
  }
  const out: Pose = {}
  for (const [name, j] of Object.entries(pose)) {
    const r = ref[name]?.r
    const dot = r ? r[0] * j.r[0] + r[1] * j.r[1] + r[2] * j.r[2] + r[3] * j.r[3] : 1
    out[name] = dot < 0 ? { ...j, r: [-j.r[0], -j.r[1], -j.r[2], -j.r[3]] } : j
  }
  return out
}

/**
 * Copy with unit-length quaternions. Blender normalizes rotations when it
 * evaluates them, so a key stored slightly off unit would preview a hair
 * differently from how Blender plays it.
 */
export function normalizeRotations(pose: Pose): Pose {
  const out = clonePose(pose)
  for (const j of Object.values(out)) {
    const len = Math.hypot(...j.r) || 1
    j.r = [j.r[0] / len, j.r[1] / len, j.r[2] / len, j.r[3] / len]
  }
  return out
}

export function sortKeys(keys: PoseKey[]): PoseKey[] {
  return [...keys].sort((a, b) => a.frame - b.frame)
}
