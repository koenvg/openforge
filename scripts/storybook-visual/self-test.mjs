import assert from 'node:assert/strict'
import { capture } from './capture.mjs'
import { verifyDiagnostics } from './comparison.mjs'
import { checkTerminalReadiness, checkTaskCursorStability } from './terminal-readiness.mjs'
import { runnerProbes } from './runner-probes.mjs'
import { checkCaptureStability } from './capture-stability.mjs'

export function regressionPhases({ browser, url, entries, output, timings }) {
  return {
    'terminal-readiness': () => checkTerminalReadiness({ browser, url, entries, output, timings }),
    'cursor-stability': () => checkTaskCursorStability({ browser, url, entries, output, timings }),
    'readiness-diagnostics': async () => {
      const entry = entries.find(entry => entry.catalog === 'components')
      assert.ok(entry, 'self-test requires a component smoke case')
      await assert.rejects(capture(browser, url, { ...entry, ready: '#missing-readiness' }, { timeout: 3000, timings, phase: 'missing-readiness' }), /missing readiness/)
      const declared = await capture(browser, url, entry, {
        timings, phase: 'declared-diagnostic',
        mutate: page => page.evaluate(() => console.error('declared failure')),
      })
      verifyDiagnostics(declared.diagnostics, [...entry.expectedErrors, 'declared failure'])
    },
    'capture-stability': () => checkCaptureStability({ browser, url, entries, output, timings }),
    'runner-probes': () => runnerProbes({ entries, output, timings }),
  }
}
