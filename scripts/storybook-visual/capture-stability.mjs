import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { capture as captureStory } from './capture.mjs'
import { compare, verifyDiagnostics } from './comparison.mjs'
import { verifyRepeatedCapture } from './repetition.mjs'

// Preserve main's targeted regressions independently of the full-matrix repeats.
export async function checkCaptureStability({ browser, url, entries, output, timings }) {
  const capture = (browser, url, entry, options = {}) => captureStory(browser, url, entry, { ...options, timings, phase: 'capture-stability' })
  for (const entry of entries.filter(item => ['sdk-overlays--modal', 'pages-task-detail--backlog', 'pages-task-detail--narrow'].includes(item.story))) {
    // Rounded, clipped overlays exposed Chromium's partial-raster corner drift.
    const first = await capture(browser, url, entry)
    verifyDiagnostics(first.diagnostics, entry.expectedErrors)
    for (let attempt = 1; attempt < 8; attempt++) {
      const next = await capture(browser, url, entry)
      verifyDiagnostics(next.diagnostics, entry.expectedErrors)
      await verifyRepeatedCapture({ ...entry, tolerance: undefined }, first.bytes, next.bytes, output)
    }
  }

  const entry = entries.find(item => item.catalog === 'components')
  assert.ok(entry, 'self-test requires a component smoke case')
  const reference = await capture(browser, url, entry)
  const delayed = await capture(browser, url, entry, {
    mutate: async page => {
      await page.evaluate(() => setTimeout(() => {
        const overlay = document.createElement('div')
        overlay.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:99999'
        document.body.append(overlay)
      }, 200))
      await page.waitForTimeout(350)
    },
  })
  verifyDiagnostics(reference.diagnostics, entry.expectedErrors)
  verifyDiagnostics(delayed.diagnostics, entry.expectedErrors)
  assert.equal(compare(reference.bytes, delayed.bytes, entry.tolerance).matches, true, 'wall-clock delay must not advance runtime timers after readiness')

  // CSS animation controls alone cannot freeze inline or image-mask SVG SMIL.
  const motionCaptures = []
  for (const elapsed of [50, 350]) {
    motionCaptures.push(await capture(browser, url, entry, {
      mutate: async page => {
        await page.evaluate(() => {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="20" height="40"><animate attributeName="x" values="0;80;0" dur="1s" repeatCount="indefinite"/></rect></svg>'
          const probe = document.createElement('div')
          probe.style.cssText = 'position:fixed;left:0;top:0;background:white;z-index:99999'
          probe.innerHTML = svg
          const mask = document.createElement('div')
          mask.style.cssText = 'width:100px;height:40px;background:black'
          mask.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
          probe.append(mask)
          document.body.append(probe)
        })
        await page.waitForTimeout(elapsed)
      },
    }))
  }
  assert.equal(compare(motionCaptures[0].bytes, motionCaptures[1].bytes).matches, true, 'SVG motion must not depend on capture time')
  const maskFrame = PNG.sync.read(motionCaptures[0].bytes)
  const pixel = (x, y) => [...maskFrame.data.subarray((y * maskFrame.width + x) * 4, (y * maskFrame.width + x) * 4 + 3)]
  assert.deepEqual(pixel(90, 60), [0, 0, 0], 'the mask must retain its visible middle keyframe')
  assert.deepEqual(pixel(10, 60), [255, 255, 255], 'the mask must not settle at its empty end frame')
  for (const result of motionCaptures) verifyDiagnostics(result.diagnostics, entry.expectedErrors)

  const terminals = entries.filter(item => item.theme === 'openforge-light' && [
    'pages-task-detail--terminal', 'components-task-workspace-agent-panel--waiting',
  ].includes(item.story))
  for (const terminal of terminals) {
    const first = await capture(browser, url, terminal, { mutate: page => page.waitForTimeout(50) })
    const second = await capture(browser, url, terminal, { mutate: async page => {
      await page.waitForTimeout(700)
      await page.evaluate(() => {
        const input = document.querySelector('.xterm-helper-textarea')
        input.focus()
        requestAnimationFrame(() => input.focus())
      })
      await page.clock.runFor(32)
    } })
    verifyDiagnostics(first.diagnostics, terminal.expectedErrors)
    verifyDiagnostics(second.diagnostics, terminal.expectedErrors)
    assert.equal(compare(first.bytes, second.bytes).matches, true, `${terminal.story}: caret must settle after delayed focus and blink timing`)
  }

  for (const feedback of entries.filter(item => item.story === 'pages-self-review--send-feedback')) {
    const first = await capture(browser, url, feedback)
    for (const rate of [1, 4]) {
      const delayed = await capture(browser, url, feedback, {
        prepare: async page => {
          const session = await page.context().newCDPSession(page)
          await session.send('Emulation.setCPUThrottlingRate', { rate })
          const wait = page.waitForFunction.bind(page)
          let first = true
          page.waitForFunction = async (...args) => {
            const result = await wait(...args)
            if (first) {
              first = false
              // Deliberately exceed the production confirmation's three-second
              // lifetime at the host observation boundary, not as a readiness fix.
              await new Promise(resolve => setTimeout(resolve, 3200))
            }
            return result
          }
        },
        mutate: async page => {
          assert.equal(await page.getByText('Feedback sent to agent!', { exact: true }).isVisible(), true)
          assert.equal(await page.getByRole('button', { name: 'Send feedback (0)', exact: true }).isDisabled(), true)
          assert.equal(await page.getByRole('dialog', { name: 'Review the prompt before sending to the agent' }).count(), 0)
          await page.waitForTimeout(4000)
          assert.equal(await page.getByText('Feedback sent to agent!', { exact: true }).isVisible(), true)
        },
      })
      verifyDiagnostics(first.diagnostics, feedback.expectedErrors)
      verifyDiagnostics(delayed.diagnostics, feedback.expectedErrors)
      await verifyRepeatedCapture({ ...feedback, tolerance: undefined }, first.bytes, delayed.bytes, output)
    }
  }
}
