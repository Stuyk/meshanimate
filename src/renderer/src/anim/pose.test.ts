import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { alignHemispheres, autoClampedHandles, blendPoses, ease, sampleClip } from './pose'
import { aimChain, mirrorPose } from './manipulate'
import { mirrorName } from './rig'
import type { Clip, Pose, Quat } from './types'

const ID: Quat = [0, 0, 0, 1]
const rest: Pose = { a: { r: ID, p: [0, 0, 0] } }
const at = (x: number): Pose => ({ a: { r: ID, p: [x, 0, 0] } })

function clip(keys: [number, number, Clip['keys'][number]['easing']?][]): Clip {
  return {
    id: 'c',
    name: 'c',
    start: 1,
    fps: 24,
    length: 100,
    keys: keys.map(([frame, x, easing]) => ({
      id: `k${frame}`,
      frame,
      pose: at(x),
      easing: easing ?? 'linear'
    }))
  }
}

describe('sampleClip', () => {
  it('holds the first key before it and the last key after it', () => {
    const c = clip([
      [10, 1],
      [20, 3]
    ])
    expect(sampleClip(c, 0, rest).a.p[0]).toBe(1)
    expect(sampleClip(c, 50, rest).a.p[0]).toBe(3)
  })

  it('interpolates linearly between keys', () => {
    const c = clip([
      [0, 0],
      [10, 10]
    ])
    expect(sampleClip(c, 4, rest).a.p[0]).toBeCloseTo(4)
  })

  it('holds a stepped key until the next one', () => {
    const c = clip([
      [0, 0, 'step'],
      [10, 10]
    ])
    expect(sampleClip(c, 9, rest).a.p[0]).toBe(0)
    expect(sampleClip(c, 10, rest).a.p[0]).toBe(10)
  })

  it('eases a two-key Bézier segment in and out (flat end handles)', () => {
    const c = clip([
      [0, 0, 'bezier'],
      [10, 10, 'bezier']
    ])
    expect(sampleClip(c, 5, rest).a.p[0]).toBeCloseTo(5)
    expect(sampleClip(c, 1, rest).a.p[0]).toBeLessThan(1)
    expect(sampleClip(c, 9, rest).a.p[0]).toBeGreaterThan(9)
  })

  it('falls back to rest with no keys', () => {
    expect(sampleClip(clip([]), 5, rest)).toBe(rest)
  })
})

describe('Blender interpolation details', () => {
  it('interpolates quaternion channels independently, without flipping signs', () => {
    // Blender lerps w x y z separately and normalizes; keys in opposite
    // hemispheres go the long way, which is what the animator sees there.
    const a: Pose = { a: { r: [0, 0, 0, 1], p: [0, 0, 0] } }
    const b: Pose = { a: { r: [0, 0, 0.6, -0.8], p: [0, 0, 0] } }
    const mid = blendPoses(a, b, 0.5, rest).a.r
    expect(mid[2]).toBeGreaterThan(0.9)
  })

  it('aligns new keys to their neighbour so they turn the short way', () => {
    const prev: Pose = { a: { r: [0, 0, 0, 1], p: [0, 0, 0] } }
    const next: Pose = { a: { r: [0, 0, -0.1, -0.995], p: [0, 0, 0] } }
    expect(alignHemispheres(next, prev).a.r[3]).toBeGreaterThan(0)
  })

  it('gives peaks flat auto-clamped handles', () => {
    const h = autoClampedHandles([0, 5, 10], [0, 4, 0], 1)
    expect(h.ly).toBe(4)
    expect(h.ry).toBe(4)
  })

  it('matches Penner cubic easing at both ends', () => {
    for (const e of ['linear', 'easeInOut', 'easeIn', 'easeOut'] as const) {
      expect(ease(e, 0)).toBeCloseTo(0)
      expect(ease(e, 1)).toBeCloseTo(1)
    }
  })
})

describe('aimChain', () => {
  it('swings a single bone so its tail points at the target (FK)', () => {
    const bone = new THREE.Object3D()
    bone.updateMatrixWorld(true)
    const tail = new THREE.Vector3(0, 1, 0)
    aimChain([bone], () => bone.localToWorld(tail.clone()), new THREE.Vector3(1, 0, 0))
    const end = bone.localToWorld(tail.clone())
    expect(end.x).toBeCloseTo(1)
    expect(end.y).toBeCloseTo(0)
  })

  it('bends a two-bone chain to reach a point inside its span', () => {
    const upper = new THREE.Object3D()
    const lower = new THREE.Object3D()
    lower.position.set(0, 1, 0)
    upper.add(lower)
    upper.updateMatrixWorld(true)
    const tail = new THREE.Vector3(0, 1, 0)
    const target = new THREE.Vector3(1, 1, 0)
    aimChain([lower, upper], () => lower.localToWorld(tail.clone()), target, 30)
    expect(lower.localToWorld(tail.clone()).distanceTo(target)).toBeLessThan(1e-3)
  })
})

describe('mirroring', () => {
  it('pairs Blender-style names, numbered copies included', () => {
    expect(mirrorName('hand.L')).toBe('hand.R')
    expect(mirrorName('Shin.L.001')).toBe('Shin.R.001')
    expect(mirrorName('LeftArm')).toBe('RightArm')
    expect(mirrorName('thigh_r')).toBe('thigh_l')
    expect(mirrorName('Spine')).toBeNull()
  })

  it('mirrors geometry exactly even when left and right bone rolls differ', () => {
    // Two arms mirrored in space, but the right one is rolled 90° about its
    // own axis. That is the case a plain channel flip gets wrong.
    const restL = new THREE.Matrix4().compose(
      new THREE.Vector3(0.5, 1, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1)),
      new THREE.Vector3(1, 1, 1)
    )
    const S = new THREE.Matrix4().makeScale(-1, 1, 1)
    const roll = new THREE.Matrix4().makeRotationY(Math.PI / 2)
    const fixedR = S.clone().multiply(restL).multiply(S).multiply(roll)
    const rig = {
      order: ['Arm.L', 'Arm.R'],
      parentOf: new Map<string, string | null>([
        ['Arm.L', null],
        ['Arm.R', null]
      ]),
      restLocal: new Map([
        ['Arm.L', restL],
        ['Arm.R', fixedR]
      ]),
      rest: {
        'Arm.L': { r: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as [number, number, number] },
        'Arm.R': { r: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as [number, number, number] }
      }
    }
    const lift = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0.3))
    const pose: Pose = { ...rig.rest, 'Arm.L': { r: lift.toArray() as Quat, p: [0.1, 0.2, 0] } }
    const out = mirrorPose(rig, pose)
    const world = (name: 'Arm.L' | 'Arm.R', p: Pose): THREE.Matrix4 => {
      const j = p[name]
      return rig.restLocal
        .get(name)!
        .clone()
        .multiply(
          new THREE.Matrix4().compose(
            new THREE.Vector3(...j.p),
            new THREE.Quaternion(...j.r),
            new THREE.Vector3(1, 1, 1)
          )
        )
    }
    // The mirrored right arm's tail sits where the posed left arm's tail mirrors to.
    const tail = new THREE.Vector3(0, 1, 0)
    const leftTail = tail.clone().applyMatrix4(world('Arm.L', pose))
    const rightTail = tail.clone().applyMatrix4(world('Arm.R', out))
    expect(rightTail.x).toBeCloseTo(-leftTail.x)
    expect(rightTail.y).toBeCloseTo(leftTail.y)
    expect(rightTail.z).toBeCloseTo(leftTail.z)
    // Mirroring twice gives the original pose back.
    const back = mirrorPose(rig, out)
    expect(tail.clone().applyMatrix4(world('Arm.L', back)).distanceTo(leftTail)).toBeLessThan(1e-9)
  })
})
