import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import * as THREE from 'three'
import AnimViewport, { type AnimViewportHandle } from './viewport/AnimViewport'
import type { LightingMode } from './viewport/scene'
import AppHeader from './components/AppHeader'
import Timeline, { keyCurrentPose, stepToKey } from './components/Timeline'
import Sidebar from './components/Sidebar'
import ToolRail from './components/ToolRail'
import HelpModal from './components/HelpModal'
import PreferencesModal from './components/PreferencesModal'
import { Button, Kbd, Modal, Toast, type MenuItem, type ToastData } from './components/ui'
import {
  AppIcon,
  FilmIcon,
  FolderOpenIcon,
  FigureIcon,
  RefreshCwIcon,
  SaveIcon,
  ClockIcon
} from './components/icons'
import { studio, type ClipSource } from './anim/studio'
import {
  buildSavePayload,
  mergeWithDisk,
  openBlendDocument,
  sourcesFromDisk
} from './anim/blendDoc'
import {
  copyLivePose,
  flushPendingCommit,
  mirrorLivePose,
  mirrorToHalfCycle,
  pasteClipboardPose
} from './anim/actions'
import type { Clip } from './anim/types'
import { fileName } from './utils/paths'

const LIGHTING_KEY = 'meshanimate:lighting'

type View = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'
/** Numpad key → [view, Ctrl+key view], as in Blender. */
const NUMPAD_VIEWS: Record<string, [View, View]> = {
  Numpad1: ['front', 'back'],
  Numpad3: ['right', 'left'],
  Numpad7: ['top', 'bottom']
}

interface Autosave {
  blendPath: string
  clips: Clip[]
  activeClipId: string
  /** Clip id → the Blender action it came from, to reconnect after reopening. */
  origins: Record<string, string>
}

/**
 * Points restored clips back at the actions they came from, so the next save
 * still only rewrites what actually changed.
 */
function reconnect(restore: Autosave, fresh: Map<string, ClipSource>): Map<string, ClipSource> {
  const byAction = new Map([...fresh.values()].map((s) => [s.action, s]))
  const out = new Map<string, ClipSource>()
  for (const clip of restore.clips) {
    const src = byAction.get(restore.origins[clip.id])
    if (src) {
      out.set(clip.id, src)
    }
  }
  return out
}

export default function App(): JSX.Element {
  let viewport: AnimViewportHandle | null = null
  const [lighting, setLightingSignal] = createSignal<LightingMode>(
    (localStorage.getItem(LIGHTING_KEY) as LightingMode | null) ?? 'neutral'
  )
  const setLighting = (m: LightingMode): void => {
    setLightingSignal(m)
    try {
      localStorage.setItem(LIGHTING_KEY, m)
    } catch {
      // Preference only.
    }
  }
  const [showHelp, setShowHelp] = createSignal(false)
  const [showPrefs, setShowPrefs] = createSignal(false)
  const [approxDismissed, setApproxDismissed] = createSignal(false)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [toast, setToast] = createSignal<ToastData | null>(null)
  const [confirmDiscard, setConfirmDiscard] = createSignal<null | (() => void)>(null)
  const [recovery, setRecovery] = createSignal<Autosave | null>(null)
  const [blender, setBlender] = createSignal<{ path: string | null; version?: string } | null>(null)
  const [recent, setRecent] = createSignal<string[]>([])

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  const notify = (text: string, type: ToastData['type'] = 'info', ms = 3600): void => {
    clearTimeout(toastTimer)
    setToast({ id: Date.now(), text, type })
    toastTimer = setTimeout(() => setToast(null), ms)
  }

  const blendPath = (): string | null => studio.rig()?.blendPath ?? null
  const docName = (): string => (blendPath() ? fileName(blendPath()) : 'No file open')

  async function refreshRecent(): Promise<void> {
    const list = await window.api.getRecentProjects()
    setRecent(list.map((r) => r.projectPath).filter((p) => p.toLowerCase().endsWith('.blend')))
  }

  async function refreshBlender(): Promise<void> {
    setBlender(await window.api.detectBlender())
  }

  async function locateBlender(): Promise<void> {
    const res = await window.api.browseBlenderExecutable()
    if (!res) {
      return
    }
    if (!res.success) {
      notify(res.error ?? 'That is not a Blender executable', 'error', 6000)
      return
    }
    setBlender({ path: res.path ?? null, version: res.version })
    notify(`Using ${res.version ?? 'Blender'}`, 'success')
  }

  // --- opening ------------------------------------------------------------------

  // --- the file on disk ----------------------------------------------------------

  /** Modification time of the .blend as last read or written by this app. */
  let knownMtime: number | null = null
  const [diskChanged, setDiskChanged] = createSignal(false)

  async function rememberDiskState(path: string): Promise<void> {
    knownMtime = await window.api.statBlend(path)
  }

  /** Has the .blend been written by something else (Blender) since we read it? */
  async function changedOnDisk(): Promise<boolean> {
    const path = blendPath()
    if (!path || knownMtime === null) {
      return false
    }
    const now = await window.api.statBlend(path)
    return now !== null && now > knownMtime + 1
  }

  /**
   * Polled and on window focus. With nothing unsaved here, a newer file is
   * simply reloaded (keeping the clip and frame you were on); otherwise you
   * choose between merging, reloading and keeping your version.
   */
  async function checkDisk(): Promise<void> {
    if (busy() || diskChanged() || !(await changedOnDisk())) {
      return
    }
    flushPendingCommit()
    if (!studio.dirty()) {
      await reloadInPlace()
      notify(`${docName()} changed on disk — reloaded`, 'info')
      return
    }
    setDiskChanged(true)
  }

  /** Re-reads the file, staying on the same clip and frame. */
  async function reloadInPlace(): Promise<void> {
    const path = blendPath()
    const clipName = studio.activeClip()?.name
    const frame = studio.frame()
    if (!path) {
      return
    }
    await openBlend(path, undefined, true)
    const same = studio.clips().find((c) => c.name === clipName)
    if (same) {
      studio.selectClip(same.id)
      studio.setFrame(frame)
    }
  }

  /** Disk version plus the edits made here; see mergeWithDisk. */
  async function mergeFromDisk(): Promise<void> {
    const path = blendPath()
    if (!path) {
      return
    }
    setDiskChanged(false)
    flushPendingCommit()
    const clipName = studio.activeClip()?.name
    const frame = studio.frame()
    setBusy(`Merging with ${fileName(path)}…`)
    try {
      const disk = await openBlendDocument(path)
      const res = mergeWithDisk(studio.clips(), studio.sources(), disk)
      studio.setRig(disk.rig)
      const active = res.clips.find((c) => c.name === clipName) ?? res.clips[0]
      studio.resetDocument(res.clips, active?.id, res.sources)
      studio.setFrame(frame)
      studio.setDirty(true)
      await rememberDiskState(path)
      notify(
        `Merged: kept ${res.keptMine} clip${res.keptMine === 1 ? '' : 's'} from MeshAnimate, the rest from disk` +
          (res.conflicts.length
            ? ` · changed in both, MeshAnimate's kept: ${res.conflicts.join(', ')}`
            : ''),
        res.conflicts.length ? 'warning' : 'success',
        8000
      )
    } catch (err) {
      notify(`Couldn't merge: ${(err as Error).message}`, 'error', 8000)
    } finally {
      setBusy(null)
    }
  }

  async function openBlend(path: string, restore?: Autosave, quiet = false): Promise<void> {
    setBusy(`Reading ${fileName(path)} with Blender…`)
    try {
      const doc = await openBlendDocument(path)
      await rememberDiskState(path)
      setDiskChanged(false)
      setApproxDismissed(false)
      studio.setRig(doc.rig)
      studio.restoreReference(path)
      if (restore) {
        studio.resetDocument(restore.clips, restore.activeClipId, reconnect(restore, doc.sources))
        studio.setDirty(true)
      } else {
        studio.resetDocument(doc.clips, doc.activeClipId, doc.sources)
      }
      void window.api.addRecentProject(path, fileName(path), 'project').then(refreshRecent)
      if (quiet) {
        return
      }
      const ik = doc.rig.ik.length
      notify(
        `${fileName(path)}: ${doc.rig.jointByName.size} bones` +
          (ik ? `, ${ik} IK chain${ik > 1 ? 's' : ''}` : '') +
          `, ${doc.clips.length} action${doc.clips.length === 1 ? '' : 's'}`,
        'success'
      )
    } catch (err) {
      console.error(err)
      notify(`Couldn't open ${fileName(path)}: ${(err as Error).message}`, 'error', 9000)
    } finally {
      setBusy(null)
    }
  }

  async function promptOpen(): Promise<void> {
    const paths = await window.api.openFileDialog({
      key: 'blend',
      filters: [{ name: 'Blender File', extensions: ['blend'] }]
    })
    const path = paths?.[0]
    if (path) {
      await guardUnsaved(() => openBlend(path))
    }
  }

  async function reload(): Promise<void> {
    const path = blendPath()
    if (path) {
      await guardUnsaved(() => openBlend(path))
    }
  }

  // --- saving -------------------------------------------------------------------

  /**
   * Writes changed clips into the .blend as actions. The file is backed up
   * first (main process), and untouched actions aren't rewritten at all.
   */
  async function save(saveAs = false): Promise<boolean> {
    const rig = studio.rig()
    if (!rig) {
      return false
    }
    flushPendingCommit()
    let outPath = rig.blendPath
    if (saveAs) {
      const chosen = await window.api.saveFileDialog({
        key: 'blend',
        defaultPath: fileName(rig.blendPath),
        filters: [{ name: 'Blender File', extensions: ['blend'] }]
      })
      if (!chosen) {
        return false
      }
      outPath = chosen.toLowerCase().endsWith('.blend') ? chosen : `${chosen}.blend`
    }
    // Never write over a newer file blindly: Blender may have saved it.
    if (outPath === rig.blendPath && (await changedOnDisk())) {
      setDiskChanged(true)
      return false
    }
    const { payload, changes } = buildSavePayload(rig, studio.clips(), studio.sources())
    if (changes === 0 && outPath === rig.blendPath) {
      studio.setDirty(false)
      notify('Nothing changed since the file was read', 'info')
      return true
    }
    setBusy(`Saving ${fileName(outPath)} with Blender…`)
    try {
      const res = await window.api.saveBlend(rig.blendPath, outPath, JSON.stringify(payload))
      if (!res.ok) {
        notify(`Save failed — the file was not changed. ${res.error ?? ''}`, 'error', 10000)
        return false
      }
      await rememberDiskState(outPath)
      setBusy(`Checking ${fileName(outPath)}…`)
      const fresh = await sourcesFromDisk(outPath, studio.clips())
      if (fresh) {
        studio.setSources(fresh)
      }
      rig.meta.fps = payload.fps
      rig.blendPath = outPath
      rig.name = fileName(outPath).replace(/\.blend$/i, '')
      studio.setRig(rig)
      studio.setDirty(false)
      void window.api.clearRecovery()
      void window.api.addRecentProject(outPath, fileName(outPath), 'project').then(refreshRecent)
      const wrote = payload.clips.length
      const tracks = res.nlaAdded?.length ?? 0
      notify(
        `Saved ${fileName(outPath)} — ${wrote} action${wrote === 1 ? '' : 's'} written` +
          (tracks ? ` · ${tracks} added to the NLA editor` : '') +
          (res.backupPath ? ' · previous version backed up' : ''),
        'success',
        5000
      )
      return true
    } finally {
      setBusy(null)
    }
  }

  async function exportVideo(): Promise<void> {
    const rig = studio.rig()
    const clip = studio.activeClip()
    if (!rig || !clip || !viewport) {
      return
    }
    const path = await window.api.saveFileDialog({
      key: 'export',
      defaultPath: `${clip.name}.webm`,
      filters: [{ name: 'WebM Video', extensions: ['webm'] }]
    })
    if (!path) {
      return
    }
    studio.setPlaying(false)
    setBusy(`Recording ${clip.name}…`)
    try {
      const blob = await viewport.engine.recordWebm(clip.length, clip.fps, (f) =>
        studio.poseAt(clip, f)
      )
      const ok = await window.api.saveBinaryFile(path, new Uint8Array(await blob.arrayBuffer()))
      notify(ok ? `Saved ${fileName(path)}` : 'Video export failed', ok ? 'success' : 'error')
    } catch (err) {
      notify(`Video export failed: ${(err as Error).message}`, 'error', 6000)
    } finally {
      viewport.engine.applyPose(studio.poseAt(clip, studio.frame()))
      setBusy(null)
    }
  }

  // --- unsaved-change guard ------------------------------------------------------

  async function guardUnsaved(then: () => void | Promise<void>): Promise<void> {
    flushPendingCommit()
    if (!studio.dirty()) {
      await then()
      return
    }
    setConfirmDiscard(() => () => void then())
  }

  function autosave(): Autosave | null {
    const path = blendPath()
    if (!path) {
      return null
    }
    const origins: Record<string, string> = {}
    for (const [id, src] of studio.sources()) {
      origins[id] = src.action
    }
    return {
      blendPath: path,
      clips: studio.clips(),
      activeClipId: studio.activeClip()?.id ?? '',
      origins
    }
  }

  // --- menus ------------------------------------------------------------------

  const fileMenu = (): MenuItem[] => [
    {
      label: 'Open .blend…',
      icon: FolderOpenIcon,
      shortcut: 'Ctrl+O',
      onClick: () => void promptOpen()
    },
    {
      label: 'Reload from Disk',
      icon: RefreshCwIcon,
      disabled: !blendPath(),
      onClick: () => void reload()
    },
    { type: 'divider' },
    {
      label: blendPath() ? `Save to ${fileName(blendPath())}` : 'Save',
      icon: SaveIcon,
      shortcut: 'Ctrl+S',
      disabled: !blendPath(),
      onClick: () => void save()
    },
    {
      label: 'Save As…',
      icon: SaveIcon,
      shortcut: 'Ctrl+Shift+S',
      disabled: !blendPath(),
      onClick: () => void save(true)
    },
    {
      label: 'Show File in Folder',
      icon: ClockIcon,
      disabled: !blendPath(),
      onClick: () => {
        const p = blendPath()
        if (p) {
          window.api.revealInFolder(p)
        }
      }
    },
    { type: 'divider' },
    {
      label: 'Export Video (WebM)…',
      icon: FilmIcon,
      disabled: !blendPath(),
      onClick: () => void exportVideo()
    }
  ]

  const viewMenu = (): MenuItem[] => {
    const go = (v: View) => (): void => viewport?.engine.viewAlong(v)
    return [
      { label: 'Front', shortcut: 'Num 1', onClick: go('front') },
      { label: 'Back', shortcut: 'Ctrl+Num 1', onClick: go('back') },
      { label: 'Right Side', shortcut: 'Num 3', onClick: go('right') },
      { label: 'Left Side', shortcut: 'Ctrl+Num 3', onClick: go('left') },
      { label: 'Top', shortcut: 'Num 7', onClick: go('top') },
      { label: 'Bottom', shortcut: 'Ctrl+Num 7', onClick: go('bottom') },
      { type: 'divider' },
      { label: 'Frame Model', shortcut: 'F', onClick: () => viewport?.engine.frame() },
      {
        label: studio.snap().enabled ? 'Turn Snapping Off' : 'Turn Snapping On',
        shortcut: 'S',
        onClick: () => studio.setSnap({ enabled: !studio.snap().enabled })
      }
    ]
  }

  const editMenu = (): MenuItem[] => [
    {
      label: 'Undo',
      shortcut: 'Ctrl+Z',
      disabled: !studio.canUndo(),
      onClick: () => studio.undo()
    },
    {
      label: 'Redo',
      shortcut: 'Ctrl+Shift+Z',
      disabled: !studio.canRedo(),
      onClick: () => studio.redo()
    },
    { type: 'divider' },
    { label: 'Key Pose', shortcut: 'K', onClick: keyCurrentPose },
    { label: 'Copy Pose', shortcut: 'Ctrl+C', onClick: copyLivePose },
    {
      label: 'Paste Pose',
      shortcut: 'Ctrl+V',
      disabled: !studio.clipboardPose(),
      onClick: pasteClipboardPose
    },
    { label: 'Mirror Pose', shortcut: 'M', onClick: mirrorLivePose },
    { label: 'Mirror to Half-Cycle', shortcut: 'Shift+M', onClick: halfCycle },
    { type: 'divider' },
    { label: 'Set Preview Start', shortcut: '[', onClick: () => studio.setRangeEnd('in') },
    { label: 'Set Preview End', shortcut: ']', onClick: () => studio.setRangeEnd('out') },
    {
      label: 'Clear Preview Range',
      shortcut: '\\',
      disabled: !studio.previewRange(),
      onClick: () => studio.setPreviewRange(null)
    },
    { type: 'divider' },
    {
      label: 'Delete Selected Keys',
      shortcut: 'Del',
      danger: true,
      disabled: studio.selectedKeyIds().length === 0,
      onClick: () => studio.deleteKeys(studio.selectedKeyIds())
    }
  ]

  // --- keyboard -----------------------------------------------------------------

  const onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement
    const typing =
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable
    if (typing || busy()) {
      return
    }
    // A focused button would also "click" on Space/Enter; the shortcut wins.
    if (t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) {
      t.blur()
    }
    const ctrl = e.ctrlKey || e.metaKey
    const view = NUMPAD_VIEWS[e.code]
    if (view && studio.rig()) {
      // Blender's numpad views; Ctrl looks from the opposite side.
      viewport?.engine.viewAlong(ctrl ? view[1] : view[0])
      e.preventDefault()
      return
    }
    const handled = ctrl ? onCtrlKey(e.key.toLowerCase(), e.shiftKey) : onPlainKey(e)
    if (handled) {
      e.preventDefault()
    }
  }

  function onCtrlKey(key: string, shift: boolean): boolean {
    const actions: Record<string, () => void> = {
      z: () => (shift ? studio.redo() : studio.undo()),
      y: () => studio.redo(),
      s: () => void save(shift),
      o: () => void promptOpen(),
      c: copyLivePose,
      v: pasteClipboardPose
    }
    const action = actions[key]
    action?.()
    return !!action
  }

  function onPlainKey(e: KeyboardEvent): boolean {
    if (!studio.rig()) {
      return false
    }
    const clip = studio.activeClip()
    const last = (clip?.length ?? 1) - 1
    const step = (d: number): void => {
      studio.setPlaying(false)
      studio.setFrame(studio.frame() + d)
    }
    const actions: Record<string, () => void> = {
      ' ': () => studio.togglePlay(),
      arrowleft: () => (e.shiftKey ? stepToKey(-1) : step(-1)),
      arrowright: () => (e.shiftKey ? stepToKey(1) : step(1)),
      home: () => studio.setFrame(0),
      end: () => studio.setFrame(last),
      k: keyCurrentPose,
      delete: deleteKeys,
      backspace: deleteKeys,
      m: () => (e.shiftKey ? halfCycle() : mirrorLivePose()),
      '[': () => studio.setRangeEnd('in'),
      ']': () => studio.setRangeEnd('out'),
      '\\': () => studio.setPreviewRange(null),
      s: () => studio.setSnap({ enabled: !studio.snap().enabled }),
      o: () =>
        e.shiftKey
          ? studio.setDisplay({
              ...studio.display(),
              showFirstFrame: !studio.display().showFirstFrame
            })
          : studio.setOnion({ ...studio.onion(), enabled: !studio.onion().enabled }),
      q: () => studio.setTool('pose'),
      e: () => studio.setTool('rotate'),
      w: () => studio.setTool('move'),
      '1': () => studio.setIkChain(1),
      '2': () => studio.setIkChain(2),
      '3': () => studio.setIkChain(3),
      f: () => viewport?.engine.frame(),
      '?': () => setShowHelp(true),
      escape: () => {
        studio.setSelectedKeyIds([])
        studio.setSelectedJoint(null)
      }
    }
    const action = actions[e.key.toLowerCase()]
    action?.()
    return !!action
  }

  function halfCycle(): void {
    const f = mirrorToHalfCycle()
    const clip = studio.activeClip()
    if (f !== null && clip) {
      notify(`Mirrored pose keyed at frame ${f + clip.start}`, 'success')
    }
  }

  function deleteKeys(): void {
    const ids = studio.selectedKeyIds()
    if (ids.length > 0) {
      studio.deleteKeys(ids)
      return
    }
    const k = studio.keyAtFrame(studio.frame())
    if (k) {
      studio.deleteKeys([k.id])
    }
  }

  // --- lifecycle ----------------------------------------------------------------

  onMount(async () => {
    window.addEventListener('keydown', onKeyDown)
    const offClose = window.api.onBeforeClose(() => {
      flushPendingCommit()
      if (!studio.dirty()) {
        window.api.confirmClose()
        return
      }
      setConfirmDiscard(() => () => window.api.confirmClose())
    })
    const poll = setInterval(() => void checkDisk(), 2000)
    const onFocus = (): void => void checkDisk()
    window.addEventListener('focus', onFocus)
    onCleanup(() => {
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    })
    const timer = setInterval(() => {
      const data = studio.dirty() ? autosave() : null
      if (data) {
        void window.api.saveRecovery(JSON.stringify(data))
      }
    }, 60_000)
    onCleanup(() => {
      offClose()
      clearInterval(timer)
      window.removeEventListener('keydown', onKeyDown)
    })

    // Handy from the dev console, and how automated smoke tests drive the app.
    Object.assign(window, {
      __meshanimate: { studio, openBlend, save, THREE, engine: () => viewport?.engine }
    })

    void refreshBlender()
    void refreshRecent()
    const saved = await window.api.loadRecovery()
    if (saved?.data) {
      try {
        const data = JSON.parse(saved.data) as Autosave
        if (data.blendPath && Array.isArray(data.clips)) {
          setRecovery(data)
        }
      } catch {
        void window.api.clearRecovery()
      }
    }
  })

  return (
    <div class="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]">
      <AppHeader
        docName={docName()}
        busy={!!busy()}
        menus={[
          { label: 'File', title: 'Open and save .blend files', items: fileMenu() },
          { label: 'Edit', title: 'Undo, keys and poses', items: editMenu() },
          {
            label: 'View',
            title: 'Front, side and top views; snapping',
            items: viewMenu()
          }
        ]}
        lightingMode={lighting()}
        onSelectLightingMode={setLighting}
        onFrameCamera={() => viewport?.engine.frame()}
        onOpenHelp={() => setShowHelp(true)}
        onOpenSettings={() => setShowPrefs(true)}
      />

      <div class="flex flex-1 min-h-0">
        <Show when={studio.rig()}>
          <ToolRail />
        </Show>
        <main class="relative flex-1 min-w-0">
          <AnimViewport lightingMode={lighting()} onReady={(h) => (viewport = h)} />
          <Show when={!studio.rig()}>
            <StartScreen
              blender={blender()}
              recent={recent()}
              busy={!!busy()}
              onOpen={() => void promptOpen()}
              onOpenRecent={(p) => void openBlend(p)}
              onLocateBlender={() => void locateBlender()}
            />
          </Show>
          <Show when={studio.rig()?.previewApproximate && !approxDismissed()}>
            <div class="absolute top-3 left-3 max-w-[460px] flex items-start gap-2 px-3 py-2 rounded-[var(--ui-radius)] bg-zinc-900/92 border border-amber-500/40 text-[11px] text-amber-100 shadow-lg">
              <span>
                <b>Preview is approximate for this rig.</b> Its mesh is driven by Blender
                constraints MeshAnimate doesn't evaluate (
                {studio.rig()!.warnings.slice(0, 3).join(', ')}
                {studio.rig()!.warnings.length > 3 ? '…' : ''}) — common with Rigify. Keys still
                save exactly; check the motion in Blender.
              </span>
              <button
                type="button"
                class="shrink-0 px-1 text-amber-200/70 hover:text-white cursor-pointer"
                title="Dismiss"
                onClick={() => setApproxDismissed(true)}
              >
                ✕
              </button>
            </div>
          </Show>
          <Show when={studio.rig() && studio.unkeyed() && !studio.autoKey()}>
            <div class="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-[var(--ui-radius)] bg-zinc-900/90 border border-amber-500/40 text-[11px] text-amber-200 shadow-lg">
              Pose changed but not keyed — press <Kbd size="xs">K</Kbd> to key it
            </div>
          </Show>
          <Show when={studio.rig()}>
            <div class="absolute bottom-2 left-3 text-[10px] text-[var(--text-muted)]/80 pointer-events-none select-none flex gap-3">
              <span>Drag handle: pose</span>
              <span>◎ IK target · ◆ pole</span>
              <span>Click body: select</span>
              <span>RMB: orbit</span>
              <span>Shift+RMB: pan</span>
              <span>Wheel: zoom</span>
            </div>
          </Show>
        </main>
        <Show when={studio.rig()}>
          <Sidebar />
        </Show>
      </div>

      <Show when={studio.rig()}>
        <Timeline />
      </Show>

      <HelpModal isOpen={showHelp()} onClose={() => setShowHelp(false)} />
      <PreferencesModal
        isOpen={showPrefs()}
        onClose={() => setShowPrefs(false)}
        blender={blender()}
        onLocateBlender={() => void locateBlender()}
        onAutoDetectBlender={async () => {
          await window.api.setBlenderPath(null)
          await refreshBlender()
          notify(
            blender()?.path ? `Found ${blender()?.version ?? 'Blender'}` : 'No Blender found',
            blender()?.path ? 'success' : 'warning'
          )
        }}
      />

      <Show when={busy()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
          <div class="flex items-center gap-3 px-5 py-3.5 rounded-[var(--ui-radius)] bg-[var(--bg-panel)] border border-[var(--border-color)] shadow-2xl text-xs">
            <RefreshCwIcon size={15} class="animate-spin text-[var(--accent-color)]" />
            {busy()}
          </div>
        </div>
      </Show>

      <Modal
        isOpen={!!confirmDiscard()}
        onClose={() => setConfirmDiscard(null)}
        title="Unsaved changes"
        icon={FigureIcon}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiscard(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const next = confirmDiscard()
                setConfirmDiscard(null)
                studio.setDirty(false)
                void window.api.clearRecovery()
                next?.()
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const next = confirmDiscard()
                setConfirmDiscard(null)
                if (await save()) {
                  next?.()
                }
              }}
            >
              Save to .blend
            </Button>
          </>
        }
      >
        <p>
          Your animation has changes that aren't in {docName()} yet. Save them into the .blend
          first? The current file is backed up before it's overwritten.
        </p>
      </Modal>

      <Modal
        isOpen={diskChanged()}
        onClose={() => setDiskChanged(false)}
        title={`${docName()} changed on disk`}
        icon={RefreshCwIcon}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={async () => {
                // Keep mine: the next save writes over the newer file.
                setDiskChanged(false)
                const path = blendPath()
                if (path) {
                  await rememberDiskState(path)
                }
              }}
            >
              Keep mine
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiskChanged(false)
                studio.setDirty(false)
                void reloadInPlace()
              }}
            >
              Reload, discard mine
            </Button>
            <Button variant="primary" onClick={() => void mergeFromDisk()}>
              Merge
            </Button>
          </>
        }
      >
        <p>
          The .blend was saved by another program (probably Blender) while you have unsaved work
          here.
        </p>
        <ul class="list-disc pl-5 space-y-1 text-[var(--text-muted)]">
          <li>
            <b class="text-[var(--text-main)]">Merge</b> — reload the file and put your edited clips
            back on top. Everything you didn't touch here comes from the new file.
          </li>
          <li>
            <b class="text-[var(--text-main)]">Reload</b> — take the file as it is now and drop your
            unsaved changes.
          </li>
          <li>
            <b class="text-[var(--text-main)]">Keep mine</b> — carry on; saving rewrites only the
            actions you changed here.
          </li>
        </ul>
        <p class="text-[var(--text-muted)]">
          Tip: if Blender still has the file open after you save here, use File ▸ Revert there, or
          Blender's next save will undo MeshAnimate's changes.
        </p>
      </Modal>

      <Modal
        isOpen={!!recovery()}
        onClose={() => {
          setRecovery(null)
          void window.api.clearRecovery()
        }}
        title="Restore unsaved work?"
        icon={FigureIcon}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRecovery(null)
                void window.api.clearRecovery()
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const data = recovery()
                setRecovery(null)
                if (data) {
                  void openBlend(data.blendPath, data)
                }
              }}
            >
              Restore
            </Button>
          </>
        }
      >
        <p>
          MeshAnimate closed with unsaved animation work on{' '}
          <span class="font-semibold">{fileName(recovery()?.blendPath ?? '')}</span>. Restore it?
        </p>
      </Modal>

      <Toast toast={toast()} onClose={() => setToast(null)} />
    </div>
  )
}

function StartScreen(props: {
  blender: { path: string | null; version?: string } | null
  recent: string[]
  busy: boolean
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onLocateBlender: () => void
}): JSX.Element {
  const found = (): boolean => !!props.blender?.path
  return (
    <div class="absolute inset-0 flex items-center justify-center bg-[var(--bg-main)]/85 backdrop-blur-[2px]">
      <div class="w-[440px] p-6 rounded-[var(--ui-radius)] bg-[var(--bg-panel)] border border-[var(--border-color)] shadow-2xl flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <AppIcon size={40} />
          <div>
            <div class="text-base font-bold">MeshAnimate</div>
            <div class="text-[11px] text-[var(--text-muted)]">
              Pose-to-pose animation for rigged .blend files
            </div>
          </div>
        </div>

        <Button
          variant="primary"
          size="md"
          disabled={!found() || props.busy}
          onClick={props.onOpen}
          icon={<FolderOpenIcon size={15} />}
        >
          Open .blend…
        </Button>

        <Show when={props.recent.length > 0}>
          <div class="flex flex-col gap-0.5">
            <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] pb-1">
              Recent
            </div>
            <For each={props.recent.slice(0, 6)}>
              {(p) => (
                <button
                  type="button"
                  disabled={!found() || props.busy}
                  onClick={() => props.onOpenRecent(p)}
                  title={p}
                  class="flex items-center justify-between gap-3 h-7 px-2 rounded-[var(--ui-radius)] text-left text-xs text-[var(--text-main)] hover:bg-white/5 cursor-pointer disabled:opacity-40"
                >
                  <span class="font-medium truncate">{fileName(p)}</span>
                  <span class="text-[10px] text-[var(--text-muted)] truncate max-w-[220px]">
                    {p}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div
          class={`flex items-center justify-between gap-2 px-3 py-2 rounded-[var(--ui-radius)] border text-[11px] ${
            found()
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <span class="truncate" title={props.blender?.path ?? ''}>
            {props.blender === null
              ? 'Looking for Blender…'
              : found()
                ? `${props.blender?.version ?? 'Blender'} found`
                : 'Blender not found — MeshAnimate needs it to read and write .blend files'}
          </span>
          <Button size="xs" variant="outline" onClick={props.onLocateBlender}>
            {found() ? 'Change…' : 'Locate Blender…'}
          </Button>
        </div>
      </div>
    </div>
  )
}
