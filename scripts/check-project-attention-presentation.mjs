import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { baselineCases } from './ui-migration-baseline-cases.mjs'
import { measureTargets } from './ui-migration-baseline-measurements.mjs'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

const storybookUrl = process.env.STORYBOOK_URL
assert.ok(storybookUrl, 'Set STORYBOOK_URL to this worktree pages Storybook')

const ownedStories = new Set([
  'pages-attention-overview--loading',
  'pages-attention-overview--failure',
  'pages-attention-overview--narrow',
  'pages-project-setup--empty',
  'pages-project-setup--failure',
  'pages-project-setup--success',
])
const entries = baselineCases.filter(entry => ownedStories.has(entry.story))
assert.equal(entries.length, ownedStories.size, 'Every KVG-4871 browser case must remain in the migration baseline')

const baseline = JSON.parse(readFileSync(resolve('docs/ui-migration-baseline.json'), 'utf8'))
const expectedReports = new Map(baseline.reports
  .filter(report => ownedStories.has(report.story))
  .map(report => [`${report.story}/${report.viewport.width}/${report.theme}`, report]))
const geometryTolerance = baseline.geometryToleranceCssPx
assert.equal(geometryTolerance, 1, 'The approved geometry tolerance must remain one CSS pixel')

function compare(actual, expected, path, spinner = false) {
  if (/\.(selector|whiteSpace|text|boxShadow)$/.test(path)) return
  if (path.includes('.interactions.') && /\.(outline|focusVisible)$/.test(path)) return
  if (spinner && /\.(background|border|radius|maskImage|clientWidth|clientHeight|scrollWidth|scrollHeight)$/.test(path)) return
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= geometryTolerance, `${path}: ${actual} vs ${expected}`)
    return
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${path}.length`)
    expected.forEach((value, index) => compare(actual[index], value, `${path}.${index}`, spinner))
    return
  }
  if (expected && typeof expected === 'object') {
    for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`, spinner)
    return
  }
  assert.equal(actual, expected, path)
}
function snapshotContract(snapshot) {
  return {
    theme: snapshot.theme,
    fonts: snapshot.fonts,
    bodyFont: snapshot.bodyFont,
    overflow: snapshot.overflow,
    elements: snapshot.elements.map(element => ({
      id: element.id,
      tag: element.tag,
      label: element.label,
      role: element.role,
      live: element.live,
      disabled: element.disabled,
      invalid: element.invalid,
      selected: element.selected,
      checked: element.checked,
      bounds: { width: element.bounds.width, height: element.bounds.height },
      color: element.color,
      background: element.background,
      border: element.border,
      radius: element.radius,
      font: element.font,
      fontSize: element.fontSize,
      lineHeight: element.lineHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      opacity: element.opacity,
      boxShadow: element.boxShadow,
      animationDuration: element.animationDuration,
      display: element.display,
      visibility: element.visibility,
      textLineCount: element.textLineTops.length,
    })),
  }
}

function interactionContract(samples) {
  return samples.map(sample => ({ state: sample.state, ...snapshotContract(sample) }))
}


async function exerciseInteraction(page, entry) {
  if (!entry.interaction) return []
  const control = page.locator(entry.interaction)
  const target = [{ id: 'interaction', selector: entry.interaction }]
  await control.evaluate(element => element.addEventListener('click', event => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }, { capture: true }))
  await page.keyboard.press('Tab')
  await control.evaluate(element => element.focus())
  assert.ok(await control.evaluate(element => element.matches(':focus-visible')), `${entry.story}: keyboard focus must be visible`)
  const focusSample = { state: 'focus-visible', ...await measureTargets(page, target) }
  assert.ok(!focusSample.elements[0].outline.includes(' none '), `${entry.story}: focus outline must paint`)
  await page.evaluate(() => document.activeElement?.blur())
  await control.hover()
  const hoverSample = { state: 'hover', ...await measureTargets(page, target) }
  await page.mouse.down()
  let pressedSample
  try {
    assert.ok(await control.evaluate(element => element.matches(':active')), `${entry.story}: pressed control must be active`)
    pressedSample = { state: 'pressed', ...await measureTargets(page, target) }
    const modalBox = await page.locator('.of-modal-box').boundingBox()
    assert.ok(modalBox, `${entry.story}: modal box must remain visible`)
    await page.mouse.move(modalBox.x + modalBox.width / 2, modalBox.y + 4)
  } finally {
    await control.evaluate(element => { element.disabled = true })
    await page.mouse.up()
    await control.evaluate(element => { element.disabled = false })
  }
  await page.keyboard.press('Tab')
  await control.evaluate(element => element.focus())
  return [hoverSample, pressedSample, focusSample]
}

async function verifyAttentionDetails(page, entry) {
  if (entry.story === 'pages-attention-overview--loading') {
    const spinner = page.locator('[role="dialog"] span[data-size="md"]')
    assert.equal(await spinner.getAttribute('aria-hidden'), 'true')
    assert.equal(await spinner.getAttribute('role'), null)
    const ring = await spinner.evaluate(element => {
      const style = getComputedStyle(element)
      return { color: style.color, top: style.borderTopColor, right: style.borderRightColor, animation: style.animationName }
    })
    assert.equal(ring.top, ring.color, 'The reduced-motion loader must retain visible currentColor ink')
    assert.equal(ring.right, 'rgba(0, 0, 0, 0)', 'The loader ring must retain its open edge')
    assert.equal(ring.animation, 'none', 'Reduced motion must suppress loader animation')
  }
  if (entry.story === 'pages-attention-overview--narrow') {
    const row = page.locator('[data-attn-row]:has-text("Normalize the greeting")')
    const details = await row.evaluate(element => {
      const style = getComputedStyle(element)
      const token = name => {
        const reference = document.createElement('span')
        reference.style.color = `var(${name})`
        document.body.append(reference)
        const color = getComputedStyle(reference).color
        reference.remove()
        return color
      }
      return {
        focused: element.matches(':focus-visible'),
        background: style.backgroundColor,
        border: style.borderTopColor,
        ring: style.boxShadow,
        surfaceSubtle: token('--of-surface-subtle'),
      }
    })
    assert.equal(details.focused, true, 'The selected attention row must retain keyboard focus')
    assert.equal(details.background, details.surfaceSubtle)
    assert.equal(details.border, 'rgba(0, 0, 0, 0)')
    assert.notEqual(details.ring, 'none', 'The selected attention row must retain its ring')
    const hints = await page.locator('kbd.of-key-hint.of-key-hint-xs').evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect()
      return { text: element.textContent, width: bounds.width, height: bounds.height }
    }))
    assert.deepEqual(hints.map(hint => hint.text), ['T', 'R'])
    assert.ok(hints.every(hint => hint.width >= hint.height && hint.height > 0), 'Keyboard hints must keep compact visible bounds')
  }
}

const outputDir = resolve(process.env.PROJECT_ATTENTION_ARTIFACTS ?? 'artifacts/storybook-visual/project-attention-presentation')
mkdirSync(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const reports = []
try {
  for (const entry of entries) {
    for (const width of [1280, 1000]) {
      const viewport = { width, height: 900 }
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' })
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      try {
        console.log(`Checking ${entry.story} at ${width}px`)
        const storyToLoad = entry.story === 'pages-project-setup--success'
          ? 'pages-project-setup--new-repository'
          : entry.story
        await page.goto(`${storybookUrl}/iframe.html?id=${storyToLoad}&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
        await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
        assert.equal(await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase), 'finished', storyToLoad)
        if (entry.story === 'pages-project-setup--success') {
          await page.evaluate(() => { window.setTimeout = () => 0 })
          await page.getByRole('button', { name: 'Create Project' }).click()
        }
        for (const target of entry.targets) await page.locator(target.selector).waitFor()
        await page.evaluate(() => document.fonts.ready)
        await page.addStyleTag({ content: '* { transition: none !important; }' })
        await installBaselineThemes(page)
        const mounted = await page.locator(entry.targets[0].selector).elementHandle()
        for (const theme of baselineThemeIds) {
          await selectBaselineTheme(page, theme)
          console.log(`  ${theme}`)
          assert.ok(await mounted.evaluate(element => element.isConnected), `${entry.story}: theme selection must preserve the mounted view`)
          const snapshot = await measureTargets(page, entry.targets)
          const interactions = await exerciseInteraction(page, entry)
          await verifyAttentionDetails(page, entry)
          const key = `${entry.story}/${width}/${theme}`
          const expected = expectedReports.get(key)
          assert.ok(expected, `${key}: missing approved baseline`)
          compare(snapshotContract(snapshot), snapshotContract(expected.snapshot), `${key}.snapshot`, entry.story === 'pages-attention-overview--loading')
          compare(interactionContract(interactions), interactionContract(expected.interactions), `${key}.interactions`)
          reports.push({ story: entry.story, theme, viewport, snapshot, interactions })
          if (theme.startsWith('com.example.')) {
            await page.screenshot({ path: resolve(outputDir, `${entry.story}-${theme.replaceAll(/[^a-z0-9]+/gi, '-')}-${width}.png`) })
          }
        }
        assert.deepEqual(pageErrors, [], `${entry.story}: browser page errors`)
      } finally {
        await page.close()
      }
    }
  }
  assert.equal(reports.length, ownedStories.size * 2 * baselineThemeIds.length)
  writeFileSync(resolve(outputDir, 'after.json'), JSON.stringify({ browser: browser.version(), geometryToleranceCssPx: geometryTolerance, reports }, null, 2) + '\n')
  console.log(`Verified ${reports.length} project-setup and attention paint/bounds cases across ${baselineThemeIds.length} themes and two viewports`)
} finally {
  await browser.close()
}
