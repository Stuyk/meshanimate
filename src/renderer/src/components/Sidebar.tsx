import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import * as THREE from 'three'
import { studio } from '../anim/studio'
import { mirrorLivePose, resetToRest, setJointChannels } from '../anim/actions'
import { formatGrid } from '../viewport/snap'
import { poseThumbnail } from '../anim/thumbnail'
import type { IkConstraint } from '../anim/ik'
import type { Quat, Vec3 } from '../anim/types'
import {
  BoneIcon,
  ClapperboardIcon,
  CopyIcon,
  Edit2Icon,
  EyeIcon,
  EyeOffIcon,
  FigureIcon,
  GhostIcon,
  ImagesIcon,
  MagnetIcon,
  MirrorIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon
} from './icons'
import {
  Button,
  IconButton,
  NumberInput,
  PanelSection,
  SearchInput,
  Slider,
  ToggleSwitch,
  SegmentedControl
} from './ui'

const AXIS_COLORS = ['#ff5c5c', '#5ad15a', '#4d9bff']

function ClipsSection(): JSX.Element {
  const [renaming, setRenaming] = createSignal<string | null>(null)
  return (
    <PanelSection
      title="Clips"
      icon={ClapperboardIcon}
      badge={studio.clips().length}
      actions={
        <IconButton
          size="xs"
          tooltip="New clip"
          onClick={() =>
            studio.addClip(`Clip ${studio.clips().length + 1}`, studio.rig()?.rest ?? null)
          }
        >
          <PlusIcon size={13} />
        </IconButton>
      }
    >
      <div class="flex flex-col gap-0.5 -mx-1 max-h-[260px] overflow-y-auto dcc-scroll">
        <For each={studio.clips()}>
          {(clip) => {
            const active = (): boolean => studio.activeClip()?.id === clip.id
            // Mid-clip pose as a tiny stick figure; redrawn when the clip changes.
            const thumb = createMemo(() => {
              const rig = studio.rig()
              return rig
                ? poseThumbnail(rig, studio.poseAt(clip, Math.floor(clip.length / 2)), 44, 30)
                : ''
            })
            return (
              <div
                class={`group flex items-center gap-1.5 h-9 pl-1 pr-1 rounded-[var(--ui-radius)] cursor-pointer transition-colors ${
                  active()
                    ? 'bg-[var(--accent-color)]/20 text-[var(--text-main)] border border-[var(--accent-color)]/50'
                    : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-main)] border border-transparent'
                }`}
                onClick={() => studio.selectClip(clip.id)}
                onDblClick={() => setRenaming(clip.id)}
              >
                <img
                  src={thumb()}
                  alt=""
                  width={44}
                  height={30}
                  class="shrink-0 rounded-[2px] bg-[var(--bg-input)] border border-[var(--border-color)]"
                />
                <Show
                  when={renaming() === clip.id}
                  fallback={<span class="flex-1 truncate font-medium">{clip.name}</span>}
                >
                  <input
                    ref={(el) => setTimeout(() => el.select(), 0)}
                    class="flex-1 min-w-0 h-5 px-1 bg-[var(--bg-input)] border border-[var(--accent-color)] rounded-[2px] text-xs text-white outline-none"
                    value={clip.name}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') {
                        studio.renameClip(clip.id, e.currentTarget.value)
                        setRenaming(null)
                      } else if (e.key === 'Escape') {
                        setRenaming(null)
                      }
                    }}
                    onBlur={(e) => {
                      studio.renameClip(clip.id, e.currentTarget.value)
                      setRenaming(null)
                    }}
                  />
                </Show>
                <span class="font-mono text-[10px] opacity-70">
                  {clip.keys.length}k · {clip.length}f
                </span>
                <div class="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconButton
                    size="xs"
                    tooltip="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenaming(clip.id)
                    }}
                  >
                    <Edit2Icon size={11} />
                  </IconButton>
                  <IconButton
                    size="xs"
                    tooltip="Duplicate"
                    onClick={(e) => {
                      e.stopPropagation()
                      studio.duplicateClip(clip.id)
                    }}
                  >
                    <CopyIcon size={11} />
                  </IconButton>
                  <Show when={studio.clips().length > 1}>
                    <IconButton
                      size="xs"
                      tooltip="Delete clip"
                      onClick={(e) => {
                        e.stopPropagation()
                        studio.deleteClip(clip.id)
                      }}
                    >
                      <TrashIcon size={11} />
                    </IconButton>
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </PanelSection>
  )
}

/** Same symbols as the viewport: ■ root, ● bone, ◎ IK target, ◆ pole. */
function marker(name: string, depth: number): { glyph: string; color: string } {
  const role = studio.rig()?.roles.get(name)
  if (role === 'ikTarget') {
    return { glyph: '◎', color: 'text-[#ffa940]' }
  }
  if (role === 'pole') {
    return { glyph: '◆', color: 'text-[#b37feb]' }
  }
  return depth === 0
    ? { glyph: '■', color: 'text-[#ffa940]' }
    : { glyph: '●', color: 'text-[#ff6b6b]' }
}

function SkeletonSection(): JSX.Element {
  const [filter, setFilter] = createSignal('')
  const rows = createMemo(() => {
    const rig = studio.rig()
    if (!rig) {
      return []
    }
    const depth = new Map<string, number>()
    const q = filter().trim().toLowerCase()
    // By Blender bone name — node names are glTF-sanitized ("Arm.L" → "ArmL").
    return [...rig.jointByName.keys()]
      .map((name) => {
        const p = rig.parentOf.get(name)
        const d = p ? (depth.get(p) ?? 0) + 1 : 0
        depth.set(name, d)
        return { name, depth: d }
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q))
  })

  return (
    <PanelSection title="Skeleton" icon={BoneIcon} badge={studio.rig()?.jointByName.size ?? 0}>
      <Show when={(studio.rig()?.jointByName.size ?? 0) > 8}>
        <SearchInput value={filter()} onInput={setFilter} placeholder="Find joint…" />
      </Show>
      <div class="flex flex-col -mx-1 max-h-[240px] overflow-y-auto dcc-scroll font-mono text-[11px]">
        <For each={rows()}>
          {(r) => {
            const sel = (): boolean => studio.selectedJoint() === r.name
            const hidden = (): boolean => !!studio.rig()?.bones.get(r.name)?.hidden
            return (
              <button
                title={hidden() ? `${r.name} is hidden in Blender` : r.name}
                type="button"
                class={`flex items-center gap-1 h-6 pr-2 rounded-[2px] text-left cursor-pointer transition-colors ${
                  sel()
                    ? 'bg-[var(--accent-color)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-main)]'
                }`}
                style={{ 'padding-left': `${6 + Math.min(r.depth, 12) * 10}px` }}
                onClick={() => studio.setSelectedJoint(sel() ? null : r.name)}
                onDblClick={() => {
                  studio.setSelectedJoint(r.name)
                  studio.focusBone(r.name)
                }}
              >
                <span class={sel() ? 'text-white' : marker(r.name, r.depth).color}>
                  {marker(r.name, r.depth).glyph}
                </span>
                <span class={`truncate ${hidden() && !sel() ? 'opacity-45' : ''}`}>{r.name}</span>
                <Show when={hidden()}>
                  <EyeOffIcon size={10} class="ml-auto shrink-0 opacity-60" />
                </Show>
                <Show when={studio.rig()?.ikDriven.has(r.name)}>
                  <span class="ml-auto text-[9px] font-sans font-bold text-amber-400/80">IK</span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>
    </PanelSection>
  )
}

function JointSection(): JSX.Element {
  const name = (): string | null => studio.selectedJoint()
  const rig = (): ReturnType<typeof studio.rig> => studio.rig()
  /** The selected bone's pose channels (Blender's Location / Rotation). */
  const channels = createMemo(() => {
    studio.poseTick()
    const n = name()
    return n ? (rig()?.basis[n] ?? null) : null
  })
  const euler = createMemo(() => {
    const jp = channels()
    if (!jp) {
      return [0, 0, 0]
    }
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...jp.r), 'XYZ')
    return [e.x, e.y, e.z].map((v) => THREE.MathUtils.radToDeg(v))
  })
  const role = (): string => (name() ? (rig()?.roles.get(name()!) ?? 'bone') : 'bone')
  const driver = (): IkConstraint | undefined => (name() ? rig()?.ikDriven.get(name()!) : undefined)
  const targetOf = (): IkConstraint | undefined =>
    rig()?.ik.find((c) => c.target === name() || c.pole === name())

  const setRot = (axis: number, deg: number): void => {
    const n = name()
    const jp = channels()
    if (!n || !jp) {
      return
    }
    const next = [...euler()]
    next[axis] = deg
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        ...(next.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]),
        'XYZ'
      )
    )
    setJointChannels(n, { ...jp, r: q.toArray() as Quat })
  }

  const setLoc = (axis: number, v: number): void => {
    const n = name()
    const jp = channels()
    if (!n || !jp) {
      return
    }
    const p = [...jp.p] as Vec3
    p[axis] = v
    setJointChannels(n, { ...jp, p })
  }

  return (
    <PanelSection title="Bone" icon={FigureIcon} summary={name()}>
      <Show
        when={channels()}
        fallback={
          <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Click a handle in the viewport, a body part, or a row in the skeleton list to select a
            bone.
          </p>
        }
      >
        <div class="space-y-1.5">
          <Show when={driver()}>
            {(c) => (
              <div class="p-2 rounded-[var(--ui-radius)] border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-200 leading-relaxed">
                Driven by IK on <b>{c().owner}</b>. Drag its orange ring (or move{' '}
                <b>{c().target}</b>) to pose this limb
                {c().pole ? (
                  <>
                    ; the knee/elbow follows <b>{c().pole}</b>
                  </>
                ) : null}
                .
                <div class="flex gap-1 pt-1.5">
                  <Button size="xs" onClick={() => studio.setSelectedJoint(c().target)}>
                    Select target
                  </Button>
                  <Show when={c().pole}>
                    <Button size="xs" onClick={() => studio.setSelectedJoint(c().pole)}>
                      Select pole
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </Show>
          <Show when={role() !== 'bone' && targetOf()}>
            {(c) => (
              <div class="text-[11px] text-[var(--text-muted)]">
                {role() === 'ikTarget' ? 'IK target' : 'Pole target'} for{' '}
                <b class="text-[var(--text-main)]">{c().owner}</b> — drag it in the viewport.
              </div>
            )}
          </Show>
          <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Location
          </div>
          <div class="grid grid-cols-3 gap-1">
            <For each={[0, 1, 2]}>
              {(axis) => (
                <NumberInput
                  value={channels()!.p[axis]}
                  prefix={'XYZ'[axis]}
                  prefixColor={AXIS_COLORS[axis]}
                  step={0.005}
                  precision={3}
                  onChange={(v) => setLoc(axis, v)}
                />
              )}
            </For>
          </div>
          <Show when={!driver()}>
            <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] pt-1">
              Rotation°
            </div>
            <div class="grid grid-cols-3 gap-1">
              <For each={[0, 1, 2]}>
                {(axis) => (
                  <NumberInput
                    value={euler()[axis]}
                    prefix={'XYZ'[axis]}
                    prefixColor={AXIS_COLORS[axis]}
                    step={0.5}
                    precision={1}
                    onChange={(v) => setRot(axis, v)}
                  />
                )}
              </For>
            </div>
          </Show>
          <div class="text-[10px] text-[var(--text-muted)]">
            Pose channels, as in Blender's Bone panel (relative to rest).
          </div>
          <div class="flex gap-1 pt-1">
            <Button
              size="xs"
              class="flex-1"
              icon={<RefreshCwIcon size={12} />}
              onClick={() => resetToRest(name()!)}
            >
              Clear transform
            </Button>
          </div>
        </div>
      </Show>
    </PanelSection>
  )
}

function RigSection(): JSX.Element {
  const rig = (): ReturnType<typeof studio.rig> => studio.rig()
  return (
    <Show when={rig() && (rig()!.ik.length > 0 || rig()!.warnings.length > 0)}>
      <PanelSection title="Rig" icon={BoneIcon} defaultOpen={false} badge={rig()!.ik.length}>
        <For each={rig()!.ik}>
          {(c) => (
            <button
              type="button"
              class="flex flex-col w-full text-left p-1.5 rounded-[var(--ui-radius)] hover:bg-white/5 cursor-pointer"
              onClick={() => studio.setSelectedJoint(c.target)}
              title="Select the IK target"
            >
              <span class="text-[11px] font-semibold text-[var(--text-main)]">
                IK · {c.owner}{' '}
                <span class="text-[var(--text-muted)] font-normal">
                  ({c.chainCount || '∞'} bones)
                </span>
              </span>
              <span class="text-[10px] text-[var(--text-muted)]">
                ◎ {c.target}
                {c.pole ? ` · ◆ ${c.pole}` : ''}
              </span>
            </button>
          )}
        </For>
        <Show when={rig()!.warnings.length > 0}>
          <p class="text-[10px] text-[var(--text-muted)] leading-snug pt-1">
            Constraints Blender applies but the preview doesn't:
          </p>
          <div class="flex flex-wrap gap-1">
            <For each={rig()!.warnings}>
              {(w) => (
                <span class="px-1.5 py-0.5 rounded-[2px] bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-200">
                  {w}
                </span>
              )}
            </For>
          </div>
        </Show>
      </PanelSection>
    </Show>
  )
}

function PoseSection(): JSX.Element {
  return (
    <PanelSection title="Pose" icon={FigureIcon}>
      <div class="grid grid-cols-2 gap-1">
        <Button
          size="xs"
          icon={<MirrorIcon size={12} />}
          onClick={mirrorLivePose}
          title="Swap left and right sides (M)"
        >
          Mirror
        </Button>
        <Button
          size="xs"
          icon={<RefreshCwIcon size={12} />}
          onClick={() => resetToRest()}
          title="Back to the model's rest pose"
        >
          Rest pose
        </Button>
      </div>
    </PanelSection>
  )
}

const GRID_STEPS = [0.01, 0.025, 0.05, 0.1, 0.25]
const ANGLE_STEPS = [5, 10, 15, 30, 45]

function SnapSection(): JSX.Element {
  const snap = studio.snap
  return (
    <PanelSection
      title="Snapping"
      icon={MagnetIcon}
      summary={snap().enabled ? `${studio.viewPlane()} view` : 'Off'}
    >
      <ToggleSwitch
        label="Snap while posing (S)"
        description="Drags stay in the view's side, front or top plane. Hold Ctrl to flip for one drag."
        icon={MagnetIcon}
        checked={snap().enabled}
        onChange={(enabled) => studio.setSnap({ enabled })}
      />
      <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        Grid — targets, poles, the root
      </div>
      <SegmentedControl
        size="xs"
        class="w-full"
        value={snap().grid}
        onChange={(grid) => studio.setSnap({ grid })}
        options={GRID_STEPS.map((g) => ({ value: g, label: formatGrid(g).replace(' ', '') }))}
      />
      <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        Angle — swinging a bone
      </div>
      <SegmentedControl
        size="xs"
        class="w-full"
        value={snap().angle}
        onChange={(angle) => studio.setSnap({ angle })}
        options={ANGLE_STEPS.map((a) => ({ value: a, label: `${a}°` }))}
      />
      <p class="text-[10px] text-[var(--text-muted)] leading-snug">
        Line the view up first — numpad 1 / 3 / 7 (front / side / top), Ctrl for the opposite side,
        or click the cube.
      </p>
    </PanelSection>
  )
}

const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const VIDEO_TYPES = ['mp4', 'webm', 'mov', 'm4v', 'ogv']

async function pickReference(): Promise<void> {
  const paths = await window.api.openFileDialog({
    key: 'reference',
    filters: [
      { name: 'Images and videos', extensions: [...IMAGE_TYPES, ...VIDEO_TYPES] },
      { name: 'Images', extensions: IMAGE_TYPES },
      { name: 'Videos', extensions: VIDEO_TYPES }
    ]
  })
  const path = paths?.[0]
  if (!path) {
    return
  }
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  studio.setReference({
    path,
    kind: VIDEO_TYPES.includes(ext) ? 'video' : 'image',
    opacity: studio.reference()?.opacity ?? 0.5,
    visible: true,
    offset: 0
  })
}

function ReferenceSection(): JSX.Element {
  const ref = studio.reference
  const patch = (p: Partial<NonNullable<ReturnType<typeof ref>>>): void => {
    const r = ref()
    if (r) {
      studio.setReference({ ...r, ...p })
    }
  }
  return (
    <PanelSection
      title="Reference"
      icon={ImagesIcon}
      defaultOpen={false}
      summary={ref() ? (ref()!.path.split(/[\\/]/).pop() ?? null) : null}
    >
      <Show
        when={ref()}
        fallback={
          <>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Put a sketch, photo or video behind the model to pose against. Videos follow the
              playhead frame by frame. Remembered for this file; never saved into it.
            </p>
            <Button
              size="xs"
              class="w-full"
              icon={<ImagesIcon size={12} />}
              onClick={() => void pickReference()}
            >
              Load image or video…
            </Button>
          </>
        }
      >
        <ToggleSwitch
          label="Show reference"
          icon={EyeIcon}
          checked={ref()!.visible}
          onChange={(visible) => patch({ visible })}
        />
        <Slider
          label="Opacity"
          value={ref()!.opacity}
          min={0.05}
          max={1}
          step={0.05}
          displayValue={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => patch({ opacity })}
        />
        <Show when={ref()!.kind === 'video'}>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-[var(--text-muted)]">Video starts at clip frame</span>
            <NumberInput
              class="w-20"
              value={ref()!.offset + (studio.activeClip()?.start ?? 0)}
              step={0.2}
              precision={0}
              onChange={(v) => patch({ offset: Math.round(v) - (studio.activeClip()?.start ?? 0) })}
            />
          </div>
        </Show>
        <div class="grid grid-cols-2 gap-1">
          <Button size="xs" onClick={() => void pickReference()}>
            Replace…
          </Button>
          <Button size="xs" variant="ghost" onClick={() => studio.setReference(null)}>
            Remove
          </Button>
        </div>
      </Show>
    </PanelSection>
  )
}

function DisplaySection(): JSX.Element {
  const d = studio.display
  return (
    <PanelSection title="Display" icon={EyeIcon} defaultOpen={false}>
      <ToggleSwitch
        label="First-frame ghost (Shift+O)"
        description="Keep the clip's starting pose visible at every frame"
        icon={GhostIcon}
        checked={d().showFirstFrame}
        onChange={(v) => studio.setDisplay({ ...d(), showFirstFrame: v })}
      />
      <ToggleSwitch
        label="Show bones hidden in Blender"
        description="Bones you hid in Blender, or whose bone collections are hidden"
        icon={EyeOffIcon}
        checked={d().showHidden}
        onChange={(v) => studio.setDisplay({ ...d(), showHidden: v })}
      />
      <ToggleSwitch
        label="Skeleton & handles"
        icon={BoneIcon}
        checked={d().showSkeleton}
        onChange={(v) => studio.setDisplay({ ...d(), showSkeleton: v })}
      />
      <Slider
        label="Handle size"
        value={d().jointSize}
        min={0.5}
        max={2.5}
        step={0.1}
        displayValue={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => studio.setDisplay({ ...d(), jointSize: v })}
      />
      <Slider
        label="Mesh opacity"
        value={d().meshOpacity}
        min={0.1}
        max={1}
        step={0.05}
        displayValue={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => studio.setDisplay({ ...d(), meshOpacity: v })}
      />
      <div class="flex items-center gap-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        <GhostIcon size={12} /> Onion skin
      </div>
      <Slider
        label="Ghost strength"
        value={studio.onion().opacity}
        min={0.05}
        max={0.8}
        step={0.01}
        displayValue={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => studio.setOnion({ ...studio.onion(), opacity: v })}
      />
    </PanelSection>
  )
}

export default function Sidebar(): JSX.Element {
  return (
    <aside class="w-[300px] min-w-[300px] h-full overflow-y-auto dcc-scroll bg-[var(--bg-main)] border-l border-[var(--border-color)]">
      <ClipsSection />
      <JointSection />
      <PoseSection />
      <SnapSection />
      <ReferenceSection />
      <RigSection />
      <SkeletonSection />
      <DisplaySection />
    </aside>
  )
}
