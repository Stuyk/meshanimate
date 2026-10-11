import * as THREE from 'three'

export interface SnapSettings {
  enabled: boolean
  /** Grid spacing in Blender units (metres). */
  grid: number
  /** Angle step in degrees for swinging bones. */
  angle: number
}

export type ViewPlaneName = 'Side' | 'Front' | 'Top'

/**
 * The plane snapping happens in: the armature-space axis plane most face-on
 * to the camera. Looking from the side you snap in the side plane, from the
 * top in the ground plane — so poses built in a side view stay flat in it,
 * Pivot-style. Coordinates are armature space, i.e. Blender units, whatever
 * the app's display scaling.
 */
export interface SnapFrame {
  name: ViewPlaneName
  /** Armature-space axis index of the plane normal (0 x, 1 y = up, 2 z). */
  normal: 0 | 1 | 2
  /** In-plane axes: u is "up" where the plane has one, so 0° points up. */
  u: 0 | 1 | 2
  v: 0 | 1 | 2
  toWorld: THREE.Matrix4
  toLocal: THREE.Matrix4
}

/** Axes are glTF/armature space: y up (Blender z), z towards the front (Blender −y). */
const PLANES: Record<0 | 1 | 2, Omit<SnapFrame, 'toWorld' | 'toLocal'>> = {
  0: { name: 'Side', normal: 0, u: 1, v: 2 },
  1: { name: 'Top', normal: 1, u: 2, v: 0 },
  2: { name: 'Front', normal: 2, u: 1, v: 0 }
}

export function viewFrame(armatureWorld: THREE.Matrix4, cameraDir: THREE.Vector3): SnapFrame {
  const toLocal = armatureWorld.clone().invert()
  const d = cameraDir.clone().transformDirection(toLocal)
  const a = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)]
  const normal = (a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2) as 0 | 1 | 2
  return { ...PLANES[normal], toWorld: armatureWorld.clone(), toLocal }
}

function axis(i: 0 | 1 | 2): THREE.Vector3 {
  return new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0)
}

/** The snap plane in world space, through a world point. */
export function planeThrough(frame: SnapFrame, world: THREE.Vector3): THREE.Plane {
  const n = axis(frame.normal).transformDirection(frame.toWorld)
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, world)
}

/** World ↔ armature-space helpers. */
export function toLocal(frame: SnapFrame, world: THREE.Vector3): THREE.Vector3 {
  return world.clone().applyMatrix4(frame.toLocal)
}

export function toWorld(frame: SnapFrame, local: THREE.Vector3): THREE.Vector3 {
  return local.clone().applyMatrix4(frame.toWorld)
}

/**
 * Snaps a point's two in-plane coordinates to the grid. The depth along the
 * plane normal is kept, so snapping in a side view never pushes a limb
 * towards or away from the camera.
 */
export function snapPoint(frame: SnapFrame, world: THREE.Vector3, grid: number): THREE.Vector3 {
  const p = toLocal(frame, world)
  const c = p.toArray()
  c[frame.u] = Math.round(c[frame.u] / grid) * grid
  c[frame.v] = Math.round(c[frame.v] / grid) * grid
  return toWorld(frame, new THREE.Vector3().fromArray(c))
}

/** Angle of an in-plane direction, degrees: 0 along u ("up" in side/front views), then towards v. */
export function planeAngle(frame: SnapFrame, dirLocal: THREE.Vector3): number {
  const c = dirLocal.toArray()
  return THREE.MathUtils.radToDeg(Math.atan2(c[frame.v], c[frame.u]))
}

/**
 * Turns a drag target into one at a whole multiple of `step` degrees around
 * `pivot`, in the snap plane through the pivot, at the same distance. Aiming
 * a bone at the result lays it flat in the view plane at a clean angle.
 */
export function snapAngle(
  frame: SnapFrame,
  pivotWorld: THREE.Vector3,
  targetWorld: THREE.Vector3,
  step: number
): { point: THREE.Vector3; angle: number } {
  const pivot = toLocal(frame, pivotWorld)
  const d = toLocal(frame, targetWorld).sub(pivot).toArray()
  const len = Math.hypot(d[frame.u], d[frame.v]) || 1e-6
  const raw = Math.atan2(d[frame.v], d[frame.u])
  const stepRad = THREE.MathUtils.degToRad(step)
  const snapped = Math.round(raw / stepRad) * stepRad
  const out = pivot.toArray()
  out[frame.u] += Math.cos(snapped) * len
  out[frame.v] += Math.sin(snapped) * len
  // Normalise −180 to 180 so the readout matches the protractor.
  const deg = Math.round(THREE.MathUtils.radToDeg(snapped) * 1000) / 1000
  return {
    point: toWorld(frame, new THREE.Vector3().fromArray(out)),
    angle: deg === -180 ? 180 : deg
  }
}

/** A point in the plane at an angle and distance from a pivot (protractor drawing). */
export function pointAtAngle(
  frame: SnapFrame,
  pivotWorld: THREE.Vector3,
  angleDeg: number,
  radiusLocal: number
): THREE.Vector3 {
  const c = toLocal(frame, pivotWorld).toArray()
  const a = THREE.MathUtils.degToRad(angleDeg)
  c[frame.u] += Math.cos(a) * radiusLocal
  c[frame.v] += Math.sin(a) * radiusLocal
  return toWorld(frame, new THREE.Vector3().fromArray(c))
}

/** A lattice point near `centerWorld`, offset by whole cells (grid drawing). */
export function latticePoint(
  frame: SnapFrame,
  centerWorld: THREE.Vector3,
  grid: number,
  i: number,
  j: number
): THREE.Vector3 {
  const c = toLocal(frame, centerWorld).toArray()
  c[frame.u] = (Math.round(c[frame.u] / grid) + i) * grid
  c[frame.v] = (Math.round(c[frame.v] / grid) + j) * grid
  return toWorld(frame, new THREE.Vector3().fromArray(c))
}

export function formatGrid(grid: number): string {
  return grid >= 1 ? `${grid} m` : `${+(grid * 100).toFixed(1)} cm`
}
