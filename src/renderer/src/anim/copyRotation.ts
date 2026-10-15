import * as THREE from 'three'
import { rotateJointWorld } from './manipulate'

/**
 * A Blender Copy Rotation constraint between two bones of the same armature,
 * in the one setup the preview evaluates: owner and target in the same space
 * (World or Pose), Replace, every axis, no inverts. IK rigs use exactly this
 * to keep a hand or foot turned with its IK controller.
 */
export interface CopyRotationConstraint {
  owner: string
  target: string
  influence: number
}

const _target = new THREE.Quaternion()
const _owner = new THREE.Quaternion()
const _delta = new THREE.Quaternion()

/**
 * Turns the owner so its world rotation matches the target's, keeping its
 * position and scale. World and Pose space differ only by the armature's own
 * transform, which both bones share, so one world-space match covers both.
 */
export function solveCopyRotation(
  joints: Map<string, THREE.Object3D>,
  c: CopyRotationConstraint
): void {
  if (c.influence <= 0) {
    return
  }
  const owner = joints.get(c.owner)
  const target = joints.get(c.target)
  if (!owner || !target) {
    return
  }
  target.getWorldQuaternion(_target)
  owner.getWorldQuaternion(_owner)
  if (c.influence < 1) {
    _target.copy(_owner).slerp(_target, c.influence)
  }
  // delta · owner = target, applied about the owner's own pivot.
  _delta.copy(_target).multiply(_owner.invert())
  rotateJointWorld(owner, _delta)
}

/**
 * The reverse: turns the target so it faces the way the owner was just
 * turned, so once the constraint runs again the owner keeps that rotation.
 */
export function matchTargetToOwner(
  joints: Map<string, THREE.Object3D>,
  c: CopyRotationConstraint
): void {
  const owner = joints.get(c.owner)
  const target = joints.get(c.target)
  if (!owner || !target) {
    return
  }
  owner.getWorldQuaternion(_owner)
  target.getWorldQuaternion(_target)
  _delta.copy(_owner).multiply(_target.invert())
  rotateJointWorld(target, _delta)
}
