import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import gt from './__fixtures__/blender-copyrot-hammer.json'
import { solveIk, type IkConstraint, type IkContext } from './ik'
import { solveCopyRotation, type CopyRotationConstraint } from './copyRotation'
import { commitNodes, refreshLive, type Rig } from './rig'
import type { JointPose, Pose, Quat, Vec3 } from './types'

/**
 * robot_hammer.blend's arms and legs are 2-bone IK chains, and each hand and
 * foot copies its IK controller's world rotation (Copy Rotation, World →
 * World, Replace). The keyed hand/foot channels are stale; only the constraint
 * puts them (and the hammer the left hand holds) where Blender shows them.
 * Blender's evaluated pose for every other frame is the ground truth.
 */
type M = number[][]
const fixture = gt as unknown as {
  rest: Record<string, M>
  parent: Record<string, string | null>
  length: Record<string, number>
  actions: Record<string, Record<string, { basis: M; pose: M }>[]>
}

const mat = (rows: M): THREE.Matrix4 => new THREE.Matrix4().fromArray(rows.flat()).transpose()

const IK: IkConstraint[] = [
  ['forearm.L', 'hand_ik.L', 'forearm_pole.L', 1.5620696544647217],
  ['forearm.R', 'hand_ik.R', 'forearm_pole.R', 1.579522967338562],
  ['shin.L', 'foot_ik.L', 'shin_pole.L', 1.5664329528808594],
  ['shin.R', 'foot_ik.R', 'shin_pole.R', 1.5751596689224243]
].map(([owner, target, pole, poleAngle]) => ({
  owner: owner as string,
  target: target as string,
  pole: pole as string,
  poleAngle: poleAngle as number,
  chainCount: 2,
  useTail: true,
  influence: 1
}))

const COPY_ROTATION: CopyRotationConstraint[] = ['hand.L', 'hand.R', 'foot.L', 'foot.R'].map(
  (owner) => ({ owner, target: owner.replace('.', '_ik.'), influence: 1 })
)

function buildRig(): {
  ctx: IkContext
  rest: Map<string, THREE.Matrix4>
  armature: THREE.Object3D
} {
  const armature = new THREE.Object3D()
  const joints = new Map<string, THREE.Object3D>()
  const rest = new Map<string, THREE.Matrix4>()
  const parentOf = new Map<string, string | null>()
  const tails = new Map<string, THREE.Vector3>()
  const names = Object.keys(fixture.rest)
  for (const n of names) {
    const o = new THREE.Object3D()
    o.name = n.replace(/\./g, '')
    joints.set(n, o)
    parentOf.set(n, fixture.parent[n])
    tails.set(n, new THREE.Vector3(0, fixture.length[n], 0))
  }
  for (const n of names) {
    const p = fixture.parent[n]
    const local = p
      ? mat(fixture.rest[p]).invert().multiply(mat(fixture.rest[n]))
      : mat(fixture.rest[n])
    rest.set(n, local)
    ;(p ? joints.get(p)! : armature).add(joints.get(n)!)
  }
  return { ctx: { joints, parentOf, tails, ikLock: new Map() }, rest, armature }
}

describe('Copy Rotation preview matches Blender', () => {
  for (const [name, frames] of Object.entries(fixture.actions)) {
    it(name, () => {
      const { ctx, rest, armature } = buildRig()
      let worstRot = 0
      let worstPos = 0
      let where = ''
      frames.forEach((frame, f) => {
        for (const [n, j] of ctx.joints) {
          rest
            .get(n)!
            .clone()
            .multiply(mat(frame[n].basis))
            .decompose(j.position, j.quaternion, j.scale)
        }
        armature.updateMatrixWorld(true)
        IK.forEach((c) => solveIk(ctx, c))
        COPY_ROTATION.forEach((c) => solveCopyRotation(ctx.joints, c))
        // bone.L is the hammer, parented to hand.L.
        for (const n of ['hand.L', 'hand.R', 'foot.L', 'foot.R', 'bone.L']) {
          const truth = mat(frame[n].pose)
          const tq = new THREE.Quaternion().setFromRotationMatrix(truth)
          const tp = new THREE.Vector3().setFromMatrixPosition(truth)
          const j = ctx.joints.get(n)!
          const gq = j.getWorldQuaternion(new THREE.Quaternion())
          const gp = j.getWorldPosition(new THREE.Vector3())
          const rot = THREE.MathUtils.radToDeg(gq.angleTo(tq))
          if (rot > worstRot) {
            worstRot = rot
            where = `frame ${f * 2} ${n}`
          }
          worstPos = Math.max(worstPos, gp.distanceTo(tp))
        }
      })
      expect(worstRot, `worst at ${where}`).toBeLessThan(1)
      // Blender units: the rig is ~17 tall and the hammer reaches ~13 out.
      expect(worstPos).toBeLessThan(0.05)
    })
  }

  it('without the constraint the hands play their stale keys', () => {
    const { ctx, rest, armature } = buildRig()
    const frame = fixture.actions.sprint[0]
    for (const [n, j] of ctx.joints) {
      rest
        .get(n)!
        .clone()
        .multiply(mat(frame[n].basis))
        .decompose(j.position, j.quaternion, j.scale)
    }
    armature.updateMatrixWorld(true)
    IK.forEach((c) => solveIk(ctx, c))
    const tq = new THREE.Quaternion().setFromRotationMatrix(mat(frame['hand.L'].pose))
    const gq = ctx.joints.get('hand.L')!.getWorldQuaternion(new THREE.Quaternion())
    expect(THREE.MathUtils.radToDeg(gq.angleTo(tq))).toBeGreaterThan(20)
  })
})

describe('rotating a bone that copies another', () => {
  /** The hammer rig as a live Rig, posed at sprint frame 0. */
  function liveRig(): Rig {
    const { ctx, rest, armature } = buildRig()
    const basis: Pose = {}
    for (const [n, b] of Object.entries(fixture.actions.sprint[0])) {
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      mat(b.basis).decompose(p, q, s)
      const jp: JointPose = { r: q.toArray() as Quat, p: p.toArray() as Vec3 }
      basis[n] = jp
    }
    const rig = {
      jointByName: ctx.joints,
      parentOf: ctx.parentOf,
      tails: ctx.tails,
      restLocal: rest,
      rest: basis,
      bones: new Map([...ctx.joints.keys()].map((n) => [n, { ikLock: [false, false, false] }])),
      ik: IK,
      copyRotation: COPY_ROTATION,
      display: armature,
      basis
    } as unknown as Rig
    refreshLive(rig)
    return rig
  }

  it('turns the bone it copies, so the turn sticks', () => {
    const rig = liveRig()
    const hand = rig.jointByName.get('hand.L')!
    const handKeys = rig.basis['hand.L']
    const ikKeys = rig.basis['hand_ik.L']

    // What a gizmo drag does: turn the node, then commit it.
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6)
    hand.quaternion.multiply(turn)
    hand.updateMatrixWorld(true)
    const wanted = hand.getWorldQuaternion(new THREE.Quaternion())
    commitNodes(rig, ['hand.L'])

    const got = hand.getWorldQuaternion(new THREE.Quaternion())
    // The fixture's rest matrices are rounded to 5 places, worth a tenth of a degree.
    expect(THREE.MathUtils.radToDeg(got.angleTo(wanted))).toBeLessThan(0.5)
    expect(rig.basis['hand.L']).toBe(handKeys)
    expect(rig.basis['hand_ik.L']).not.toEqual(ikKeys)
  })
})
