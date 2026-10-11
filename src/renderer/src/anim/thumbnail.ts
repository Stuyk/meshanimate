import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { evaluatePose, type Rig } from './rig'
import type { Pose } from './types'

interface ThumbRig {
  top: THREE.Object3D
  joints: Map<string, THREE.Object3D>
  /** Side-view bounds of the rest pose, so every clip's thumbnail shares one scale. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  armatureInv: THREE.Matrix4
}

const cache = new WeakMap<Rig, ThumbRig>()

/** Side view in armature space: across = z (front/back), up = y. */
function project(p: THREE.Vector3, inv: THREE.Matrix4): [number, number] {
  const a = p.clone().applyMatrix4(inv)
  return [a.z, a.y]
}

function setup(rig: Rig): ThumbRig {
  const top = cloneSkinned(rig.display)
  const joints = new Map<string, THREE.Object3D>()
  top.traverse((o) => {
    const name = o.userData.meshanimate_name as string | undefined
    if (name && rig.jointByName.has(name) && !joints.has(name)) {
      joints.set(name, o)
    }
  })
  const first = rig.jointByName.values().next().value
  rig.display.updateMatrixWorld(true)
  const armatureInv = (first?.parent?.matrixWorld ?? new THREE.Matrix4()).clone().invert()
  evaluatePose(rig, joints, rig.rest, top)
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (const [name, j] of joints) {
    for (const p of [
      j.getWorldPosition(new THREE.Vector3()),
      j.localToWorld(rig.tails.get(name)!.clone())
    ]) {
      const [x, y] = project(p, armatureInv)
      b.minX = Math.min(b.minX, x)
      b.maxX = Math.max(b.maxX, x)
      b.minY = Math.min(b.minY, y)
      b.maxY = Math.max(b.maxY, y)
    }
  }
  return { top, joints, bounds: b, armatureInv }
}

/**
 * A small side-view stick figure of a pose, constraints included — enough to
 * tell clips apart at a glance without rendering the mesh.
 */
export function poseThumbnail(rig: Rig, pose: Pose, width = 56, height = 40): string {
  let t = cache.get(rig)
  if (!t) {
    t = setup(rig)
    cache.set(rig, t)
  }
  evaluatePose(rig, t.joints, pose, t.top)
  const canvas = document.createElement('canvas')
  const dpr = 2
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  const { minX, maxX, minY, maxY } = t.bounds
  // Room for limbs to swing beyond the rest silhouette.
  const pad = Math.max(maxX - minX, maxY - minY) * 0.25
  const spanX = maxX - minX + pad * 2
  const spanY = maxY - minY + pad * 2
  const scale = Math.min(width / spanX, height / spanY)
  const ox = width / 2 - ((minX + maxX) / 2) * scale
  const oy = height / 2 + ((minY + maxY) / 2) * scale
  const toCanvas = (p: THREE.Vector3): [number, number] => {
    const [x, y] = project(p, t!.armatureInv)
    return [ox + x * scale, oy - y * scale]
  }
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.6
  ctx.strokeStyle = '#e8e8ea'
  for (const [name, j] of t.joints) {
    if (rig.roles.get(name) !== 'bone' || rig.bones.get(name)?.hidden) {
      continue
    }
    const [hx, hy] = toCanvas(j.getWorldPosition(new THREE.Vector3()))
    const [tx, ty] = toCanvas(j.localToWorld(rig.tails.get(name)!.clone()))
    ctx.beginPath()
    ctx.moveTo(hx, hy)
    ctx.lineTo(tx, ty)
    ctx.stroke()
  }
  return canvas.toDataURL('image/png')
}
