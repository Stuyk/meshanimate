import { describe, it, expect } from 'vitest'
import { buildSavePayload, mergeWithDisk } from './blendDoc'
import { keysFingerprint, type ClipSource } from './studio'
import { keyTiming } from './preserve'
import type { Rig } from './rig'
import type { Clip } from './types'

const rig = { meta: { armature: 'Armature', fps: 25 }, rest: {} } as unknown as Rig
const clip = (id: string, name: string): Clip => ({
  id,
  name,
  start: 1,
  fps: 25,
  length: 10,
  keys: [{ id: `${id}k`, frame: 0, easing: 'bezier', pose: {} }]
})
const source = (c: Clip, action: string, inNla: boolean): ClipSource => ({
  action,
  start: c.start,
  length: c.length,
  keys: keysFingerprint(c),
  timing: keyTiming(c.keys),
  baked: [],
  inNla
})

describe('buildSavePayload', () => {
  it('sends nothing for untouched actions that are already in the NLA', () => {
    const a = clip('a', 'walk')
    const { payload, changes } = buildSavePayload(
      rig,
      [a],
      new Map([['a', source(a, 'walk', true)]])
    )
    expect(changes).toBe(0)
    expect(payload.clips).toHaveLength(0)
  })

  it('still saves when an action has no NLA track yet, and lists every clip for one', () => {
    const a = clip('a', 'test')
    const { payload, changes } = buildSavePayload(
      rig,
      [a],
      new Map([['a', source(a, 'test', false)]])
    )
    expect(changes).toBe(1)
    expect(payload.clips).toHaveLength(0)
    expect(payload.nla).toEqual(['test'])
  })

  it('renames, rewrites, adds and deletes only what changed', () => {
    const renamed = clip('r', 'walk-loop')
    const edited = { ...clip('e', 'idle'), length: 20 }
    const fresh = clip('n', 'jump')
    const sources = new Map([
      ['r', source(clip('r', 'walk'), 'walk', true)],
      ['e', source(clip('e', 'idle'), 'idle', true)],
      ['gone', source(clip('gone', 'old'), 'old', true)]
    ])
    const { payload } = buildSavePayload(rig, [renamed, edited, fresh], sources)
    expect(payload.renames).toEqual([['walk', 'walk-loop']])
    expect(payload.clips.map((c) => [c.name, c.source])).toEqual([
      ['idle', 'idle'],
      ['jump', null]
    ])
    expect(payload.deleted).toEqual(['old'])
    expect(payload.nla).toEqual(['walk-loop', 'idle', 'jump'])
  })
})

describe('mergeWithDisk', () => {
  it('keeps edits made here and takes everything else from disk', () => {
    const walk = clip('w', 'walk')
    const run = clip('r', 'run')
    const mySources = new Map([
      ['w', source(walk, 'walk', true)],
      ['r', source(run, 'run', true)]
    ])
    const myWalk = { ...walk, length: 30 } // edited here
    const diskRun = { ...clip('r2', 'run'), length: 12 } // edited in Blender
    const diskWalk = clip('w2', 'walk') // unchanged on disk
    const diskSources = new Map([
      ['w2', source(diskWalk, 'walk', true)],
      ['r2', source(diskRun, 'run', true)]
    ])
    const res = mergeWithDisk([myWalk, run, clip('n', 'jump')], mySources, {
      rig,
      clips: [diskWalk, diskRun],
      sources: diskSources,
      activeClipId: 'w2'
    })
    expect(res.clips.map((c) => [c.name, c.length])).toEqual([
      ['walk', 30],
      ['run', 12],
      ['jump', 10]
    ])
    expect(res.conflicts).toEqual([])
  })

  it('reports actions changed on both sides, keeping this app’s version', () => {
    const walk = clip('w', 'walk')
    const mySources = new Map([['w', source(walk, 'walk', true)]])
    const diskWalk = { ...clip('w2', 'walk'), length: 40 }
    const res = mergeWithDisk([{ ...walk, length: 30 }], mySources, {
      rig,
      clips: [diskWalk],
      sources: new Map([['w2', source(diskWalk, 'walk', true)]]),
      activeClipId: 'w2'
    })
    expect(res.conflicts).toEqual(['walk'])
    expect(res.clips[0].length).toBe(30)
  })

  it('drops actions deleted here', () => {
    const walk = clip('w', 'walk')
    const res = mergeWithDisk([], new Map([['w', source(walk, 'walk', true)]]), {
      rig,
      clips: [clip('w2', 'walk')],
      sources: new Map([['w2', source(clip('w2', 'walk'), 'walk', true)]]),
      activeClipId: 'w2'
    })
    expect(res.clips).toEqual([])
  })
})
