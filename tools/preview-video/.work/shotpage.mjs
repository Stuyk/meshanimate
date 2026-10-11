import { chromium } from 'playwright-core'
const b = await chromium.launch()
for (const [w, name] of [[1280, 'desk'], [390, 'phone']]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } })
  await p.goto('http://localhost:8765/index.html#video')
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `/media/stuyk/Side2/projects2/mesh-animate/tools/preview-video/.work/page-${name}.png` })
}
await b.close()
