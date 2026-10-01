import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { serve } from './storybook-visual/capture.mjs'

const root = resolve(import.meta.dirname, '..')
const server = await serve(resolve(root, 'storybook-static'))
const browser = await chromium.launch({ headless: true })
try {
  for (const catalog of ['pages', 'components']) {
    const index = JSON.parse(await readFile(resolve(root, `storybook-static/${catalog}/index.json`), 'utf8'))
    const stories = Object.keys(index.entries).filter(id => id.startsWith(`${catalog}-terminal`) && index.entries[id].type === 'story')
    assert.ok(stories.length, `No Terminal stories in ${catalog}`)
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const errors = []
    const externalRequests = []
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === server.url) return route.continue()
      externalRequests.push(route.request().url())
      return route.abort()
    })
    const page = await context.newPage()
    await page.addInitScript(() => {
      const tracked = new Map()
      for (const target of [window, document]) {
        const add = target.addEventListener.bind(target)
        const remove = target.removeEventListener.bind(target)
        target.addEventListener = (type, handler, options) => {
          if (['keydown', 'keyup', 'resize', 'copy', 'paste'].includes(type) && !options?.once) {
            const key = `${target === window ? 'window' : 'document'}:${type}:${typeof options === 'boolean' ? options : Boolean(options?.capture)}`
            const handlers = tracked.get(key) ?? new Set()
            handlers.add(handler)
            tracked.set(key, handlers)
          }
          add(type, handler, options)
        }
        target.removeEventListener = (type, handler, options) => {
          const key = `${target === window ? 'window' : 'document'}:${type}:${typeof options === 'boolean' ? options : Boolean(options?.capture)}`
          tracked.get(key)?.delete(handler)
          remove(type, handler, options)
        }
      }
      window.terminalGlobalListeners = () => [...tracked.values()].reduce((count, handlers) => count + handlers.size, 0)
    })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const blank = catalog === 'pages' ? 'pages-terminal--no-project' : 'components-button--primary'
    await page.goto(`${server.url}/${catalog}/iframe.html?id=${blank}&viewMode=story`)
    await page.waitForFunction(() => Boolean(window.__STORYBOOK_ADDONS_CHANNEL__))

    async function select(storyId, eventName = 'setCurrentStory') {
      const result = await page.evaluate(([storyId, eventName]) => new Promise((resolve, reject) => {
        const channel = window.__STORYBOOK_ADDONS_CHANNEL__
        const timeout = setTimeout(() => { channel.off('storyFinished', done); reject(new Error(`Story timed out: ${storyId}`)) }, 30000)
        function done(event) {
          if (event.storyId !== storyId) return
          clearTimeout(timeout)
          channel.off('storyFinished', done)
          resolve({ status: event.status })
        }
        channel.on('storyFinished', done)
        channel.emit(eventName, { storyId, viewMode: 'story' })
      }), [storyId, eventName])
      assert.equal(result.status, 'success', `${storyId}: ${errors.join('\n')}`)
      assert.deepEqual(errors, [], storyId)
    }

    let listenerBaseline
    // Each pass stays in one document. Adapter disposal checks session/listener leaks.
    for (let pass = 0; pass < 2; pass++) {
      for (const id of stories) {
        if (id === blank) continue
        if (id === 'components-terminal-runtime--overflow') await page.mouse.move(0, 0)
        await select(id)
        if (id === 'pages-terminal--shell-tabs-and-input') {
          // Same-document remount must discard the input story's old shell state.
          await select(id, 'forceRemount')
          assert.equal(await page.getByRole('tab').count(), 1, 'Remount must reset Shell 2')
        }
        if (['components-terminal-runtime--empty', 'components-terminal-tabs--overflow'].includes(id)) {
          const screen = page.locator('.xterm-screen:visible').first()
          const first = await screen.screenshot()
          // Observe multiple phases of the default 600ms cursor blink cycle.
          for (let sample = 0; sample < 4; sample++) {
            await page.waitForTimeout(350)
            assert.equal(Buffer.compare(await screen.screenshot(), first), 0, `${id}: ready cursor must stay painted`)
          }
        }
        if (id === 'components-terminal-runtime--overflow') {
          const scrollbar = page.locator('.xterm-scrollable-element > .scrollbar.vertical')
          assert.equal(await scrollbar.evaluate(element => getComputedStyle(element).opacity), '1', 'Overflow readiness must include the visible scrollbar')
          // Sample beyond xterm's auto-hide delay to catch timing-dependent captures.
          await page.waitForTimeout(1200)
          assert.equal(await scrollbar.evaluate(element => getComputedStyle(element).opacity), '1', 'Ready overflow scrollbar must not fade before capture')
        }
        if (id === 'components-terminal-runtime--ready') {
          const screen = page.locator('.xterm-screen')
          await screen.waitFor()
          const bounds = await screen.boundingBox()
          assert.ok(bounds)
          await page.mouse.click(bounds.x + 50, bounds.y + 8, { clickCount: 3 })
          await page.keyboard.press('ControlOrMeta+c')
          assert.match(await page.evaluate(() => navigator.clipboard.readText()), /OpenForge Terminal/, 'Terminal selection must copy replayed output')
        }
        await page.evaluate(() => localStorage.setItem('terminal-layout-leak-probe', 'dirty'))
        if (id === 'components-terminal-tabs--ready') {
          await page.getByRole('button', { name: 'Open new shell' }).click()
          assert.equal(await page.getByRole('tab').count(), 2)
          await select(id, 'forceRemount')
          assert.equal(await page.getByRole('tab').count(), 1, 'Remount must reset shell tabs')
          assert.equal(await page.evaluate(() => localStorage.getItem('terminal-layout-leak-probe')), null, 'Remount must reset layout storage')
        }
        await select(blank)
        assert.equal(await page.locator('.xterm').count(), 0, `${id}: detached terminal retained in DOM`)
        assert.equal(await page.evaluate(() => localStorage.getItem('terminal-layout-leak-probe')), null, `${id}: storage leaked`)
      }
      const listeners = await page.evaluate(() => window.terminalGlobalListeners())
      if (pass === 0) listenerBaseline = listeners
      else assert.equal(listeners, listenerBaseline, 'Repeated story switching retained global keyboard or resize listeners')
    }
    assert.deepEqual(externalRequests, [], 'Stories must not contact a runtime or external service')
    console.log(`${catalog}: ${stories.length} Terminal stories passed twice in one document with clean teardown and storage`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
