// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { createServer } from 'node:http'
import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwind from '@tailwindcss/vite'
import { openArcTab } from '../../../tests/arcCdp'
import { pdfAssets } from '../../../pdfAssets'
import { pdfFixture } from '../../../tests/pdfFixture'

// Use Koen's existing Arc session only. This never launches another browser.
it.skipIf(!process.env.ARC_CDP_URL).each(['project', 'task'] as const)('renders %s first-page text with the real packaged worker, blocks actions and releases resources', async scope => {
  const root = resolve(import.meta.dirname, '../../..')
  const output = await mkdtemp(resolve(tmpdir(), 'openforge-pdf-'))
  await build({
    root, configFile: false, logLevel: 'error', plugins: [svelte(), tailwind(), pdfAssets()],
    build: { outDir: output, emptyOutDir: false, lib: { entry: resolve(root, 'tests/pdfRendererEntry.ts'), formats: ['es'], fileName: () => 'renderer.js', cssFileName: 'renderer' }, rollupOptions: { output: { chunkFileNames: '[name]-[hash].js' } } },
  })
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'")
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<link rel="stylesheet" href="/renderer.css"><script type="module" src="/renderer.js"></script><main style="width:320px"><div id="pdf" class="pdfViewer"></div></main>'); return }
    const file = resolve(output, '.' + new URL(request.url!, 'http://localhost').pathname)
    if (!file.startsWith(output + sep)) { response.writeHead(403).end(); return }
    try {
      response.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
      response.end(await readFile(file))
    } catch { response.writeHead(404).end() }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  let page: Awaited<ReturnType<typeof openArcTab>> | undefined
  try {
    page = await openArcTab(process.env.ARC_CDP_URL!, `http://127.0.0.1:${port}/`)
    const run = (bytes: Uint8Array) => page!.evaluate(async bytes => {
      const { createPdfSession } = globalThis as unknown as { createPdfSession: typeof import('./renderer').createPdfSession }
      const container = document.querySelector('#pdf') as HTMLDivElement
      const session = createPdfSession(container)
      try {
        const result = await session.load(new Uint8Array(bytes), () => {})
        const canvases = [...container.querySelectorAll('canvas')].map(canvas => [canvas.width, canvas.height])
        const text = container.querySelector('.textLayer')?.textContent
        const links = container.querySelectorAll('a, input, form, iframe').length
        const structure = container.querySelector('.structTree')?.textContent ?? null
        const range = document.createRange()
        range.selectNodeContents(container.querySelector('.textLayer')!)
        const selection = window.getSelection()!
        selection.removeAllRanges(); selection.addRange(range)
        const selectedText = selection.toString()
        session.destroy(); session.destroy()
        return { result, canvases, text, selectedText, links, structure, childrenAfterDestroy: container.childElementCount }
      } catch (error) { session.destroy(); return { error: String(error), childrenAfterDestroy: container.childElementCount } }
    }, Array.from(bytes))
    const normal = await run(pdfFixture({ pages: 2, malicious: true }))
    expect(normal.error).toBeUndefined()
    expect(normal.result?.pages).toBe(2)
    expect(normal.text).toContain('Selectable project PDF')
    expect(normal.selectedText).toContain('Selectable project PDF')
    expect(normal.links).toBe(0)
    expect(normal.childrenAfterDestroy).toBe(0)
    const scanned = await run(pdfFixture({ text: false }))
    expect(scanned.result?.notice).toContain('No selectable text')
    const tagged = await run(pdfFixture({ tagged: true }))
    expect(tagged.result?.notice).toBe('')
    expect(tagged.structure).not.toBeNull()
    const large = await run(pdfFixture({ width: 100000, height: 100000 }))
    expect(large.error).toBeUndefined()
    expect(large.result?.reduced).toBe(true)
    for (const [width, height] of large.canvases ?? []) { expect(width).toBeLessThanOrEqual(8192); expect(height).toBeLessThanOrEqual(8192); expect(width * height).toBeLessThanOrEqual(16777216) }
    expect((await run(pdfFixture({ pages: 2001 }))).error).toContain('PDF_PAGES:')
    expect((await run(new Uint8Array())).error).toBeTruthy()
    expect((await run(pdfFixture({ encrypted: true }))).error).toContain('PasswordException')
    const setMode = (mode: string) => page!.evaluate(async mode => {
      const resources = (globalThis as unknown as { pdfTestResources: { mode: string } }).pdfTestResources
      resources.mode = mode
    }, mode)
    for (const mode of ['startup-failure', 'parse-timeout', 'render-timeout']) {
      await setMode(mode)
      expect((await run(pdfFixture())).error).toContain(mode === 'startup-failure' ? 'PDF_WORKER:' : 'PDF_TIMEOUT:')
    }
    await setMode('')
    for (let index = 0; index < 10; index++) expect((await run(pdfFixture())).error).toBeUndefined()
    const resources = await page.evaluate(async () => (globalThis as unknown as { pdfTestResources: { active: number; peak: number; created: number; urls: number } }).pdfTestResources, null)
    expect(resources.active).toBe(0)
    expect(resources.urls).toBe(0)
    expect(resources.peak).toBe(1)
    expect(resources.created).toBeGreaterThanOrEqual(10)
    const failure = await page.evaluate(async bytes => {
      const api = globalThis as unknown as { createPdfSession: typeof import('./renderer').createPdfSession; failPdfWorker(): void }
      const container = document.querySelector('#pdf') as HTMLDivElement
      let failure = ''
      const session = api.createPdfSession(container, error => { failure = String(error) })
      await session.load(new Uint8Array(bytes), () => {})
      api.failPdfWorker()
      const remaining = container.childElementCount
      session.destroy()
      return { failure, remaining }
    }, Array.from(pdfFixture()))
    expect(failure.failure).toContain('PDF_WORKER:')
    expect(failure.remaining).toBe(0)
    const layout = await page.evaluate(async ({ bytes, scope }) => {
      const api = globalThis as unknown as { mountPdfViewer(bytes: number[], scope: 'project' | 'task'): () => void }
      const dispose = api.mountPdfViewer(bytes, scope)
      Object.assign(globalThis, { disposePdfViewer: dispose })
      const start = performance.now()
      while (!document.querySelector('.textLayer span') && performance.now() - start < 10000) await new Promise(resolve => setTimeout(resolve, 20))
      const button = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Return focus'))!
      const main = document.querySelector('main')!
      const fits = () => button.getBoundingClientRect().right <= main.getBoundingClientRect().right + 1
      const narrow = fits()
      document.body.style.zoom = '2'
      const zoomed = fits()
      document.body.style.zoom = '1'
      button.focus()
      return { narrow, zoomed, text: main.textContent, selectable: !!main.querySelector('.textLayer span') }
    }, { bytes: Array.from(pdfFixture({ pages: 2, tagged: true })), scope })
    expect(layout.selectable).toBe(true)
    expect(layout.text).toContain(`${scope}-guide.pdf`)
    expect(layout.text).toContain('Page 1 of 2')
    expect(layout.narrow).toBe(true)
    expect(layout.zoomed).toBe(true)
    await page.key('Enter')
    expect(await page.evaluate(async () => document.activeElement?.id, null)).toBe('fixture-tree-file')
    await writeFile(`/tmp/KVG-5077-${scope}-preview.png`, Buffer.from(await page.screenshot(), 'base64'))
    await page.evaluate(async () => {
      (globalThis as unknown as { disposePdfViewer(): void }).disposePdfViewer()
    }, null)
    const cleaned = await page.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      return (globalThis as unknown as { pdfTestResources: { active: number; urls: number } }).pdfTestResources
    }, null)
    expect(cleaned.active).toBe(0)
    expect(cleaned.urls).toBe(0)
    expect(page.requests.filter(url => !url.startsWith(`http://127.0.0.1:${port}/`) && !/^(blob:|data:|chrome-extension:)/.test(url)).map(url => new URL(url).origin)).toEqual([])
  } finally {
    await page?.close()
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
    await rm(output, { recursive: true, force: true })
  }
}, 120000)
