import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { measureTargets } from './ui-migration-baseline-measurements.mjs'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

export { baselineThemeIds }

const defaultGlobals = 'openforgeTheme:openforge-light;openforgeMotion:reduced'

export async function loadStory(browser, {
  storybookUrl,
  story,
  width,
  height = 900,
  deviceScaleFactor = 1,
  locale,
  timezoneId,
  reducedMotion = 'reduce',
  globals = defaultGlobals,
  disableTransitions = true,
  waitForFonts = true,
}) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor,
    ...(locale ? { locale } : {}),
    ...(timezoneId ? { timezoneId } : {}),
    reducedMotion,
  })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const globalsQuery = globals ? `&globals=${globals}` : ''
  await page.goto(`${storybookUrl}/iframe.html?id=${story}&viewMode=story${globalsQuery}`)
  await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
  assert.equal(await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase), 'finished', story)
  if (waitForFonts) await page.evaluate(() => document.fonts.ready)
  if (disableTransitions) await page.addStyleTag({ content: '* { transition: none !important; }' })
  return { page, pageErrors }
}

export async function cycleThemes(page, {
  mounted,
  themes = baselineThemeIds,
  installThemes = installBaselineThemes,
  selectTheme = selectBaselineTheme,
  mountedMessage = 'Theme selection must preserve the mounted view',
  sample,
}) {
  await installThemes(page)
  const snapshots = []
  for (const theme of themes) {
    await selectTheme(page, theme)
    if (mounted) assert.ok(await mounted.evaluate(element => element.isConnected), mountedMessage)
    snapshots.push({ theme, snapshot: await sample(page, theme) })
  }
  return snapshots
}

export const sampleTargets = measureTargets

export async function samplePresentationTree(target) {
  return target.evaluate(root => {
    const measure = element => {
      const box = element.getBoundingClientRect()
      const css = getComputedStyle(element)
      return {
        x: box.x, y: box.y, width: box.width, height: box.height, color: css.color, background: css.backgroundColor,
        borderColor: css.borderTopColor, borderWidth: css.borderTopWidth, radius: css.borderTopLeftRadius,
        font: css.fontFamily, fontSize: css.fontSize, animation: css.animationName,
      }
    }
    return {
      root: measure(root),
      spinner: [...root.querySelectorAll('.loading, [data-size]')].filter(element => element.tagName === 'SPAN').map(measure),
      hints: [...root.querySelectorAll('kbd')].map(measure),
      controls: [...root.querySelectorAll('button, input, [role="option"]')].map(measure),
    }
  })
}

export async function captureControlStates(page, {
  control,
  sample,
  moveBeforeRelease,
  focusMessage = 'Keyboard focus must be visible',
  pressedMessage = 'Pressed control must be active',
}) {
  await control.evaluate(element => element.addEventListener('click', event => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }, { capture: true }))
  await page.keyboard.press('Tab')
  await control.focus()
  assert.ok(await control.evaluate(element => element.matches(':focus-visible')), focusMessage)
  const focus = await sample(page, control, 'focus-visible')
  await page.evaluate(() => document.activeElement?.blur())
  await control.hover()
  const hover = await sample(page, control, 'hover')
  await page.mouse.down()
  let pressed
  try {
    assert.ok(await control.evaluate(element => element.matches(':active')), pressedMessage)
    pressed = await sample(page, control, 'pressed')
    await moveBeforeRelease?.(page, control)
  } finally {
    await page.mouse.up()
  }
  await page.keyboard.press('Tab')
  await control.focus()
  return [hover, pressed, focus]
}

export function compareBaseline(actual, expected, path, {
  tolerance = 1,
  ignorePath = () => false,
  requireSameKeys = false,
} = {}) {
  if (ignorePath(path, actual, expected)) return
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: ${actual} vs ${expected}`)
    return
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${path}.length`)
    expected.forEach((value, index) => compareBaseline(actual[index], value, `${path}.${index}`, { tolerance, ignorePath, requireSameKeys }))
    return
  }
  if (expected && typeof expected === 'object') {
    if (requireSameKeys) assert.deepEqual(Object.keys(actual), Object.keys(expected), path)
    for (const key of Object.keys(expected)) compareBaseline(actual[key], expected[key], `${path}.${key}`, { tolerance, ignorePath, requireSameKeys })
    return
  }
  assert.equal(actual, expected, path)
}

export function writeJsonArtifact(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeScreenshotArtifact(page, path) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  await page.screenshot({ path })
}
