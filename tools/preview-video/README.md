# Preview videos

Beat-synced promo videos of MeshAnimate, built from real captures of the running app.
Adapted from the `promo-video` tool in op-frontend (`video-builder-cms` branch).

## How it works

| File | Role |
|---|---|
| `analyze-music.py` | Measures a track's beat grid (BPM, bar-0 downbeat, per-bar energy) with numpy/scipy, to build a scene's `at(bar, beat)` grid from |
| `capture.mjs` | Drives the built app on a **copy** of a .blend with a throwaway profile; writes stills, drag/playback flipbooks and the on-screen box of every clicked element → `assets/` |
| `engine.js` | Animation engine: queues CSS animations, app-window/camera helpers (`appWindow`, `showShot`, `focus`), seek hooks for the renderer |
| `scene-sizzle.html` | **Sizzle** (56 s walkthrough, seven chapters) on `Synthpop The Arcade Cut 60.wav` |
| `render.mjs` | Pauses every animation, seeks frame by frame across several browser processes, encodes with ffmpeg + music + SFX |
| `reference.png` | The sketch the reference-image shot uses |

Accuracy rules the scene follows: every screen is a real capture; during a drag the
pointer is drawn exactly where the mouse was when that frame was shot; clicks land on
boxes recorded at capture time (`window.CAPTURE.boxes`).

## Run it

Needs ffmpeg, Blender (the app needs it to open the .blend), a Playwright Chromium
(`npx playwright install chromium`), and on Linux without a desktop, `xvfb-run`.

```bash
npm run build                                          # capture drives the built app
npm run preview:capture -- path/to/robot.blend         # ~1.5 min → assets/
npm run preview:render                                 # → tools/preview-video/meshanimate-sizzle.mp4 (~2 min)
node tools/preview-video/render.mjs --fps 30           # faster draft
node tools/preview-video/render.mjs --stills 2,9.5     # review stills → .stills/
node tools/preview-video/render.mjs --remix            # rebuild only the audio
```

From a VS Code terminal, run the capture with `env -u ELECTRON_RUN_AS_NODE` — VS Code sets it,
and Electron then starts as plain Node and fails to launch.

Open `scene-sizzle.html?play` in a browser to watch it live (no audio).

The shots are written for the sample robot rig (its clip names `walk-full`, `idle-full`…
and bones `LowerArrm.L`, `Shin.L`). Filming another rig means updating those names in
`capture.mjs`.

## Music and sync

The scene's grid comes from `analyze-music.py "Synthpop The Arcade Cut 60.wav"`:
139.988 BPM, bar 0 at 0.040 s, phrases of eight bars (bars 7/15/23/31 are the
lighter turnarounds), the song's ending at bar 32 (54.9 s). The video plays the song
from the top (`PREVIEW_MUSIC_START = 0`) and ends with its own ending.

Chapters sit on bar boundaries, each long enough for its action to play out at a
readable pace:

| Bars | Chapter |
|---|---|
| 0–1 | Title |
| 2–5 | 1 Open — click Open, the load report, click run-full and it plays with its keys |
| 6–10 | 2 Walk cycle — new clip, side view (3), contact pose: feet and arms |
| 11–16 | 3 Walk cycle — Shift+M mirrors the step to frame 13, scrub with onion skin, passing pose, Shift+M again |
| 17–18 | 4 Playback — the walk loops in side view |
| 19–22 | 5 Blender IK — S for snapping, drop the hips (feet stay planted), set a foot on the 5 cm grid |
| 23–26 | 6 Timing — retime the passing key, click onion skin, click the first-frame ghost, scrub |
| 27–29 | 7 Save — Ctrl+S, backup toast, the new clip in the list (an NLA track in Blender) |
| 30–31 | End card |

For another track: run the analyzer, set `BPM`, `T0`, `START_BAR` and `PREVIEW_MUSIC`
in the scene, and keep chapters on bar boundaries.

Check sync after a render: the analyzer on the output should give T0 ≈ 0, and chapter
changes should land on bars:

```bash
python3 tools/preview-video/analyze-music.py tools/preview-video/meshanimate-sizzle.mp4
```

## Sound effects

`window.PREVIEW_SFX` cues (`sfx(file, t, gainDb, anchor)`) come from the SlipSound library
(`PREVIEW_SFX_ROOT`, default `/media/stuyk/Side2/sounds`); missing files are skipped with
a warning. Confirm each file's license before publishing the video.
