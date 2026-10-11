import { For, type JSX } from 'solid-js'
import { studio, type PoseTool } from '../anim/studio'
import { mirrorLivePose } from '../anim/actions'
import { MagnetIcon, MirrorIcon, MoveIcon, PoseIcon, Rotate3dIcon } from './icons'
import { IconButton } from './ui'
import { t } from '../i18n'

const TOOLS: {
  value: PoseTool
  key: string
  Icon: (p: { size?: number }) => JSX.Element
}[] = [
  { value: 'pose', key: 'Q', Icon: PoseIcon },
  { value: 'rotate', key: 'E', Icon: Rotate3dIcon },
  { value: 'move', key: 'W', Icon: MoveIcon }
]

export default function ToolRail(): JSX.Element {
  return (
    <div class="w-11 min-w-11 flex flex-col items-center gap-1.5 py-2 bg-[var(--bg-panel-header)] border-r border-[var(--border-color)]">
      <For each={TOOLS}>
        {(tool) => (
          <IconButton
            size="md"
            active={studio.tool() === tool.value}
            tooltip={t('tools.withKey', { label: t(`tools.${tool.value}`), key: tool.key })}
            shortcut={tool.key}
            onClick={() => studio.setTool(tool.value)}
          >
            <tool.Icon size={17} />
          </IconButton>
        )}
      </For>
      <div class="w-6 h-px bg-[var(--border-color)] my-1" />
      <IconButton
        size="md"
        toggled={studio.snap().enabled}
        tooltip={t('tools.snapping')}
        shortcut="S"
        onClick={() => studio.setSnap({ enabled: !studio.snap().enabled })}
      >
        <MagnetIcon size={17} />
      </IconButton>
      <IconButton size="md" tooltip={t('tools.mirror')} shortcut="M" onClick={mirrorLivePose}>
        <MirrorIcon size={17} />
      </IconButton>
      <div class="w-6 h-px bg-[var(--border-color)] my-1" />
      <For each={[1, 2, 3]}>
        {(n) => (
          <button
            type="button"
            title={t('tools.reach', { count: n })}
            onClick={() => studio.setIkChain(n)}
            class={`w-9 h-6 rounded-[var(--ui-radius)] text-[10px] font-bold font-mono border cursor-pointer transition-colors ${
              studio.ikChain() === n
                ? 'bg-[var(--accent-color)]/20 border-[var(--accent-color)] text-[var(--text-main)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
            }`}
          >
            {n === 1 ? t('tools.fk') : t('tools.ik', { count: n })}
          </button>
        )}
      </For>
    </div>
  )
}
