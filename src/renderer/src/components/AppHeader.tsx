import { createSignal, For, Show, type JSX } from 'solid-js'
import {
  AppIcon,
  CheckIcon,
  ChevronDownIcon,
  DevConsoleIcon,
  FocusIcon,
  HelpCircleIcon,
  SettingsIcon,
  RefreshCwIcon,
  UndoIcon,
  RedoIcon
} from './icons'
import { DropdownMenu, IconButton, type MenuItem } from './ui'
import type { LightingMode } from '../viewport/scene'
import { studio } from '../anim/studio'
import { t } from '../i18n'

export interface AppHeaderProps {
  docName: string
  busy: boolean
  menus: { label: string; title: string; items: MenuItem[] }[]
  lightingMode: LightingMode
  onSelectLightingMode: (m: LightingMode) => void
  onFrameCamera: () => void
  onOpenHelp: () => void
  onOpenSettings: () => void
}

const LIGHTING_OPTIONS: { value: LightingMode; swatch: string }[] = [
  { value: 'neutral', swatch: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)' },
  { value: 'flat', swatch: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)' },
  { value: 'outdoor', swatch: 'linear-gradient(135deg, #fbbf24 0%, #38bdf8 100%)' },
  { value: 'warm', swatch: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)' },
  { value: 'cool', swatch: 'linear-gradient(135deg, #38bdf8 0%, #3b82f6 100%)' }
]

export default function AppHeader(props: AppHeaderProps): JSX.Element {
  const [openMenu, setOpenMenu] = createSignal<string | null>(null)
  const current = (): (typeof LIGHTING_OPTIONS)[number] =>
    LIGHTING_OPTIONS.find((o) => o.value === props.lightingMode) ?? LIGHTING_OPTIONS[0]

  return (
    <header class="h-10 min-h-10 px-3 bg-[var(--bg-panel-header)] border-b border-[var(--border-color)] flex items-center justify-between select-none z-40 shrink-0 text-xs text-[var(--text-main)]">
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex items-center gap-2 pr-3 border-r border-[var(--border-color)] shrink-0">
          <AppIcon size={18} class="shrink-0" />
          <span class="font-bold text-xs tracking-tight hidden sm:inline">
            {t('common.appName')}
          </span>
          <span class="text-[var(--text-muted)]">/</span>
          <span
            class="font-medium text-[var(--text-muted)] max-w-[220px] truncate"
            title={props.docName}
          >
            {props.docName}
            {studio.dirty() ? ' *' : ''}
          </span>
          <Show when={props.busy}>
            <RefreshCwIcon size={11} class="animate-spin text-[var(--accent-color)] ml-1" />
          </Show>
        </div>

        <nav class="flex items-center gap-1 shrink-0">
          <For each={props.menus}>
            {(menu) => (
              <div class="relative">
                <button
                  type="button"
                  title={menu.title}
                  class={`px-2.5 py-1 rounded-[var(--ui-radius)] text-xs font-medium transition-colors cursor-pointer ${
                    openMenu() === menu.label
                      ? 'bg-[var(--accent-color)] text-[var(--accent-text)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
                  }`}
                  onClick={() => setOpenMenu((m) => (m === menu.label ? null : menu.label))}
                >
                  {menu.label}
                </button>
                <DropdownMenu
                  isOpen={openMenu() === menu.label}
                  onClose={() => setOpenMenu(null)}
                  items={menu.items}
                />
              </div>
            )}
          </For>
        </nav>

        <div class="flex items-center gap-0.5 pl-2 border-l border-[var(--border-color)]">
          <IconButton
            size="xs"
            variant="ghost"
            disabled={!studio.canUndo()}
            tooltip={t('header.undo')}
            onClick={() => studio.undo()}
          >
            <UndoIcon size={14} />
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            disabled={!studio.canRedo()}
            tooltip={t('header.redo')}
            onClick={() => studio.redo()}
          >
            <RedoIcon size={14} />
          </IconButton>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <div class="relative">
          <button
            type="button"
            class={`flex items-center gap-2 h-7 px-2.5 rounded-[var(--ui-radius)] border text-xs transition-colors cursor-pointer ${
              openMenu() === '__light'
                ? 'border-blue-500/50 bg-[var(--bg-input)]'
                : 'bg-[var(--bg-input)] border-[var(--border-color)] hover:border-white/20'
            }`}
            onClick={() => setOpenMenu((m) => (m === '__light' ? null : '__light'))}
            title={t('header.lighting', {
              label: t(`lighting.${current().value}.label`),
              subtitle: t(`lighting.${current().value}.subtitle`)
            })}
          >
            <span
              class="w-2.5 h-2.5 rounded-full border border-white/20"
              style={{ background: current().swatch }}
            />
            <span class="font-medium">{t(`lighting.${current().value}.label`)}</span>
            <ChevronDownIcon size={12} class="text-[var(--text-muted)]" />
          </button>
          <Show when={openMenu() === '__light'}>
            <div class="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
            <div class="absolute right-0 top-full mt-1.5 z-50 min-w-[230px] p-1.5 bg-zinc-900/98 backdrop-blur-md border border-zinc-750/90 rounded-xl shadow-2xl shadow-black/80 flex flex-col gap-0.5">
              <div class="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Lighting Preset
              </div>
              <For each={LIGHTING_OPTIONS}>
                {(item) => {
                  const sel = (): boolean => props.lightingMode === item.value
                  return (
                    <button
                      type="button"
                      class={`flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                        sel() ? 'bg-blue-600 text-white' : 'text-zinc-200 hover:bg-zinc-800/80'
                      }`}
                      onClick={() => {
                        props.onSelectLightingMode(item.value)
                        setOpenMenu(null)
                      }}
                    >
                      <span
                        class="w-3.5 h-3.5 rounded-full border border-white/25"
                        style={{ background: item.swatch }}
                      />
                      <div class="flex flex-col flex-1 min-w-0">
                        <span class="font-semibold leading-tight">
                          {t(`lighting.${item.value}.label`)}
                        </span>
                        <span
                          class={`text-[10px] leading-tight ${sel() ? 'text-blue-100' : 'text-zinc-400'}`}
                        >
                          {t(`lighting.${item.value}.subtitle`)}
                        </span>
                      </div>
                      <Show when={sel()}>
                        <CheckIcon size={14} />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>

        <div class="w-px h-4 bg-[var(--border-color)]" />
        <IconButton
          size="xs"
          variant="ghost"
          onClick={props.onFrameCamera}
          tooltip={t('header.frameModel')}
        >
          <FocusIcon size={15} />
        </IconButton>
        <IconButton
          size="xs"
          variant="ghost"
          onClick={() => window.api.toggleDevTools()}
          tooltip={t('header.devConsole')}
        >
          <DevConsoleIcon size={15} />
        </IconButton>
        <IconButton
          size="xs"
          variant="ghost"
          onClick={props.onOpenSettings}
          tooltip={t('header.preferences')}
        >
          <SettingsIcon size={15} />
        </IconButton>
        <IconButton size="xs" variant="ghost" onClick={props.onOpenHelp} tooltip={t('header.help')}>
          <HelpCircleIcon size={15} />
        </IconButton>
      </div>
    </header>
  )
}
