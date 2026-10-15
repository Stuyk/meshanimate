"""
MeshAnimate: read a .blend for animating.

Run as:  blender -b file.blend --python meshanimate_load.py -- <out_dir>

Writes <out_dir>/model.glb (the rig and its meshes at rest, for display only)
and <out_dir>/meta.json (bones, rest matrices, constraints, actions). Nothing
is saved back to the .blend; every change made here is in memory only.

Pose values are Blender's own pose-bone channels (matrix_basis: location,
rotation as a quaternion, scale), so what MeshAnimate keys is exactly what
Blender plays back.
"""

import bpy
import json
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
out_dir = argv[0]
os.makedirs(out_dir, exist_ok=True)

scene = bpy.context.scene

# A file saved in Edit Mode keeps its bone changes in edit bones until Edit
# Mode is left. Leave it now (in memory only): otherwise the bones read below
# are out of date, and the exporter leaves Edit Mode itself, rebuilding the
# bones and losing the name tags set on them further down.
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")

POSE_CHANNELS = ("location", "rotation_quaternion", "rotation_euler", "rotation_axis_angle", "scale")


def fail(msg):
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump({"error": msg}, f)
    sys.exit(0)


armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
if not armatures:
    fail("This .blend has no armature. Rig the mesh in Blender (add an Armature and parent the mesh to it), then open it again.")


def mesh_users(arm):
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        parented = o.parent == arm
        modded = any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)
        if parented or modded:
            out.append(o)
    return out


# The armature that actually drives geometry wins; ties go to the bigger rig.
arm = max(armatures, key=lambda a: (len(mesh_users(a)) > 0, len(a.data.bones)))


def iter_fcurves(action):
    """All F-curves of an action, for both the legacy and the layered (4.4+/5.x) API."""
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    for fc in bag.fcurves:
                        yield fc
    if hasattr(action, "fcurves"):
        try:
            for fc in action.fcurves:
                yield fc
        except Exception:
            pass


def bone_channel(fc):
    """('BoneName', 'rotation_quaternion') for pose-bone F-curves, else None."""
    path = fc.data_path
    if not path.startswith('pose.bones["'):
        return None
    end = path.find('"]')
    if end < 0:
        return None
    name = path[len('pose.bones["'):end].replace('\\"', '"')
    prop = path[end + 3:]
    if prop not in POSE_CHANNELS:
        return None
    return name, prop


bone_names = {b.name for b in arm.data.bones}


def stored_channels(pb):
    """The pose values saved in the file: what a bone shows when an action doesn't key it."""
    from mathutils import Quaternion
    if pb.rotation_mode == "QUATERNION":
        q = pb.rotation_quaternion.copy()
    elif pb.rotation_mode == "AXIS_ANGLE":
        a, x, y, z = pb.rotation_axis_angle
        q = Quaternion((x, y, z), a)
    else:
        q = pb.rotation_euler.to_quaternion()
    return {
        "location": list(pb.location),
        "rotation_quaternion": [q.w, q.x, q.y, q.z],
        "rotation_euler": list(pb.rotation_euler),
        "rotation_axis_angle": list(pb.rotation_axis_angle),
        "scale": list(pb.scale),
    }


# Read before anything below touches the pose.
STORED = {pb.name: stored_channels(pb) for pb in arm.pose.bones}


def stored_pose_of(name):
    st = STORED[name]
    w, x, y, z = st["rotation_quaternion"]
    q = [x, y, z, w]
    norm = math.sqrt(sum(v * v for v in q)) or 1
    j = {"r": [v / norm for v in q], "p": st["location"]}
    if any(abs(v - 1) > 1e-6 for v in st["scale"]):
        j["s"] = st["scale"]
    return j


def mat_rows(m):
    return [list(r) for r in m]


def hidden_in_blender(b):
    """Hidden per bone, or because every bone collection it sits in is hidden (4.0+)."""
    if b.hide:
        return True
    collections = list(getattr(b, "collections", []))
    if not collections:
        return False
    def visible(c):
        return getattr(c, "is_visible_effectively", getattr(c, "is_visible", True))
    return not any(visible(c) for c in collections)


bones = []
for b in arm.data.bones:
    pb = arm.pose.bones[b.name]
    constraints = []
    for c in pb.constraints:
        entry = {"type": c.type, "name": c.name, "mute": c.mute, "influence": c.influence}
        if c.type == "IK":
            entry.update({
                "target": c.target.name if c.target else None,
                "subtarget": c.subtarget or None,
                "poleTarget": c.pole_target.name if c.pole_target else None,
                "poleSubtarget": c.pole_subtarget or None,
                "poleAngle": c.pole_angle,
                "chainCount": c.chain_count,
                "useTail": c.use_tail,
                "iterations": c.iterations,
                "useRotation": c.use_rotation,
                "sameArmature": c.target == arm,
            })
        elif c.type == "COPY_ROTATION":
            entry.update({
                "target": c.target.name if c.target else None,
                "subtarget": c.subtarget or None,
                "sameArmature": c.target == arm,
                "ownerSpace": c.owner_space,
                "targetSpace": c.target_space,
                "mixMode": c.mix_mode,
                "useAxes": [c.use_x, c.use_y, c.use_z],
                "invertAxes": [c.invert_x, c.invert_y, c.invert_z],
            })
        constraints.append(entry)
    bones.append({
        "name": b.name,
        "parent": b.parent.name if b.parent else None,
        "length": b.length,
        "deform": b.use_deform,
        "hidden": hidden_in_blender(b),
        "rotationMode": pb.rotation_mode,
        "ikLock": [pb.lock_ik_x, pb.lock_ik_y, pb.lock_ik_z],
        "matrixLocal": mat_rows(b.matrix_local),
        "constraints": constraints,
    })


def basis_at(channels, mode, frame, stored):
    """Evaluates one bone's pose channels at a frame → (loc, quat xyzw, scale)."""
    from mathutils import Euler, Quaternion

    def val(prop, n, default):
        # Channels the action doesn't key keep the file's stored value.
        out = list(stored.get(prop, default))
        for i in range(n):
            fc = channels.get((prop, i))
            if fc is not None:
                out[i] = fc.evaluate(frame)
        return out

    loc = val("location", 3, (0, 0, 0))
    scl = val("scale", 3, (1, 1, 1))
    if mode == "QUATERNION":
        w, x, y, z = val("rotation_quaternion", 4, (1, 0, 0, 0))
        q = Quaternion((w, x, y, z))
    elif mode == "AXIS_ANGLE":
        a, x, y, z = val("rotation_axis_angle", 4, (0, 0, 1, 0))
        q = Quaternion((x, y, z), a)
    else:
        q = Euler(val("rotation_euler", 3, (0, 0, 0)), mode).to_quaternion()
    if q.magnitude > 1e-9:
        q.normalize()
    return loc, [q.x, q.y, q.z, q.w], scl


INTERP = {"CONSTANT": "step", "LINEAR": "linear", "BEZIER": "bezier"}
EASED = {"EASE_IN": "easeIn", "EASE_OUT": "easeOut", "EASE_IN_OUT": "easeInOut"}


def easing_of(kp):
    if kp.interpolation in INTERP:
        return INTERP[kp.interpolation]
    # Penner curves: cubic is reproduced exactly, the rest approximately.
    e = kp.easing
    if e == "AUTO":
        e = "EASE_IN" if kp.interpolation in ("BACK", "BOUNCE", "ELASTIC") else "EASE_IN_OUT"
    return EASED.get(e, "easeInOut")


nla_actions = set()
if arm.animation_data:
    for track in arm.animation_data.nla_tracks:
        for strip in track.strips:
            if strip.action:
                nla_actions.add(strip.action.name)

actions = []
for action in bpy.data.actions:
    per_bone = {}
    for fc in iter_fcurves(action):
        ch = bone_channel(fc)
        if ch is None or ch[0] not in bone_names:
            continue
        per_bone.setdefault(ch[0], {})[(ch[1], fc.array_index)] = fc
    if not per_bone:
        continue

    key_frames = {}
    for chans in per_bone.values():
        for fc in chans.values():
            for kp in fc.keyframe_points:
                f = int(round(kp.co[0]))
                key_frames.setdefault(f, []).append(easing_of(kp))
    if not key_frames:
        continue

    start, end = action.frame_range
    start = int(math.floor(start))
    end = int(math.ceil(end))
    first_key, last_key = min(key_frames), max(key_frames)
    start = min(start, first_key)
    end = max(end, last_key, start + 1)

    def pose_at(frame):
        pose = {}
        for name, chans in per_bone.items():
            mode = arm.pose.bones[name].rotation_mode
            loc, quat, scl = basis_at(chans, mode, frame, STORED[name])
            j = {"r": quat, "p": loc}
            if any(abs(s - 1) > 1e-6 for s in scl):
                j["s"] = scl
            pose[name] = j
        return pose

    keys = []
    for f in sorted(key_frames):
        votes = key_frames[f]
        easing = max(set(votes), key=votes.count)
        keys.append({"frame": f - start, "easing": easing, "pose": pose_at(f)})

    actions.append({
        "name": action.name,
        "inNla": action.name in nla_actions,
        "start": start,
        "length": end - start + 1,
        "cyclic": bool(getattr(action, "use_cyclic", False)),
        "keys": keys,
        # Blender's own evaluation of every frame, so an untouched clip
        # previews exactly as Blender plays it (Bézier handles, modifiers…).
        "baked": [pose_at(f) for f in range(start, end + 1)],
    })

meta = {
    "blenderVersion": bpy.app.version_string,
    "fps": scene.render.fps / (scene.render.fps_base or 1),
    "frameStart": scene.frame_start,
    "armature": arm.name,
    "armatureMatrix": mat_rows(arm.matrix_world),
    "bones": bones,
    # Pose of every bone as stored in the file: what bones an action doesn't
    # key show in Blender.
    "storedPose": {name: stored_pose_of(name) for name in STORED},
    "actions": actions,
    "activeAction": arm.animation_data.action.name if arm.animation_data and arm.animation_data.action else None,
}

# --- display model --------------------------------------------------------
# Everything below only shapes the temporary glTF; the .blend is never saved.
if arm.animation_data:
    arm.animation_data.action = None
    for track in arm.animation_data.nla_tracks:
        track.mute = True
for pb in arm.pose.bones:
    pb.matrix_basis.identity()

# Tag every bone with its real name: glTF loaders strip the "." from names
# like "Arm.L", and mesh objects named after bones collide with them.
for b in arm.data.bones:
    b["meshanimate_name"] = b.name
    arm.pose.bones[b.name]["meshanimate_name"] = b.name

keep = [arm] + mesh_users(arm)
for o in bpy.data.objects:
    o.select_set(o in keep)
bpy.context.view_layer.objects.active = arm

bpy.ops.export_scene.gltf(
    filepath=os.path.join(out_dir, "model.glb"),
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_apply=True,
    export_extras=True,
    export_def_bones=False,
)

with open(os.path.join(out_dir, "meta.json"), "w") as f:
    json.dump(meta, f)
print("MESHANIMATE_OK")
