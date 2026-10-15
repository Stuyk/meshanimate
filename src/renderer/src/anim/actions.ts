import { studio } from './studio'
import { readPose, refreshLive, setLiveBasis, type Rig } from './rig'
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

/**
 * The bones whose channels decide how `name` looks. A bone that fully copies
 * another's rotation ignores its own, and an IK chain bone is turned by its
 * target and pole, so copying just the bone would leave its rotation behind.
 */
function controllingBones(rig: Rig, name: string): string[] {
  const out = new Set([name])
  const ik = [rig.ikDriven.get(name), ...rig.ik.filter((c) => c.owner === name)]
  for (const c of ik) {
    if (c) {
      out.add(c.target)
      if (c.pole) {
        out.add(c.pole)
      }
    }
  }
  for (const c of rig.copyRotation) {
    if (c.owner === name) {
      out.add(c.target)
    }
  }
  return [...out].filter((n) => rig.jointByName.has(n))
}

function copyBoneFrom(pose: Pose, jointName?: string): void {
  const rig = studio.rig()
  const name = jointName ?? studio.selectedJoint()
  if (!rig || !name) {
    return
  }
  const copied: Pose = {}
  for (const n of controllingBones(rig, name)) {
    copied[n] = pose[n] ?? rig.rest[n] ?? IDENTITY_JOINT
  }
  studio.setClipboardBone({ joint: name, pose: copied })
}

/** Copies one bone from the live pose (defaults to the selected bone). */
export function copyBoneChannels(jointName?: string): void {
  const rig = studio.rig()
  if (rig) {
    copyBoneFrom(readPose(rig), jointName)
  }
}

/** Copies one bone out of a stored key, without moving the playhead. */
export function copyBoneFromKey(keyId: string, jointName?: string): void {
  const key = studio.activeClip()?.keys.find((k) => k.id === keyId)
  if (key) {
    copyBoneFrom(key.pose, jointName)
  }
}

/**
 * Pastes the copied bone onto the same bone at a frame (the playhead by
 * default) and keys it there, leaving every other bone as it was. Pasting at
 * the playhead keeps the live pose, so unkeyed edits to other bones survive.
 */
export function pasteBoneChannels(frame = studio.frame()): void {
  const rig = studio.rig()
  const clip = studio.activeClip()
  const copied = studio.clipboardBone()
  if (!rig || !clip || !copied) {
    return
  }
  flushPendingCommit()
  const base =
    frame === studio.frame()
      ? readPose(rig)
      : (clip.keys.find((k) => k.frame === frame)?.pose ?? studio.poseAt(clip, frame))
  studio.setKey(frame, { ...base, ...copied.pose })
}

studio.onBeforeChange(flushPendingCommit)
