import fs from 'node:fs'
import { expect, it } from 'vitest'

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

it('runs the terminal presentation harness with Chromium and uploads its report', () => {
  expect(workflow).toMatch(/terminal-presentation:\n/)
  expect(workflow).toMatch(/pnpm exec playwright install --with-deps chromium/)
  expect(workflow).toMatch(/pnpm terminal:presentation/)
  expect(workflow).toMatch(/artifacts\/terminal-presentation/)
})
