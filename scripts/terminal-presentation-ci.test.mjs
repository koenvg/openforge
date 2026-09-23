import fs from 'node:fs'
import { expect, it } from 'vitest'

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const jobStart = workflow.indexOf('  terminal-presentation:\n')
const terminalPresentationJob = workflow.slice(jobStart, workflow.indexOf('\n  npm-packages:', jobStart))

it('runs terminal and Markdown browser conformance in the pinned Linux container', () => {
  expect(terminalPresentationJob).toContain('runs-on: ubuntu-24.04-arm')
  expect(terminalPresentationJob).toContain('pnpm terminal:visual:check')
  expect(terminalPresentationJob).not.toContain('pnpm terminal:presentation\n')
  expect(terminalPresentationJob).not.toContain('pnpm markdown:visual')
  expect(terminalPresentationJob).not.toContain('playwright install')
  expect(terminalPresentationJob).not.toContain('uses: dtolnay/rust-toolchain@stable')
  expect(terminalPresentationJob).not.toContain('uses: ./.github/actions/prepare-ghostty')
  expect(terminalPresentationJob).toContain('name: markdown-visual-${{ runner.os }}-${{ runner.arch }}')
  expect(terminalPresentationJob).toContain('screenshots/markdown-visual')
  expect(terminalPresentationJob).toContain('name: terminal-presentation-${{ runner.os }}-${{ runner.arch }}')
  expect(terminalPresentationJob).toContain('artifacts/terminal-presentation')
})

it('allows the terminal presentation and Markdown visual suites to finish on a cold Linux runner', () => {
  const timeout = Number(terminalPresentationJob.match(/timeout-minutes: (\d+)/)?.[1])
  expect(timeout).toBeGreaterThanOrEqual(15)
})
