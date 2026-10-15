import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import * as THREE from 'three'
import { studio } from '../anim/studio'
import {
  copyBoneChannels,
  mirrorLivePose,
  pasteBoneChannels,
  resetToRest,
  setJointChannels
} from '../anim/actions'
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
  PasteIcon,
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
import { t, tr } from '../i18n'

const AXIS_COLORS = ['#ff5c5c', '#5ad15a', '#4d9bff']

function ClipsSection(): JSX.Element {
  const [renaming, setRenaming] = createSignal<string | null>(null)
  return (
    <PanelSection
      title={t('clips.title')}
      icon={ClapperboardIcon}
      badge={studio.clips().length}
      actions={
        <IconButton
          size="xs"
          tooltip={t('clips.newClip')}
          onClick={() =>
            studio.addClip(
              t('clips.defaultName', { n: studio.clips().length + 1 }),
              studio.rig()?.rest ?? null
            )
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
                  {t('clips.meta', { keys: clip.keys.length, length: clip.length })}
                </span>
                <div class="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconButton
                    size="xs"
                    tooltip={t('common.rename')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenaming(clip.id)
                    }}
                  >
                    <Edit2Icon size={11} />
                  </IconButton>
                  <IconButton
                    size="xs"
                    tooltip={t('common.duplicate')}
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
                      tooltip={t('clips.deleteClip')}
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
    // By Blender bone name, node names are glTF-sanitized ("Arm.L" → "ArmL").
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
    <PanelSection
      title={t('skeleton.title')}
      icon={BoneIcon}
      badge={studio.rig()?.jointByName.size ?? 0}
    >
      <Show when={(studio.rig()?.jointByName.size ?? 0) > 8}>
        <SearchInput value={filter()} onInput={setFilter} placeholder={t('skeleton.find')} />
      </Show>
      <div class="flex flex-col -mx-1 max-h-[240px] overflow-y-auto dcc-scroll font-mono text-[11px]">
        <For each={rows()}>
          {(r) => {
            const sel = (): boolean => studio.selectedJoint() === r.name
            const hidden = (): boolean => !!studio.rig()?.bones.get(r.name)?.hidden
            return (
              <button
                title={hidden() ? t('skeleton.hiddenInBlender', { bone: r.name }) : r.name}
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
                  <span class="ml-auto text-[9px] font-sans font-bold text-amber-400/80">
                    {t('skeleton.ikBadge')}
                  </span>
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
    <PanelSection title={t('bone.title')} icon={FigureIcon} summary={name()}>
      <Show
        when={channels()}
        fallback={
          <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">{t('bone.empty')}</p>
        }
      >
        <div class="space-y-1.5">
          <Show when={driver()}>
            {(c) => (
              <div class="p-2 rounded-[var(--ui-radius)] border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-200 leading-relaxed">
                {tr('bone.drivenByIk', { owner: <b>{c().owner}</b>, target: <b>{c().target}</b> })}
                {c().pole ? <> {tr('bone.pointsAtPole', { pole: <b>{c().pole}</b> })}</> : null}
                <div class="flex gap-1 pt-1.5">
                  <Button size="xs" onClick={() => studio.setSelectedJoint(c().target)}>
                    {t('bone.selectTarget')}
                  </Button>
                  <Show when={c().pole}>
                    <Button size="xs" onClick={() => studio.setSelectedJoint(c().pole)}>
                      {t('bone.selectPole')}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </Show>
          <Show when={role() !== 'bone' && targetOf()}>
            {(c) => (
              <div class="text-[11px] text-[var(--text-muted)]">
                {tr(role() === 'ikTarget' ? 'bone.ikTargetFor' : 'bone.poleTargetFor', {
                  owner: <b class="text-[var(--text-main)]">{c().owner}</b>
                })}
              </div>
            )}
          </Show>
          <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {t('bone.location')}
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
              {t('bone.rotation')}
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
          <div class="text-[10px] text-[var(--text-muted)]">{t('bone.sameAsBlender')}</div>
          <div class="flex gap-1 pt-1">
            <Button
              size="xs"
              class="flex-1"
              icon={<RefreshCwIcon size={12} />}
              onClick={() => resetToRest(name()!)}
            >
              {t('bone.clearTransform')}
            </Button>
          </div>
          <div class="flex gap-1">
            <Button
              size="xs"
              class="flex-1"
              icon={<CopyIcon size={12} />}
              onClick={() => copyBoneChannels(name()!)}
              title={t('bone.copyTitle')}
            >
              {t('bone.copy')}
            </Button>
            <Button
              size="xs"
              class="flex-1"
              icon={<PasteIcon size={12} />}
              disabled={!studio.clipboardBone()}
              onClick={() => pasteBoneChannels()}
              title={t('bone.pasteTitle', { joint: studio.clipboardBone()?.joint ?? '' })}
            >
              {t('bone.paste')}
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
      <PanelSection
        title={t('rig.title')}
        icon={BoneIcon}
        defaultOpen={false}
        badge={rig()!.ik.length}
      >
        <For each={rig()!.ik}>
          {(c) => (
            <button
              type="button"
              class="flex flex-col w-full text-left p-1.5 rounded-[var(--ui-radius)] hover:bg-white/5 cursor-pointer"
              onClick={() => studio.setSelectedJoint(c.target)}
              title={t('rig.selectIkTarget')}
            >
              <span class="text-[11px] font-semibold text-[var(--text-main)]">
                {t('rig.ikChain', { owner: c.owner })}{' '}
                <span class="text-[var(--text-muted)] font-normal">
                  {c.chainCount ? t('rig.chainBones', { count: c.chainCount }) : t('rig.chainAll')}
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
            {t('rig.unsupported')}
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
    <PanelSection title={t('pose.title')} icon={FigureIcon}>
      <div class="grid grid-cols-2 gap-1">
        <Button
          size="xs"
          icon={<MirrorIcon size={12} />}
          onClick={mirrorLivePose}
          title={t('pose.mirrorTitle')}
        >
          {t('pose.mirror')}
        </Button>
        <Button
          size="xs"
          icon={<RefreshCwIcon size={12} />}
          onClick={() => resetToRest()}
          title={t('pose.restTitle')}
        >
          {t('pose.rest')}
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
      title={t('snapping.title')}
      icon={MagnetIcon}
      summary={
        snap().enabled
          ? t('snapping.summaryOn', { plane: t(`snap.planes.${studio.viewPlane()}`) })
          : t('snapping.summaryOff')
      }
    >
      <ToggleSwitch
        label={t('snapping.toggle')}
        description={t('snapping.toggleHelp')}
        icon={MagnetIcon}
        checked={snap().enabled}
        onChange={(enabled) => studio.setSnap({ enabled })}
      />
      <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {t('snapping.grid')}
      </div>
      <SegmentedControl
        size="xs"
        class="w-full"
        value={snap().grid}
        onChange={(grid) => studio.setSnap({ grid })}
        options={GRID_STEPS.map((g) => ({ value: g, label: formatGrid(g).replace(' ', '') }))}
      />
      <div class="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {t('snapping.angle')}
      </div>
      <SegmentedControl
        size="xs"
        class="w-full"
        value={snap().angle}
        onChange={(angle) => studio.setSnap({ angle })}
        options={ANGLE_STEPS.map((a) => ({ value: a, label: `${a}°` }))}
      />
      <p class="text-[10px] text-[var(--text-muted)] leading-snug">{t('snapping.viewTip')}</p>
    </PanelSection>
  )
}

const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const VIDEO_TYPES = ['mp4', 'webm', 'mov', 'm4v', 'ogv']

async function pickReference(): Promise<void> {
  const paths = await window.api.openFileDialog({
    key: 'reference',
    filters: [
      { name: t('files.imagesAndVideos'), extensions: [...IMAGE_TYPES, ...VIDEO_TYPES] },
      { name: t('files.images'), extensions: IMAGE_TYPES },
      { name: t('files.videos'), extensions: VIDEO_TYPES }
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
      title={t('reference.title')}
      icon={ImagesIcon}
      defaultOpen={false}
      summary={ref() ? (ref()!.path.split(/[\\/]/).pop() ?? null) : null}
    >
      <Show
        when={ref()}
        fallback={
          <>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {t('reference.empty')}
            </p>
            <Button
              size="xs"
              class="w-full"
              icon={<ImagesIcon size={12} />}
              onClick={() => void pickReference()}
            >
              {t('reference.load')}
            </Button>
          </>
        }
      >
        <ToggleSwitch
          label={t('reference.show')}
          icon={EyeIcon}
          checked={ref()!.visible}
          onChange={(visible) => patch({ visible })}
        />
        <Slider
          label={t('reference.opacity')}
          value={ref()!.opacity}
          min={0.05}
          max={1}
          step={0.05}
          displayValue={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => patch({ opacity })}
        />
        <Show when={ref()!.kind === 'video'}>
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="text-[var(--text-muted)]">{t('reference.videoStart')}</span>
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
            {t('common.replace')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => studio.setReference(null)}>
            {t('common.remove')}
          </Button>
        </div>
      </Show>
    </PanelSection>
  )
}

function DisplaySection(): JSX.Element {
  const d = studio.display
  return (
    <PanelSection title={t('display.title')} icon={EyeIcon} defaultOpen={false}>
      <ToggleSwitch
        label={t('display.firstFrame')}
        description={t('display.firstFrameHelp')}
        icon={GhostIcon}
        checked={d().showFirstFrame}
        onChange={(v) => studio.setDisplay({ ...d(), showFirstFrame: v })}
      />
      <ToggleSwitch
        label={t('display.showHidden')}
        description={t('display.showHiddenHelp')}
        icon={EyeOffIcon}
        checked={d().showHidden}
        onChange={(v) => studio.setDisplay({ ...d(), showHidden: v })}
      />
      <ToggleSwitch
        label={t('display.skeleton')}
        icon={BoneIcon}
        checked={d().showSkeleton}
        onChange={(v) => studio.setDisplay({ ...d(), showSkeleton: v })}
      />
      <Slider
        label={t('display.handleSize')}
        value={d().jointSize}
        min={0.5}
        max={2.5}
        step={0.1}
        displayValue={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => studio.setDisplay({ ...d(), jointSize: v })}
      />
      <Slider
        label={t('display.meshOpacity')}
        value={d().meshOpacity}
        min={0.1}
        max={1}
        step={0.05}
        displayValue={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => studio.setDisplay({ ...d(), meshOpacity: v })}
      />
      <div class="flex items-center gap-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        <GhostIcon size={12} /> {t('display.onionSkin')}
      </div>
      <Slider
        label={t('display.ghostStrength')}
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
