/**
 * English text for the whole app. Other languages copy this file and
 * translate the values; keys stay the same. `{name}` is filled in by the app.
 * Objects with `one` / `other` are plural forms picked by `{count}`.
 */
export const en = {
  common: {
    appName: 'MeshAnimate',
    blender: 'Blender',
    cancel: 'Cancel',
    discard: 'Discard',
    done: 'Done',
    dismiss: 'Dismiss',
    closeEsc: 'Close (Esc)',
    delete: 'Delete',
    remove: 'Remove',
    rename: 'Rename',
    duplicate: 'Duplicate',
    replace: 'Replace…',
    choose: 'Choose…',
    search: 'Search...',
    clearSearch: 'Clear search',
    noFileOpen: 'No file open',
    untitled: 'Untitled'
  },

  units: {
    centimeters: '{value} cm',
    meters: '{value} m',
    seconds: '{value}s'
  },

  files: {
    blend: 'Blender File',
    webm: 'WebM Video',
    imagesAndVideos: 'Images and videos',
    images: 'Images',
    videos: 'Videos',
    blenderExecutable: 'Blender Executable',
    allFiles: 'All Files'
  },

  menu: {
    file: { label: 'File', title: 'Open and save .blend files' },
    edit: { label: 'Edit', title: 'Undo, keys and poses' },
    view: { label: 'View', title: 'Front, side and top views, and snapping' },
    open: 'Open .blend…',
    reload: 'Reload from Disk',
    save: 'Save',
    saveTo: 'Save to {file}',
    saveAs: 'Save As…',
    showInFolder: 'Show File in Folder',
    exportVideo: 'Export Video (WebM)…',
    front: 'Front',
    back: 'Back',
    rightSide: 'Right Side',
    leftSide: 'Left Side',
    top: 'Top',
    bottom: 'Bottom',
    frameModel: 'Frame Model',
    snappingOn: 'Turn Snapping On',
    snappingOff: 'Turn Snapping Off',
    undo: 'Undo',
    redo: 'Redo',
    keyPose: 'Key Pose',
    copyPose: 'Copy Pose',
    pastePose: 'Paste Pose',
    copyBone: 'Copy Bone',
    pasteBone: 'Paste Bone',
    mirrorPose: 'Mirror Pose',
    mirrorHalfCycle: 'Mirror to Half-Cycle',
    previewStart: 'Set Preview Start',
    previewEnd: 'Set Preview End',
    clearPreview: 'Clear Preview Range',
    deleteKeys: 'Delete Selected Keys'
  },

  start: {
    tagline: 'Pose-to-pose animation for rigged .blend files',
    open: 'Open .blend…',
    recent: 'Recent',
    lookingForBlender: 'Looking for Blender…',
    blenderFound: '{version} found',
    blenderMissing: 'Blender not found. MeshAnimate needs it to open and save .blend files.',
    change: 'Change…',
    locate: 'Locate Blender…'
  },

  busy: {
    merging: 'Merging with {file}…',
    reading: 'Reading {file} with Blender…',
    saving: 'Saving {file} with Blender…',
    checking: 'Checking {file}…',
    recording: 'Recording {clip}…'
  },

  toast: {
    notBlender: 'That is not a Blender executable',
    usingBlender: 'Using {version}',
    foundBlender: 'Found {version}',
    noBlender: 'No Blender found',
    reloaded: '{file} changed on disk. Reloaded it.',
    merged: {
      one: 'Merged: kept {count} clip from MeshAnimate, the rest from disk.',
      other: 'Merged: kept {count} clips from MeshAnimate, the rest from disk.'
    },
    mergeConflicts: 'Changed in both, kept the MeshAnimate version: {clips}',
    mergeFailed: "Couldn't merge: {error}",
    opened: '{file}: {bones}, {actions}',
    openedWithIk: '{file}: {bones}, {ik}, {actions}',
    bones: { one: '{count} bone', other: '{count} bones' },
    ikChains: { one: '{count} IK chain', other: '{count} IK chains' },
    actions: { one: '{count} action', other: '{count} actions' },
    openFailed: "Couldn't open {file}: {error}",
    nothingToSave: 'Nothing to save',
    saveFailed: 'Save failed. The file was not changed. {error}',
    saved: 'Saved {file}.',
    actionsWritten: { one: '{count} action written.', other: '{count} actions written.' },
    nlaAdded: {
      one: '{count} added to the NLA editor.',
      other: '{count} added to the NLA editor.'
    },
    backupMade: 'Backup made.',
    videoSaved: 'Saved {file}',
    videoFailed: 'Video export failed',
    videoFailedWithError: 'Video export failed: {error}',
    mirrored: 'Mirrored pose keyed at frame {frame}'
  },

  banner: {
    approxTitle: 'The preview may not match Blender for this rig.',
    approxBody:
      "It uses constraints MeshAnimate can't preview ({constraints}). This is common with Rigify. Your keys still save correctly. Check the motion in Blender.",
    notKeyed: 'Pose not keyed. Press {key} to key it.'
  },

  hints: {
    drag: 'Drag handle: pose',
    ik: '◎ IK target · ◆ pole',
    click: 'Click body: select',
    orbit: 'RMB: orbit',
    pan: 'Shift+RMB: pan',
    zoom: 'Wheel: zoom'
  },

  dialogs: {
    unsaved: {
      title: 'Unsaved changes',
      body: 'You have unsaved changes in {file}. Save them first? A backup is made before saving.',
      save: 'Save to .blend'
    },
    diskChanged: {
      title: '{file} changed on disk',
      keepMine: 'Keep mine',
      reload: 'Reload',
      merge: 'Merge',
      intro:
        'The .blend was changed by another program, probably Blender, and you have unsaved work here.',
      mergeHelp:
        '{label} reload the file and keep the clips you edited here. Everything else comes from the new file.',
      reloadHelp: '{label} load the new file and lose your unsaved changes.',
      keepHelp: '{label} keep working. Saving only rewrites the actions you changed here.',
      mergeLabel: 'Merge:',
      reloadLabel: 'Reload:',
      keepLabel: 'Keep mine:',
      revertTip:
        'If Blender still has the file open after you save here, use File > Revert in Blender. Otherwise its next save will undo your changes from MeshAnimate.'
    },
    recovery: {
      title: 'Restore unsaved work?',
      body: 'MeshAnimate closed with unsaved animation work on {file}. Restore it?',
      restore: 'Restore'
    }
  },

  header: {
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Shift+Z)',
    frameModel: 'Frame model (F)',
    devConsole: 'Developer console',
    help: 'Quick guide & hotkeys (?)',
    preferences: 'Preferences',
    lighting: 'Lighting: {label}. {subtitle}'
  },

  lighting: {
    neutral: { label: 'Neutral', subtitle: 'Balanced 3-point studio' },
    flat: { label: 'Flat', subtitle: 'Even light, soft shadows' },
    outdoor: { label: 'Outdoor', subtitle: 'Sunlight & sky fill' },
    warm: { label: 'Warm', subtitle: 'Tungsten & amber glow' },
    cool: { label: 'Cool', subtitle: 'Blue hour & cyan rim' }
  },

  tools: {
    pose: 'Pose: drag handles to move bones',
    rotate: 'Rotate: turn the selected joint',
    move: 'Move: move the selected joint',
    withKey: '{label} ({key})',
    snapping: 'Snapping (S). Hold Ctrl to switch it for one drag.',
    mirror: 'Mirror pose left ↔ right (M)',
    reach: { one: 'Move {count} bone ({count})', other: 'Move {count} bones ({count})' },
    fk: 'FK',
    ik: 'IK{count}'
  },

  viewport: {
    navCube: 'Click a side to change the view. Drag to orbit.',
    navFaces: {
      right: 'RIGHT',
      left: 'LEFT',
      top: 'TOP',
      bottom: 'BOTTOM',
      front: 'FRONT',
      back: 'BACK'
    }
  },

  snap: {
    planes: { Side: 'Side', Front: 'Front', Top: 'Top' },
    badgeOff: 'Snap off',
    badgeOn: '{plane} · {grid} · {angle}°',
    titleOn:
      'Snapping on ({plane} view). Handles snap to a {grid} grid and bones turn in {angle}° steps. Hold Ctrl to drag freely. (S)',
    titleOff: 'Snapping off. Click or press S to turn it on. Hold Ctrl to snap one drag.',
    overlayLabel: '{plane} · {grid}'
  },

  easing: {
    placeholder: 'Easing…',
    heading: 'Easing',
    bezier: { label: 'Auto', title: "Blender's default: smooth Bézier with auto-clamped handles" },
    linear: { label: 'Linear', title: 'Constant speed between this key and the next' },
    easeInOut: { label: 'Ease In-Out', title: 'Slow out of this key, slow into the next' },
    easeIn: { label: 'Ease In', title: 'Start slow, arrive fast' },
    easeOut: { label: 'Ease Out', title: 'Start fast, settle slowly' },
    step: { label: 'Hold', title: 'Hold this pose until the next key (Constant)' }
  },

  timeline: {
    firstFrame: 'First frame (Home)',
    previousKey: 'Previous key (Shift+←)',
    play: 'Play (Space)',
    pause: 'Pause (Space)',
    nextKey: 'Next key (Shift+→)',
    lastFrame: 'Last frame (End)',
    looping: 'Looping playback',
    playOnce: 'Play once',
    rangeSet:
      'Preview range {start} to {end}. Playback loops here. Click to clear (\\). Drag its edges on the ruler.',
    rangeUnset:
      'Preview range: loop part of the clip while you polish it. [ and ] set its start and end at the playhead.',
    fit: 'Fit the whole clip in the timeline',
    frame: 'Frame',
    frameTitle: 'Current frame. Drag to scrub, double-click to type.',
    length: 'Length',
    lengthTitle: 'Clip length in frames',
    fps: 'FPS',
    fpsTitle: 'Frame rate. Every action in the .blend uses it.',
    keyPose: 'Key the current pose at this frame (K)',
    deleteKeys: 'Delete selected keys, or the key at the playhead (Del)',
    copyPose: 'Copy pose (Ctrl+C)',
    pastePose: 'Paste pose as a key here (Ctrl+V)',
    easingTitle: 'Easing to the next key, for the selected keys',
    autoKey: 'Auto-key',
    autoKeyTitle: 'Auto-key: each change adds a key at the playhead',
    firstFrameGhost: 'First-frame ghost (Shift+O)',
    onionSkin: 'Onion skin (O)',
    ghostsBeforeTitle: 'Ghosts before the playhead',
    ghostsBefore: 'Ghosts before',
    ghostsAfter: 'Ghosts after',
    ghostsAfterTitle: 'Ghosts after the playhead',
    onionKeys: 'Keys',
    onionKeysTitle: 'Ghost the neighbouring keyed poses',
    onionFrames: 'Frames',
    onionFramesTitle: 'Ghost every Nth frame around the playhead',
    every: 'every',
    framesBetween: 'Frames between ghosts',
    noClip: 'No clip',
    poseRow: 'Pose',
    poseRowTitle: 'Pose keys',
    jointRowTitle: 'Where the selected joint changes between keys',
    noJoint: 'No joint selected',
    rangeEdge: 'Drag to move this end of the preview range',
    keyTitle: 'Key @ {frame}, {easing}\nDrag to move. Alt+drag to copy. Right-click for options.',
    jointMoves: '{joint} moves into frame {frame}',
    jointHolds: '{joint} holds at frame {frame}',
    insertKey: 'Insert key at frame {frame}',
    mirrorHalfCycle: 'Mirror to half-cycle (Shift+M)',
    mirrorHalfCycleHint:
      'Key the mirrored pose half a cycle later. A left step becomes a right step.',
    copyPoseMenu: 'Copy pose',
    copyBoneMenu: 'Copy {joint} from this key',
    pasteBoneMenu: 'Paste {joint} into this key',
    duplicateToPlayhead: 'Duplicate to playhead ({frame})'
  },

  clips: {
    title: 'Clips',
    newClip: 'New clip',
    deleteClip: 'Delete clip',
    defaultName: 'Clip {n}',
    copyName: '{name} Copy',
    meta: '{keys}k · {length}f'
  },

  skeleton: {
    title: 'Skeleton',
    find: 'Find joint…',
    hiddenInBlender: '{bone} is hidden in Blender',
    ikBadge: 'IK'
  },

  bone: {
    title: 'Bone',
    empty: 'Click a handle, a body part or a row in the skeleton list to select a bone.',
    drivenByIk:
      'Moved by IK on {owner}. Drag its orange ring (or move {target}) to pose this limb.',
    pointsAtPole: 'The knee or elbow points at {pole}.',
    selectTarget: 'Select target',
    selectPole: 'Select pole',
    ikTargetFor: 'IK target for {owner}. Drag it in the viewport.',
    poleTargetFor: 'Pole target for {owner}. Drag it in the viewport.',
    location: 'Location',
    rotation: 'Rotation°',
    sameAsBlender: "Same values as Blender's Bone panel.",
    clearTransform: 'Clear transform',
    copy: 'Copy',
    copyTitle: "Copy this bone's location and rotation (Ctrl+Shift+C)",
    paste: 'Paste',
    pasteTitle: 'Paste {joint} here and key it (Ctrl+Shift+V)'
  },

  rig: {
    title: 'Rig',
    selectIkTarget: 'Select the IK target',
    ikChain: 'IK · {owner}',
    chainBones: { one: '({count} bone)', other: '({count} bones)' },
    chainAll: '(∞ bones)',
    unsupported: "Constraints the preview can't show:"
  },

  pose: {
    title: 'Pose',
    mirror: 'Mirror',
    mirrorTitle: 'Swap left and right sides (M)',
    rest: 'Rest pose',
    restTitle: "Back to the model's rest pose"
  },

  snapping: {
    title: 'Snapping',
    summaryOn: '{plane} view',
    summaryOff: 'Off',
    toggle: 'Snap while posing (S)',
    toggleHelp: 'Drags stay flat to the front, side or top view. Hold Ctrl to switch for one drag.',
    grid: 'Grid (targets, poles, root)',
    angle: 'Angle (rotating a bone)',
    viewTip:
      'Pick a view first: numpad 1, 3 or 7 for front, side or top. Hold Ctrl for the other side, or click the cube.'
  },

  reference: {
    title: 'Reference',
    empty:
      'Show a sketch, photo or video behind the model. Videos follow the playhead. This is remembered for this file but not saved into it.',
    load: 'Load image or video…',
    show: 'Show reference',
    opacity: 'Opacity',
    videoStart: 'Video starts at clip frame'
  },

  display: {
    title: 'Display',
    firstFrame: 'First-frame ghost (Shift+O)',
    firstFrameHelp: "Show the clip's first frame at all times",
    showHidden: 'Show bones hidden in Blender',
    showHiddenHelp: 'Bones you hid in Blender, or in hidden bone collections',
    skeleton: 'Skeleton & handles',
    handleSize: 'Handle size',
    meshOpacity: 'Mesh opacity',
    onionSkin: 'Onion skin',
    ghostStrength: 'Ghost strength'
  },

  prefs: {
    title: 'Preferences',
    reset: 'Reset to defaults',
    reallyReset: 'Really reset?',
    blenderHeading: 'Blender',
    blenderNotFound: 'Blender not found',
    blenderNeeded: 'MeshAnimate needs Blender to open and save .blend files.',
    findAutomatically: 'Find automatically',
    posingHeading: 'Posing',
    autoKey: 'Auto-key when the app starts',
    autoKeyHelp: 'Each change adds a key at the playhead',
    snapping: 'Snapping on',
    grid: 'Grid',
    angleStep: 'Angle step',
    viewportHeading: 'Viewport',
    onionColours: 'Onion skin colours',
    beforePlayhead: 'Before the playhead',
    afterPlayhead: 'After the playhead',
    firstFrameGhost: 'First-frame ghost',
    savingHeading: 'Saving',
    savingInfo:
      "Each save first copies the .blend to a {folder} folder next to it. The last 20 copies are kept. Only the actions you changed are saved, and bones you didn't touch keep their original curves."
  },

  help: {
    title: 'MeshAnimate Quick Guide',
    hotkeysHeading: 'Hotkeys',
    steps: {
      open: {
        title: 'Open a .blend',
        body: 'MeshAnimate loads your rig and all its actions from the .blend. Blender must be installed. Each action shows up as a clip.'
      },
      grab: {
        title: 'Grab a handle',
        body: 'Each bone has a red circle at its end. Drag it to swing the bone around its joint. The orange square moves the whole rig.'
      },
      ik: {
        title: 'IK limbs',
        body: 'Limbs that use IK are orange. Drag the ring at the end (or the ◎ target) to move the hand or foot. Drag the knee or elbow (or the ◆ pole) to point it.'
      },
      save: {
        title: 'Key, time, save',
        body: 'With Auto-key on, each change adds a key (◆) at the playhead. Drag keys to move them. Right-click a key for easing. Ctrl+S saves your changes into the .blend and makes a backup first.'
      }
    },
    hotkeys: {
      play: { keys: 'Space', action: 'Play / pause' },
      frame: { keys: '← / →', action: 'Previous / next frame' },
      key: { keys: 'Shift + ← / →', action: 'Previous / next key' },
      ends: { keys: 'Home / End', action: 'First / last frame' },
      keyPose: { keys: 'K', action: 'Key the current pose' },
      deleteKeys: { keys: 'Delete', action: 'Delete selected keys' },
      copyPaste: { keys: 'Ctrl+C / Ctrl+V', action: 'Copy / paste pose' },
      copyPasteBone: { keys: 'Ctrl+Shift+C / V', action: 'Copy / paste the selected bone' },
      mirror: { keys: 'M', action: 'Mirror pose left ↔ right' },
      halfCycle: { keys: 'Shift+M', action: 'Mirror to half-cycle (walk cycles)' },
      range: { keys: '[ / ] / \\', action: 'Preview range start / end / clear' },
      boxSelect: { keys: 'Drag on track', action: 'Box-select keys (Shift adds)' },
      onion: { keys: 'O', action: 'Toggle onion skin' },
      firstFrame: { keys: 'Shift+O', action: 'Show the first frame as a ghost' },
      tools: { keys: 'Q / E / W', action: 'Pose handles / rotate gizmo / move gizmo' },
      reach: { keys: '1 / 2 / 3', action: 'Drag moves 1, 2 or 3 bones' },
      frameModel: { keys: 'F', action: 'Frame the model' },
      snapping: { keys: 'S', action: 'Snapping on / off (hold Ctrl to switch for one drag)' },
      views: { keys: 'Num 1 / 3 / 7', action: 'Front / side / top view (Ctrl: opposite)' },
      undo: { keys: 'Ctrl+Z / Ctrl+Shift+Z', action: 'Undo / redo' },
      save: { keys: 'Ctrl+S / Ctrl+Shift+S', action: 'Save into the .blend / Save As' },
      open: { keys: 'Ctrl+O', action: 'Open a .blend' },
      orbit: { keys: 'Right-drag', action: 'Orbit (Shift: pan)' },
      zoom: { keys: 'Wheel', action: 'Zoom' },
      timelineZoom: { keys: 'Ctrl + wheel on timeline', action: 'Zoom timeline' }
    }
  },

  errors: {
    blenderCouldNotRead: 'Blender could not read the file',
    bonesMissing: 'Bones missing from the display model: {bones}',
    blenderNotFound: 'Blender not found. Use "Locate Blender…" to pick it.',
    blenderDidNotFinish: 'Blender did not finish',
    fileNotFound: 'File not found: {path}',
    fileDoesNotExist: 'File does not exist',
    unknownBlenderVersion: 'Blender (unknown version)',
    invalidBlender: 'Invalid Blender executable',
    notValidBlender: 'The selected file is not a valid Blender executable.'
  },

  main: {
    recoveryDetail:
      'Changes since the last autosave (every 60 seconds) may be lost. Reload to restore the autosave from the start screen.',
    notResponding: 'MeshAnimate is not responding.',
    maybeBusy: 'It may still be working on something heavy. {detail}',
    outOfMemory: 'MeshAnimate ran out of memory.',
    stopped: 'MeshAnimate stopped ({reason}).',
    gpuLost: 'The graphics context was lost.',
    gpuDetail: 'The GPU driver reset or ran out of memory. {detail}',
    wait: 'Wait',
    reload: 'Reload',
    quit: 'Quit',
    closeAnyway: 'Close Anyway',
    selectBlender: 'Select Blender Executable'
  }
}
