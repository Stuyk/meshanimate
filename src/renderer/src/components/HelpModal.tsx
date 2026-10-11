import { For, type JSX } from 'solid-js'
import { HelpCircleIcon } from './icons'
import { Kbd, Modal } from './ui'

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Open a .blend',
    body: 'MeshAnimate reads your rig and every action straight from the .blend (Blender does the reading, so it must be installed). Each action becomes a clip.'
  },
  {
    title: 'Grab a handle',
    body: 'Red circles sit at the end of every bone: drag one and the bone swings about its joint, Pivot-style. The orange square moves the whole rig.'
  },
  {
    title: 'IK limbs',
    body: 'Limbs driven by Blender IK are orange. Drag the ring at the end (or the ◎ target) to place the foot or hand; drag the knee, or the ◆ pole, to aim the joint.'
  },
  {
    title: 'Key, time, save',
    body: 'With Auto-key on, every pose becomes a key (◆) at the playhead. Drag keys to retime, right-click for easing. Ctrl+S writes the changed actions back into the .blend — a backup is kept first.'
  }
]

const HOTKEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← / →', 'Previous / next frame'],
  ['Shift + ← / →', 'Previous / next key'],
  ['Home / End', 'First / last frame'],
  ['K', 'Key the current pose'],
  ['Delete', 'Delete selected keys'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste pose'],
  ['M', 'Mirror pose left ↔ right'],
  ['Shift+M', 'Mirror to half-cycle (walk cycles)'],
  ['[ / ] / \\', 'Preview range start / end / clear'],
  ['Drag on track', 'Box-select keys (Shift adds)'],
  ['O', 'Toggle onion skin'],
  ['Shift+O', 'First-frame ghost (starting pose at every frame)'],
  ['Q / E / W', 'Pose handles / rotate gizmo / move gizmo'],
  ['1 / 2 / 3', 'Drag swings 1 bone, or bends 2 / 3 (FK reach)'],
  ['F', 'Frame the model'],
  ['S', 'Snapping on / off (hold Ctrl to flip for one drag)'],
  ['Num 1 / 3 / 7', 'Front / side / top view (Ctrl: opposite)'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+S / Ctrl+Shift+S', 'Save into the .blend / Save As'],
  ['Ctrl+O', 'Open a .blend'],
  ['Right-drag', 'Orbit (Shift: pan)'],
  ['Wheel', 'Zoom'],
  ['Ctrl + wheel on timeline', 'Zoom timeline']
]

export default function HelpModal(props: { isOpen: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="MeshAnimate Quick Guide"
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
                {s.title}
              </div>
              <p class="mt-1.5 text-[11px] text-[var(--text-muted)] leading-relaxed">{s.body}</p>
            </div>
          )}
        </For>
      </div>
      <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] pt-2">
        Hotkeys
      </div>
      <div class="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <For each={HOTKEYS}>
          {([k, v]) => (
            <div class="flex items-center justify-between gap-3">
              <span class="text-[var(--text-muted)]">{v}</span>
              <Kbd size="xs">{k}</Kbd>
            </div>
          )}
        </For>
      </div>
    </Modal>
  )
}
