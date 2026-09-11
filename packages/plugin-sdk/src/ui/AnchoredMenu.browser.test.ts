// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createOpenForgePluginSdkSourceAliasRecord } from '../vite'

let server: ViteDevServer
let browser: Browser
let origin: string
let cacheRoot: string

beforeAll(async () => {
  // Parallel fixture servers must not invalidate each other's optimized dependencies.
  cacheRoot = await mkdtemp(resolve(tmpdir(), 'openforge-action-controls-'))
  // Build the public-entrypoint fixture during setup, outside interaction deadlines.
  execFileSync('pnpm', ['run', 'build'], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'pipe' })
  server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../..'),
    cacheDir: resolve(cacheRoot, 'source'),
    plugins: [svelte()],
    optimizeDeps: { entries: ['packages/plugin-sdk/src/ui/browser/anchored-menu.html'] },
    resolve: { alias: createOpenForgePluginSdkSourceAliasRecord(new URL('../../../../', import.meta.url)) },
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  try {
    await browser?.close()
  } finally {
    try {
      await server?.close()
    } finally {
      if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true })
    }
  }
})

describe.each([
  { name: 'Standalone actions', fixture: 'split-button' },
  { name: 'More actions', fixture: 'split-button' },
  { name: 'Bits actions', fixture: 'bits-menu-opening' },
])('$name opening dismissal', ({ name, fixture }) => {
  let page: Page
  let trigger: Locator

  beforeEach(async () => {
    page = await browser.newPage()
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/${fixture}.html`)
    trigger = page.getByRole('button', { name, exact: true })
    await trigger.waitFor()
  }, 30_000)

  afterEach(async () => {
    await page?.close()
  })

  async function dispatchOutsideClick(duringOpening: boolean) {
    // The public DOM marker pins the event to opening, independent of runner speed.
    // Use a complete DOM mouse sequence, not Playwright's actionability wait.
    await page.evaluate((duringOpening) => {
      function click() {
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent
          document.documentElement.dispatchEvent(new EventType(type, {
            bubbles: true, composed: true, cancelable: true,
            clientX: 900, clientY: 10, button: 0,
            buttons: type.endsWith('down') ? 1 : 0,
            pointerType: 'mouse',
          }))
        }
      }
      if (!duringOpening) {
        click()
        return
      }
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[role="menu"][data-starting-style]')) return
        observer.disconnect()
        document.documentElement.dataset.clickedDuringOpening = 'true'
        click()
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    }, duringOpening)
  }

  async function clickOutsideDuringOpening() {
    await dispatchOutsideClick(true)
    await trigger.click()
    expect(await page.locator('html').getAttribute('data-clicked-during-opening')).toBe('true')
    expect(await page.getByRole('status', { name: 'Selected action' }).textContent()).toBe('None')
    if (fixture === 'split-button') {
      expect(await page.getByRole('status', { name: 'Primary count' }).textContent()).toBe('0')
    }
  }

  describe('outside click during opening', () => {
    // Keep reproduction/setup assertions outside it.fails: missing markers, fixture
    // errors, or accidental selections must fail the suite, not count as the bug.
    beforeEach(clickOutsideDuringOpening)

    // https://github.com/huntabyte/bits-ui/issues/2141
    // An upstream fix must unexpectedly pass, prompting removal of .fails.
    it.fails('dismisses the menu', async () => {
      await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')
    })

    afterEach(async () => {
      // The early-dismissal assertion has completed. Replay the identical sequence
      // to prove it is a valid outside interaction, without a sleep or a second
      // expected failure hiding an unrelated event-dispatch problem.
      await dispatchOutsideClick(false)
      await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')
      expect(await page.getByRole('status', { name: 'Selected action' }).textContent()).toBe('None')
      if (fixture === 'split-button') {
        expect(await page.getByRole('status', { name: 'Primary count' }).textContent()).toBe('0')
      }
    })
  })
})

it('selects the End-focused item after rapid keyboard reopen without late autofocus stealing it', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/anchored-menu.html`)
    const trigger = page.getByRole('button', { name: 'Report actions' })
    await trigger.waitFor()
    await page.keyboard.press('Tab')
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      await page.keyboard.press('Enter')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Enter')
      await page.keyboard.press('End')
      expect(await page.getByRole('menuitem', { name: 'Delete report' }).evaluate((node) => node === document.activeElement)).toBe(true)
      await page.keyboard.press('Enter')
      expect(await page.getByRole('status', { name: 'Selected action' }).textContent()).toBe('delete')
      expect(await page.getByRole('status', { name: 'Selection count' }).textContent()).toBe(String(attempt))
      expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true)
    }
  } finally {
    await page.close()
  }
}, 30_000)

it('skips disabled items on keyboard, pointer, and controlled opening and restores focus on Escape', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/anchored-menu.html`)
    const trigger = page.getByRole('button', { name: 'Report actions' })
    await trigger.waitFor()
    await page.keyboard.press('Tab')
    for (const method of ['ArrowDown', 'Space', 'pointer', 'controlled']) {
      if (method === 'pointer') await trigger.click()
      else if (method === 'controlled') await page.getByRole('button', { name: 'Open actions externally' }).click()
      else await page.keyboard.press(method)
      await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()), { message: method }).toBe('Open report')
      await page.keyboard.press('ArrowDown')
      expect(await page.getByRole('menuitem', { name: 'Delete report' }).evaluate((node) => node === document.activeElement)).toBe(true)
      await page.keyboard.press('Home')
      expect(await page.getByRole('menuitem', { name: 'Open report', exact: true }).evaluate((node) => node === document.activeElement)).toBe(true)
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true)
    }
  } finally {
    await page.close()
  }
})

it('keeps a persistent checkbox menu usable when the focused item is removed, including the empty menu', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/anchored-menu.html`)
    const trigger = page.getByRole('button', { name: 'Remove reports' })
    await trigger.click()
    await expect.poll(() => page.getByRole('menuitemcheckbox', { name: 'Remove first report' }).evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('ArrowDown')
    expect(await page.getByRole('menuitemcheckbox', { name: 'Remove second report' }).evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    expect(await page.getByRole('menuitemcheckbox', { name: 'Remove third report' }).evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    expect(await page.getByRole('menuitemcheckbox', { name: 'Remove first report' }).evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu', { name: 'Remove reports' })
    expect(await menu.evaluate((node) => node === document.activeElement)).toBe(true)
    expect(await page.getByRole('menuitemcheckbox').count()).toBe(0)
    await page.keyboard.press('Escape')
    expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    expect(await menu.evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true)
  } finally {
    await page.close()
  }
})

it('operates both split segments by keyboard and preserves menu focus and accessible names', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/split-button.html`)
    const primary = page.getByRole('button', { name: 'Complete', exact: true })
    const trigger = page.getByRole('button', { name: 'More actions', exact: true })
    await primary.waitFor()
    await page.keyboard.press('Tab')
    expect(await primary.evaluate((node) => node === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    expect(await page.getByRole('status', { name: 'Primary count' }).textContent()).toBe('1')
    await page.keyboard.press('Tab')
    expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true)
    expect(await trigger.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none')
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Set aside', exact: true }).waitFor()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    expect(await page.getByRole('status', { name: 'Selected action' }).textContent()).toBe('long')
    expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true)
    expect(await primary.textContent()).toContain('Complete')
    await trigger.click()
    await page.keyboard.press('Escape')
    expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true)
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Set aside', exact: true }).waitFor()
    await page.locator('[role="menu"]:not([data-starting-style])').waitFor()
    // Modal menus suppress pointer events on underlying controls. Click the document
    // instead, letting Playwright wait for a stable target before dispatching.
    await page.locator('html').click({ position: { x: 900, y: 10 } })
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    expect(await page.getByRole('status', { name: 'Primary count' }).textContent()).toBe('1')
  } finally {
    await page.close()
  }
}, 30_000)

it('keeps standalone and split menus within a narrow viewport with readable long labels', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 300 } })
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/split-button.html`)
    for (const name of ['More actions', 'Standalone actions']) {
      await page.getByRole('button', { name, exact: true }).click()
      const menu = page.getByRole('menu')
      const bounds = await menu.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(300)
      expect(await menu.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.keyboard.press('Escape')
    }
  } finally {
    await page.close()
  }
})

it('reveals the menu panel and items with the anchored motion treatment', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/anchored-menu.html`)
    const openingStyles = page.evaluate(() => new Promise<{ panelClipPath: string; itemOpacity: string; itemTransform: string }>((resolve) => {
      const inspect = () => {
        const menu = document.querySelector<HTMLElement>('[role="menu"][data-starting-style]')
        const item = menu?.querySelector<HTMLElement>('[role="menuitem"]')
        if (!menu || !item) return
        resolve({
          panelClipPath: getComputedStyle(menu).clipPath,
          itemOpacity: getComputedStyle(item).opacity,
          itemTransform: getComputedStyle(item).transform,
        })
      }
      const observer = new MutationObserver(() => {
        inspect()
        if (document.querySelector('[role="menu"][data-starting-style]')) return
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true })
      inspect()
    }))
    await page.getByRole('button', { name: 'Report actions' }).click()
    const opening = await openingStyles
    const menu = page.getByRole('menu', { name: 'Report actions' })
    await menu.waitFor()
    await page.locator('[role="menu"]:not([data-starting-style])').waitFor()

    const motion = await menu.evaluate((node) => {
      const panelStyles = getComputedStyle(node)
      const itemStyles = getComputedStyle(node.querySelector<HTMLElement>('[role="menuitem"]')!)
      return {
        state: node.getAttribute('data-state'),
        panelTransition: panelStyles.transition,
        panelClipPath: panelStyles.clipPath,
        itemTransition: itemStyles.transition,
      }
    })

    expect(opening.panelClipPath).toContain('100%')
    expect(opening.itemOpacity).toBe('0')
    expect(opening.itemTransform).not.toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
    expect(motion.state).toBe('open')
    expect(motion.panelTransition).toContain('clip-path')
    expect(motion.panelTransition).toContain('cubic-bezier(0.16, 1, 0.3, 1)')
    expect(motion.panelClipPath).not.toContain('100%')
    expect(motion.itemTransition).toContain('opacity')
    expect(motion.itemTransition).toContain('transform')
  } finally {
    await page.close()
  }
})

it('fades the menu panel away without leaving a top border on close', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/anchored-menu.html`)
    const trigger = page.getByRole('button', { name: 'Report actions' })
    await trigger.click()
    const menu = page.getByRole('menu', { name: 'Report actions' })
    await menu.waitFor()
    await page.locator('[role="menu"]:not([data-starting-style])').waitFor()

    await page.keyboard.press('Escape')
    const endingMenu = page.locator('[role="menu"][data-ending-style]')
    await endingMenu.waitFor()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const closing = await endingMenu.evaluate((node) => {
      const styles = getComputedStyle(node)
      return {
        panelClipPath: styles.clipPath,
        panelOpacity: styles.opacity,
        panelTransition: styles.transition,
      }
    })
    expect(closing.panelClipPath).toContain('100%')
    expect(Number(closing.panelOpacity)).toBeLessThan(1)
    expect(closing.panelTransition).toContain('opacity')
    await menu.waitFor({ state: 'hidden' })
  } finally {
    await page.close()
  }
})

it('settles the menu immediately when reduced motion is preferred', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  try {
    await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/anchored-menu.html`)
    await page.getByRole('button', { name: 'Report actions' }).click()
    const menu = page.getByRole('menu', { name: 'Report actions' })
    await menu.waitFor()

    const motion = await menu.evaluate((node) => {
      const panelStyles = getComputedStyle(node)
      const itemStyles = getComputedStyle(node.querySelector<HTMLElement>('[role="menuitem"]')!)
      return {
        panelTransitionDuration: panelStyles.transitionDuration,
        panelClipPath: panelStyles.clipPath,
        itemOpacity: itemStyles.opacity,
        itemTransform: itemStyles.transform,
      }
    })

    expect(motion.panelTransitionDuration).toBe('0s')
    expect(motion.panelClipPath).not.toContain('100%')
    expect(motion.itemOpacity).toBe('1')
    expect(motion.itemTransform).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
  } finally {
    await page.close()
  }
})

it('renders the built public SplitButton export without source aliases or app imports', async () => {
  const packageServer = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../..'),
    cacheDir: resolve(cacheRoot, 'built'),
    plugins: [svelte()],
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  const page = await browser.newPage()
  try {
    await packageServer.listen()
    await page.goto(`${packageServer.resolvedUrls!.local[0]}packages/plugin-sdk/src/ui/browser/split-button.html`)
    await page.getByRole('button', { name: 'Complete', exact: true }).click()
    expect(await page.getByRole('status', { name: 'Primary count' }).textContent()).toBe('1')
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Set aside', exact: true }).click()
    expect(await page.getByRole('status', { name: 'Selected action' }).textContent()).toBe('aside')
  } finally {
    await page.close()
    await packageServer.close()
  }
}, 30_000)
