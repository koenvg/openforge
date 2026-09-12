import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

const url = process.env.STORYBOOK_URL
assert.ok(url, 'Set STORYBOOK_URL to this worktree pages server')
const dir = resolve(`artifacts/storybook-visual/host-feedback${process.argv.includes('--production-css') ? '-production' : ''}`)
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1280, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${url}/iframe.html?id=pages-host-feedback--downloading&viewMode=story`)
    await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
    assert.equal(await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase), 'finished')
    if (process.argv.includes('--production-css')) {
      const assets = resolve('dist/assets')
      const css = readdirSync(assets).filter(name => name.endsWith('.css')).map(name => readFileSync(resolve(assets, name), 'utf8')).join('\n')
      assert.ok(css.includes('--of-accent'), 'Build the host before checking production CSS')
      await page.evaluate(() => {
        for (const style of document.querySelectorAll('style[data-vite-dev-id], link[rel="stylesheet"]')) style.remove()
      })
      await page.route('**/assets/*', async route => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1)
        if (readdirSync(assets).includes(name)) await route.fulfill({ path: resolve(assets, name) })
        else await route.continue()
      })
      await page.addStyleTag({ content: css })
    }
    await page.evaluate(() => document.fonts.ready)
    await installBaselineThemes(page)
    const bar = page.getByRole('progressbar', { name: 'Downloading Whisper Small' })
    const mountedBar = await bar.elementHandle()
    const action = page.getByRole('menuitem', { name: 'Open workspace', exact: true })
    for (const theme of baselineThemeIds) {
      await selectBaselineTheme(page, theme)
      assert.ok(await mountedBar.evaluate(node => node.isConnected))
      assert.equal(await bar.getAttribute('value'), '25')
      assert.equal(await page.getByRole('status').count(), 1)
      assert.equal(await page.getByRole('status').getAttribute('aria-live'), 'polite')
      assert.ok(await page.getByRole('menuitem', { name: 'Unavailable action' }).isDisabled())
      const paint = await page.evaluate(() => {
        const color = token => {
          const reference = document.createElement('div')
          reference.style.color = `var(${token})`
          document.body.append(reference)
          const result = getComputedStyle(reference).color
          reference.remove()
          return result
        }
        const root = document.querySelector('main'), css = selector => getComputedStyle(document.querySelector(selector))
        return { text: color('--of-text'), accent: color('--of-accent'), onAccent: color('--of-on-accent'),
          content: css('.markdown-body').color, keyword: css('.hljs-keyword').color, progress: css('progress').color,
          radius: css('progress').borderRadius, expectedRadius: getComputedStyle(document.documentElement).getPropertyValue('--of-radius-container').trim(),
          height: document.querySelector('progress').getBoundingClientRect().height,
          overflow: root.scrollWidth > root.clientWidth,
          spinners: [...root.querySelectorAll('span[data-size]')].map(node => ({ animation: getComputedStyle(node).animationName,
            ink: getComputedStyle(node).borderTopColor, color: getComputedStyle(node).color, width: node.getBoundingClientRect().width })) }
      })
      assert.equal(paint.content, paint.text)
      assert.equal(paint.keyword, paint.accent)
      assert.equal(paint.progress, paint.accent)
      assert.equal(paint.radius, paint.expectedRadius)
      assert.equal(paint.height, 8)
      assert.equal(paint.overflow, false)
      assert.equal(paint.spinners.length, 2)
      assert.equal(paint.spinners[0].width, 17, 'Toast glyph bounds stay fixed')
      for (const spinner of paint.spinners) { assert.equal(spinner.animation, 'none'); assert.equal(spinner.ink, spinner.color) }
      await action.hover()
      const hover = await action.evaluate(node => ({ bg: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }))
      assert.equal(hover.bg, paint.accent)
      assert.equal(hover.color, paint.onAccent)
      await page.mouse.down()
      assert.ok(await action.evaluate(node => node.matches(':active')))
      await page.mouse.move(0, 0)
      await page.mouse.up()
      await page.keyboard.press('Tab')
      await action.focus()
      assert.ok(await action.evaluate(node => node.matches(':focus-visible')))
      if (theme === 'com.example.ink:ink') await page.screenshot({ path: `${dir}/ink-${width}.png` })
    }
    // A newly registered palette must affect mounted consumers without a built-in selector.
    await page.evaluate(async ({ registryModule, contractModule }) => {
      const { themeRegistry } = await import(registryModule)
      const { LIGHT_THEME } = await import(contractModule)
      themeRegistry.registerContributedTheme({ ...LIGHT_THEME, id: 'com.example.host:mutated', label: 'Mutated host',
        tokens: { ...LIGHT_THEME.tokens, accent: '#654321', text: '#234567', radiusContainer: '13px', controlHeightCompact: '40px' },
      }, { pluginId: 'com.example.host', generation: 1 })
      await themeRegistry.selectTheme('com.example.host:mutated')
    }, { registryModule: `/@fs${new URL('../src/lib/theme.ts', import.meta.url).pathname}`,
      contractModule: `/@fs${new URL('../src/lib/themeContract.ts', import.meta.url).pathname}` })
    assert.ok(await mountedBar.evaluate(node => node.isConnected))
    assert.equal(await bar.evaluate(node => getComputedStyle(node).color), 'rgb(101, 67, 33)')
    assert.equal(await bar.evaluate(node => getComputedStyle(node).borderRadius), '13px')
    assert.equal(await page.locator('.markdown-body').evaluate(node => getComputedStyle(node).color), 'rgb(35, 69, 103)')
    assert.equal(await page.locator('span[data-size="xs"]').evaluate(node => node.getBoundingClientRect().width), 20)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.notEqual(await page.locator('span[data-size="xs"]').evaluate(node => getComputedStyle(node).animationName), 'none')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`Host feedback paint, progress, loading, content, interactions and mounted tokens passed at ${width}px`)
  }
} finally { await browser.close() }
