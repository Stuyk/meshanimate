import { join } from 'path'
import { t } from './i18n'
import { homedir } from 'os'
import { existsSync, readdirSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getBlenderPath, setBlenderPath } from './prefs'

const execFileAsync = promisify(execFile)

/**
 * Tests if a given path is an executable Blender binary by running `blender -v`.
 */
export async function testBlenderExecutable(
  executablePath: string
): Promise<{ valid: boolean; version?: string; error?: string }> {
  if (!executablePath || !existsSync(executablePath)) {
    return { valid: false, error: t('errors.fileDoesNotExist') }
  }

  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ['-v'], {
      timeout: 10000
    })
    const output = (stdout || stderr || '').trim()
    const match = output.match(/Blender\s+([0-9.]+[\w\s-]*)/i)
    if (match) {
      return { valid: true, version: match[0].split('\n')[0].trim() }
    }
    return { valid: true, version: t('errors.unknownBlenderVersion') }
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** `blender.exe` under each version subdirectory of `blenderFoundDir` (Blender's own versioned install layout). Empty if it doesn't exist or can't be read. */
function findVersionedWindowsBlenders(blenderFoundDir: string): string[] {
  if (!existsSync(blenderFoundDir)) {
    return []
  }
  try {
    const entries = readdirSync(blenderFoundDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(blenderFoundDir, entry.name, 'blender.exe'))
  } catch {
    return []
  }
}

/** Direct- and Windows-style Blender binaries under each "blender"-named subdirectory of `programsDir`. Empty if it doesn't exist or can't be read. */
function findBlenderBinariesInPrograms(programsDir: string): string[] {
  if (!existsSync(programsDir)) {
    return []
  }
  try {
    const entries = readdirSync(programsDir, { withFileTypes: true })
    const found: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().includes('blender')) {
        continue
      }
      const directBin = join(programsDir, entry.name, 'blender')
      const winBin = join(programsDir, entry.name, 'blender.exe')
      if (existsSync(directBin)) {
        found.push(directBin)
      }
      if (existsSync(winBin)) {
        found.push(winBin)
      }
    }
    return found
  } catch {
    return []
  }
}

/**
 * Scans standard OS and user directories for Blender installations.
 */
export async function findSystemBlender(): Promise<string | null> {
  const candidates: string[] = []
  const home = homedir()

  // 1. Check user programs directory (e.g. ~/programs/blender-5.2.0-linux-x64/blender)
  const userProgramsDir = join(home, 'programs')
  candidates.push(...findBlenderBinariesInPrograms(userProgramsDir))

  // 2. Common user directories
  candidates.push(
    join(home, 'bin', 'blender'),
    join(home, '.local', 'bin', 'blender'),
    join(home, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender')
  )

  // 3. Linux system paths
  if (process.platform === 'linux') {
    candidates.push(
      '/usr/bin/blender',
      '/usr/local/bin/blender',
      '/snap/bin/blender',
      '/var/lib/flatpak/exports/bin/org.blender.Blender'
    )
  }

  // 4. Windows system paths
  if (process.platform === 'win32') {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const progFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const blenderFoundDir = join(progFiles, 'Blender Foundation')
    candidates.push(...findVersionedWindowsBlenders(blenderFoundDir))

    candidates.push(
      join(progFiles, 'Blender Foundation', 'Blender', 'blender.exe'),
      join(progFiles86, 'Blender Foundation', 'Blender', 'blender.exe'),
      join(progFiles, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe')
    )
  }

  // 5. macOS system paths
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Blender.app/Contents/MacOS/Blender',
      join(home, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender')
    )
  }

  // 6. Test candidates in order
  for (const path of candidates) {
    if (existsSync(path)) {
      const test = await testBlenderExecutable(path)
      if (test.valid) {
        return path
      }
    }
  }

  // 7. PATH lookup via `which` or `where`
  try {
    const lookupCmd = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(lookupCmd, ['blender'], { timeout: 5000 })
    const path = stdout.trim().split(/\r?\n/)[0]
    if (path && existsSync(path)) {
      const test = await testBlenderExecutable(path)
      if (test.valid) {
        return path
      }
    }
  } catch {
    // No usable Blender on PATH; the caller falls back to asking the user.
  }

  return null
}

/**
 * Returns the effective Blender path, checking saved preference first, then system.
 */
export async function getEffectiveBlender(): Promise<{
  path: string | null
  version?: string
}> {
  const saved = getBlenderPath()
  if (saved && existsSync(saved)) {
    const test = await testBlenderExecutable(saved)
    if (test.valid) {
      return { path: saved, version: test.version }
    }
  }

  const found = await findSystemBlender()
  if (found) {
    const test = await testBlenderExecutable(found)
    if (test.valid) {
      setBlenderPath(found)
      return { path: found, version: test.version }
    }
  }

  return { path: null }
}
