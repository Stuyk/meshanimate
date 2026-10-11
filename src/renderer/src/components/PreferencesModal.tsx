import { createSignal, For, Show, type JSX } from 'solid-js'
import { DEFAULT_DISPLAY, studio } from '../anim/studio'
import { formatGrid } from '../viewport/snap'
import { BoneIcon, GhostIcon, MagnetIcon, SettingsIcon } from './icons'
import { Button, Modal, SegmentedControl, Slider, ToggleSwitch } from './ui'
import { t, tr } from '../i18n'

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
      title={t('prefs.title')}
      icon={SettingsIcon}
      size="md"
      footer={
        <>
          <Show
            when={confirmReset()}
            fallback={
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                {t('prefs.reset')}
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
              {t('prefs.reallyReset')}
            </Button>
          </Show>
          <Button variant="primary" onClick={props.onClose}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      <Heading>{t('prefs.blenderHeading')}</Heading>
      <div class="flex items-center justify-between gap-2 p-2 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
        <div class="flex flex-col min-w-0">
          <span class="font-semibold">
            {props.blender?.path
              ? (props.blender.version ?? t('common.blender'))
              : t('prefs.blenderNotFound')}
          </span>
          <span
            class="text-[10px] text-[var(--text-muted)] truncate"
            title={props.blender?.path ?? ''}
          >
            {props.blender?.path ?? t('prefs.blenderNeeded')}
          </span>
        </div>
        <div class="flex gap-1 shrink-0">
          <Button size="xs" variant="ghost" onClick={props.onAutoDetectBlender}>
            {t('prefs.findAutomatically')}
          </Button>
          <Button size="xs" onClick={props.onLocateBlender}>
            {t('common.choose')}
          </Button>
        </div>
      </div>

      <Heading>{t('prefs.posingHeading')}</Heading>
      <ToggleSwitch
        label={t('prefs.autoKey')}
        description={t('prefs.autoKeyHelp')}
        checked={d().autoKeyDefault}
        onChange={(v) => studio.setDisplay({ ...d(), autoKeyDefault: v })}
      />
      <ToggleSwitch
        label={t('prefs.snapping')}
        icon={MagnetIcon}
        checked={snap().enabled}
        onChange={(enabled) => studio.setSnap({ enabled })}
      />
      <div class="grid grid-cols-[90px_1fr] items-center gap-2">
        <span class="text-[11px] text-[var(--text-muted)]">{t('prefs.grid')}</span>
        <SegmentedControl
          size="xs"
          value={snap().grid}
          onChange={(grid) => studio.setSnap({ grid })}
          options={GRID_STEPS.map((g) => ({ value: g, label: formatGrid(g).replace(' ', '') }))}
        />
        <span class="text-[11px] text-[var(--text-muted)]">{t('prefs.angleStep')}</span>
        <SegmentedControl
          size="xs"
          value={snap().angle}
          onChange={(angle) => studio.setSnap({ angle })}
          options={ANGLE_STEPS.map((a) => ({ value: a, label: `${a}°` }))}
        />
      </div>

      <Heading>{t('prefs.viewportHeading')}</Heading>
      <Slider
        label={t('display.handleSize')}
        value={d().jointSize}
        min={0.5}
        max={2.5}
        step={0.1}
        displayValue={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => studio.setDisplay({ ...d(), jointSize: v })}
      />
      <ToggleSwitch
        label={t('display.showHidden')}
        icon={BoneIcon}
        checked={d().showHidden}
        onChange={(v) => studio.setDisplay({ ...d(), showHidden: v })}
      />
      <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] pt-1">
        <GhostIcon size={12} /> {t('prefs.onionColours')}
      </div>
      <div class="grid grid-cols-2 gap-3">
        <For
          each={[
            { label: 'prefs.beforePlayhead' as const, key: 'onionBefore' as const },
            { label: 'prefs.afterPlayhead' as const, key: 'onionAfter' as const },
            { label: 'prefs.firstFrameGhost' as const, key: 'firstFrameColor' as const }
          ]}
        >
          {(c) => (
            <ColorField
              label={t(c.label)}
              value={d()[c.key]}
              onChange={(v) => studio.setDisplay({ ...d(), [c.key]: v })}
            />
          )}
        </For>
      </div>

      <Heading>{t('prefs.savingHeading')}</Heading>
      <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
        {tr('prefs.savingInfo', { folder: <code>.meshanimate-backups</code> })}
      </p>
    </Modal>
  )
}
