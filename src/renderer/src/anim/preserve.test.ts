import { describe, it, expect } from 'vitest'
import { keyTiming, preservedBones } from './preserve'
import type { ClipSource } from './studio'
import type { Clip, Pose } from './types'

const rest: Pose = {
  arm: { r: [0, 0, 0, 1], p: [0, 0, 0] },
  leg: { r: [0, 0, 0, 1], p: [0, 0, 0] }
}
// What Blender evaluates for frames 0..4: the arm sweeps, the leg holds.
const baked: Pose[] = [0, 1, 2, 3, 4].map((f) => ({
  arm: { r: [0, 0, Math.sin(f / 10), Math.cos(f / 10)], p: [0, 0, 0] },
  leg: { r: [0, 0, 0, 1], p: [0, 0.1, 0] }
}))
const original: Clip = {
  id: 'c',
  name: 'walk',
  start: 1,
  fps: 25,
  length: 5,
  keys: [0, 4].map((f) => ({ id: `k${f}`, frame: f, easing: 'bezier', pose: baked[f] }))
}
const src: ClipSource = {
  action: 'walk',
  start: 1,
  length: 5,
  keys: '',
  timing: keyTiming(original.keys),
  baked,
  inNla: true
}

describe('preservedBones', () => {
  it('keeps every bone a new key leaves where Blender had it', () => {
    const edited: Clip = {
      ...original,
      keys: [
        ...original.keys,
        {
          id: 'n',
          frame: 2,
          easing: 'bezier',
          pose: { ...baked[2], arm: { r: [0, 0, 0.5, 0.866], p: [0, 0, 0] } }
        }
      ]
    }
    expect([...preservedBones(edited, src, rest)!]).toEqual(['leg'])
  })

  it('rewrites everything when an original key moved, was deleted or re-eased', () => {
    const moved = { ...original, keys: [original.keys[0], { ...original.keys[1], frame: 3 }] }
    const deleted = { ...original, keys: [original.keys[0]] }
    const eased = {
      ...original,
      keys: [original.keys[0], { ...original.keys[1], easing: 'linear' as const }]
    }
    expect(preservedBones(moved, src, rest)).toBeNull()
    expect(preservedBones(deleted, src, rest)).toBeNull()
    expect(preservedBones(eased, src, rest)).toBeNull()
  })

  it('rewrites everything when the clip length changes', () => {
    expect(preservedBones({ ...original, length: 8 }, src, rest)).toBeNull()
  })
})
