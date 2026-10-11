# Changelog

## v0.1.0

The first release of MeshAnimate: pose-to-pose animation for rigged Blender characters, built on the interface of the MeshCoat texture painter.

### Animate
- Pivot-style posing: drag a handle at the tip of any bone to swing it; drag the root square to move the rig. FK reach of 2 or 3 bones, plus rotate and move gizmos for fine control.
- Blender IK is evaluated live: drag the foot/hand ring to move the IK target, the knee/elbow to swing the pole. Matches Blender's solver to within half a degree.
- Whole-pose keys with auto-key, Blender's easing options (Auto Bézier, Linear, Ease In/Out, Hold), copy/paste pose, mirror pose, and mirror-to-half-cycle for walk cycles.
- Onion skin of neighbouring keys or every Nth frame, with configurable colours.
- First-frame ghost (Shift+O): a pinned ghost of the clip's starting pose, visible at every frame and during playback.
- Snapping in the view's side, front or top plane: grid points for handles, angle steps for swinging bones. Numpad view keys as in Blender.
- Timeline with box selection, drag-to-retime, Alt+drag copy, per-bone motion row, preview range, and Blender frame numbering.
- Reference image or video behind the model; video is frame-synced to the playhead.
- Clip list with stick-figure thumbnails; double-click a bone in the skeleton list to frame it.

### Blender files
- Opens `.blend` files directly (Blender runs in the background); every action becomes a clip with its real keyframes, at the scene's frame rate.
- Saves back into the `.blend`: only changed actions, and within them only changed bones, are rewritten. New actions get a fake user and an NLA track; renames carry to tracks and strips.
- Timestamped backup before every save; a failed save leaves the file untouched.
- Detects when the file is saved elsewhere (e.g. in Blender): reloads on its own when there's no unsaved work here, otherwise offers merge / reload / keep mine.
- Respects Blender's hidden bones and bone collections; reports constraints the preview can't evaluate.
- Autosave recovery after a crash.
