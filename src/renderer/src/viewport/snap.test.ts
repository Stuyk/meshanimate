import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { planeThrough, snapAngle, snapPoint, viewFrame } from './snap'

const identity = new THREE.Matrix4()

describe('view frame', () => {
  it('picks the axis plane most face-on to the camera', () => {
    expect(viewFrame(identity, new THREE.Vector3(-0.9, -0.2, 0.3)).name).toBe('Side')
    expect(viewFrame(identity, new THREE.Vector3(0.1, -1, 0.2)).name).toBe('Top')
    expect(viewFrame(identity, new THREE.Vector3(0.3, 0.1, -1)).name).toBe('Front')
  })

  it('works in armature space, whatever the display scale', () => {
    // The app may scale the model for display; snapping stays in Blender units.
    const scaled = new THREE.Matrix4().makeScale(2, 2, 2)
    const f = viewFrame(scaled, new THREE.Vector3(-1, 0, 0))
    const p = snapPoint(f, new THREE.Vector3(0.5, 0.33, 0.27), 0.05)
    // World 0.33 is local 0.165 → 0.15 or 0.2 local → 0.3 / 0.4 world.
    expect(p.y).toBeCloseTo(0.3)
    expect(p.z).toBeCloseTo(0.3)
    expect(p.x).toBeCloseTo(0.5)
  })
})

describe('snapping', () => {
  const side = viewFrame(identity, new THREE.Vector3(-1, 0, 0))

  it('snaps the two in-plane coordinates and keeps the depth', () => {
    const p = snapPoint(side, new THREE.Vector3(0.123, 1.026, -0.071), 0.05)
    expect(p.x).toBeCloseTo(0.123)
    expect(p.y).toBeCloseTo(1.05)
    expect(p.z).toBeCloseTo(-0.05)
  })

  it('snaps a swing to the angle step at the same distance', () => {
    const pivot = new THREE.Vector3(0, 1, 0)
    // 50° from straight up, towards +z.
    const a = THREE.MathUtils.degToRad(50)
    const target = new THREE.Vector3(0.2, 1 + Math.cos(a) * 0.4, Math.sin(a) * 0.4)
    const { point, angle } = snapAngle(side, pivot, target, 15)
    expect(angle).toBe(45)
    expect(point.x).toBeCloseTo(0) // laid flat in the side plane through the pivot
    expect(point.clone().sub(pivot).length()).toBeCloseTo(0.4)
    expect(point.y - 1).toBeCloseTo(Math.cos(Math.PI / 4) * 0.4)
  })

  it('builds the drag plane facing the view axis', () => {
    const plane = planeThrough(side, new THREE.Vector3(0.3, 1, 0))
    expect(Math.abs(plane.normal.x)).toBeCloseTo(1)
    expect(plane.distanceToPoint(new THREE.Vector3(0.3, 5, -2))).toBeCloseTo(0)
  })
})
