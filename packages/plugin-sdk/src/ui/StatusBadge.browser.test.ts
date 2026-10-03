// @vitest-environment node
import type { Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSdkBrowserFixture, type SdkBrowserFixture } from '../../test/browserFixture'
import { THEME_TOKEN_CSS_PROPERTIES, validateThemeDefinition, type ThemeDefinition, type ThemeTokenName } from '../themes'
import { BUILTIN_THEMES, DARK_THEME, LIGHT_THEME } from '../../../../src/lib/themeContract'

let browser: SdkBrowserFixture
let origin: string

beforeAll(async () => {
  browser = await createSdkBrowserFixture({
    entries: ['packages/plugin-sdk/src/ui/browser/status-badge.html'],
  })
  origin = browser.origin
}, 60_000)

afterAll(async () => { await browser?.close() })

// Each role has distinct edge, fill, and text colors, including warning vs waiting.
const contributedLight: ThemeDefinition = {
  id: 'plugin.status-light',
  label: 'Contributed light',
  appearance: 'light',
  tokens: {
    ...LIGHT_THEME.tokens,
    statusWarning: '#813600', statusWarningSubtle: '#fff0cf', onStatusWarning: '#572300',
    statusDanger: '#940054', statusDangerSubtle: '#ffe0ed', onStatusDanger: '#620032',
    statusSuccess: '#005d3d', statusSuccessSubtle: '#d0ffe1', onStatusSuccess: '#003a21',
    statusRunning: '#005d91', statusRunningSubtle: '#d5f4ff', onStatusRunning: '#003b62',
    statusWaiting: '#683d99', statusWaitingSubtle: '#eee2ff', onStatusWaiting: '#412462',
    statusNeutral: '#575c65', statusNeutralSubtle: '#e5e8ed', onStatusNeutral: '#333840',
  },
}

const contributedDark: ThemeDefinition = {
  id: 'plugin.status-dark',
  label: 'Contributed dark',
  appearance: 'dark',
  tokens: {
    ...DARK_THEME.tokens,
    statusWarning: '#ffd080', statusWarningSubtle: '#3e2d08', onStatusWarning: '#ffe6aa',
    statusDanger: '#ff83b5', statusDangerSubtle: '#40132d', onStatusDanger: '#ffb9d8',
    statusSuccess: '#7ddbae', statusSuccessSubtle: '#0a3424', onStatusSuccess: '#b9f4d6',
    statusRunning: '#80ccff', statusRunningSubtle: '#0b2e46', onStatusRunning: '#bce6ff',
    statusWaiting: '#c9a0ff', statusWaitingSubtle: '#2d1a48', onStatusWaiting: '#e1caff',
    statusNeutral: '#b0bfce', statusNeutralSubtle: '#242e38', onStatusNeutral: '#d3e0ec',
  },
}

const statusRoles = [
  ['pending', 'statusWarning', 'statusWarningSubtle', 'onStatusWarning'],
  ['failed', 'statusDanger', 'statusDangerSubtle', 'onStatusDanger'],
  ['success', 'statusSuccess', 'statusSuccessSubtle', 'onStatusSuccess'],
  ['in-progress', 'statusRunning', 'statusRunningSubtle', 'onStatusRunning'],
  ['in-review', 'statusWaiting', 'statusWaitingSubtle', 'onStatusWaiting'],
  ['submitted', 'statusWaiting', 'statusWaitingSubtle', 'onStatusWaiting'],
  ['expired', 'statusNeutral', 'statusNeutralSubtle', 'onStatusNeutral'],
] as const satisfies readonly (readonly [string, ThemeTokenName, ThemeTokenName, ThemeTokenName])[]

async function applyTheme(page: Page, theme: ThemeDefinition) {
  await page.evaluate(({ id, appearance, properties }) => {
    const root = document.documentElement
    root.dataset.theme = id
    root.dataset.themeAppearance = appearance
    for (const [name, value] of properties) root.style.setProperty(name, value)
  }, {
    id: theme.id,
    appearance: theme.appearance,
    properties: Object.entries(theme.tokens).map(([name, value]) => [THEME_TOKEN_CSS_PROPERTIES[name as ThemeTokenName], value]),
  })
}

async function expectPaint(page: Page, theme: ThemeDefinition) {
  for (const [status, edge, fill, text] of statusRoles) {
    const badge = page.getByRole('status', { name: status, exact: true })
    const expected = await page.evaluate(({ edge, fill, text }) => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = fill
      probe.style.color = text
      probe.style.boxShadow = `inset 0 0 0 1px ${edge}`
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const paint = { background: style.backgroundColor, color: style.color, ring: style.boxShadow }
      probe.remove()
      return paint
    }, { edge: theme.tokens[edge], fill: theme.tokens[fill], text: theme.tokens[text] })
    expect(await badge.evaluate(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color, ring: style.boxShadow }
    }), `${theme.id}: ${status}`).toEqual(expected)
    expect(await badge.locator('svg').evaluate(element => getComputedStyle(element).color)).toBe(expected.color)
  }
}

describe('StatusBadge public paint', () => {
  it.each([...BUILTIN_THEMES, contributedLight, contributedDark])('uses $id semantic status colors for every status', async (theme) => {
    expect(validateThemeDefinition(theme)).toEqual({ valid: true, errors: [] })
    const page = await browser.newPage()
    try {
      await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/status-badge.html`)
      await page.getByRole('status', { name: 'pending', exact: true }).waitFor()
      await applyTheme(page, theme)
      await expectPaint(page, theme)
    } finally {
      await page.close()
    }
  }, 30_000)

  it('repaints mounted badges on theme switches and token changes without relying on theme selectors', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/status-badge.html`)
      await page.getByRole('status', { name: 'pending', exact: true }).waitFor()
      const mounted = await page.getByRole('status').elementHandles()
      for (const theme of [LIGHT_THEME, contributedLight, contributedDark, DARK_THEME, contributedLight]) {
        await applyTheme(page, theme)
        await expectPaint(page, theme)
        for (const badge of mounted) expect(await badge.evaluate(element => element.isConnected)).toBe(true)
      }

      // Same identity and appearance, new token values. Stale built-in selectors must not override them.
      const updated = { ...contributedLight, tokens: contributedDark.tokens }
      await applyTheme(page, updated)
      await page.evaluate(() => { document.documentElement.dataset.theme = 'openforge-dark' })
      await expectPaint(page, updated)
      await page.evaluate(() => {
        delete document.documentElement.dataset.theme
        delete document.documentElement.dataset.themeAppearance
      })
      await expectPaint(page, updated)
      for (const badge of mounted) expect(await badge.evaluate(element => element.isConnected)).toBe(true)
    } finally {
      await page.close()
    }
  }, 30_000)

  it('animates only progress and stops the mounted icon when reduced motion is enabled', async () => {
    const page = await browser.newPage({ reducedMotion: 'no-preference' })
    try {
      await page.goto(`${origin}packages/plugin-sdk/src/ui/browser/status-badge.html`)
      await page.getByRole('status', { name: 'pending', exact: true }).waitFor()
      await applyTheme(page, contributedLight)
      for (const [status] of statusRoles) {
        const icon = page.getByRole('status', { name: status, exact: true }).locator('svg')
        const animation = await icon.evaluate(element => {
          const style = getComputedStyle(element)
          return { name: style.animationName, duration: style.animationDuration, timing: style.animationTimingFunction, iterations: style.animationIterationCount }
        })
        if (status === 'in-progress') {
          expect(animation.name).not.toBe('none')
          expect(animation).toMatchObject({ duration: '3s', timing: 'linear', iterations: 'infinite' })
        } else {
          expect(animation.name).toBe('none')
        }
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const [status] of statusRoles) {
        const icon = page.getByRole('status', { name: status, exact: true }).locator('svg')
        expect(await icon.evaluate(element => getComputedStyle(element).animationName)).toBe('none')
      }
    } finally {
      await page.close()
    }
  }, 30_000)
})
