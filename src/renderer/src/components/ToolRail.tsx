import { For, type JSX } from 'solid-js'
import { studio, type PoseTool } from '../anim/studio'
import { mirrorLivePose } from '../anim/actions'
import { MagnetIcon, MirrorIcon, MoveIcon, PoseIcon, Rotate3dIcon } from './icons'
import { IconButton } from './ui'

const TOOLS: {
  value: PoseTool
  key: string
  label: string
  Icon: (p: { size?: number }) => JSX.Element
}[] = [
  { value: 'pose', key: 'Q', label: 'Pose — drag handles to swing bones', Icon: PoseIcon },
  {
    value: 'rotate',
    key: 'E',
    label: 'Rotate gizmo — twist the selected joint on any axis',
    Icon: Rotate3dIcon
  },
  { value: 'move', key: 'W', label: 'Move gizmo — translate the selected joint', Icon: MoveIcon }
]

export default function ToolRail(): JSX.Element {
  return (
    <div class="w-11 min-w-11 flex flex-col items-center gap-1.5 py-2 bg-[var(--bg-panel-header)] border-r border-[var(--border-color)]">
      <For each={TOOLS}>
        {(t) => (
          <IconButton
            size="md"
            active={studio.tool() === t.value}
            tooltip={`${t.label} (${t.key})`}
            shortcut={t.key}
            onClick={() => studio.setTool(t.value)}
          >
            <t.Icon size={17} />
          </IconButton>
        )}
      </For>
      <div class="w-6 h-px bg-[var(--border-color)] my-1" />
      <IconButton
        size="md"
        toggled={studio.snap().enabled}
        tooltip="Snap to the view-plane grid and angle steps (S) — hold Ctrl to flip for one drag"
        shortcut="S"
        onClick={() => studio.setSnap({ enabled: !studio.snap().enabled })}
      >
        <MagnetIcon size={17} />
      </IconButton>
      <IconButton
        size="md"
        tooltip="Mirror pose left ↔ right (M)"
        shortcut="M"
        onClick={mirrorLivePose}
      >
        <MirrorIcon size={17} />
      </IconButton>
      <div class="w-6 h-px bg-[var(--border-color)] my-1" />
      <For each={[1, 2, 3]}>
        {(n) => (
          <button
            type="button"
            title={n === 1 ? 'FK — swing one bone (1)' : `IK — bend ${n} bones to reach (${n})`}
            onClick={() => studio.setIkChain(n)}
            class={`w-9 h-6 rounded-[var(--ui-radius)] text-[10px] font-bold font-mono border cursor-pointer transition-colors ${
              studio.ikChain() === n
                ? 'bg-[var(--accent-color)]/20 border-[var(--accent-color)] text-[var(--text-main)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-white/5'
            }`}
          >
            {n === 1 ? 'FK' : `IK${n}`}
          </button>
        )}
      </For>
    </div>
  )
}
