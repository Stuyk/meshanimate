import { createSignal, For, Show, type JSX } from 'solid-js'
import { DEFAULT_DISPLAY, studio } from '../anim/studio'
import { formatGrid } from '../viewport/snap'
import { BoneIcon, GhostIcon, MagnetIcon, SettingsIcon } from './icons'
import { Button, Modal, SegmentedControl, Slider, ToggleSwitch } from './ui'

const GRID_STEPS = [0.01, 0.025, 0.05, 0.1, 0.25]
const ANGLE_STEPS = [5, 10, 15, 30, 45]

function Heading(props: { children: JSX.Element }): JSX.Element {
  return (
    <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] pt-1">
      {props.children}
    </div>
  )
}

function ColorField(props: {
  label: string
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label class="flex items-center justify-between gap-2 text-[11px] text-[var(--text-main)]">
      {props.label}
      <input
        type="color"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        class="w-10 h-6 rounded-[var(--ui-radius)] border border-[var(--border-color)] bg-transparent cursor-pointer"
      />
    </label>
  )
}

export default function PreferencesModal(props: {
  isOpen: boolean
  onClose: () => void
  blender: { path: string | null; version?: string } | null
  onLocateBlender: () => void
  onAutoDetectBlender: () => void
}): JSX.Element {
  const d = studio.display
  const snap = studio.snap
  const [confirmReset, setConfirmReset] = createSignal(false)

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Preferences"
      icon={SettingsIcon}
      size="md"
      footer={
        <>
          <Show
            when={confirmReset()}
            fallback={
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                Reset to defaults
              </Button>
            }
          >
            <Button
              variant="danger"
              onClick={() => {
                studio.setDisplay(DEFAULT_DISPLAY)
                studio.setSnap({ enabled: true, grid: 0.05, angle: 15 })
                setConfirmReset(false)
              }}
            >
              Really reset?
            </Button>
          </Show>
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        </>
      }
    >
      <Heading>Blender</Heading>
      <div class="flex items-center justify-between gap-2 p-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
        <div class="flex flex-col min-w-0">
          <span class="font-semibold">
            {props.blender?.path ? (props.blender.version ?? 'Blender') : 'Blender not found'}
          </span>
          <span
            class="text-[10px] text-[var(--text-muted)] truncate"
            title={props.blender?.path ?? ''}
          >
            {props.blender?.path ?? 'MeshAnimate needs Blender to read and write .blend files.'}
          </span>
        </div>
        <div class="flex gap-1 shrink-0">
          <Button size="xs" variant="ghost" onClick={props.onAutoDetectBlender}>
            Find automatically
          </Button>
          <Button size="xs" onClick={props.onLocateBlender}>
            Choose…
          </Button>
        </div>
      </div>

      <Heading>Posing</Heading>
      <ToggleSwitch
        label="Auto-key when the app starts"
        description="Every pose edit writes a key at the playhead"
        checked={d().autoKeyDefault}
        onChange={(v) => studio.setDisplay({ ...d(), autoKeyDefault: v })}
      />
      <ToggleSwitch
        label="Snapping on"
        icon={MagnetIcon}
        checked={snap().enabled}
        onChange={(enabled) => studio.setSnap({ enabled })}
      />
      <div class="grid grid-cols-[90px_1fr] items-center gap-2">
        <span class="text-[11px] text-[var(--text-muted)]">Grid</span>
        <SegmentedControl
          size="xs"
          value={snap().grid}
          onChange={(grid) => studio.setSnap({ grid })}
          options={GRID_STEPS.map((g) => ({ value: g, label: formatGrid(g).replace(' ', '') }))}
        />
        <span class="text-[11px] text-[var(--text-muted)]">Angle step</span>
        <SegmentedControl
          size="xs"
          value={snap().angle}
          onChange={(angle) => studio.setSnap({ angle })}
          options={ANGLE_STEPS.map((a) => ({ value: a, label: `${a}°` }))}
        />
      </div>

      <Heading>Viewport</Heading>
      <Slider
        label="Handle size"
        value={d().jointSize}
        min={0.5}
        max={2.5}
        step={0.1}
        displayValue={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => studio.setDisplay({ ...d(), jointSize: v })}
      />
      <ToggleSwitch
        label="Show bones hidden in Blender"
        icon={BoneIcon}
        checked={d().showHidden}
        onChange={(v) => studio.setDisplay({ ...d(), showHidden: v })}
      />
      <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] pt-1">
        <GhostIcon size={12} /> Onion skin colours
      </div>
      <div class="grid grid-cols-2 gap-3">
        <For
          each={[
            { label: 'Before the playhead', key: 'onionBefore' as const },
            { label: 'After the playhead', key: 'onionAfter' as const },
            { label: 'First-frame ghost', key: 'firstFrameColor' as const }
          ]}
        >
          {(c) => (
            <ColorField
              label={c.label}
              value={d()[c.key]}
              onChange={(v) => studio.setDisplay({ ...d(), [c.key]: v })}
            />
          )}
        </For>
      </div>

      <Heading>Saving</Heading>
      <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
        Before each save the .blend is copied to a <code>.meshanimate-backups</code> folder next to
        it; the newest 20 copies per file are kept. Only actions you changed are rewritten, and
        bones you didn't touch keep Blender's original curves.
      </p>
    </Modal>
  )
}
