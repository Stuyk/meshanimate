import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createScene, type LightingMode, type SceneHandle } from './scene'
import { createNavCube, type NavCubeHandle } from './navCube'
import { commitNodes, evaluatePose, moveBoneTo, setLiveBasis, type Rig } from '../anim/rig'
import { aimChain } from '../anim/manipulate'
import type { IkConstraint } from '../anim/ik'
import type { Pose } from '../anim/types'
import type { PoseTool } from '../anim/studio'
import {
  formatGrid,
  latticePoint,
  planeThrough,
  pointAtAngle,
  snapAngle,
  snapPoint,
  viewFrame,
  type SnapFrame,
  type SnapSettings,
  type ViewPlaneName
} from './snap'

export interface GhostSpec {
  pose: Pose
  color: string
  opacity: number
}

export interface EngineCallbacks {
  /** Called once per animation frame with elapsed seconds. */
  onTick: (dt: number) => void
  /** The live rig pose changed (during a drag, a gizmo move…). */
  onPoseChanging: () => void
  /** A drag or gizmo edit finished; time to key it. */
  onPoseEdited: () => void
  onSelectJoint: (name: string | null) => void
  getSelectedJoint: () => string | null
  /** How many FK bones a drag bends (1 = Pivot-style, more = reach). */
  getIkChain: () => number
  getSnap: () => SnapSettings
  /** The axis plane snapping would use from the current view changed. */
  onViewPlane: (name: ViewPlaneName) => void
}

/** What the last drag step snapped to, for drawing it. */
type SnapShot =
  | { kind: 'point'; point: THREE.Vector3 }
  | { kind: 'angle'; pivot: THREE.Vector3; point: THREE.Vector3; angle: number; radius: number }

export interface OverlayStyle {
  showSkeleton: boolean
  jointSize: number
  /** Draw bones hidden in Blender too. */
  showHidden: boolean
}

/**
 * What a grab in the viewport does:
 * - rotate: swing an FK bone about its head (Pivot-style), maybe its parents too
 * - move: put a bone's head somewhere (rig roots, IK targets, pole targets)
 * - ikEnd: the end of an IK chain — drags the IK target, as in Blender
 * - ikMid: a knee/elbow inside an IK chain — swings the pole target
 */
type Handle =
  | { kind: 'rotate'; joint: THREE.Object3D; fraction: number }
  | { kind: 'move'; joint: THREE.Object3D }
  | { kind: 'ikEnd'; joint: THREE.Object3D; ik: IkConstraint }
  | { kind: 'ikMid'; joint: THREE.Object3D; ik: IkConstraint }

interface Ghost {
  display: THREE.Object3D
  joints: Map<string, THREE.Object3D>
  materials: THREE.MeshBasicMaterial[]
}

const HANDLE_RADIUS = 6
const COLORS = {
  bone: 'rgba(232,232,234,0.85)',
  boneIk: 'rgba(255,169,64,0.7)',
  boneSelected: '#0084ff',
  handle: '#ff4d4f',
  handleIk: '#ffa940',
  handleSelected: '#0084ff',
  root: '#ffa940',
  target: '#ffa940',
  pole: '#b37feb',
  link: 'rgba(232,232,234,0.35)',
  poleLink: 'rgba(179,127,235,0.6)',
  outline: 'rgba(10,10,12,0.85)'
}

export class AnimEngine {
  readonly sceneHandle: SceneHandle
  private rig: Rig | null = null
  private overlay: HTMLCanvasElement
  private overlayCtx: CanvasRenderingContext2D
  private navCube: NavCubeHandle | null
  private gizmo: TransformControls
  private gizmoHelper: THREE.Object3D
  private tool: PoseTool = 'pose'
  private style: OverlayStyle = { showSkeleton: true, jointSize: 1, showHidden: false }
  private ghosts: Ghost[] = []
  private ghostRoot = new THREE.Group()
  private raf = 0
  private lastTime = performance.now()
  private drag: {
    handle: Handle
    plane: THREE.Plane
    grabLocal: THREE.Vector3
    /** The dragged thing's position relative to the grab point. */
    offset: THREE.Vector3
    startHit: THREE.Vector3
    startPole: THREE.Vector3 | null
    moved: boolean
    /** Snap plane for this drag (null when snapping was off at the start). */
    frame: SnapFrame | null
    shot: SnapShot | null
  } | null = null
  private viewPlane: ViewPlaneName | null = null
  private hovered: Handle | null = null
  private raycaster = new THREE.Raycaster()
  private recording = false
  private disposed = false

  constructor(
    private canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    navCanvas: HTMLCanvasElement | null,
    private cb: EngineCallbacks
  ) {
    this.sceneHandle = createScene(canvas)
    this.overlay = overlay
    this.overlayCtx = overlay.getContext('2d')!
    this.navCube = navCanvas ? createNavCube(navCanvas, 96) : null
    this.ghostRoot.name = '__onion'
    this.sceneHandle.scene.add(this.ghostRoot)

    const { camera, renderer, scene } = this.sceneHandle
    this.gizmo = new TransformControls(camera, renderer.domElement)
    this.gizmo.setSpace('local')
    this.gizmo.setSize(0.8)
    this.gizmoHelper = this.gizmo.getHelper()
    scene.add(this.gizmoHelper)
    this.gizmo.addEventListener('objectChange', () => {
      const rig = this.rig
      const name = this.gizmo.object ? this.boneNameOf(this.gizmo.object) : null
      if (!rig || !name) {
        return
      }
      // The gizmo turned the node: read that back as pose channels and
      // re-evaluate, so any IK below it follows along.
      commitNodes(rig, [name])
      this.cb.onPoseChanging()
    })
    this.gizmo.addEventListener('mouseUp', () => this.cb.onPoseEdited())

    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    this.onHover = this.onHover.bind(this)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onHover)

    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onHover)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.gizmo.detach()
    this.gizmo.dispose()
    this.clearGhosts()
    this.navCube?.dispose()
    this.sceneHandle.dispose()
  }

  // -------------------------------------------------------------------------
  // Model
  // -------------------------------------------------------------------------

  setRig(rig: Rig | null): void {
    if (this.rig) {
      this.gizmo.detach()
      this.sceneHandle.scene.remove(this.rig.display)
    }
    this.clearGhosts()
    this.rig = rig
    if (!rig) {
      return
    }
    this.sceneHandle.scene.add(rig.display)
    this.frame()
  }

  /** Points the camera at the whole model (F). */
  frame(): void {
    if (!this.rig) {
      return
    }
    this.rig.display.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(this.rig.display, true)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    this.sceneHandle.controls.focus(sphere.center, Math.max(sphere.radius, 0.1))
    this.sceneHandle.fitShadows(sphere.center, sphere.radius, box.min.y)
  }

  /** Centres the view on one bone, close enough to pose it. */
  frameBone(name: string): void {
    const rig = this.rig
    const joint = rig?.jointByName.get(name)
    if (!rig || !joint) {
      return
    }
    const head = this.headWorld(joint)
    const tail = this.tailWorld(name) ?? head
    const center = head.clone().add(tail).multiplyScalar(0.5)
    const radius = Math.max(head.distanceTo(tail), 0.08) * 1.6
    this.sceneHandle.controls.focus(center, radius)
  }

  setLightingMode(mode: LightingMode): void {
    this.sceneHandle.setLightingMode(mode)
  }

  /** Lets a reference image/video behind the canvas show through. */
  setSeeThrough(on: boolean): void {
    this.sceneHandle.setSeeThrough(on)
  }

  /** Shows a pose (Blender pose channels) on the live rig, constraints included. */
  applyPose(pose: Pose): void {
    if (this.rig) {
      setLiveBasis(this.rig, pose)
    }
  }

  setMeshOpacity(opacity: number): void {
    if (!this.rig) {
      return
    }
    for (const mesh of this.rig.meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const transparent = opacity < 0.999
        if (m.transparent !== transparent) {
          m.needsUpdate = true
        }
        m.transparent = transparent
        m.opacity = opacity
        m.depthWrite = !transparent
      }
    }
  }

  /** The armature's own frame: Blender units and axes, whatever the display scaling. */
  private armatureWorld(): THREE.Matrix4 | null {
    const first = this.rig?.jointByName.values().next().value
    const armature = first?.parent
    if (!armature) {
      return null
    }
    armature.updateMatrixWorld(true)
    return armature.matrixWorld
  }

  /** The snap plane the current view would use. */
  private currentFrame(): SnapFrame | null {
    const m = this.armatureWorld()
    if (!m) {
      return null
    }
    return viewFrame(m, this.sceneHandle.camera.getWorldDirection(new THREE.Vector3()))
  }

  /**
   * Swings the camera to a straight view of the rig, Blender's numpad views:
   * front looks at the face (armature +z here is Blender −y), right from +x,
   * top from above.
   */
  viewAlong(view: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'): void {
    const dirs = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0],
      bottom: [0, -1, 0]
    } as const
    const dir = new THREE.Vector3(...dirs[view])
    const m = this.armatureWorld()
    if (m) {
      dir.transformDirection(m)
    }
    this.sceneHandle.controls.snapToDirection(dir)
  }

  /** Grid and angle snapping for the rotate/move gizmos too. */
  setSnap(settings: SnapSettings): void {
    const m = this.armatureWorld()
    const scale = m ? new THREE.Vector3().setFromMatrixScale(m).x : 1
    this.gizmo.setTranslationSnap(settings.enabled ? settings.grid * scale : null)
    this.gizmo.setRotationSnap(settings.enabled ? THREE.MathUtils.degToRad(settings.angle) : null)
  }

  /** The Blender bone name of a live bone node, or null for anything else. */
  private boneNameOf(o: THREE.Object3D): string | null {
    const name = o.userData.meshanimate_name as string | undefined
    return name && this.rig?.jointByName.get(name) === o ? name : null
  }

  // -------------------------------------------------------------------------
  // Tools & overlay
  // -------------------------------------------------------------------------

  setTool(tool: PoseTool): void {
    this.tool = tool
    this.syncGizmo()
  }

  setOverlayStyle(style: OverlayStyle): void {
    this.style = style
  }

  /**
   * Re-attaches the gizmo to whatever is selected. Bones Blender's IK drives
   * get none: their rotation comes from the IK target, so a turn made here
   * would be overridden the moment Blender evaluates the rig.
   */
  syncGizmo(): void {
    const name = this.cb.getSelectedJoint()
    const joint = name ? this.rig?.jointByName.get(name) : undefined
    const driven = name ? this.rig?.ikDriven.has(name) : false
    if (!joint || driven || this.tool === 'pose' || this.recording) {
      this.gizmo.detach()
      return
    }
    this.gizmo.setMode(this.tool === 'rotate' ? 'rotate' : 'translate')
    this.gizmo.setSpace(this.tool === 'rotate' ? 'local' : 'world')
    this.gizmo.attach(joint)
  }

  // -------------------------------------------------------------------------
  // Onion skin
  // -------------------------------------------------------------------------

  private clearGhosts(): void {
    for (const g of this.ghosts) {
      this.ghostRoot.remove(g.display)
      g.materials.forEach((m) => m.dispose())
    }
    this.ghosts = []
  }

  private makeGhost(): Ghost | null {
    const rig = this.rig
    if (!rig) {
      return null
    }
    const display = cloneSkinned(rig.display)
    const joints = new Map<string, THREE.Object3D>()
    const materials: THREE.MeshBasicMaterial[] = []
    display.traverse((o) => {
      const name = o.userData.meshanimate_name as string | undefined
      if (name && rig.jointByName.has(name) && !joints.has(name)) {
        joints.set(name, o)
      }
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) {
        return
      }
      // Pushed back in depth with a strict test, so wherever a ghost overlaps
      // the live figure (limbs that didn't move) the live figure wins instead
      // of being tinted by it.
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthFunc: THREE.LessDepth,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 8,
        opacity: 0.3
      })
      materials.push(mat)
      mesh.material = mat
      mesh.castShadow = false
      mesh.renderOrder = -2
      mesh.frustumCulled = false
    })
    this.ghostRoot.add(display)
    return { display, joints, materials }
  }

  setGhosts(specs: GhostSpec[]): void {
    const rig = this.rig
    if (!rig) {
      return
    }
    while (this.ghosts.length < specs.length) {
      const g = this.makeGhost()
      if (!g) {
        return
      }
      this.ghosts.push(g)
    }
    this.ghosts.forEach((g, i) => {
      const spec = specs[i]
      g.display.visible = !!spec
      if (!spec) {
        return
      }
      g.display.position.copy(rig.display.position)
      g.display.scale.copy(rig.display.scale)
      // Ghosts run the same constraints as the live rig, so IK legs ghost correctly.
      evaluatePose(rig, g.joints, spec.pose, g.display)
      for (const m of g.materials) {
        m.color.set(spec.color)
        m.opacity = spec.opacity
      }
    })
  }

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------

  private loop(now: number): void {
    if (this.disposed) {
      return
    }
    const dt = Math.min(0.1, (now - this.lastTime) / 1000)
    this.lastTime = now
    if (!this.recording) {
      this.cb.onTick(dt)
    }
    this.render()
    this.raf = requestAnimationFrame(this.loop)
  }

  render(): void {
    const { renderer, scene, camera } = this.sceneHandle
    const frame = this.currentFrame()
    if (frame && frame.name !== this.viewPlane) {
      this.viewPlane = frame.name
      this.cb.onViewPlane(frame.name)
    }
    renderer.render(scene, camera)
    this.drawOverlay()
    this.navCube?.render(camera)
  }

  private toScreen(world: THREE.Vector3, out: THREE.Vector2): boolean {
    const v = world.clone().project(this.sceneHandle.camera)
    const rect = this.canvas.getBoundingClientRect()
    out.set(((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height)
    return v.z < 1
  }

  private headWorld(j: THREE.Object3D): THREE.Vector3 {
    return j.getWorldPosition(new THREE.Vector3())
  }

  private tailWorld(name: string): THREE.Vector3 | null {
    const rig = this.rig
    const tail = rig?.tails.get(name)
    const joint = rig?.jointByName.get(name)
    return tail && joint ? joint.localToWorld(tail.clone()) : null
  }

  /** Hidden in Blender (the bone or all its bone collections) and not shown anyway. */
  private isHidden(name: string): boolean {
    return !this.style.showHidden && !!this.rig?.bones.get(name)?.hidden
  }

  /** Bones drawn as bones (not IK targets or poles) and not hidden. */
  private isDrawnBone(name: string): boolean {
    const rig = this.rig!
    return rig.roles.get(name) === 'bone' && !this.isHidden(name)
  }

  /** Bones grabbed by the head and moved: rig roots, IK targets, pole targets. */
  private isMoveHandle(name: string): boolean {
    const rig = this.rig!
    if (rig.roles.get(name) !== 'bone') {
      return !this.isHidden(name)
    }
    return !rig.parentOf.get(name) && this.isDrawnBone(name)
  }

  /** What grabbing a bone's tail does. */
  private tailHandle(name: string, joint: THREE.Object3D, fraction: number): Handle {
    const ik = this.rig!.ikDriven.get(name)
    if (!ik) {
      return { kind: 'rotate', joint, fraction }
    }
    if (ik.owner === name && ik.useTail) {
      return { kind: 'ikEnd', joint, ik }
    }
    return { kind: 'ikMid', joint, ik }
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (this.overlay.width !== w || this.overlay.height !== h) {
      this.overlay.width = w
      this.overlay.height = h
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
    const rig = this.rig
    if (!rig || !this.style.showSkeleton || this.recording) {
      return
    }

    const selected = this.cb.getSelectedJoint()
    const r = HANDLE_RADIUS * this.style.jointSize
    const head = new THREE.Vector2()
    const tail = new THREE.Vector2()
    const other = new THREE.Vector2()
    ctx.lineCap = 'round'
    this.drawSnap()

    // Thin links bridge a parent's tail to a child's head where they don't
    // touch (shoulders off the chest), so the figure reads as one piece.
    for (const [name, j] of rig.jointByName) {
      const parent = rig.parentOf.get(name)
      if (!parent || !this.isDrawnBone(name) || !this.isDrawnBone(parent)) {
        continue
      }
      const pt = this.tailWorld(parent)
      if (!pt || !this.toScreen(pt, other) || !this.toScreen(this.headWorld(j), head)) {
        continue
      }
      if (other.distanceTo(head) >= 2) {
        this.dashed(other, head, COLORS.link)
      }
    }

    // Pole guides: from the knee/elbow to its pole target.
    for (const c of rig.ik) {
      const pole = c.pole ? rig.jointByName.get(c.pole) : undefined
      const mid = rig.jointByName.get(c.owner)
      if (!pole || !mid || this.isHidden(c.pole!)) {
        continue
      }
      if (this.toScreen(this.headWorld(mid), head) && this.toScreen(this.headWorld(pole), other)) {
        this.dashed(head, other, COLORS.poleLink)
      }
    }

    for (const [name, j] of rig.jointByName) {
      // Cheap checks first: big rigs hide most of their bones.
      if (this.isHidden(name) || !this.toScreen(this.headWorld(j), head)) {
        continue
      }
      const isSel = name === selected
      const hov = this.hovered?.joint === j
      const role = rig.roles.get(name)
      if (role !== 'bone' && this.isHidden(name)) {
        continue
      }
      if (role === 'ikTarget') {
        this.drawTarget(head, r * 1.5, isSel ? COLORS.handleSelected : COLORS.target, hov)
        continue
      }
      if (role === 'pole') {
        this.drawDiamond(head, r * 1.2, isSel ? COLORS.handleSelected : COLORS.pole, hov)
        continue
      }
      if (!this.isDrawnBone(name)) {
        continue
      }
      const driven = rig.ikDriven.has(name)
      const tw = this.tailWorld(name)
      if (tw && this.toScreen(tw, tail)) {
        ctx.strokeStyle = COLORS.outline
        ctx.lineWidth = 6 * this.style.jointSize
        ctx.beginPath()
        ctx.moveTo(head.x, head.y)
        ctx.lineTo(tail.x, tail.y)
        ctx.stroke()
        ctx.strokeStyle = isSel ? COLORS.boneSelected : driven ? COLORS.boneIk : COLORS.bone
        ctx.lineWidth = 3.5 * this.style.jointSize
        ctx.stroke()
        const big = hov && this.hovered?.kind !== 'move'
        const fill = isSel ? COLORS.handleSelected : driven ? COLORS.handleIk : COLORS.handle
        this.drawCircle(tail, big ? r * 1.35 : r, fill, driven)
      }
      if (!rig.parentOf.get(name)) {
        const s = (hov && this.hovered?.kind === 'move' ? r * 1.35 : r) * 1.15
        ctx.fillStyle = isSel ? COLORS.handleSelected : COLORS.root
        ctx.strokeStyle = COLORS.outline
        ctx.lineWidth = 2
        ctx.fillRect(head.x - s, head.y - s, s * 2, s * 2)
        ctx.strokeRect(head.x - s, head.y - s, s * 2, s * 2)
      }
    }
  }

  /**
   * While a snapping drag runs: the grid points around the handle in the view
   * plane (the one it will land on ringed), or for a swinging bone a
   * protractor of the allowed angles with the current one marked.
   */
  private drawSnap(): void {
    const drag = this.drag
    const shot = drag?.shot
    const frame = drag?.frame
    if (!drag || !shot || !frame) {
      return
    }
    const ctx = this.overlayCtx
    const settings = this.cb.getSnap()
    const a = new THREE.Vector2()
    const b = new THREE.Vector2()

    if (shot.kind === 'angle') {
      const local = shot.radius / new THREE.Vector3().setFromMatrixScale(frame.toWorld).x
      const r = local * 1.25
      if (!this.toScreen(shot.pivot, a)) {
        return
      }
      for (let deg = -180; deg < 180; deg += settings.angle) {
        const major = Math.round(deg) % 90 === 0
        if (!this.toScreen(pointAtAngle(frame, shot.pivot, deg, r * (major ? 1.08 : 1)), b)) {
          continue
        }
        ctx.strokeStyle = major ? 'rgba(232,232,234,0.45)' : 'rgba(232,232,234,0.18)'
        ctx.lineWidth = major ? 1.5 : 1
        ctx.beginPath()
        ctx.moveTo(a.x + (b.x - a.x) * 0.55, a.y + (b.y - a.y) * 0.55)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      if (this.toScreen(pointAtAngle(frame, shot.pivot, shot.angle, r * 1.12), b)) {
        ctx.strokeStyle = COLORS.handleSelected
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        this.label(b, `${shot.angle}°`)
      }
      return
    }

    // Draw every k-th cell so dots never crowd closer than ~8px on screen.
    const origin = latticePoint(frame, shot.point, settings.grid, 0, 0)
    if (
      !this.toScreen(origin, a) ||
      !this.toScreen(latticePoint(frame, shot.point, settings.grid, 1, 0), b)
    ) {
      return
    }
    const cellPx = Math.max(a.distanceTo(b), 0.01)
    const k = [1, 2, 5, 10, 20, 50].find((n) => n * cellPx >= 8) ?? 100
    const reach = Math.min(30, Math.ceil(260 / (cellPx * k))) * k
    for (let i = -reach; i <= reach; i += k) {
      for (let j = -reach; j <= reach; j += k) {
        if (!this.toScreen(latticePoint(frame, shot.point, settings.grid, i, j), b)) {
          continue
        }
        const fade = 1 - Math.hypot(i, j) / (reach * 1.42)
        const major = (i / k) % 5 === 0 && (j / k) % 5 === 0
        ctx.fillStyle = `rgba(232,232,234,${(major ? 0.55 : 0.3) * fade})`
        ctx.fillRect(b.x - (major ? 1.5 : 1), b.y - (major ? 1.5 : 1), major ? 3 : 2, major ? 3 : 2)
      }
    }
    if (this.toScreen(shot.point, b)) {
      ctx.strokeStyle = COLORS.handleSelected
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(b.x, b.y, 9, 0, Math.PI * 2)
      ctx.stroke()
      this.label(b, `${frame.name} · ${formatGrid(settings.grid)}`)
    }
  }

  private label(at: THREE.Vector2, text: string): void {
    const ctx = this.overlayCtx
    ctx.font = '600 11px Inter, system-ui, sans-serif'
    const w = ctx.measureText(text).width + 10
    const x = at.x + 12
    const y = at.y - 22
    ctx.fillStyle = 'rgba(20,20,22,0.9)'
    ctx.fillRect(x, y, w, 17)
    ctx.fillStyle = '#e8e8ea'
    ctx.fillText(text, x + 5, y + 12.5)
  }

  private dashed(a: THREE.Vector2, b: THREE.Vector2, color: string): void {
    const ctx = this.overlayCtx
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  /** IK-driven ends draw as rings: grabbing one moves its IK target. */
  private drawCircle(at: THREE.Vector2, r: number, fill: string, ring = false): void {
    const ctx = this.overlayCtx
    ctx.beginPath()
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2)
    ctx.fillStyle = ring ? 'rgba(10,10,12,0.6)' : fill
    ctx.fill()
    ctx.lineWidth = ring ? 2.5 : 2
    ctx.strokeStyle = ring ? fill : COLORS.outline
    ctx.stroke()
  }

  private drawTarget(at: THREE.Vector2, r: number, color: string, hover: boolean): void {
    const ctx = this.overlayCtx
    const rr = hover ? r * 1.25 : r
    ctx.beginPath()
    ctx.arc(at.x, at.y, rr, 0, Math.PI * 2)
    ctx.moveTo(at.x - rr * 1.4, at.y)
    ctx.lineTo(at.x + rr * 1.4, at.y)
    ctx.moveTo(at.x, at.y - rr * 1.4)
    ctx.lineTo(at.x, at.y + rr * 1.4)
    ctx.lineWidth = 4.5
    ctx.strokeStyle = COLORS.outline
    ctx.stroke()
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.stroke()
  }

  private drawDiamond(at: THREE.Vector2, r: number, color: string, hover: boolean): void {
    const ctx = this.overlayCtx
    const rr = hover ? r * 1.3 : r
    ctx.beginPath()
    ctx.moveTo(at.x, at.y - rr)
    ctx.lineTo(at.x + rr, at.y)
    ctx.lineTo(at.x, at.y + rr)
    ctx.lineTo(at.x - rr, at.y)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = COLORS.outline
    ctx.stroke()
  }

  // -------------------------------------------------------------------------
  // Picking & dragging
  // -------------------------------------------------------------------------

  private localPoint(e: PointerEvent | MouseEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect()
    return new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top)
  }

  /** Nearest handle under the pointer: move handles, bone tails, then bone bodies. */
  private pickHandle(p: THREE.Vector2): Handle | null {
    const rig = this.rig
    if (!rig || !this.style.showSkeleton) {
      return null
    }
    const r = HANDLE_RADIUS * this.style.jointSize + 4
    const head = new THREE.Vector2()
    const tail = new THREE.Vector2()
    let best: { handle: Handle; d: number } | null = null
    const consider = (handle: Handle, d: number, limit: number): void => {
      if (d <= limit && (!best || d < best.d)) {
        best = { handle, d }
      }
    }
    for (const [name, j] of rig.jointByName) {
      if (this.isHidden(name)) {
        continue
      }
      const headOk = this.toScreen(this.headWorld(j), head)
      if (headOk && this.isMoveHandle(name)) {
        consider({ kind: 'move', joint: j }, head.distanceTo(p) - 1, r * 1.5)
      }
      if (!headOk || !this.isDrawnBone(name)) {
        continue
      }
      const tw = this.tailWorld(name)
      if (!tw || !this.toScreen(tw, tail)) {
        continue
      }
      consider(this.tailHandle(name, j, 1), tail.distanceTo(p), r)
      // Grabbing an FK bone along its body, past the first third, swings it too.
      const seg = tail.clone().sub(head)
      const len2 = seg.lengthSq()
      if (len2 < 1 || rig.ikDriven.has(name)) {
        continue
      }
      const t = Math.max(0, Math.min(1, p.clone().sub(head).dot(seg) / len2))
      if (t > 0.35) {
        const d = head.clone().addScaledVector(seg, t).distanceTo(p)
        consider({ kind: 'rotate', joint: j, fraction: t }, d + 3, 5 * this.style.jointSize)
      }
    }
    return (best as { handle: Handle } | null)?.handle ?? null
  }

  /** Bone owning the surface under the pointer: dominant skin weight, or the bone a part hangs off. */
  private pickMeshJoint(e: PointerEvent): string | null {
    const rig = this.rig
    if (!rig) {
      return null
    }
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.sceneHandle.camera)
    const hit = this.raycaster.intersectObjects(rig.meshes, false)[0]
    if (!hit) {
      return null
    }
    const mesh = hit.object as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh && hit.face) {
      const si = mesh.geometry.attributes.skinIndex
      const sw = mesh.geometry.attributes.skinWeight
      let bestBone = -1
      let bestW = 0
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(hit.face.a, k)
        if (w > bestW) {
          bestW = w
          bestBone = si.getComponent(hit.face.a, k)
        }
      }
      const bone = mesh.skeleton.bones[bestBone]
      const name = bone ? this.boneNameOf(bone) : null
      if (name) {
        return name
      }
    }
    let o: THREE.Object3D | null = mesh
    while (o) {
      const name = this.boneNameOf(o)
      if (name) {
        return name
      }
      o = o.parent
    }
    return null
  }

  private planeAt(world: THREE.Vector3): THREE.Plane {
    const normal = this.sceneHandle.camera.getWorldDirection(new THREE.Vector3())
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world)
  }

  private rayHit(e: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.sceneHandle.camera)
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
  }

  private onHover(e: PointerEvent): void {
    if (this.drag || e.buttons !== 0) {
      return
    }
    const gizmoActive = this.gizmo.object && this.gizmo.axis
    const h = gizmoActive ? null : this.pickHandle(this.localPoint(e))
    this.hovered = h
    this.canvas.style.cursor = h ? (h.kind === 'rotate' ? 'grab' : 'move') : ''
  }

  private onPointerDown(e: PointerEvent): void {
    const rig = this.rig
    if (e.button !== 0 || e.altKey || !rig) {
      return
    }
    // The gizmo claims clicks on its own axes.
    if (this.gizmo.object && (this.gizmo.axis || this.gizmo.dragging)) {
      return
    }
    const handle = this.pickHandle(this.localPoint(e))
    if (!handle) {
      this.cb.onSelectJoint(this.pickMeshJoint(e))
      return
    }
    e.preventDefault()
    const name = this.boneNameOf(handle.joint)!
    this.cb.onSelectJoint(name)

    let grabLocal = new THREE.Vector3()
    let anchor: THREE.Vector3
    let moved: THREE.Vector3
    let startPole: THREE.Vector3 | null = null
    if (handle.kind === 'move') {
      anchor = this.headWorld(handle.joint)
      moved = anchor.clone()
    } else {
      const fraction = handle.kind === 'rotate' ? handle.fraction : 1
      grabLocal = rig.tails.get(name)!.clone().multiplyScalar(fraction)
      anchor = handle.joint.localToWorld(grabLocal.clone())
      moved = anchor.clone()
      if (handle.kind === 'ikEnd') {
        moved = this.headWorld(rig.jointByName.get(handle.ik.target)!)
      }
      if (handle.kind === 'ikMid' && handle.ik.pole) {
        startPole = this.headWorld(rig.jointByName.get(handle.ik.pole)!)
      }
    }
    // With snapping on, drags run in the view's axis plane (side, front or
    // top) instead of a camera-facing one, so they never drift in depth.
    const frame = this.cb.getSnap().enabled ? this.currentFrame() : null
    const plane = frame ? planeThrough(frame, anchor) : this.planeAt(anchor)
    const hit = this.rayHit(e, plane) ?? anchor.clone()
    this.drag = {
      handle,
      plane,
      grabLocal,
      offset: moved.sub(hit),
      startHit: hit,
      startPole,
      moved: false,
      frame,
      shot: null
    }
    this.canvas.style.cursor = handle.kind === 'rotate' ? 'grabbing' : 'move'
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
  }

  /** FK bones a drag on `name` may bend: itself, then parents IK doesn't drive. */
  private fkChain(name: string): THREE.Object3D[] {
    const rig = this.rig!
    const out = [rig.jointByName.get(name)!]
    let p = rig.parentOf.get(name) ?? null
    while (p && out.length < this.cb.getIkChain() && !rig.ikDriven.has(p)) {
      out.push(rig.jointByName.get(p)!)
      p = rig.parentOf.get(p) ?? null
    }
    return out
  }

  private onPointerMove(e: PointerEvent): void {
    const drag = this.drag
    const rig = this.rig
    if (!drag || !rig) {
      return
    }
    const hit = this.rayHit(e, drag.plane)
    if (!hit) {
      return
    }
    const h = drag.handle
    const name = this.boneNameOf(h.joint)!
    // Ctrl flips snapping for the moment, as in Blender.
    const settings = this.cb.getSnap()
    const snapping = settings.enabled !== (e.ctrlKey || e.metaKey)
    if (snapping && !drag.frame) {
      drag.frame = this.currentFrame()
    }
    const frame = snapping ? drag.frame : null
    const snapTo = (p: THREE.Vector3): THREE.Vector3 => {
      if (!frame) {
        return p
      }
      const q = snapPoint(frame, p, settings.grid)
      drag.shot = { kind: 'point', point: q }
      return q
    }
    drag.shot = null
    if (h.kind === 'move') {
      moveBoneTo(rig, name, snapTo(hit.clone().add(drag.offset)))
    } else if (h.kind === 'ikEnd') {
      moveBoneTo(rig, h.ik.target, snapTo(hit.clone().add(drag.offset)))
    } else if (h.kind === 'ikMid') {
      if (!h.ik.pole || !drag.startPole) {
        return
      }
      const pole = drag.startPole.clone().add(hit.clone().sub(drag.startHit))
      moveBoneTo(rig, h.ik.pole, snapTo(pole))
    } else {
      const chain = this.fkChain(name)
      const grab = drag.grabLocal
      let target = hit.clone().add(drag.offset)
      if (frame && chain.length === 1) {
        // One bone: swing it to a clean angle in the view plane.
        const pivot = this.headWorld(h.joint)
        const snapped = snapAngle(frame, pivot, target, settings.angle)
        target = snapped.point
        drag.shot = {
          kind: 'angle',
          pivot,
          point: snapped.point,
          angle: snapped.angle,
          radius: target.distanceTo(pivot)
        }
      } else {
        // A reaching chain: put its end on a grid point.
        target = snapTo(target)
      }
      aimChain(chain, () => h.joint.localToWorld(grab.clone()), target)
      commitNodes(
        rig,
        chain.map((j) => this.boneNameOf(j)!)
      )
    }
    drag.moved = true
    this.cb.onPoseChanging()
  }

  private onPointerUp(): void {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    const moved = this.drag?.moved
    this.drag = null
    this.canvas.style.cursor = ''
    if (moved) {
      this.cb.onPoseEdited()
    }
  }

  // -------------------------------------------------------------------------
  // Video capture
  // -------------------------------------------------------------------------

  /**
   * Plays frames through the main canvas into a WebM, one rendered image per
   * frame at the clip's real rate. Handles and the gizmo are hidden while it
   * runs so the recording is just the model.
   */
  async recordWebm(
    frameCount: number,
    fps: number,
    poseAt: (frame: number) => Pose,
    onProgress?: (done: number) => void
  ): Promise<Blob> {
    const stream = this.canvas.captureStream(0)
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (ev): void => {
      if (ev.data.size > 0) {
        chunks.push(ev.data)
      }
    }
    const stopped = new Promise<void>((resolve) => (recorder.onstop = (): void => resolve()))
    const ghostsVisible = this.ghostRoot.visible
    this.recording = true
    this.ghostRoot.visible = false
    this.gizmoHelper.visible = false
    recorder.start()
    try {
      for (let f = 0; f < frameCount; f++) {
        this.applyPose(poseAt(f))
        this.render()
        track.requestFrame()
        onProgress?.(f + 1)
        await new Promise((r) => setTimeout(r, 1000 / fps))
      }
    } finally {
      recorder.stop()
      await stopped
      this.recording = false
      this.ghostRoot.visible = ghostsVisible
      this.gizmoHelper.visible = true
      stream.getTracks().forEach((t) => t.stop())
    }
    return new Blob(chunks, { type: 'video/webm' })
  }

  // -------------------------------------------------------------------------
  // Nav cube
  // -------------------------------------------------------------------------

  navCubeClick(clientX: number, clientY: number): void {
    const dir = this.navCube?.pickFace(clientX, clientY)
    if (dir) {
      this.sceneHandle.controls.snapToDirection(dir)
    }
  }

  navCubeOrbit(dx: number, dy: number): void {
    this.sceneHandle.controls.orbitBy(dx, dy)
  }
}
