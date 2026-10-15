import { For, type JSX } from 'solid-js'
import { HelpCircleIcon } from './icons'
import { Kbd, Modal } from './ui'
import { t } from '../i18n'

const STEPS = ['open', 'grab', 'ik', 'save'] as const

const HOTKEYS = [
  'play',
  'frame',
  'key',
  'ends',
  'keyPose',
  'deleteKeys',
  'copyPaste',
  'copyPasteBone',
  'mirror',
  'halfCycle',
  'range',
  'boxSelect',
  'onion',
  'firstFrame',
  'tools',
  'reach',
  'frameModel',
  'snapping',
  'views',
  'undo',
  'save',
  'open',
  'orbit',
  'zoom',
  'timelineZoom'
] as const

export default function HelpModal(props: { isOpen: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('help.title')}
      icon={HelpCircleIcon}
      size="lg"
    >
      <div class="grid grid-cols-2 gap-2">
        <For each={STEPS}>
          {(s, i) => (
            <div class="p-3 rounded-[var(--ui-radius)] bg-[var(--bg-input)] border border-[var(--border-color)]">
              <div class="flex items-center gap-2 font-bold text-[var(--text-main)]">
                <span class="w-5 h-5 rounded-full bg-[var(--accent-color)] text-white text-[11px] flex items-center justify-center">
                  {i() + 1}
                </span>
                {t(`help.steps.${s}.title`)}
              </div>
              <p class="mt-1.5 text-[11px] text-[var(--text-muted)] leading-relaxed">
                {t(`help.steps.${s}.body`)}
              </p>
            </div>
          )}
        </For>
      </div>
      <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] pt-2">
        {t('help.hotkeysHeading')}
      </div>
      <div class="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <For each={HOTKEYS}>
          {(h) => (
            <div class="flex items-center justify-between gap-3">
              <span class="text-[var(--text-muted)]">{t(`help.hotkeys.${h}.action`)}</span>
              <Kbd size="xs">{t(`help.hotkeys.${h}.keys`)}</Kbd>
            </div>
          )}
        </For>
      </div>
    </Modal>
  )
}
