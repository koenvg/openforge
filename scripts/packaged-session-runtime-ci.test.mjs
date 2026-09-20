import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const workflowUrl = new URL('../.github/workflows/packaged-session-runtime.yml', import.meta.url)

it('requires real arm64 and Intel runners rather than accepting translated execution', () => {
  const workflow = readFileSync(workflowUrl, 'utf8')
  expect(workflow).toContain('runner: macos-15-intel')
  expect(workflow).toContain('runner: macos-14\n')
  expect(workflow).toContain('target: x86_64-apple-darwin')
  expect(workflow).toContain('target: aarch64-apple-darwin')
  expect(workflow).toContain('sysctl.proc_translated')
  expect(workflow).toContain('uname -m')
  expect(workflow).toContain('process.arch')
  expect(workflow).toContain('test "$translated" != "1"')
  expect(workflow).not.toContain('needs:')
})

it('launches the actual packaged runtime and retains logs even when checks fail', () => {
  const workflow = readFileSync(workflowUrl, 'utf8')
  expect(workflow).toContain('pnpm electron:package')
  expect(workflow).toContain('OPENFORGE_PACKAGED_RUNTIME')
  expect(workflow).toContain('--test packaged_release')
  expect(workflow).toContain('pnpm electron:smoke:packaged --skip-package')
  expect(workflow).toContain('if: always()')
  expect(workflow).toContain('actions/upload-artifact@v6')
  expect(workflow).toContain('packaged-session-runtime-${{ matrix.arch }}')
  expect(workflow).toContain('contents: read')
  expect(workflow).not.toContain('continue-on-error: true')
})
