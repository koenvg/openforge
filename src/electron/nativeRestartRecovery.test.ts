import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { dialog } from 'electron'
import { RestartOperation } from './restartOperation'
import { NativeRestartRecovery } from './nativeRestartRecovery'

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn(async () => ({ response: 2 })) } }))
const roots: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(script: string, intent: 'restart' | 'update' = 'restart') {
  const root = await mkdtemp(join(tmpdir(), 'of-native-recovery-'))
  roots.push(root)
  await writeFile(join(root, 'openforge-session-daemon'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${root}/calls'\n${script}\n`, { mode: 0o700 })
  const controller = { installation: 'installation', lifetime: 'original-lifetime', generation: 1 }
  const identity = createHash('sha256').update(JSON.stringify([root, controller.installation])).digest('hex')
  const operation = new RestartOperation(join(root, 'restart-operation.json'), identity)
  const target = {
    installationId: identity, operationId: 'operation', manifestSha256: 'a'.repeat(64),
    images: { app: 'b'.repeat(64), sidecar: 'c'.repeat(64), daemon: 'd'.repeat(64), cli: 'e'.repeat(64), helper: 'f'.repeat(64) },
  }
  await operation.prepare('operation', controller, intent, root, intent === 'update' ? target : undefined)
  await operation.detach('operation')
  const quit = vi.fn()
  const relaunch = vi.fn()
  const retryUpdate = vi.fn(async () => {})
  const closeUpdate = vi.fn(async () => {})
  const recovery = new NativeRestartRecovery({
    root, currentDir: root, env: { OPENFORGE_SIDECAR_PATH: join(root, 'missing-sidecar') }, quit, relaunch,
    update: { retry: retryUpdate, close: closeUpdate },
  })
  return { root, operation, quit, relaunch, recovery, retryUpdate, closeUpdate, target }
}

it('uses the current local helper after failed Sidecar boot and exposes cold loss without launching another image', async () => {
  const { root, operation, recovery, quit, relaunch } = await fixture("printf '%s' '{\"state\":\"cold-process-loss\"}'")
  await recovery.recoverBoot('activation-failed')
  expect(await readFile(join(root, 'calls'), 'utf8')).toBe(`--recovery-status\n${root}\ninstallation\noriginal-lifetime\n`)
  expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringContaining('not uninterrupted continuity'),
    buttons: ['Retry attachment', 'Quit and stop sessions', 'Keep waiting'], cancelId: 2,
  }))
  expect(await operation.status()).toMatchObject({ phase: 'detached', failure: 'cold-process-loss' })
  expect(quit).not.toHaveBeenCalled()
  expect(relaunch).not.toHaveBeenCalled()
})

it('does not quit when the authenticated local termination helper rejects its credentials', async () => {
  const { root, operation, recovery, quit } = await fixture("echo 'reauthentication required' >&2; exit 1")
  await recovery.quit()
  expect(await readFile(join(root, 'calls'), 'utf8')).toBe(`--terminate-sessions\n${root}\ninstallation\noriginal-lifetime\n`)
  expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('reauthentication required') }))
  expect(quit).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ phase: 'detached' })
})

it('requires a termination result rather than treating any successful helper exit as cleanup', async () => {
  const { operation, recovery, quit } = await fixture("printf '%s' '{\"state\":\"available\"}'")
  await recovery.quit()
  expect(quit).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ phase: 'detached' })
})

it('does not acquire a controller while an update recovery app is only waiting', async () => {
  const { root, recovery, relaunch, retryUpdate } = await fixture('exit 1', 'update')
  await recovery.recoverBoot('update-verification-unavailable')
  await expect(readFile(join(root, 'calls'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(relaunch).not.toHaveBeenCalled()
  expect(retryUpdate).not.toHaveBeenCalled()
})

it('routes update retries to native recovery rather than ordinary app relaunch', async () => {
  const { root, recovery, relaunch, retryUpdate, target } = await fixture('exit 1', 'update')
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
  await recovery.recover('activation-failed')
  expect(retryUpdate).toHaveBeenCalledExactlyOnceWith(target)
  expect(relaunch).not.toHaveBeenCalled()
  await expect(readFile(join(root, 'calls'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('routes Quit during update recovery to an owner-scoped close without terminating sessions', async () => {
  const { root, recovery, quit, closeUpdate, operation } = await fixture('exit 1', 'update')
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  await recovery.quit()
  expect(closeUpdate).toHaveBeenCalledOnce()
  expect(quit).not.toHaveBeenCalled()
  await expect(readFile(join(root, 'calls'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await operation.status()).toMatchObject({ phase: 'detached' })
})
