// Renders screenshots/github-social-card.html to a 1280×640 PNG for GitHub's
// social preview and the docs site. Run with: npm run social-card
import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync, copyFileSync } from 'fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 640,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  await win.loadFile(join(root, 'screenshots', 'github-social-card.html'))
  await new Promise((r) => setTimeout(r, 500))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 })
  const png = join(root, 'screenshots', 'github-social-card.png')
  writeFileSync(png, image.resize({ width: 1280, height: 640 }).toPNG())
  copyFileSync(png, join(root, 'docs', 'social-preview.png'))
  console.log('Wrote', png, 'and docs/social-preview.png')
  app.quit()
})
