# Changelog

## v1.0.2

### Changes
- The preview now plays Copy Rotation constraints between bones of the rig (World or Pose space, Replace, all axes), so hands and feet that follow their IK controllers show the way Blender shows them. Before, they played their own keys and pointed the wrong way, and Copy Rotation was listed as unsupported.
- Rotating a hand or foot that copies its IK controller's rotation now turns the controller, so the turn stays. Before, the constraint undid it.
- You can copy one bone from a keyframe and paste it into another keyframe. Other bones don't change, except the IK and Copy Rotation controllers that drive it, which come along so the bone's rotation copies too. Use Copy / Paste in the Bone panel, Ctrl+Shift+C / Ctrl+Shift+V, or right-click a key on the timeline.

### Fixes
- New clips are now added to the NLA editor as muted tracks. Before, if any track in the file was unmuted, the new track was too, and it played on top of everything in Blender and game importers.

## v1.0.1

### Fixes
- Files saved in Blender while in Edit Mode now open. Before, they failed with "Bones missing from the display model".

## v1.0.0

### Changes
- All app text is in one translation file (`src/shared/i18n/en.ts`). New languages can be added by copying it. The app uses the system language when a translation exists, and English otherwise.
- Rewrote the text across the app, README and website in plain language.
- Added a one-minute video to the website and README.

### Fixes
- The recovery dialog (Wait / Reload / Quit) no longer depends on its English button labels.
- The bone row on the timeline now shows Blender frame numbers in its tooltips, like the rest of the timeline.

### Removed
- The sample `robot.blend` and old backups are no longer in the repository.

## v0.1.0

First release of MeshAnimate: pose-to-pose animation for rigged Blender characters. It is built on the interface of the MeshCoat texture painter.

### Animate
- Drag a handle at the end of a bone to move it. Drag the root square to move the whole rig. Move 1, 2 or 3 bones at once, or use the rotate and move tools.
- Blender IK works in the viewport. Drag the foot or hand ring to move the IK target, or the knee or elbow to move the pole. Results match Blender.
- Whole-pose keys with auto-key, Blender's easing options (Auto Bézier, Linear, Ease In/Out, Hold), copy and paste pose, mirror pose, and mirror to half-cycle for walk cycles.
- Onion skin for the keys before and after, or every Nth frame, with your own colours.
- First-frame ghost (Shift+O): shows the clip's first frame at all times, including during playback.
- Snapping in the front, side or top view: handles snap to a grid and bones turn in fixed steps. Numpad view keys work like in Blender.
- Timeline with box select, drag to move keys, Alt+drag to copy, a row for the selected bone, a preview range, and Blender frame numbers.
- Reference image or video behind the model. Videos follow the playhead.
- Clip list with thumbnails. Double-click a bone in the skeleton list to frame it.

### Blender files
- Opens `.blend` files directly, using Blender in the background. Each action becomes a clip with its own keys, at the scene's frame rate.
- Saves back into the `.blend`. Only changed actions are saved, and only the changed bones in them. New actions get a fake user and an NLA track. Renaming a clip renames its track.
- Makes a backup before every save. If a save fails, the file is not changed.
- Notices when the file is saved somewhere else, like in Blender. Reloads if you have no unsaved work. Otherwise asks whether to merge, reload or keep your version.
- Respects hidden bones and bone collections from Blender. Lists constraints the preview can't show.
- Restores unsaved work after a crash.
