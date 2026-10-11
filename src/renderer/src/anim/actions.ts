import { studio } from './studio'
import { readPose, refreshLive, setLiveBasis } from './rig'
import { mirrorPose } from './manipulate'
import { alignHemispheres, IDENTITY_JOINT } from './pose'
import type { JointPose, Pose } from './types'

/**
 * The rig was posed by hand: key it if auto-key is on, otherwise leave the
 * pose live and flag it as unkeyed so the Key button lights up.
 */
export function commitLivePose(): void {
  const rig = studio.rig()
  if (!rig) {
    return
  }
  studio.bumpPose()
  if (studio.autoKey()) {
    studio.setKey(studio.frame(), readPose(rig))
    return
  }
  studio.setUnkeyed(true)
}

let pending: { frame: number; clipId: string; pose: Pose } | null = null
let commitTimer: ReturnType<typeof setTimeout> | undefined

/**
 * For scrubbable number fields: shows every change live but writes a single
 * undo step once the value settles, instead of one per pixel dragged. The
 * pose and frame are captured now, so scrubbing the timeline before the
 * timer fires can't key the edit onto the wrong frame.
 */
export function commitLivePoseSoon(): void {
  const rig = studio.rig()
  const clip = studio.activeClip()
  if (!rig || !clip) {
    return
  }
  studio.bumpPose()
  if (!studio.autoKey()) {
    studio.setUnkeyed(true)
    return
  }
  pending = { frame: studio.frame(), clipId: clip.id, pose: readPose(rig) }
  clearTimeout(commitTimer)
  commitTimer = setTimeout(flushPendingCommit, 300)
}

/** Writes a debounced edit now; runs before anything changes the frame or clip. */
export function flushPendingCommit(): void {
  clearTimeout(commitTimer)
  const p = pending
  pending = null
  if (!p || studio.activeClip()?.id !== p.clipId) {
    return
  }
  studio.setKey(p.frame, p.pose)
}

/** Puts a whole pose on the rig and commits it as one edit. */
export function setLivePose(pose: Pose): void {
  const rig = studio.rig()
  if (!rig) {
    return
  }
  setLiveBasis(rig, pose)
  commitLivePose()
}

/** Edits one bone's pose channels (inspector fields). */
export function setJointChannels(name: string, jp: JointPose): void {
  const rig = studio.rig()
  if (!rig) {
    return
  }
  rig.basis[name] = jp
  refreshLive(rig)
  commitLivePoseSoon()
}

/** Clears pose channels back to the bone's rest (Blender's Alt+G/R/S), one bone or all. */
export function resetToRest(jointName?: string): void {
  const rig = studio.rig()
  if (!rig) {
    return
  }
  const live = readPose(rig)
  for (const name of jointName ? [jointName] : Object.keys(rig.rest)) {
    live[name] = IDENTITY_JOINT
  }
  setLivePose(live)
}

export function mirrorLivePose(): void {
  const rig = studio.rig()
  const mirrored = rig ? mirrorOf(readPose(rig)) : null
  if (rig && mirrored) {
    setLivePose(alignHemispheres(mirrored, rig.basis))
  }
}

function mirrorOf(pose: Pose): Pose | null {
  const rig = studio.rig()
  if (!rig) {
    return null
  }
  return mirrorPose(
    {
      order: [...rig.jointByName.keys()],
      parentOf: rig.parentOf,
      restLocal: rig.restLocal,
      rest: rig.rest
    },
    pose
  )
}

/**
 * Walk-cycle helper: keys the mirror image of the pose at the playhead half a
 * cycle later (left step → right step), wrapping round the clip. In a cycle
 * whose last frame repeats its first, that duplicate frame is kept in step.
 * Returns the frame it keyed.
 */
export function mirrorToHalfCycle(): number | null {
  const rig = studio.rig()
  const clip = studio.activeClip()
  if (!rig || !clip) {
    return null
  }
  flushPendingCommit()
  const seamless = studio.isSeamless(clip)
  const period = seamless ? clip.length - 1 : clip.length
  const from = studio.frame()
  const target = (from + Math.round(period / 2)) % period
  const mirrored = mirrorOf(readPose(rig))
  if (!mirrored || target === from) {
    return null
  }
  studio.setKey(target, mirrored)
  if (seamless && target === 0) {
    studio.setKey(clip.length - 1, mirrored)
  }
  return target
}

export function copyLivePose(): void {
  const rig = studio.rig()
  if (rig) {
    studio.setClipboardPose(readPose(rig))
  }
}

export function pasteClipboardPose(): void {
  const pose = studio.clipboardPose()
  if (pose) {
    setLivePose(pose)
  }
}

studio.onBeforeChange(flushPendingCommit)
