import * as THREE from 'three'
import { ikChain, solveIk, type IkConstraint, type IkContext } from './ik'
import { clonePose, IDENTITY_JOINT } from './pose'
import { UNIT_SCALE, type Easing, type JointPose, type Pose, type Quat, type Vec3 } from './types'
import { t } from '../i18n'

// ---------------------------------------------------------------------------
// What meshanimate_load.py reports about a .blend
// ---------------------------------------------------------------------------

export interface BlendConstraint {
  type: string
  name: string
  mute: boolean
  influence: number
  target?: string | null
  subtarget?: string | null
  poleTarget?: string | null
  poleSubtarget?: string | null
  poleAngle?: number
  chainCount?: number
  useTail?: boolean
  sameArmature?: boolean
}

export interface BlendBone {
  name: string
  parent: string | null
  length: number
  deform: boolean
  hidden: boolean
  rotationMode: string
  ikLock: [boolean, boolean, boolean]
  matrixLocal: number[][]
  constraints: BlendConstraint[]
}

export interface BlendAction {
  name: string
  start: number
  length: number
  cyclic: boolean
  /** Has a strip on one of the armature's NLA tracks. */
  inNla?: boolean
  keys: { frame: number; easing: Easing; pose: Pose }[]
  /** Blender's own evaluation of every frame of the action. */
  baked: Pose[]
}

export interface BlendMeta {
  error?: string
  blenderVersion: string
  fps: number
  frameStart: number
  armature: string
  bones: BlendBone[]
  /** Each bone's pose as stored in the file, shown where an action doesn't key it. */
  storedPose?: Pose
  actions: BlendAction[]
  activeAction: string | null
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

export type JointRole = 'bone' | 'ikTarget' | 'pole'

/**
 * A rig loaded from a .blend. Pose values are Blender pose channels
 * (matrix_basis) per bone; `restLocal` turns them into node transforms:
 * local = restLocal · basis. Constraints are then evaluated on top, the way
 * Blender does, so the viewport shows what Blender shows.
 */
export interface Rig {
  name: string
  blendPath: string
  meta: BlendMeta
  display: THREE.Group
  root: THREE.Object3D
  meshes: THREE.Mesh[]
  /**
   * Bone nodes by Blender bone name, parents before children. Always go by
   * these keys: node.name is glTF-sanitized ("Arm.L" arrives as "ArmL").
   */
  jointByName: Map<string, THREE.Object3D>
  parentOf: Map<string, string | null>
  childrenOf: Map<string, string[]>
  /** Local-space tail of every bone: the handle you grab to swing it. */
  tails: Map<string, THREE.Vector3>
  restLocal: Map<string, THREE.Matrix4>
  /**
   * What each bone shows when no key says otherwise: the pose stored in the
   * .blend (Blender holds unkeyed channels at those values), identity if none.
   */
  rest: Pose
  bones: Map<string, BlendBone>
  ik: IkConstraint[]
  roles: Map<string, JointRole>
  /** Bones whose rotation Blender's IK overrides, and the constraint doing it. */
  ikDriven: Map<string, IkConstraint>
  /** Constraint types the preview doesn't evaluate, with counts (Blender still applies them). */
  warnings: string[]
  /** Those constraints move the mesh, so the viewport only approximates Blender. */
  previewApproximate: boolean
  /** The live pose channels. These get keyed. */
  basis: Pose
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      meshes.push(o as THREE.Mesh)
    }
  })
  return meshes
}

/** Bone nodes by their real Blender name, tagged by the load script. */
function findBoneNodes(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>()
  root.traverse((o) => {
    const name = o.userData.meshanimate_name as string | undefined
    if (name && !out.has(name)) {
      out.set(name, o)
    }
  })
  return out
}

/** Blender's constraint type ids as its UI names them. */
function constraintLabel(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function readConstraints(bones: BlendBone[]): {
  ik: IkConstraint[]
  warnings: string[]
  unsupportedOn: Set<string>
} {
  const ik: IkConstraint[] = []
  const counts = new Map<string, number>()
  const unsupportedOn = new Set<string>()
  const skip = (label: string, bone: string): void => {
    counts.set(label, (counts.get(label) ?? 0) + 1)
    unsupportedOn.add(bone)
  }
  for (const b of bones) {
    for (const c of b.constraints) {
      if (c.mute || c.influence <= 0) {
        continue
      }
      if (c.type !== 'IK') {
        skip(constraintLabel(c.type), b.name)
        continue
      }
      if (!c.sameArmature || !c.subtarget) {
        skip('IK aimed at another object', b.name)
        continue
      }
      ik.push({
        owner: b.name,
        target: c.subtarget,
        pole: c.poleSubtarget && c.poleTarget ? c.poleSubtarget : null,
        poleAngle: c.poleAngle ?? 0,
        chainCount: c.chainCount ?? 0,
        useTail: c.useTail ?? true,
        influence: c.influence
      })
    }
  }
  const warnings = [...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${label} ×${n}`)
  return { ik, warnings, unsupportedOn }
}

/**
 * Whether constraints the preview doesn't evaluate move the mesh: they sit on
 * a deforming bone or above one. Rigs like Rigify drive their deform bones
 * entirely through such constraints, so the viewport can't show what Blender
 * will. The keys still save exactly.
 */
function meshDrivenByUnsupported(
  bones: BlendBone[],
  unsupportedOn: Set<string>,
  childrenOf: Map<string, string[]>
): boolean {
  const deformSet = new Set(bones.filter((b) => b.deform).map((b) => b.name))
  const deforms = (name: string): boolean => {
    const stack = [name]
    while (stack.length) {
      const n = stack.pop()!
      if (deformSet.has(n)) {
        return true
      }
      stack.push(...(childrenOf.get(n) ?? []))
    }
    return false
  }
  return [...unsupportedOn].some(deforms)
}

/**
 * Some rigs are tiny or huge. Scaling the app-owned wrapper keeps the camera,
 * grid and shadows sensible without touching any bone data.
 */
function normalizeDisplayScale(display: THREE.Group, root: THREE.Object3D): void {
  display.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root, true)
  const size = box.getSize(new THREE.Vector3())
  const height = Math.max(size.x, size.y, size.z)
  if (!isFinite(height) || height <= 0) {
    return
  }
  if (height > 6 || height < 0.3) {
    display.scale.setScalar(1.8 / height)
  }
  display.updateMatrixWorld(true)
  const placed = new THREE.Box3().setFromObject(root, true)
  display.position.y -= placed.min.y
  display.updateMatrixWorld(true)
}

export async function loadRig(glbUrl: string, meta: BlendMeta, blendPath: string): Promise<Rig> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const gltf = await new GLTFLoader().loadAsync(glbUrl)
  const root = gltf.scene
  const display = new THREE.Group()
  display.name = '__display'
  display.add(root)

  const meshes = collectMeshes(root)
  for (const m of meshes) {
    m.castShadow = true
    // Skinned bounds go stale the moment a bone moves.
    m.frustumCulled = false
  }

  const nodes = findBoneNodes(root)
  const bones = new Map(meta.bones.map((b) => [b.name, b]))
  const missing = meta.bones.filter((b) => !nodes.has(b.name)).map((b) => b.name)
  if (missing.length > 0) {
    throw new Error(t('errors.bonesMissing', { bones: missing.slice(0, 5).join(', ') }))
  }

  // Parents before children, in Blender's own bone order otherwise.
  const ordered: BlendBone[] = []
  const placed = new Set<string>()
  const visit = (b: BlendBone): void => {
    if (placed.has(b.name)) {
      return
    }
    if (b.parent && bones.has(b.parent)) {
      visit(bones.get(b.parent)!)
    }
    placed.add(b.name)
    ordered.push(b)
  }
  meta.bones.forEach(visit)

  const jointByName = new Map(ordered.map((b) => [b.name, nodes.get(b.name)!]))
  const parentOf = new Map<string, string | null>()
  const childrenOf = new Map<string, string[]>(ordered.map((b) => [b.name, []]))
  const tails = new Map<string, THREE.Vector3>()
  const restLocal = new Map<string, THREE.Matrix4>()
  const rest: Pose = {}
  for (const b of ordered) {
    const parent = b.parent && bones.has(b.parent) ? b.parent : null
    parentOf.set(b.name, parent)
    if (parent) {
      childrenOf.get(parent)!.push(b.name)
    }
    // Bones point down their local +Y, length as authored in Blender.
    tails.set(b.name, new THREE.Vector3(0, b.length, 0))
    const node = nodes.get(b.name)!
    node.updateMatrix()
    restLocal.set(b.name, node.matrix.clone())
    rest[b.name] = meta.storedPose?.[b.name] ?? IDENTITY_JOINT
  }

  const { ik, warnings, unsupportedOn } = readConstraints(ordered)
  const roles = new Map<string, JointRole>(ordered.map((b) => [b.name, 'bone']))
  const ikDriven = new Map<string, IkConstraint>()
  for (const c of ik) {
    roles.set(c.target, 'ikTarget')
    if (c.pole) {
      roles.set(c.pole, 'pole')
    }
    if (c.influence >= 0.999) {
      ikChain(c, parentOf).forEach((n) => ikDriven.set(n, c))
    }
  }

  normalizeDisplayScale(display, root)

  const rig: Rig = {
    name:
      blendPath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.blend$/i, '') ?? 'Untitled',
    blendPath,
    meta,
    display,
    root,
    meshes,
    jointByName,
    parentOf,
    childrenOf,
    tails,
    restLocal,
    rest,
    bones,
    ik,
    roles,
    ikDriven,
    warnings,
    previewApproximate: meshDrivenByUnsupported(ordered, unsupportedOn, childrenOf),
    basis: clonePose(rest)
  }
  evaluatePose(rig, rig.jointByName, rig.basis, rig.display)
  return rig
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const _basis = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

function basisMatrix(j: JointPose, out: THREE.Matrix4): THREE.Matrix4 {
  _p.fromArray(j.p)
  _q.fromArray(j.r)
  _s.fromArray(j.s ?? UNIT_SCALE)
  return out.compose(_p, _q, _s)
}

export function ikContext(rig: Rig, joints: Map<string, THREE.Object3D>): IkContext {
  return {
    joints,
    parentOf: rig.parentOf,
    tails: rig.tails,
    ikLock: new Map([...rig.bones].map(([n, b]) => [n, b.ikLock]))
  }
}

/**
 * Poses any copy of the rig (the live one, onion ghosts): pose channels on
 * top of rest, then constraints, the order Blender evaluates an armature in.
 */
export function evaluatePose(
  rig: Rig,
  joints: Map<string, THREE.Object3D>,
  pose: Pose,
  top: THREE.Object3D
): void {
  for (const name of rig.jointByName.keys()) {
    const joint = joints.get(name)
    if (!joint) {
      continue
    }
    const local = rig.restLocal
      .get(name)!
      .clone()
      .multiply(basisMatrix(pose[name] ?? rig.rest[name] ?? IDENTITY_JOINT, _basis))
    local.decompose(joint.position, joint.quaternion, joint.scale)
  }
  top.updateMatrixWorld(true)
  if (rig.ik.length === 0) {
    return
  }
  const ctx = ikContext(rig, joints)
  for (const c of rig.ik) {
    solveIk(ctx, c)
  }
}

/** Shows `pose` on the live rig and makes it the pose being edited. */
export function setLiveBasis(rig: Rig, pose: Pose): void {
  rig.basis = clonePose(pose)
  for (const name of Object.keys(rig.rest)) {
    // Bones a pose doesn't mention hold their unkeyed pose, as in Blender.
    rig.basis[name] ??= rig.rest[name]
  }
  evaluatePose(rig, rig.jointByName, rig.basis, rig.display)
}

/** Re-evaluates the live rig after its channels were changed in place. */
export function refreshLive(rig: Rig): void {
  evaluatePose(rig, rig.jointByName, rig.basis, rig.display)
}

/** The live pose channels, for keying. */
export function readPose(rig: Rig): Pose {
  return clonePose(rig.basis)
}

/**
 * Turns a bone's current node transform (after a drag or a gizmo turn) back
 * into pose channels: basis = restLocal⁻¹ · local.
 */
export function basisFromNode(rig: Rig, name: string): JointPose {
  const node = rig.jointByName.get(name)!
  node.updateMatrix()
  const m = rig.restLocal.get(name)!.clone().invert().multiply(node.matrix)
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  m.decompose(p, q, s)
  // Keep the quaternion on the side it was, so keys stay continuous.
  const prev = rig.basis[name]?.r
  if (prev && prev[0] * q.x + prev[1] * q.y + prev[2] * q.z + prev[3] * q.w < 0) {
    q.set(-q.x, -q.y, -q.z, -q.w)
  }
  const out: JointPose = { r: q.toArray() as Quat, p: p.toArray() as Vec3 }
  if (Math.abs(s.x - 1) > 1e-6 || Math.abs(s.y - 1) > 1e-6 || Math.abs(s.z - 1) > 1e-6) {
    out.s = s.toArray() as Vec3
  }
  return out
}

/** Re-reads the given bones' channels from their nodes, then re-evaluates. */
export function commitNodes(rig: Rig, names: string[]): void {
  for (const n of names) {
    rig.basis[n] = basisFromNode(rig, n)
  }
  refreshLive(rig)
}

/** Moves a bone so its head lands on a world point (roots, IK targets, poles). */
export function moveBoneTo(rig: Rig, name: string, world: THREE.Vector3): void {
  const joint = rig.jointByName.get(name)!
  const local = world.clone()
  if (joint.parent) {
    joint.parent.updateMatrixWorld(true)
    joint.parent.worldToLocal(local)
  }
  joint.position.copy(local)
  commitNodes(rig, [name])
}

/**
 * Pairs `.L/.R` (also `.L.001`), `_l/_r`, `Left/Right` style bone names, for
 * mirroring a pose across the figure.
 */
export function mirrorName(name: string): string | null {
  const rules: [RegExp, string][] = [
    [/\.L(\.\d+)?$/, '.R$1'],
    [/\.R(\.\d+)?$/, '.L$1'],
    [/_L$/, '_R'],
    [/_R$/, '_L'],
    [/_l$/, '_r'],
    [/_r$/, '_l'],
    [/Left/, 'Right'],
    [/Right/, 'Left'],
    [/left/, 'right'],
    [/right/, 'left'],
    [/^L_/, 'R_'],
    [/^R_/, 'L_']
  ]
  for (const [re, rep] of rules) {
    if (re.test(name)) {
      return name.replace(re, rep)
    }
  }
  return null
}
