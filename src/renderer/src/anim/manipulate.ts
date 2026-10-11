import * as THREE from 'three'
import { mirrorName } from './rig'
import type { JointPose, Pose, Quat, Vec3 } from './types'

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _pq = new THREE.Quaternion()
const _pqInv = new THREE.Quaternion()

/**
 * Rotates `joint` by a world-space rotation `delta`, about its own pivot.
 * local' = parentWorld⁻¹ · delta · parentWorld · local
 */
export function rotateJointWorld(joint: THREE.Object3D, delta: THREE.Quaternion): void {
  if (joint.parent) {
    joint.parent.getWorldQuaternion(_pq)
  } else {
    _pq.identity()
  }
  _pqInv.copy(_pq).invert()
  _q.copy(_pqInv).multiply(delta).multiply(_pq)
  joint.quaternion.premultiply(_q).normalize()
  joint.updateMatrixWorld(true)
}

/**
 * Swings the chain of joints that ends at `effector` so the effector moves
 * towards `target`. A chain of one is plain Pivot-style FK: the segment
 * turns about its pivot; longer chains are CCD IK (bend the elbow and the
 * shoulder to reach). Joint lengths never change; only rotations do.
 */
export function aimChain(
  chain: THREE.Object3D[],
  effectorWorld: () => THREE.Vector3,
  target: THREE.Vector3,
  iterations = 12
): void {
  const passes = chain.length === 1 ? 1 : iterations
  for (let it = 0; it < passes; it++) {
    for (const joint of chain) {
      const pivot = joint.getWorldPosition(_a)
      const eff = effectorWorld().sub(pivot)
      const want = _b.copy(target).sub(pivot)
      if (eff.lengthSq() < 1e-12 || want.lengthSq() < 1e-12) {
        continue
      }
      eff.normalize()
      want.normalize()
      const delta = new THREE.Quaternion().setFromUnitVectors(eff, want)
      rotateJointWorld(joint, delta)
    }
    if (effectorWorld().distanceToSquared(target) < 1e-8) {
      break
    }
  }
}

export interface MirrorRig {
  /** Bone names, parents before children. */
  order: string[]
  parentOf: Map<string, string | null>
  restLocal: Map<string, THREE.Matrix4>
  rest: Pose
}

function basisMatrix(j: JointPose): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...j.p),
    new THREE.Quaternion(...j.r),
    new THREE.Vector3(...(j.s ?? [1, 1, 1]))
  )
}

/**
 * Left/right-swapped copy of a pose, mirrored across the armature's X axis.
 * Done on the geometry rather than on pose channels: each bone takes its
 * partner's posed armature-space transform, reflected, then corrected by how
 * the two bones' rest frames differ. That makes it exact whatever the bone
 * rolls are. A plain channel flip (Blender's Paste Flipped) assumes rolls
 * mirror each other, which real rigs don't always do. Needs only a rest pose
 * that is itself symmetric. Unpaired bones mirror onto themselves.
 */
export function mirrorPose(rig: MirrorRig, pose: Pose): Pose {
  const S = new THREE.Matrix4().makeScale(-1, 1, 1)
  const restW = new Map<string, THREE.Matrix4>()
  const poseW = new Map<string, THREE.Matrix4>()
  for (const name of rig.order) {
    const parent = rig.parentOf.get(name)
    const rl = rig.restLocal.get(name)!
    const pl = rl.clone().multiply(basisMatrix(pose[name] ?? rig.rest[name]))
    restW.set(name, parent ? restW.get(parent)!.clone().multiply(rl) : rl.clone())
    poseW.set(name, parent ? poseW.get(parent)!.clone().multiply(pl) : pl)
  }
  const mirroredW = new Map<string, THREE.Matrix4>()
  for (const name of rig.order) {
    const other = mirrorName(name)
    const partner = other && restW.has(other) ? other : name
    // At rest this gives back the bone's own rest transform.
    const fix = restW.get(partner)!.clone().invert().multiply(S).multiply(restW.get(name)!)
    mirroredW.set(name, S.clone().multiply(poseW.get(partner)!).multiply(fix))
  }
  const out: Pose = {}
  for (const name of rig.order) {
    const parent = rig.parentOf.get(name)
    const local = parent
      ? mirroredW.get(parent)!.clone().invert().multiply(mirroredW.get(name)!)
      : mirroredW.get(name)!
    const m = rig.restLocal.get(name)!.clone().invert().multiply(local)
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    m.decompose(p, q, sc)
    out[name] = { r: q.toArray() as Quat, p: p.toArray() as Vec3 }
    if (Math.abs(sc.x - 1) > 1e-6 || Math.abs(sc.y - 1) > 1e-6 || Math.abs(sc.z - 1) > 1e-6) {
      out[name].s = sc.toArray() as Vec3
    }
  }
  return out
}
