import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

interface Prefs {
  /** Last folder browsed to/saved in, per dialog purpose (e.g. 'blend', 'export'). */
  lastPaths?: Record<string, string>
  blenderPath?: string
}

function storePath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

function load(): Prefs {
  const p = storePath()
  if (!existsSync(p)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function save(prefs: Prefs): void {
  writeFileSync(storePath(), JSON.stringify(prefs, null, 2))
}

export function getLastPath(key: string): string | undefined {
  return load().lastPaths?.[key]
}

export function setLastPath(key: string, folder: string): void {
  const prefs = load()
  prefs.lastPaths = { ...prefs.lastPaths, [key]: folder }
  save(prefs)
}

export function getBlenderPath(): string | undefined {
  return load().blenderPath
}

export function setBlenderPath(path: string | undefined): void {
  const prefs = load()
  prefs.blenderPath = path
  save(prefs)
}
