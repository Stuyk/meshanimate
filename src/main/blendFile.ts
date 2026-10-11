import { app } from 'electron'
import { basename, dirname, join } from 'path'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { t } from './i18n'
import { execFile } from 'child_process'
import loadScript from '../../resources/blender/meshanimate_load.py?asset'
import saveScript from '../../resources/blender/meshanimate_save.py?asset'
import { getEffectiveBlender } from './blenderBridge'

/** Backups kept per .blend; older ones are pruned after each save. */
const BACKUPS_KEPT = 20
const OK_MARKER = 'MESHANIMATE_OK'

/** Scripts inside app.asar can't be read by Blender; electron-builder unpacks resources/. */
function unpacked(path: string): string {
  return path.replace('app.asar', 'app.asar.unpacked')
}

async function runBlender(args: string[], timeoutMs: number): Promise<string> {
  const { path: blender } = await getEffectiveBlender()
  if (!blender) {
    throw new Error(t('errors.blenderNotFound'))
  }
  return new Promise((resolve, reject) => {
    execFile(
      blender,
      // Factory settings: no user add-ons or startup scripts change what the
      // scripts see or write. --python-exit-code makes a Python error fail.
      ['--factory-startup', '--python-exit-code', '1', ...args],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`
        if (err || !output.includes(OK_MARKER)) {
          const tail = output
            .split('\n')
            .filter((l) => l.trim())
            .slice(-12)
            .join('\n')
          reject(new Error(tail || (err ? err.message : t('errors.blenderDidNotFinish'))))
          return
        }
        resolve(output)
      }
    )
  })
}

export interface OpenedBlend {
  glbPath: string
  metaJson: string
}

/** Reads a .blend through Blender: a display model plus rig/action data. */
export async function openBlend(blendPath: string): Promise<OpenedBlend> {
  if (!existsSync(blendPath)) {
    throw new Error(t('errors.fileNotFound', { path: blendPath }))
  }
  const dir = join(app.getPath('temp'), 'meshanimate', `open-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  await runBlender(['-b', blendPath, '--python', unpacked(loadScript), '--', dir], 180_000)
  const metaJson = await readFile(join(dir, 'meta.json'), 'utf-8')
  return { glbPath: join(dir, 'model.glb'), metaJson }
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Copies `file` into a `.meshanimate-backups` folder beside it before it is
 * overwritten, keeping the newest BACKUPS_KEPT copies.
 */
async function backup(file: string): Promise<string> {
  const dir = join(dirname(file), '.meshanimate-backups')
  await mkdir(dir, { recursive: true })
  const stem = basename(file).replace(/\.blend$/i, '')
  const target = join(dir, `${stem}-${timestamp()}.blend`)
  await copyFile(file, target)

  const mine = (await readdir(dir)).filter((n) => n.startsWith(`${stem}-`) && n.endsWith('.blend'))
  const dated = await Promise.all(
    mine.map(async (n) => ({ n, t: (await stat(join(dir, n))).mtimeMs }))
  )
  dated.sort((a, b) => b.t - a.t)
  for (const old of dated.slice(BACKUPS_KEPT)) {
    await rm(join(dir, old.n), { force: true })
  }
  return target
}

export interface SavedBlend {
  backupPath: string | null
  /** Actions that were given a new NLA track by this save. */
  nlaAdded: string[]
}

/**
 * Writes clips into a .blend as actions. `sourcePath` is the file the rig was
 * read from; `outPath` is where to save (the same file, or a Save As target).
 * Whatever is at `outPath` is backed up first. Blender saves straight to the
 * target. It writes `file.blend@` and renames it into place only once the
 * write succeeded, so a failed save leaves the original intact, and relative
 * texture paths stay valid (saving elsewhere and copying back would not).
 */
export async function saveBlend(
  sourcePath: string,
  outPath: string,
  payloadJson: string
): Promise<SavedBlend> {
  const dir = join(app.getPath('temp'), 'meshanimate', `save-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  const payloadPath = join(dir, 'payload.json')
  await writeFile(payloadPath, payloadJson, 'utf-8')
  const backupPath = existsSync(outPath) ? await backup(outPath) : null
  let output = ''
  try {
    output = await runBlender(
      ['-b', sourcePath, '--python', unpacked(saveScript), '--', payloadPath, outPath],
      300_000
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  const added = output.match(/MESHANIMATE_NLA_ADDED (.*)/)?.[1]
  return { backupPath, nlaAdded: added ? added.trim().split('|') : [] }
}
