import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { baselineCases } from './ui-migration-baseline-cases.mjs'
import { measureTargets } from './ui-migration-baseline-measurements.mjs'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'
import { captureControlStates } from './storybook-migration-browser-harness.mjs'

// Native computed measurements supplement, never replace, pinned raster review.
const url = process.env.STORYBOOK_URL
assert.ok(url, 'Set STORYBOOK_URL to the pages server started from this worktree; ports may belong to other worktrees')
const output = resolve(process.env.UI_MIGRATION_BASELINE ?? 'artifacts/storybook-visual/ui-migration-baseline.json')
const browser = await chromium.launch({ headless: true })
const reports = []
try {
  for (const entry of baselineCases) {
    for (const width of [1280, 1000]) {
      const viewport = { width, height: 900 }
      const knownGap = width === 1000 ? entry.narrowGap : undefined
      const targets = entry.targets.map(target => ({ ...target, ...(knownGap ? { knownInvisibleReason: knownGap } : {}) }))
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' })
      const pageErrors = []
      const consoleErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      try {
        await page.goto(`${url}/iframe.html?id=${entry.story}&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
        await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
        assert.equal(await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase), 'finished', `${entry.story} interaction must finish successfully`)
        if (entry.story === 'pages-project-setup--success') {
          // The completion story now reopens the dialog. Hold its real, transient
          // success state with the browser clock, without changing application callbacks.
          await page.clock.install()
          await page.clock.pauseAt(new Date(Date.now() + 100))
          await page.getByRole('radio', { name: /New repo/ }).evaluate(element => element.click())
          await page.getByRole('textbox', { name: 'Project Name' }).fill('catalog-project')
          await page.getByRole('button', { name: 'Create Project', exact: true }).evaluate(element => element.click())
        }
        for (const target of targets) await page.locator(target.selector).waitFor({ state: target.knownInvisibleReason ? 'attached' : 'visible' })
        await page.evaluate(() => document.fonts.ready)
        await page.addStyleTag({ content: '* { transition: none !important; }' })
        await installBaselineThemes(page)
        const mountedTarget = await page.locator(entry.targets[0].selector).elementHandle()
        for (const theme of baselineThemeIds) {
          await selectBaselineTheme(page, theme)
          assert.ok(await mountedTarget.evaluate(element => element.isConnected), 'Theme selection must not remount the measured view')
          const snapshot = await measureTargets(page, targets)
          assert.equal(snapshot.theme, theme, `${entry.story} requested theme must be active`)
          assert.equal(snapshot.fonts, 'loaded')
          const interactions = []
          if (entry.interaction && !knownGap) {
            const control = page.locator(entry.interaction)
            const target = [{ id: 'interaction', selector: entry.interaction }]
            interactions.push(...await captureControlStates(page, {
              control,
              sample: async (_page, _control, state) => ({ state, ...await measureTargets(page, target) }),
            }))
          }
          reports.push({ story: entry.story, theme, viewport, snapshot, interactions, ...(knownGap ? { knownGap } : {}), consoleErrors: [...consoleErrors] })
        }
        assert.deepEqual(pageErrors, [], 'Baseline stories must not have unhandled errors')
        console.log(`Measured ${entry.story} at ${width}px under ${baselineThemeIds.length} themes`)
      } finally { await page.close() }
    }
  }
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, JSON.stringify({ browser: browser.version(), sourceUrl: url, locale: 'en-US', timezone: 'UTC', scale: 1,
    reducedMotion: 'reduce', geometryToleranceCssPx: 1, reports }, null, 2) + '\n')
  console.log(`Saved ${reports.length} measurement cases to ${output}`)
} finally { await browser.close() }
