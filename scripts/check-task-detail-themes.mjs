import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { checkMountedTaskState } from './task-detail-theme-state.mjs'
import {
  compareBaseline,
  cycleThemes,
  loadStory,
  sampleTargets,
  writeJsonArtifact,
} from './storybook-migration-browser-harness.mjs'

// Capture before migration, then compare the same mounted public views after migration.
const url = process.env.STORYBOOK_URL
assert.ok(url, 'Set STORYBOOK_URL to the pages Storybook from this worktree')
const capture = process.argv.includes('--capture')
const output = resolve(process.env.TASK_DETAIL_BASELINE ?? 'artifacts/task-detail-themes/before.json')
const cases = [
  { story: 'pages-self-review--loading', targets: [
    { id: 'panel', selector: '[aria-label="Code diff panel"]' },
    { id: 'feedback', selector: '[role="status"]:has-text("Loading diff...")' },
    { id: 'spinner', selector: '[role="status"]:has-text("Loading diff...") > :first-child' },
  ] },
  { story: 'pages-self-review--failure', targets: [
    { id: 'feedback', selector: '[role="alert"]:has-text("Failed to load diff. Please try again.")' },
    { id: 'retry', selector: 'button:text-is("Retry loading diff")' },
  ] },
  { story: 'pages-task-detail--backlog', targets: [
    { id: 'prompt', selector: '[aria-label="Initial Prompt content"]' },
  ] },
  { story: 'pages-task-detail--review', targets: [
    { id: 'file', selector: '[role="treeitem"][aria-label="Select file src/greet.ts"]' },
    { id: 'panel', selector: '[aria-label="Code diff panel"]' },
  ] },
  { story: 'pages-task-detail--active', targets: [
    { id: 'terminal', selector: '.agent-terminal-surface' },
  ] },
]
const expected = capture ? [] : JSON.parse(readFileSync(output, 'utf8')).reports
const reports = []
const browser = await chromium.launch({ headless: true })
try {
  for (const entry of cases) {
    for (const width of [1280, 1000]) {
      const { page, pageErrors } = await loadStory(browser, {
        storybookUrl: url,
        story: entry.story,
        width,
        locale: 'en-US',
        timezoneId: 'UTC',
      })
      try {
        const mounted = await page.locator(entry.targets[0].selector).elementHandle()
        const samples = await cycleThemes(page, {
          mounted,
          mountedMessage: 'Theme changes must retain the mounted view',
          sample: async (_page, theme) => {
            const snapshot = await sampleTargets(page, entry.targets)
            assert.equal(snapshot.theme, theme)
            if (!capture) {
              const before = expected.find(row => row.story === entry.story && row.width === width && row.theme === theme)
              assert.ok(before, `Missing baseline for ${entry.story}/${width}/${theme}`)
              if (entry.story === 'pages-self-review--loading') {
                const spinner = page.locator(entry.targets.find(target => target.id === 'spinner').selector)
                assert.equal(await spinner.getAttribute('aria-hidden'), 'true', 'The loading message owns the announcement')
                const paint = await spinner.evaluate(element => {
                  const style = getComputedStyle(element)
                  return { ink: style.borderTopColor, color: style.color, motion: style.animationName }
                })
                assert.equal(paint.ink, paint.color, 'The SDK spinner paints the inherited accent')
                assert.equal(paint.motion, 'none', 'Reduced motion must leave a visible static loading indicator')
              }
              for (const actual of snapshot.elements) {
                const prior = before.snapshot.elements.find(element => element.id === actual.id)
                const context = `${entry.story}/${width}/${theme}/${actual.id}`
                compareBaseline(actual.bounds, prior.bounds, `${context}.bounds`)
                const properties = ['color', 'opacity', 'font', 'fontSize', 'lineHeight', 'role', 'live', 'selected', 'disabled', 'text']
                if (actual.id !== 'spinner') properties.push('background', 'radius')
                for (const property of properties) compareBaseline(actual[property], prior[property], `${context}.${property}`, { tolerance: 0 })
                assert.equal(actual.textLineTops.length, prior.textLineTops.length, `${context} wrapping`)
              }
              // Poison only legacy paint aliases on host targets. Shared packages retain their own ticket ownership.
              const hostTargets = entry.targets.filter(target => target.id !== 'file')
              const poison = await page.addStyleTag({ content: hostTargets.map(target => `${target.selector.replace(/:has-text\([^)]*\)|:text-is\([^)]*\)/g, '')} { --color-base-100: #ff00ff !important; --color-base-content: #ff00ff !important; --color-primary: #ff00ff !important; --color-error: #ff00ff !important; }`).join('\n') })
              const independent = await sampleTargets(page, entry.targets)
              for (let i = 0; i < snapshot.elements.length; i++) {
                for (const property of ['color', 'background']) assert.equal(independent.elements[i][property], snapshot.elements[i][property], `${entry.story}/${theme}/${entry.targets[i].id} must not depend on legacy ${property}`)
              }
              await poison.evaluate(element => element.remove())
            }
            return snapshot
          },
        })
        for (const { theme, snapshot } of samples) reports.push({ story: entry.story, width, theme, snapshot })
        if (!capture) await checkMountedTaskState(page, entry.story)
        assert.deepEqual(pageErrors, [], `${entry.story} page errors`)
        console.log(`${entry.story} ${width}px: ${samples.length} themes ${capture ? 'captured' : 'passed'}`)
      } finally { await page.close() }
    }
  }
  const destination = capture ? output : resolve(output, '../after.json')
  writeJsonArtifact(destination, { browser: browser.version(), geometryToleranceCssPx: 1, reports })
  console.log(`Saved ${reports.length} cases to ${destination}`)
} finally { await browser.close() }
