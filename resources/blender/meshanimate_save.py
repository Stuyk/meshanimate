"""
MeshAnimate: write animation clips back into a .blend as actions.

Run as:  blender -b file.blend --python meshanimate_save.py -- <payload.json> <out.blend>

The caller (MeshAnimate's main process) has already copied the original file
to a backup. Only clips listed in the payload are rewritten; every other
action, the rig, meshes, materials and NLA tracks are left untouched.

Payload:
{
  "armature": "Armature",
  "fps": 25,                       # written to the scene only if it changed
  "clips": [{
      "name": "walk",              # action name to write
      "source": "walk" | null,     # existing action this clip came from
      "start": 1,                  # Blender frame of clip frame 0
      "length": 32,
      "keys": [{"frame": 0, "easing": "bezier", "pose": {bone: {"r":[x,y,z,w], "p":[...], "s":[...]}}}]
  }],
  "renames": [["old", "new"]],     # name-only changes
  "deleted": ["old action"]
}
"""

import bpy
import json
import sys
from mathutils import Euler, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
payload_path, out_path = argv[0], argv[1]
with open(payload_path) as f:
    payload = json.load(f)

arm = bpy.data.objects.get(payload["armature"])
if arm is None or arm.type != "ARMATURE":
    raise SystemExit("MESHANIMATE_ERR armature not found: %s" % payload["armature"])

scene = bpy.context.scene
POSE_CHANNELS = ("location", "rotation_quaternion", "rotation_euler", "rotation_axis_angle", "scale")
EASINGS = {
    "linear": ("LINEAR", None),
    "step": ("CONSTANT", None),
    "bezier": ("BEZIER", None),
    "easeInOut": ("CUBIC", "EASE_IN_OUT"),
    "easeIn": ("CUBIC", "EASE_IN"),
    "easeOut": ("CUBIC", "EASE_OUT"),
}


def channelbag_for(action):
    """The F-curve container for this armature in an action (layered API on 4.4+, legacy before)."""
    if not hasattr(action, "slots"):
        return action
    slot = None
    for s in action.slots:
        if s.target_id_type == "OBJECT":
            slot = s
            break
    if slot is None:
        slot = action.slots.new(id_type="OBJECT", name=arm.name)
    from bpy_extras import anim_utils
    return anim_utils.action_ensure_channelbag_for_slot(action, slot)


def curve_bone(fc):
    path = fc.data_path
    if not path.startswith('pose.bones["') or path.rsplit(".", 1)[-1] not in POSE_CHANNELS:
        return None
    return path[len('pose.bones["'):path.find('"]')].replace('\\"', '"')


def clear_bone_curves(action, keep=()):
    """Removes pose-channel curves, except those of bones in `keep`."""
    bag = channelbag_for(action)
    keep = set(keep)
    doomed = [fc for fc in bag.fcurves if curve_bone(fc) is not None and curve_bone(fc) not in keep]
    for fc in doomed:
        bag.fcurves.remove(fc)
    return bag


def write_curve(bag, bone, prop, index, points):
    """points: [(frame, value, easing)]"""
    path = 'pose.bones["%s"].%s' % (bone.replace('"', '\\"'), prop)
    fc = bag.fcurves.new(path, index=index, group_name=bone)
    # Keep Blender's handle maths identical to MeshAnimate's preview.
    fc.auto_smoothing = "NONE"
    fc.keyframe_points.add(len(points))
    for kp, (frame, value, easing) in zip(fc.keyframe_points, points):
        interp, ease = EASINGS.get(easing, EASINGS["bezier"])
        kp.co = (frame, value)
        kp.interpolation = interp
        if ease:
            kp.easing = ease
        kp.handle_left_type = "AUTO_CLAMPED"
        kp.handle_right_type = "AUTO_CLAMPED"
    fc.update()


def write_clip(clip):
    action = bpy.data.actions.get(clip["source"]) if clip.get("source") else None
    if action is None:
        action = bpy.data.actions.new(clip["name"])
        bag = channelbag_for(action)
    else:
        # Bones the edit didn't touch keep their original curves exactly.
        bag = clear_bone_curves(action, clip.get("preserve", []))
        if action.name != clip["name"]:
            rename_action(action, clip["name"])
    # An action nothing uses is dropped on save unless it has a fake user.
    action.use_fake_user = True

    start = clip["start"]
    keys = sorted(clip["keys"], key=lambda k: k["frame"])
    preserved = set(clip.get("preserve", []))
    bones = sorted({name for k in keys for name in k["pose"]} - preserved)
    for name in bones:
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        mode = pb.rotation_mode
        loc = [[], [], []]
        scl = [[], [], []]
        rot = [[], [], [], []]
        prev_q = None
        prev_e = None
        for k in keys:
            jp = k["pose"].get(name)
            if jp is None:
                continue
            frame = start + k["frame"]
            easing = k["easing"]
            for i in range(3):
                loc[i].append((frame, jp["p"][i], easing))
                scl[i].append((frame, (jp.get("s") or [1, 1, 1])[i], easing))
            x, y, z, w = jp["r"]
            q = Quaternion((w, x, y, z))
            # Same hemisphere as the previous key, so per-channel
            # interpolation takes the short way round (as the preview does).
            if prev_q is not None and prev_q.dot(q) < 0:
                q.negate()
            prev_q = q
            if mode == "QUATERNION":
                for i, v in enumerate((q.w, q.x, q.y, q.z)):
                    rot[i].append((frame, v, easing))
            elif mode == "AXIS_ANGLE":
                axis, angle = q.to_axis_angle()
                for i, v in enumerate((angle, axis.x, axis.y, axis.z)):
                    rot[i].append((frame, v, easing))
            else:
                e = q.to_euler(mode, prev_e) if prev_e is not None else q.to_euler(mode)
                prev_e = e
                for i in range(3):
                    rot[i].append((frame, e[i], easing))
        for i in range(3):
            write_curve(bag, name, "location", i, loc[i])
            write_curve(bag, name, "scale", i, scl[i])
        if mode == "QUATERNION":
            prop, count = "rotation_quaternion", 4
        elif mode == "AXIS_ANGLE":
            prop, count = "rotation_axis_angle", 4
        else:
            prop, count = "rotation_euler", 3
        for i in range(count):
            write_curve(bag, name, prop, i, rot[i])

    # Pin the range so holds after the last key survive.
    action.use_frame_range = True
    action.frame_start = start
    action.frame_end = start + clip["length"] - 1

    # NLA strips playing this action follow its new length.
    if arm.animation_data:
        for track in arm.animation_data.nla_tracks:
            for strip in track.strips:
                if strip.action == action:
                    strip.action_frame_start = action.frame_start
                    strip.action_frame_end = action.frame_end
    return action


def rename_action(action, new):
    """Renames an action, and the NLA track/strips that carry its name with it."""
    old = action.name
    action.name = new
    if not arm.animation_data:
        return
    for track in arm.animation_data.nla_tracks:
        named_after = track.name == old
        for strip in track.strips:
            if strip.action == action and strip.name == old:
                strip.name = action.name
                named_after = named_after or len(track.strips) == 1
        if named_after and all(st.action == action for st in track.strips):
            track.name = action.name


def armature_slot(action):
    if not hasattr(action, "slots"):
        return None
    for s in action.slots:
        if s.target_id_type == "OBJECT":
            return s
    return None


def ensure_nla_track(action):
    """
    Every animation MeshAnimate manages gets a track on the armature, the
    way Blender's Stash and most game-export setups lay them out: one track
    per action, named after it, one strip at the action's first frame.
    New tracks are always muted, like Blender's Stash: an unmuted track
    plays on every frame and would change what the file shows in Blender
    and in game importers. Blend and extrapolation copy the rig's existing
    strips so the track behaves like its neighbours once you unmute it.
    """
    ad = arm.animation_data or arm.animation_data_create()
    for track in ad.nla_tracks:
        if any(s.action == action for s in track.strips):
            return False
    template = next((s for t in ad.nla_tracks for s in t.strips), None)
    track = ad.nla_tracks.new()
    track.name = action.name
    track.mute = True
    start, _end = action.frame_range
    strip = track.strips.new(action.name, int(round(start)), action)
    if hasattr(strip, "action_slot") and strip.action_slot is None:
        slot = armature_slot(action)
        if slot is not None:
            strip.action_slot = slot
    if template is not None:
        strip.blend_type = template.blend_type
        strip.extrapolation = template.extrapolation
    else:
        strip.extrapolation = "HOLD"
    return True


# Deletes first, so a clip may take over the name of an action it replaces.
for name in payload.get("deleted", []):
    a = bpy.data.actions.get(name)
    if a is None:
        continue
    if arm.animation_data:
        for track in list(arm.animation_data.nla_tracks):
            if track.strips and all(s.action == a for s in track.strips):
                arm.animation_data.nla_tracks.remove(track)
        if arm.animation_data.action == a:
            arm.animation_data.action = None
    bpy.data.actions.remove(a)

for old, new in payload.get("renames", []):
    a = bpy.data.actions.get(old)
    if a is not None:
        rename_action(a, new)

for clip in payload.get("clips", []):
    write_clip(clip)

# Every clip's action shows up in the armature's NLA editor.
added = []
for name in payload.get("nla", []):
    a = bpy.data.actions.get(name)
    if a is not None and ensure_nla_track(a):
        added.append(name)
if added:
    print("MESHANIMATE_NLA_ADDED " + "|".join(added))

fps = payload.get("fps")
if fps and abs(scene.render.fps / (scene.render.fps_base or 1) - fps) > 1e-6:
    scene.render.fps = int(round(fps))
    scene.render.fps_base = 1

# MeshAnimate keeps its own timestamped backups; no stray .blend1 files.
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=out_path, check_existing=False, copy=False)
print("MESHANIMATE_OK")
