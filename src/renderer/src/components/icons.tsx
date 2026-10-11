import type { JSX } from 'solid-js'
export {
  FolderOpen as FolderOpenIcon,
  RefreshCw as RefreshCwIcon,
  Search as SearchIcon,
  X as XIcon,
  Play as PlayIcon,
  Pause as PauseIcon,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  HelpCircle as HelpCircleIcon,
  Settings as SettingsIcon,
  SquareTerminal as DevConsoleIcon,
  Copy as CopyIcon,
  Eye as EyeIcon,
  EyeOff as EyeOffIcon,
  Plus as PlusIcon,
  Check as CheckIcon,
  Focus as FocusIcon,
  Pencil as Edit2Icon,
  Images as ImagesIcon,
  Trash2 as TrashIcon,
  Clock as ClockIcon,
  Expand as FitIcon,
  SkipBack as SkipBackIcon,
  SkipForward as SkipForwardIcon,
  StepBack as StepBackIcon,
  StepForward as StepForwardIcon,
  Repeat as RepeatIcon,
  Diamond as DiamondIcon,
  Ghost as GhostIcon,
  Bone as BoneIcon,
  Move as MoveIcon,
  Rotate3d as Rotate3dIcon,
  MousePointer2 as PoseIcon,
  Film as FilmIcon,
  Clapperboard as ClapperboardIcon,
  FlipHorizontal2 as MirrorIcon,
  Undo2 as UndoIcon,
  Redo2 as RedoIcon,
  KeyRound as KeyIcon,
  ClipboardPaste as PasteIcon,
  PersonStanding as FigureIcon,
  Save as SaveIcon,
  Flag as FlagIcon,
  Magnet as MagnetIcon,
  Crosshair as FrameIcon
} from 'lucide-solid'

export function AppIcon(props: { size?: number; class?: string }): JSX.Element {
  const s = (): number => props.size || 24
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={s()}
      height={s()}
      class={props.class}
      style={{ 'flex-shrink': '0' }}
    >
      <rect width="128" height="128" rx="28" fill="#1e2430" />
      {/* Onion ghost of the previous pose */}
      <g stroke="#ff5c5c" stroke-opacity="0.45" stroke-width="7" stroke-linecap="round" fill="none">
        <path d="M52 42 L50 74 M50 74 L36 102 M50 74 L60 102 M51 52 L32 66" />
      </g>
      {/* Current pose */}
      <g stroke="#e8e8ea" stroke-width="8" stroke-linecap="round" fill="none">
        <path d="M68 40 L68 74 M68 74 L54 104 M68 74 L84 102 M68 50 L88 36 M68 50 L90 62" />
      </g>
      <circle cx="68" cy="28" r="11" fill="#e8e8ea" />
      <circle cx="88" cy="36" r="6" fill="#0084ff" stroke="#1e2430" stroke-width="2.5" />
      <circle cx="90" cy="62" r="6" fill="#ff4d4f" stroke="#1e2430" stroke-width="2.5" />
      <circle cx="54" cy="104" r="6" fill="#ff4d4f" stroke="#1e2430" stroke-width="2.5" />
      <circle cx="84" cy="102" r="6" fill="#ff4d4f" stroke="#1e2430" stroke-width="2.5" />
      <rect
        x="62"
        y="68"
        width="12"
        height="12"
        fill="#ffa940"
        stroke="#1e2430"
        stroke-width="2.5"
      />
    </svg>
  )
}
