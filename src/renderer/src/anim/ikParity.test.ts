import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import gt from './__fixtures__/blender-ik-robot.json'
import { solveIk, type IkConstraint, type IkContext } from './ik'

/**
 * robot.blend's legs are driven by Blender IK (2-bone chains with pole
 * targets). Blender's evaluated pose for every frame is the ground truth; the
 * preview solver has to land the legs where Blender does.
 */
type M = number[][]
const fixture = gt as unknown as {
  rest: Record<string, M>
  parent: Record<string, string | null>
  length: Record<string, number>
  actions: Record<string, Record<string, { basis: M; pose: M }>[]>
}

const mat = (rows: M): THREE.Matrix4 =>
  new THREE.Matrix4().set(
    ...(rows.flat() as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number
    ])
  )

const IK: IkConstraint[] = [
  {
    owner: 'Shin.L',
    target: 'Shin.L.001',
    pole: 'CTRL_IKPoleVector.L',
    poleAngle: -Math.PI,
    chainCount: 2,
    useTail: true,
    influence: 1
  },
  {
    owner: 'Shin.R',
    target: 'Shin.R.001',
    pole: 'CTRL_IKPoleVector.R',
    poleAngle: 0,
    chainCount: 2,
    useTail: true,
    influence: 1
  }
]

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
    // As glTF delivers them: "Shin.L" arrives as "ShinL". The solver must
    // go by bone names, never node names.
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
  const ikLock = new Map<string, [boolean, boolean, boolean]>([
    ['Shin.L', [false, false, true]],
    ['Shin.R', [true, false, false]]
  ])
  return { ctx: { joints, parentOf, tails, ikLock }, rest, armature }
}

describe('IK preview matches Blender', () => {
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
        for (const n of ['Thigh.L', 'Shin.L', 'Foot.L', 'Thigh.R', 'Shin.R', 'Foot.R']) {
          const truth = mat(frame[n].pose)
          const tq = new THREE.Quaternion().setFromRotationMatrix(truth)
          const tp = new THREE.Vector3().setFromMatrixPosition(truth)
          const j = ctx.joints.get(n)!
          const gq = j.getWorldQuaternion(new THREE.Quaternion())
          const gp = j.getWorldPosition(new THREE.Vector3())
          const rot = THREE.MathUtils.radToDeg(gq.angleTo(tq))
          if (rot > worstRot) {
            worstRot = rot
            where = `frame ${f} ${n}`
          }
          worstPos = Math.max(worstPos, gp.distanceTo(tp))
        }
      })
      // Blender iterates (damped least squares) where this solves in closed
      // form; they agree to well under a degree, deepest knee bends included.
      expect(worstRot, `worst at ${where}`).toBeLessThan(1)
      expect(worstPos).toBeLessThan(5e-3)
    })
  }
})
