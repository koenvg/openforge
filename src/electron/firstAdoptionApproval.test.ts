import { expect, it, vi } from 'vitest'
import { dialog } from 'electron'
import { confirmNativeFirstAdoption, firstAdoptionApprovalPrompt } from './firstAdoptionApproval.js'
import type { UpdateAuthorization } from './updateAuthorization.js'

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }))

const request: UpdateAuthorization = {
  version: 1, source: 'local-build', installationId: 'installation-one', operationId: 'operation-one',
  installedBundlePath: '/Applications/Open Forge.app', bundlePath: '/private/staged/bundle.app', manifestSha256: 'a'.repeat(64),
  firstAdoption: { installedManifestSha256: 'b'.repeat(64) },
}

it('defaults to cancellation and discloses session interruption separately from build trust', () => {
  const prompt = firstAdoptionApprovalPrompt(request)
  expect(prompt.buttons).toEqual(['Approve interruption for this update', 'Cancel'])
  expect(prompt.defaultId).toBe(1)
  expect(prompt.cancelId).toBe(1)
  expect(prompt.message).toContain('cannot preserve')
  expect(prompt.detail).toContain('Existing terminals, running agents and tool processes will stop')
  expect(prompt.detail).toContain(request.installedBundlePath)
  expect(prompt.detail).toContain('a'.repeat(64))
  expect(prompt.detail).toContain('b'.repeat(64))
  expect(prompt.detail).toContain('separate from trusting a local build')
})

it.each([0, 1, -1])('only an explicit affirmative native response approves interruption: %s', async response => {
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response, checkboxChecked: false })
  await expect(confirmNativeFirstAdoption(request)).resolves.toBe(response === 0 ? 'approve' : 'cancel')
})
