import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import { join, dirname } from 'path'
import { pathToFileURL } from 'url'
import { stat, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  getRecentProjects,
  addRecentProject,
  removeRecentProject,
  clearRecentProjects
} from './recent'
import { getLastPath, setLastPath, setBlenderPath } from './prefs'
import { saveAutosave, loadAutosave, clearAutosave } from './recovery'
import { existsSync } from 'fs'
import { getEffectiveBlender, testBlenderExecutable } from './blenderBridge'
import { openBlend, saveBlend } from './blendFile'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset-file',
    privileges: {
      standard: true,
      stream: true,
      bypassCSP: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

// GPU rasterization tuning. Deliberately NOT disabling the frame-rate limit —
// that uncaps rendering from vsync entirely, so a static scene (the render
// loop always redraws, no dirty-check) gets pushed at however many hundred/
// thousand FPS the GPU can physically produce, pinning it at 100% even at
// idle. Normal vsync-capped rendering (60/144Hz, whatever the display is) is
// what a desktop app should do; the uncapped mode is a benchmarking flag, not
// a performance win.
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

let mainWindow: BrowserWindow | null = null
let forceClose = false
/** The renderer can't answer 'app:before-close' while it's dead or hung, so
 * the close guard has to stand aside or the window can never be closed. */
let rendererGone = false
let rendererHung = false
/** One recovery dialog at a time — a hang that turns into a crash would otherwise stack two. */
let recoveryDialogOpen = false

/**
 * Offers a way out when the renderer can no longer be trusted (crashed, hung,
 * or lost its WebGL context). Work since the last autosave is gone either way;
 * reloading lands on the start wizard, which offers that autosave back.
 */
async function showRecoveryDialog(
  win: BrowserWindow,
  message: string,
  detail: string,
  allowWait: boolean
): Promise<void> {
  if (recoveryDialogOpen || win.isDestroyed()) {
    return
  }
  recoveryDialogOpen = true
  const buttons = allowWait ? ['Wait', 'Reload', 'Quit'] : ['Reload', 'Quit']
  const { response } = await dialog.showMessageBox(win, {
    type: 'error',
    title: 'MeshAnimate',
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  recoveryDialogOpen = false
  if (win.isDestroyed()) {
    return
  }
  const choice = buttons[response]
  if (choice === 'Reload') {
    rendererGone = false
    rendererHung = false
    win.webContents.reload()
  } else if (choice === 'Quit') {
    forceClose = true
    win.close()
  }
}

const RECOVERY_DETAIL =
  'Changes since the last autosave (every 60 seconds) may be lost. Reload to get back to the start screen, where the autosave can be restored.'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'MeshAnimate',
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Never let a stray click on the close button, Alt+F4, or Cmd+Q throw away
  // unsaved work — the renderer decides (via its own dirty state) whether to
  // prompt, and tells us back through 'app:close-confirmed' when it's safe.
  mainWindow.on('close', (event) => {
    if (forceClose || rendererGone) {
      return
    }
    if (rendererHung) {
      // No answer is coming from a frozen renderer; ask here instead of
      // leaving the close button dead.
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        title: 'MeshAnimate',
        message: 'MeshAnimate is not responding.',
        detail: RECOVERY_DETAIL,
        buttons: ['Wait', 'Close Anyway'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (choice !== 1) {
        event.preventDefault()
      }
      return
    }
    event.preventDefault()
    mainWindow?.webContents.send('app:before-close')
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details)
    if (details.reason === 'clean-exit') {
      return
    }
    rendererGone = true
    rendererHung = false
    const reason = details.reason === 'oom' ? 'ran out of memory' : `stopped (${details.reason})`
    void showRecoveryDialog(mainWindow!, `MeshAnimate ${reason}.`, RECOVERY_DETAIL, false)
  })

  mainWindow.on('unresponsive', () => {
    rendererHung = true
    void showRecoveryDialog(
      mainWindow!,
      'MeshAnimate is not responding.',
      `It may still be working on something heavy. ${RECOVERY_DETAIL}`,
      true
    )
  })

  mainWindow.on('responsive', () => {
    rendererHung = false
  })

  // Handled here rather than in the page so the shortcut still works while
  // the renderer is busy — which is exactly when you want the console.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return
    }
    const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control
    // In dev, the toolkit's watchWindowShortcuts already toggles on F12;
    // handling it here too would open and immediately close the panel.
    const isToggle =
      (input.key === 'F12' && !is.dev) ||
      (ctrlOrCmd && input.shift && input.key.toLowerCase() === 'i')
    if (isToggle) {
      event.preventDefault()
      mainWindow?.webContents.toggleDevTools()
    }
  })

  // The Text tool asks Chromium for the installed fonts (queryLocalFonts),
  // which is gated behind the "local-fonts" permission. Electron's typings
  // don't list that string yet, hence the widening — and everything else is
  // refused rather than silently granted, since nothing here needs it.
  const isAllowedPermission = (permission: string): boolean => permission === 'local-fonts'
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isAllowedPermission(permission))
  })
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    isAllowedPermission(permission)
  )

  mainWindow.webContents.setWindowOpenHandler((details) => {
    /**
     * A blank popup is one of our own inspector windows: the renderer calls
     * window.open('') and then writes the document itself (see
     * utils/uvInspector.ts), which needs same-origin access from the opener —
     * so it has to be a real child window rather than an external URL.
     *
     * Everything with an actual URL is a link and still goes to the browser;
     * this app never navigates a child window to remote content.
     */
    if (details.url === 'about:blank' || details.url === '') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 900,
          backgroundColor: '#141416',
          autoHideMenuBar: true,
          // Node stays out of the popup. It only ever shows a data-URL image
          // the main window handed it.
          webPreferences: { nodeIntegration: false, contextIsolation: true, preload: undefined }
        }
      }
    }
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sliptexturepaint.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  protocol.handle('asset-file', (request) => {
    let filePath = decodeURIComponent(new URL(request.url).pathname)
    if (process.platform === 'win32' && filePath.startsWith('/') && filePath[2] === ':') {
      filePath = filePath.slice(1)
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  ipcMain.handle(
    'file:open-dialog',
    async (
      _event,
      options: {
        filters?: { name: string; extensions: string[] }[]
        multi?: boolean
        /** Dialog purpose, e.g. 'model' or 'project' — remembers the folder per key. */
        key?: string
      }
    ) => {
      if (!mainWindow) {
        return null
      }
      const lastFolder = options?.key ? getLastPath(options.key) : undefined
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: options?.multi ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: options?.filters,
        ...(lastFolder && existsSync(lastFolder) ? { defaultPath: lastFolder } : {})
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      if (options?.key) {
        setLastPath(options.key, dirname(result.filePaths[0]))
      }
      return result.filePaths
    }
  )

  ipcMain.handle(
    'file:save-dialog',
    async (
      _event,
      options: {
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
        /** Dialog purpose, e.g. 'project' or 'export' — remembers the folder per key. */
        key?: string
      }
    ) => {
      if (!mainWindow) {
        return null
      }
      const lastFolder = options?.key ? getLastPath(options.key) : undefined
      const defaultPath =
        lastFolder && existsSync(lastFolder) && options?.defaultPath
          ? join(lastFolder, options.defaultPath)
          : options?.defaultPath
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath,
        filters: options?.filters
      })
      if (result.canceled || !result.filePath) {
        return null
      }
      if (options?.key) {
        setLastPath(options.key, dirname(result.filePath))
      }
      return result.filePath
    }
  )

  ipcMain.handle('file:save-binary', async (_e, filePath: string, data: Uint8Array) => {
    try {
      await writeFile(filePath, Buffer.from(data))
      return true
    } catch (err) {
      console.error('Failed to save binary file:', filePath, err)
      return false
    }
  })

  ipcMain.handle('recovery:save', async (_e, data: string) => {
    return saveAutosave(data)
  })

  ipcMain.handle('recovery:load', async () => {
    return loadAutosave()
  })

  ipcMain.handle('recovery:clear', async () => {
    return clearAutosave()
  })

  ipcMain.handle('project:recent', () => {
    return getRecentProjects()
  })

  ipcMain.handle(
    'project:add-recent',
    (_e, projectPath: string, name?: string, type?: 'project' | 'model') => {
      addRecentProject(projectPath, name, type)
      return getRecentProjects()
    }
  )

  ipcMain.handle('project:remove-recent', (_e, projectPath: string) => {
    removeRecentProject(projectPath)
    return getRecentProjects()
  })

  ipcMain.handle('project:clear-recent', () => {
    clearRecentProjects()
    return []
  })

  ipcMain.handle('blender:detect', async () => {
    return getEffectiveBlender()
  })

  ipcMain.handle('blender:set-path', async (_e, customPath: string | null) => {
    if (!customPath) {
      setBlenderPath(undefined)
      return { success: true }
    }
    const test = await testBlenderExecutable(customPath)
    if (test.valid) {
      setBlenderPath(customPath)
      return { success: true, version: test.version }
    }
    return { success: false, error: test.error || 'Invalid Blender executable' }
  })

  ipcMain.handle('blender:browse-executable', async () => {
    if (!mainWindow) {
      return null
    }
    const isWin = process.platform === 'win32'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Blender Executable',
      properties: ['openFile'],
      filters: isWin
        ? [{ name: 'Blender Executable', extensions: ['exe'] }]
        : [{ name: 'All Files', extensions: ['*'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const chosen = result.filePaths[0]
    const test = await testBlenderExecutable(chosen)
    if (test.valid) {
      setBlenderPath(chosen)
      return { success: true, path: chosen, version: test.version }
    }
    return {
      success: false,
      error: test.error || 'Selected file is not a valid Blender executable.'
    }
  })

  ipcMain.handle('blend:open', async (_e, blendPath: string) => {
    try {
      return { ok: true, ...(await openBlend(blendPath)) }
    } catch (err) {
      console.error('Failed to open .blend:', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'blend:save',
    async (_e, sourcePath: string, outPath: string, payloadJson: string) => {
      try {
        return { ok: true, ...(await saveBlend(sourcePath, outPath, payloadJson)) }
      } catch (err) {
        console.error('Failed to save .blend:', err)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  /** Last-modified time of a file, to notice a .blend changed outside the app. */
  ipcMain.handle('blend:stat', async (_e, filePath: string) => {
    try {
      return (await stat(filePath)).mtimeMs
    } catch {
      return null
    }
  })

  ipcMain.on('app:close-confirmed', () => {
    forceClose = true
    mainWindow?.close()
  })

  ipcMain.on('devtools:toggle', (event) => {
    event.sender.toggleDevTools()
  })

  // A lost WebGL context can't be restored in place; reloading is the way out.
  ipcMain.on('app:gpu-context-lost', () => {
    if (mainWindow) {
      void showRecoveryDialog(
        mainWindow,
        'The graphics context was lost.',
        `The GPU driver reset or ran out of memory. ${RECOVERY_DETAIL}`,
        false
      )
    }
  })

  app.on('child-process-gone', (_event, details) => {
    console.error('Child process gone:', details)
  })

  ipcMain.on('shell:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
