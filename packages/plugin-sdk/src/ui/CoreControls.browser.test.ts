// @vitest-environment node
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let server: ViteDevServer
let browser: Browser
let origin: string

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../..'),
    plugins: [svelte()],
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

const controls = [
  ['Button', 'button', 'Run review'],
  ['IconButton', 'button', 'Refresh tasks'],
  ['TextField', 'textbox', 'Repository name'],
  ['Textarea', 'textbox', 'Review note'],
  ['Checkbox', 'checkbox', 'Include generated files'],
  ['Switch', 'switch', 'Enable notifications'],
] as const

async function openFixture(page: Page, theme: string, invalid = false) {
  await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/index.html?theme=${theme}${invalid ? '&invalid' : ''}`)
  await page.getByRole('button', { name: 'Run review' }).waitFor()
}

// Inspect the rendered group, including decorative siblings and pseudo-elements.
// No component class names or assumptions about which element paints the control.
async function presentation(group: Locator) {
  return group.evaluate((root) => [root, ...root.querySelectorAll('*')].flatMap((element) => {
    const rect = element.getBoundingClientRect()
    const own = getComputedStyle(element)
    if (!rect.width || !rect.height || own.visibility === 'hidden' || Number(own.opacity) === 0) return []
    return [null, '::before', '::after'].flatMap((pseudo) => {
      const style = getComputedStyle(element, pseudo)
      if (pseudo && (style.content === 'none' || style.content === 'normal')) return []
      return [{
        outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
          && style.outlineColor !== 'rgba(0, 0, 0, 0)' && style.outlineColor !== 'transparent',
        durations: style.transitionProperty === 'none' ? [0] : style.transitionDuration.split(',').map((duration) => parseFloat(duration)),
      }]
    })
  }))
}

async function fieldPaint(field: Locator) {
  return field.evaluate((element) => {
    let background = ''
    const borders: string[] = []
    // Transparent inputs expose their containing control's background.
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (!background && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
        background = style.backgroundColor
      }
      if (style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) > 0) borders.push(style.borderTopColor)
      if (current.getAttribute('role') === 'group') break
    }
    return { background, borders }
  })
}

async function expectButtonPaint(button: Locator, background: string, color: string) {
  expect(await button.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, border: style.borderTopColor, color: style.color }
  })).toEqual({ background, border: background, color })
}

describe.each(['light', 'dark', 'custom'])('core control browser styles in %s theme', (theme) => {
  it.each(['Button', 'IconButton'])('%s keeps primary, danger, and disabled interaction colors', async (component) => {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    try {
      await openFixture(page, theme)
      for (const variant of ['primary', 'danger']) {
        const foreground = variant === 'primary' && theme === 'dark' ? 'rgb(13, 15, 20)' : 'rgb(255, 255, 255)'
        const hover = variant === 'primary' ? 'rgb(25, 59, 204)' : 'rgb(145, 32, 24)'
        const pressed = variant === 'primary' ? 'rgb(16, 38, 136)' : 'rgb(145, 32, 24)'
        const resting = variant === 'danger' ? 'rgb(180, 35, 24)' : {
          light: 'rgb(41, 71, 255)', dark: 'rgb(132, 148, 255)', custom: 'rgb(139, 61, 255)',
        }[theme]!
        for (const disabled of [false, true]) {
          const button = page.getByRole('button', { name: `${variant} ${component}${disabled ? ' disabled' : ''}`, exact: true })
          expect(await button.isDisabled()).toBe(disabled)
          const expectedForeground = disabled ? 'rgb(102, 102, 102)' : foreground
          const disabledBackground = 'rgb(170, 170, 170)'
          await expectButtonPaint(button, disabled ? disabledBackground : resting, expectedForeground)
          await button.hover()
          await expectButtonPaint(button, disabled ? disabledBackground : hover, expectedForeground)
          await page.mouse.down()
          // Remove hover while retaining the press so hover styling cannot hide a missing active rule.
          await page.mouse.move(0, 0)
          if (!disabled) expect(await button.evaluate((element) => element.matches(':active') && !element.matches(':hover'))).toBe(true)
          await expectButtonPaint(button, disabled ? disabledBackground : pressed, expectedForeground)
          await page.mouse.up()
          await expectButtonPaint(button, disabled ? disabledBackground : resting, expectedForeground)
        }
      }
    } finally {
      await page.close()
    }
  }, 30_000)

  it('shows a visible outline on every keyboard-focused control', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    try {
      await openFixture(page, theme)
      for (const [component, role, name] of controls) {
        const group = page.getByRole('group', { name: component, exact: true })
        expect((await presentation(group)).some((style) => style.outline), `${component} before focus`).toBe(false)
        await page.keyboard.press('Tab')
        expect(await page.getByRole(role, { name }).evaluate((element) => element === document.activeElement), component).toBe(true)
        expect((await presentation(group)).some((style) => style.outline), `${component} focus outline`).toBe(true)
      }
    } finally {
      await page.close()
    }
  })

  it('removes control and decorative transitions when reduced motion is requested', async () => {
    const page = await browser.newPage({ reducedMotion: 'no-preference' })
    try {
      await openFixture(page, theme)
      for (const [component] of controls) {
        const styles = await presentation(page.getByRole('group', { name: component, exact: true }))
        expect(styles.some((style) => style.durations.some((duration) => duration > 0)), `${component} normal motion`).toBe(true)
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const [component] of controls) {
        const styles = await presentation(page.getByRole('group', { name: component, exact: true }))
        expect(styles.length, component).toBeGreaterThan(0)
        expect(styles.every((style) => style.durations.every((duration) => duration === 0)), `${component} reduced motion`).toBe(true)
      }
    } finally {
      await page.close()
    }
  })

  it.each(['Repository name', 'Review note'])('preserves the %s background while showing its invalid border', async (name) => {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    try {
      await openFixture(page, theme)
      const field = page.getByRole('textbox', { name })
      const normal = await fieldPaint(field)
      expect(normal.background).not.toBe('')
      await openFixture(page, theme, true)
      expect(await field.getAttribute('aria-invalid')).toBe('true')
      const invalid = await fieldPaint(field)
      expect(invalid.background).toBe(normal.background)
      expect(invalid.borders).toContain('rgb(255, 238, 238)')
      expect(normal.borders).not.toContain('rgb(255, 238, 238)')
    } finally {
      await page.close()
    }
  })
})
