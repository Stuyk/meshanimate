import { describe, it, expect } from 'vitest'
import fixture from './__fixtures__/blender-autoclamped.json'
import { sampleClip } from './pose'
import type { Clip, Pose } from './types'

/**
 * Keys written by meshanimate_save.py, read back from the .blend together
 * with Blender's own evaluation of every frame. The preview must match what
 * Blender plays, or what you animate isn't what you get.
 */
describe('preview matches Blender playback', () => {
  for (const action of fixture as unknown as {
    name: string
    length: number
    keys: Clip['keys']
    baked: Pose[]
  }[]) {
    it(action.name, () => {
      const rest: Pose = {}
      for (const name of Object.keys(action.baked[0])) {
        rest[name] = { r: [0, 0, 0, 1], p: [0, 0, 0] }
      }
      const clip: Clip = {
        id: 'c',
        name: action.name,
        start: 1,
        fps: 25,
        length: action.length,
        keys: action.keys
      }
      let worstRot = 0
      let worstPos = 0
      action.baked.forEach((truth, f) => {
        const got = sampleClip(clip, f, rest)
        for (const [name, t] of Object.entries(truth)) {
          const g = got[name]
          // Component distance, sign-agnostic: an acos-based angle bottoms out
          // around 0.05° on Blender's 32-bit floats and would hide nothing.
          const same = Math.max(...t.r.map((v, i) => Math.abs(v - g.r[i])))
          const flip = Math.max(...t.r.map((v, i) => Math.abs(v + g.r[i])))
          worstRot = Math.max(worstRot, Math.min(same, flip))
          worstPos = Math.max(
            worstPos,
            Math.hypot(t.p[0] - g.p[0], t.p[1] - g.p[1], t.p[2] - g.p[2])
          )
        }
      })
      expect(worstRot).toBeLessThan(1e-4)
      expect(worstPos).toBeLessThan(1e-4)
    })
  }
})
