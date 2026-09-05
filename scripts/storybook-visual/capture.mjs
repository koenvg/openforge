import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

export async function serve(root) {
  const base = resolve(root)
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }
  const server = createServer(async (request, response) => {
    try {
      const path = resolve(base, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
      if (!path.startsWith(base + sep)) throw new Error('outside static root')
      const bytes = await readFile(path)
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
      response.end(bytes)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

export async function capture(browser, url, entry, { mutate, timeout = 15000 } = {}) {
  const context = await browser.newContext({ viewport: entry.viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: entry.theme.endsWith('dark') ? 'dark' : 'light', reducedMotion: 'reduce', serviceWorkers: 'block' })
  try {
    // Stories may only fetch their local catalog. Fonts ship with production CSS.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort('blockedbyclient'))
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)
    const errors = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.setFixedTime(new Date('2026-01-02T09:30:00.000Z'))
    await page.goto(`${url}/${entry.catalog}/iframe.html?id=${entry.story}&viewMode=story&globals=openforgeTheme:${entry.theme}`, { waitUntil: 'networkidle', timeout })
    try {
      await page.locator(entry.ready).first().waitFor({ state: 'visible' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() => document.fonts.check('14px Inter'))
    } catch (error) {
      throw new Error(`missing readiness for ${entry.story}: ${entry.ready}\n${errors.join('\n')}\n${error.message}`)
    }
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
    if (mutate) await mutate(page)
    const bytes = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })
    return { bytes, diagnostics: errors }
  } finally {
    await context.close()
  }
}
