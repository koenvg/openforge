import { expect, it } from 'vitest'
import { localBuildApprovalPrompt } from './localBuildApproval.js'

it('defaults to cancellation and discloses the unsigned build and exact installation before approval', () => {
  const prompt = localBuildApprovalPrompt({
    version: 1, source: 'local-build', installationId: 'installation-one', operationId: 'operation-one',
    installedBundlePath: '/Applications/Open Forge.app', bundlePath: '/private/staged/bundle.app', manifestSha256: 'a'.repeat(64),
  })
  expect(prompt.buttons).toEqual(['Approve this local build', 'Cancel'])
  expect(prompt.defaultId).toBe(1)
  expect(prompt.cancelId).toBe(1)
  expect(prompt.detail).toContain('/Applications/Open Forge.app')
  expect(prompt.detail).toContain('a'.repeat(64))
  expect(prompt.detail).toContain('not verified by the release publisher')
  expect(prompt.detail).toContain('does not approve interruption')
})
