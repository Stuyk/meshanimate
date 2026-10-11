import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface RecentEntry {
  projectPath: string
  openedAt: number
  name?: string
  type?: 'project' | 'model'
}

export interface FileFilter {
  name: string
  extensions: string[]
}

const api = {
  openFileDialog: (options?: {
    filters?: FileFilter[]
    multi?: boolean
    key?: string
  }): Promise<string[] | null> => ipcRenderer.invoke('file:open-dialog', options),
  saveFileDialog: (options?: {
    defaultPath?: string
    filters?: FileFilter[]
    key?: string
  }): Promise<string | null> => ipcRenderer.invoke('file:save-dialog', options),
  saveBinaryFile: (filePath: string, data: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('file:save-binary', filePath, data),
  saveRecovery: (content: string): Promise<boolean> => ipcRenderer.invoke('recovery:save', content),
  loadRecovery: (): Promise<{ data: string; timestamp: number } | null> =>
    ipcRenderer.invoke('recovery:load'),
  clearRecovery: (): Promise<boolean> => ipcRenderer.invoke('recovery:clear'),
  getRecentProjects: (): Promise<RecentEntry[]> => ipcRenderer.invoke('project:recent'),
  addRecentProject: (
    projectPath: string,
    name?: string,
    type?: 'project' | 'model'
  ): Promise<RecentEntry[]> => ipcRenderer.invoke('project:add-recent', projectPath, name, type),
  removeRecentProject: (projectPath: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke('project:remove-recent', projectPath),
  revealInFolder: (path: string): void => ipcRenderer.send('shell:reveal', path),
  assetUrl: (filePath: string): string => {
    if (
      filePath.startsWith('data:') ||
      filePath.startsWith('blob:') ||
      filePath.startsWith('asset-file:') ||
      filePath.startsWith('http:') ||
      filePath.startsWith('https:')
    ) {
      return filePath
    }
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const encoded = normalized
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
    return `asset-file://local/${encoded}`
  },
  detectBlender: (): Promise<{ path: string | null; version?: string }> =>
    ipcRenderer.invoke('blender:detect'),
  setBlenderPath: (
    customPath: string | null
  ): Promise<{ success: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('blender:set-path', customPath),
  browseBlenderExecutable: (): Promise<{
    success: boolean
    path?: string
    version?: string
    error?: string
  } | null> => ipcRenderer.invoke('blender:browse-executable'),
  openBlend: (
    blendPath: string
  ): Promise<{ ok: boolean; glbPath?: string; metaJson?: string; error?: string }> =>
    ipcRenderer.invoke('blend:open', blendPath),
  saveBlend: (
    sourcePath: string,
    outPath: string,
    payloadJson: string
  ): Promise<{ ok: boolean; backupPath?: string | null; nlaAdded?: string[]; error?: string }> =>
    ipcRenderer.invoke('blend:save', sourcePath, outPath, payloadJson),
  /** Last-modified time (ms) of a file, or null if it's gone. */
  statBlend: (filePath: string): Promise<number | null> =>
    ipcRenderer.invoke('blend:stat', filePath),
  onBeforeClose: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:before-close', listener)
    return () => ipcRenderer.removeListener('app:before-close', listener)
  },
  confirmClose: (): void => ipcRenderer.send('app:close-confirmed'),
  toggleDevTools: (): void => ipcRenderer.send('devtools:toggle'),
  reportGpuContextLost: (): void => ipcRenderer.send('app:gpu-context-lost')
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
