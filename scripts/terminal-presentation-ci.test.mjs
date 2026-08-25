import fs from 'node:fs'
import { expect, it } from 'vitest'

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const jobStart = workflow.indexOf('  terminal-presentation:\n')
const terminalPresentationJob = workflow.slice(jobStart, workflow.indexOf('\n  npm-packages:', jobStart))

it('runs the terminal presentation harness on macOS with Chromium and uploads its report', () => {
  expect(terminalPresentationJob).toContain('runs-on: macos-14')
  expect(terminalPresentationJob).toContain('pnpm exec playwright install chromium')
  expect(terminalPresentationJob).not.toContain('--with-deps')
  expect(terminalPresentationJob).toContain('pnpm terminal:presentation')
  expect(terminalPresentationJob).toContain('artifacts/terminal-presentation')
})
