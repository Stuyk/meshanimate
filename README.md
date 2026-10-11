<p align="center">
  <img src="build/icon.png" alt="MeshAnimate icon" width="128" height="128" />
</p>

<h1 align="center">MeshAnimate</h1>

<p align="center">
  <strong>Pivot-style pose-to-pose animation for rigged Blender characters.</strong>
</p>

<p align="center">
  <a href="https://github.com/stuyk/meshanimate/releases">
    <img src="https://img.shields.io/badge/Download-MeshAnimate-0084ff?style=for-the-badge" alt="Download MeshAnimate" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-GPL--3.0-10b981?style=for-the-badge" alt="GPL-3.0 License" />
  </a>
</p>

Open a `.blend`, drag a bone to pose it, move to another frame and pose again. MeshAnimate shows your poses on a simple timeline, shows the poses before and after as ghosts, and saves your animation back into the `.blend` as normal Blender actions.

<p align="center">
  <a href="https://www.youtube.com/watch?v=d1_FvcEW-b4">
    <img src="https://img.youtube.com/vi/d1_FvcEW-b4/maxresdefault.jpg" alt="Watch the MeshAnimate walkthrough on YouTube" width="80%" />
  </a>
  <br />
  <sub><a href="https://www.youtube.com/watch?v=d1_FvcEW-b4">Watch the one-minute video</a></sub>
</p>

<p align="center">
  <img src="docs/screenshots/posing.png" alt="Posing a rigged robot with onion skins" width="49%" />
  <img src="docs/screenshots/ik-snap.png" alt="Dragging an IK foot target onto the snap grid in side view" width="49%" />
</p>
<p align="center">
  <img src="docs/screenshots/timeline.png" alt="Timeline with a preview range and box-selected keys" width="49%" />
  <img src="docs/screenshots/reference.png" alt="Posing against a reference image" width="49%" />
</p>

## Features

- **Drag to pose.** Each bone has a handle at its end. Drag it to move the bone, like Pivot Stickfigure Animator. The orange square moves the whole rig.
- **IK.** Limbs that use Blender IK are posed by dragging the hand or foot. Poles point the knee and elbow. The result matches Blender.
- **Onion skin.** See the poses before and after the current frame as ghosts. You can also show the first frame as a ghost at all times.
- **Simple timeline.** One row of keys for the whole pose. Drag keys to move them, Alt+drag to copy, right-click for easing. Set a preview range to loop part of a clip.
- **Snapping.** In front, side or top view, handles snap to a grid and bones turn in fixed steps.
- **Walk cycles.** Mirror a pose, or key the mirrored pose half a cycle later with one key.
- **Reference.** Put an image or video behind the model. Videos follow the playhead.
- **Plays like Blender.** Playback uses the same curves and easing as Blender. The tests check this against Blender.

## Saving

- Before each save, the `.blend` is copied to `.meshanimate-backups/` next to it. The last 20 copies are kept.
- Only the actions you changed are saved, and only the bones you changed in them. The rest of the file is not touched.
- New actions get a fake user and their own NLA track. Renaming a clip renames its track.
- If the file is saved in Blender while it's open here, MeshAnimate notices. It reloads if you have no unsaved work. If you do, it asks whether to merge.

## Requirements

- [Blender](https://www.blender.org/download/), tested with 5.2. Older 4.x versions may work but are untested. MeshAnimate runs Blender in the background to open and save `.blend` files. It finds Blender on its own, or you can set the path in Preferences.
- A `.blend` with an armature. Skinned meshes and parts parented to bones both work.

Some rigs move the mesh with other constraints, like Rigify's Copy Transforms, Stretch To or drivers. You can still animate and save them, but the preview may not match Blender exactly. MeshAnimate tells you when this is the case.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Previous / next frame |
| Shift+← / → | Previous / next key |
| K | Key the current pose |
| M | Mirror pose |
| Shift+M | Mirror to half-cycle |
| S | Snapping on / off (hold Ctrl to switch it for one drag) |
| Num 1 / 3 / 7 | Front / side / top view (Ctrl: opposite side) |
| [ / ] | Preview range start / end |
| \\ | Clear preview range |
| Q / E / W | Pose / rotate / move tool |
| O | Onion skin |
| Shift+O | First-frame ghost |
| Ctrl+S | Save into the .blend |

Press `?` in the app for the full list.

## Building from source

```bash
bun install        # or npm install
bun run dev        # run with hot reload
bun run test       # unit tests
bun run build:linux   # or build:win / build:mac
```

Built with Electron, Solid and three.js. The Blender scripts are in `resources/blender/`: one loads a `.blend`, one saves actions to it. The app is in `src/`.

## Translations

All app text is in [src/shared/i18n/en.ts](src/shared/i18n/en.ts). To add a language, copy that file (for example to `de.ts`), translate the values, and add it to `dictionaries` in [src/shared/i18n/index.ts](src/shared/i18n/index.ts). The app picks the system language when it has a translation for it, and falls back to English for anything missing.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
