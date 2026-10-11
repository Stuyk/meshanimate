import * as THREE from 'three'
import { aimChain, rotateJointWorld } from './manipulate'

/** A Blender IK constraint, as read from the .blend. */
export interface IkConstraint {
  owner: string
  /** Bone whose head is the goal. */
  target: string
  pole: string | null
  poleAngle: number
  /** 0 = up to the armature root. */
  chainCount: number
  useTail: boolean
  influence: number
}

export interface IkContext {
  joints: Map<string, THREE.Object3D>
  parentOf: Map<string, string | null>
  tails: Map<string, THREE.Vector3>
  /** Per bone: which axes Blender's IK may not rotate (lock_ik_x/y/z). */
  ikLock: Map<string, [boolean, boolean, boolean]>
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

/** Bones the constraint moves, owner first. */
export function ikChain(c: IkConstraint, parentOf: Map<string, string | null>): string[] {
  const out: string[] = []
  let name: string | null = c.useTail ? c.owner : (parentOf.get(c.owner) ?? null)
  const limit = c.chainCount > 0 ? c.chainCount : Infinity
  while (name && out.length < limit) {
    out.push(name)
    name = parentOf.get(name) ?? null
  }
  return out
}

function effectorWorld(ctx: IkContext, c: IkConstraint): THREE.Vector3 {
  const owner = ctx.joints.get(c.owner)!
  if (!c.useTail) {
    return owner.getWorldPosition(new THREE.Vector3())
  }
  return owner.localToWorld((ctx.tails.get(c.owner) ?? new THREE.Vector3()).clone())
}

function worldAxis(o: THREE.Object3D, col: 0 | 1 | 2): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixColumn(o.matrixWorld, col).normalize()
}

/**
 * Bends the middle bone about one of its own axes so the chain spans exactly
 * `reach` from the root to the effector. Solved in closed form: the
 * effector circles the hinge axis, so its distance to the root is a sinusoid
 * in the bend angle. Of the two solutions the smaller turn wins, which keeps
 * a knee bending the way it already bends.
 */
function bendTo(
  mid: THREE.Object3D,
  axis: THREE.Vector3,
  rootPos: THREE.Vector3,
  eff: () => THREE.Vector3,
  reach: number
): void {
  const k = mid.getWorldPosition(new THREE.Vector3())
  const v = eff().sub(k)
  const vPar = axis.clone().multiplyScalar(v.dot(axis))
  const vPerp = v.clone().sub(vPar)
  const w = rootPos.clone().sub(k).sub(vPar)
  const wPerp = w.clone().sub(axis.clone().multiplyScalar(w.dot(axis)))
  const a = wPerp.dot(vPerp)
  const b = w.dot(axis.clone().cross(vPerp))
  const c = (w.lengthSq() + vPerp.lengthSq() - reach * reach) / 2
  const r = Math.hypot(a, b)
  if (r < 1e-9) {
    return
  }
  const phi = Math.atan2(b, a)
  const delta = Math.acos(Math.max(-1, Math.min(1, c / r)))
  const wrap = (x: number): number => Math.atan2(Math.sin(x), Math.cos(x))
  const t1 = wrap(phi + delta)
  const t2 = wrap(phi - delta)
  const theta = Math.abs(t1) <= Math.abs(t2) ? t1 : t2
  rotateJointWorld(mid, new THREE.Quaternion().setFromAxisAngle(axis, theta))
}

/**
 * Blender's pole-target step (IK_QJacobianSolver::ConstrainPoleVector):
 * turns the whole chain about its root so the root→effector line points at
 * the goal and the root's X/Z "up" (rotated by the pole angle) faces the pole.
 */
function constrainPole(
  root: THREE.Object3D,
  eff: THREE.Vector3,
  goal: THREE.Vector3,
  polePos: THREE.Vector3,
  poleAngle: number
): void {
  const rootPos = root.getWorldPosition(new THREE.Vector3())
  const dir = eff.clone().sub(rootPos).normalize()
  const up = worldAxis(root, 0)
    .multiplyScalar(Math.cos(poleAngle))
    .add(worldAxis(root, 2).multiplyScalar(Math.sin(poleAngle)))
  const poleDir = goal.clone().sub(rootPos).normalize()
  const poleUp = polePos.clone().sub(rootPos).normalize()

  const frame = (d: THREE.Vector3, u: THREE.Vector3): THREE.Matrix4 => {
    const r0 = d.clone().cross(u).normalize()
    const r1 = r0.clone().cross(d)
    const r2 = d.clone().negate()
    // Rows r0 r1 r2 → a rotation matrix whose transpose has them as columns.
    return new THREE.Matrix4().makeBasis(r0, r1, r2)
  }
  const mat = frame(dir, up)
  const poleMat = frame(poleDir, poleUp)
  // rotation = poleMatᵀ · mat, with mat/poleMat stored as row matrices
  // (makeBasis gives their transposes).
  const rotation = poleMat.clone().multiply(mat.clone().transpose())
  rotateJointWorld(root, new THREE.Quaternion().setFromRotationMatrix(rotation))
}

/** Solves one IK constraint in place on `ctx.joints`, Blender-style. */
export function solveIk(ctx: IkContext, c: IkConstraint): void {
  if (c.influence <= 0) {
    return
  }
  const target = ctx.joints.get(c.target)
  const chainNames = ikChain(c, ctx.parentOf)
  if (!target || chainNames.length === 0) {
    return
  }
  const chain = chainNames.map((n) => ctx.joints.get(n)!)
  const fk = chain.map((j) => j.quaternion.clone())
  const goal = target.getWorldPosition(new THREE.Vector3())
  const eff = (): THREE.Vector3 => effectorWorld(ctx, c)
  const root = chain[chain.length - 1]

  // Blender applies the pole step once, before solving: it turns the FK
  // chain about its root so the root's pole-angle "up" faces the pole and the
  // effector line faces the goal. The solve then only bends and swings from
  // there, which is what fixes the knee's twist.
  const pole = c.pole ? ctx.joints.get(c.pole) : undefined
  if (pole) {
    constrainPole(root, eff(), goal, pole.getWorldPosition(new THREE.Vector3()), c.poleAngle)
  }

  if (chain.length === 2 && c.useTail) {
    const mid = chain[0]
    const rootPos = root.getWorldPosition(new THREE.Vector3())
    const upper = mid.getWorldPosition(_a).distanceTo(rootPos)
    const lower = eff().distanceTo(mid.getWorldPosition(_b))
    const reach = Math.min(
      Math.max(goal.distanceTo(rootPos), Math.abs(upper - lower) + 1e-6),
      upper + lower - 1e-6
    )
    // By bone name: node names are glTF-sanitized ("Shin.L" arrives as "ShinL").
    const lock = ctx.ikLock.get(chainNames[0]) ?? [false, false, false]
    // Hinge on the free axis that bends the bone (Y is twist along it).
    const axis = lock[0] && !lock[2] ? worldAxis(mid, 2) : worldAxis(mid, 0)
    bendTo(mid, axis, rootPos, eff, reach)
    const e = eff().sub(rootPos).normalize()
    const g = goal.clone().sub(rootPos).normalize()
    rotateJointWorld(root, new THREE.Quaternion().setFromUnitVectors(e, g))
  } else {
    aimChain(chain, eff, goal, 40)
  }

  if (c.influence < 1) {
    chain.forEach((j, i) => {
      const ik = j.quaternion.clone()
      j.quaternion.copy(fk[i]).slerp(ik, c.influence)
    })
    root.updateMatrixWorld(true)
  }
}
