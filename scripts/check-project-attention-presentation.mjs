import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { baselineCases } from './ui-migration-baseline-cases.mjs'
import {
  baselineThemeIds,
  captureControlStates,
  compareBaseline,
  cycleThemes,
  loadStory,
  sampleTargets,
  writeJsonArtifact,
  writeScreenshotArtifact,
} from './storybook-migration-browser-harness.mjs'

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
  const samples = await captureControlStates(page, {
    control,
    focusMessage: `${entry.story}: keyboard focus must be visible`,
    pressedMessage: `${entry.story}: pressed control must be active`,
    sample: async (_page, _control, state) => {
      const snapshot = { state, ...await sampleTargets(page, target) }
      if (state === 'focus-visible') assert.ok(!snapshot.elements[0].outline.includes(' none '), `${entry.story}: focus outline must paint`)
      return snapshot
    },
    moveBeforeRelease: async () => {
      const modalBox = await page.locator('.of-modal-box').boundingBox()
      assert.ok(modalBox, `${entry.story}: modal box must remain visible`)
      await page.mouse.move(modalBox.x + modalBox.width / 2, modalBox.y + 4)
    },
  })
  return samples
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
const browser = await chromium.launch({ headless: true })
const reports = []
try {
  for (const entry of entries) {
    for (const width of [1280, 1000]) {
      const viewport = { width, height: 900 }
      console.log(`Checking ${entry.story} at ${width}px`)
      const storyToLoad = entry.story === 'pages-project-setup--success'
        ? 'pages-project-setup--new-repository'
        : entry.story
      const { page, pageErrors } = await loadStory(browser, {
        storybookUrl,
        story: storyToLoad,
        width,
        locale: 'en-US',
        timezoneId: 'UTC',
      })
      try {
        if (entry.story === 'pages-project-setup--success') {
          await page.evaluate(() => { window.setTimeout = () => 0 })
          await page.getByRole('button', { name: 'Create Project' }).click()
        }
        for (const target of entry.targets) await page.locator(target.selector).waitFor()
        const mounted = await page.locator(entry.targets[0].selector).elementHandle()
        const samples = await cycleThemes(page, {
          mounted,
          mountedMessage: `${entry.story}: theme selection must preserve the mounted view`,
          sample: async (_page, theme) => {
            console.log(`  ${theme}`)
            const snapshot = await sampleTargets(page, entry.targets)
            const interactions = await exerciseInteraction(page, entry)
            await verifyAttentionDetails(page, entry)
            const key = `${entry.story}/${width}/${theme}`
            const expected = expectedReports.get(key)
            assert.ok(expected, `${key}: missing approved baseline`)
            const spinner = entry.story === 'pages-attention-overview--loading'
            const ignorePath = path => /\.(selector|whiteSpace|text|boxShadow)$/.test(path)
              || (path.includes('.interactions.') && /\.(outline|focusVisible)$/.test(path))
              || (spinner && /\.(background|border|radius|maskImage|clientWidth|clientHeight|scrollWidth|scrollHeight)$/.test(path))
            compareBaseline(snapshotContract(snapshot), snapshotContract(expected.snapshot), `${key}.snapshot`, { tolerance: geometryTolerance, ignorePath })
            compareBaseline(interactionContract(interactions), interactionContract(expected.interactions), `${key}.interactions`, { tolerance: geometryTolerance, ignorePath })
            if (theme.startsWith('com.example.')) {
              await writeScreenshotArtifact(page, resolve(outputDir, `${entry.story}-${theme.replaceAll(/[^a-z0-9]+/gi, '-')}-${width}.png`))
            }
            return { snapshot, interactions }
          },
        })
        for (const { theme, snapshot: sample } of samples) reports.push({ story: entry.story, theme, viewport, ...sample })
        assert.deepEqual(pageErrors, [], `${entry.story}: browser page errors`)
      } finally { await page.close() }
    }
  }
  assert.equal(reports.length, ownedStories.size * 2 * baselineThemeIds.length)
  writeJsonArtifact(resolve(outputDir, 'after.json'), { browser: browser.version(), geometryToleranceCssPx: geometryTolerance, reports })
  console.log(`Verified ${reports.length} project-setup and attention paint/bounds cases across ${baselineThemeIds.length} themes and two viewports`)
} finally { await browser.close() }
