// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dialog } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeUpdateRecovery } from './nativeUpdateRecovery'
import { RestartOperation } from './restartOperation'

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn(async () => ({ response: 2 })) } }))
const roots: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture(intent: 'restart' | 'update' = 'update') {
  const root = await mkdtemp(join(tmpdir(), 'openforge-native-update-recovery-'))
  roots.push(root)
  const controller = { installation: 'installation', lifetime: 'daemon', generation: 1 }
  const installationId = createHash('sha256').update(JSON.stringify([root, controller.installation])).digest('hex')
  const operation = new RestartOperation(join(root, 'restart-operation.json'), installationId)
  const target = {
    installationId, operationId: 'operation', manifestSha256: 'a'.repeat(64),
    images: { app: 'b'.repeat(64), sidecar: 'c'.repeat(64), daemon: 'd'.repeat(64), cli: 'e'.repeat(64), helper: 'f'.repeat(64) },
  }
  await operation.prepare(target.operationId, controller, intent, root, intent === 'update' ? target : undefined)
  await operation.detach(target.operationId)
  const retry = vi.fn(async () => {})
  const close = vi.fn(async () => {})
  return { operation, target, retry, close, recovery: new NativeUpdateRecovery({ root, retry, close }) }
}

it('defaults to leaving sessions alone without invoking recovery or close', async () => {
  const { recovery, retry, close, operation } = await fixture()
  expect(await recovery.recover('update-verification-unavailable')).toBe(true)
  expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
    buttons: ['Retry update', 'Close app and leave sessions running', 'Keep waiting'], defaultId: 2, cancelId: 2,
  }))
  expect(retry).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ phase: 'detached' })
})

it('uses the recorded target for native recovery without treating it as startup authority', async () => {
  const { recovery, retry, close, target, operation } = await fixture()
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
  expect(await recovery.recover('activation-failed')).toBe(true)
  expect(retry).toHaveBeenCalledExactlyOnceWith(target)
  expect(close).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ phase: 'detached' })
})

it('shows a native refusal without falling back to ordinary restart or session termination', async () => {
  const { recovery, retry, close, operation } = await fixture()
  retry.mockRejectedValueOnce(new Error('Another admitted Sidecar is still running'))
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
  await recovery.recover('activation-failed')
  expect(dialog.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.stringContaining('Another admitted Sidecar') }))
  expect(retry).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ phase: 'detached' })
})

it('closes only through the owner-scoped action and retains pending recovery', async () => {
  const { recovery, retry, close, operation } = await fixture()
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  await recovery.recover()
  expect(close).toHaveBeenCalledOnce()
  expect(retry).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ phase: 'detached' })
})

it('does not apply a stale dialog decision after the operation settles', async () => {
  const { recovery, retry, close, operation, target } = await fixture()
  vi.mocked(dialog.showMessageBox).mockImplementationOnce(async () => {
    await operation.terminated(target.operationId)
    return { response: 0, checkboxChecked: false }
  })
  await recovery.recover()
  expect(retry).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('does not handle ordinary restart recovery', async () => {
  const { recovery } = await fixture('restart')
  expect(await recovery.recover('activation-failed')).toBe(false)
  expect(dialog.showMessageBox).not.toHaveBeenCalled()
})
