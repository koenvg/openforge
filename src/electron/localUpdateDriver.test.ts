import { createHash } from 'node:crypto'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { LocalUpdateDriver, type NativeUpdateOperations } from './localUpdateDriver'
import { cleanupUpdateBundles, updateBundleFixture } from './updateBundle.testUtils'
import type { UpdateTarget } from './appUpdateVerification'
import { RestartOperation, type RestartOperationRecord } from './restartOperation'
import { createControlledRestartHost } from './controlledRestartHost'
import { NativeUpdateNotStarted } from './nativeUpdateHelper'
import { preflightProductionUpdateLaunch } from './productionUpdateLaunch'

afterEach(cleanupUpdateBundles)

async function fixture() {
  const { root, source } = await updateBundleFixture()
  const installed = join(root, 'Installed.app')
  await cp(source, installed, { recursive: true })
  const userData = join(root, 'user-data')
  const appData = join(root, 'app-data')
  const daemonRoot = join(root, 'daemon-data')
  for (const path of [userData, appData, daemonRoot]) await mkdir(path, { mode: 0o700 })
  const inventory = { controller: { installation: 'private-installation', lifetime: 'private-daemon', generation: 1 }, sessions: [], hasLegacySessions: false, parentExitGuardArmed: true as boolean | undefined, daemonRoot, appDataRoot: appData }
  const identity = { installationId: createHash('sha256').update(JSON.stringify([userData, inventory.controller.installation])).digest('hex'), operationId: 'local-operation' }
  const events: string[] = []
  const preparationRecords: (RestartOperationRecord | null)[] = []
  let mutateController = false
  let backendUnavailable = false
  let recoveryArmFails = false
  let preparationFailure: Error | null = null
  const native: NativeUpdateOperations = {
    prepareNativeUpdateHandoff: async options => {
      preparationRecords.push(await (await RestartOperation.open(userData))?.status() ?? null)
      if (preparationFailure) throw preparationFailure
      const grant = await options.authorization.read(options.target.operationId)
      expect(grant?.source).toBe('local-build')
      expect(grant?.firstAdoption).toBeUndefined()
      expect(grant?.launch).toEqual({ electronUserData: userData, appData, daemonRoot })
      expect(options.controller).toEqual(inventory.controller)
      events.push('prepared')
      return { arm: async () => { events.push('armed') }, cancel: async () => { events.push('cancelled') } }
    },
    prepareNativeUpdateRelaunch: async options => {
      const grant = await options.authorization.read(options.target.operationId)
      expect(grant?.launch).toEqual({ electronUserData: userData, appData, daemonRoot })
      events.push('recovery-prepared')
      return {
        arm: async () => {
          if (recoveryArmFails) throw new Error('Native recovery refused to arm')
          events.push('recovery-armed')
        },
        cancel: async () => { events.push('recovery-cancelled') },
      }
    },
    verifyNativeUpdateLaunch: async () => { events.push('launch-verified') },
    authorizeNativeUpdateSidecar: async () => { events.push('sidecar-admitted'); return 'opaque-native-admission' },
    verifyNativeUpdateReadiness: async () => { if (mutateController) inventory.controller.generation++; events.push('ready') },
    commitNativeUpdate: async () => { events.push('committed') },
  }
  const driver = new LocalUpdateDriver({
    root: userData, installedBundlePath: installed, platform: 'darwin', architecture: 'arm64', native,
    inventory: async () => { if (backendUnavailable) throw new Error('Backend is not running'); return inventory },
    chooseBundle: async () => { events.push('selected'); return source },
    confirmLocalBuild: async () => { events.push('approved'); return 'approve' },
    quit: () => { events.push('quit') },
  })
  return {
    driver, identity, inventory, events, race: () => { mutateController = true },
    root: userData, preparationRecords,
    recordPreparation: async (target: UpdateTarget) => {
      const operation = new RestartOperation(join(userData, 'restart-operation.json'), identity.installationId)
      await operation.prepare(target.operationId, inventory.controller, 'update', daemonRoot, target)
    },
    loseBackend: () => { backendUnavailable = true },
    refuseRecoveryArm: () => { recoveryArmFails = true },
    refusePreparation: (error: Error) => { preparationFailure = error },
  }
}

it('stages and approves one daemon-aware local build before arming the native helper and quitting', async () => {
  const { driver, identity, events, recordPreparation } = await fixture()
  const target = await driver.preflight(identity)
  expect(target).toMatchObject(identity)
  expect(events).toEqual(['selected', 'approved'])
  await expect(driver.prepare(target)).rejects.toThrow('durable recovery authority')
  expect(events).not.toContain('prepared')
  await recordPreparation(target)
  await driver.prepare(target)
  expect(events).toEqual(['selected', 'approved', 'prepared'])
  await expect(driver.replace({ ...target, operationId: 'foreign' })).rejects.toThrow('Stale')
  await driver.replace(target)
  expect(events.slice(-2)).toEqual(['armed', 'quit'])
})

it('refuses legacy sessions before selecting or approving a local bundle', async () => {
  const { driver, identity, inventory, events } = await fixture()
  inventory.hasLegacySessions = true
  await expect(driver.preflight(identity)).rejects.toThrow('daemon-aware')
  expect(events).toEqual([])
})

it.each([false, undefined])('refuses a source without confirmed parent-loss preservation: %s', async armed => {
  const { driver, identity, inventory, events } = await fixture()
  inventory.parentExitGuardArmed = armed
  await expect(driver.preflight(identity)).rejects.toThrow('parent-loss preservation')
  expect(events).toEqual([])
})

it('cancels prepared ownership without authorizing replacement or quitting', async () => {
  const { driver, identity, events, recordPreparation } = await fixture()
  const target = await driver.preflight(identity)
  await recordPreparation(target)
  await driver.prepare(target)
  await driver.cancel(target)
  await expect(driver.replace(target)).rejects.toThrow('selected')
  expect(events).toEqual(['selected', 'approved', 'prepared', 'cancelled'])
})

it('admits Sidecar startup only after native launch verification and requires stable runtime readiness', async () => {
  const { driver, identity, inventory, events, race } = await fixture()
  const target = await driver.preflight(identity)
  await expect(driver.admitSidecar(123)).rejects.toThrow('launch')
  await driver.authorizeLaunch(target)
  expect(await driver.admitSidecar(123)).toBe('opaque-native-admission')
  const evidence = await driver.readiness(target)
  expect(evidence).toEqual({ operationId: target.operationId, images: target.images, controller: inventory.controller, reconciled: true })
  race()
  await expect(driver.readiness(target)).rejects.toThrow('controller changed')
  expect(events).not.toContain('committed')
})

it('recovers from durable authorization without starting or querying a Sidecar', async () => {
  const { driver, identity, events, loseBackend } = await fixture()
  const target = await driver.preflight(identity)
  await driver.cancel(target)
  events.length = 0
  loseBackend()
  await expect(driver.recover({ ...target, operationId: 'foreign' })).rejects.toThrow('authorization')
  expect(events).toEqual([])
  await driver.recover(target)
  expect(events).toEqual(['recovery-prepared', 'recovery-armed', 'quit'])
  await expect(driver.admitSidecar(123)).rejects.toThrow('launch')
})

it('does not quit or promote startup authority when recovery arming fails', async () => {
  const { driver, identity, events, refuseRecoveryArm } = await fixture()
  const target = await driver.preflight(identity)
  await driver.cancel(target)
  events.length = 0
  refuseRecoveryArm()
  await expect(driver.recover(target)).rejects.toThrow('refused to arm')
  expect(events).toEqual(['recovery-prepared'])
  await expect(driver.admitSidecar(123)).rejects.toThrow('launch')
})

it('persists update recovery authority before native preparation can change the live runtime', async () => {
  const { driver, root, inventory, preparationRecords } = await fixture()
  const host = await createControlledRestartHost({
    root, operationId: null, update: driver, inventory: async () => inventory,
    backend: { prepare: async () => {}, cancel: async () => {}, detach: async () => {}, commit: async () => {}, stopForUpdate: async () => {} },
    replace: async () => { throw new Error('An update cannot use ordinary restart') },
  })
  host.register(10, 'window', operationId => {
    void host.handle(10, 'capture_restart_workspace', {
      operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
  })
  await host.requestUpdate(10)
  expect(preparationRecords).toHaveLength(1)
  expect(preparationRecords[0]).toMatchObject({ intent: 'update', phase: 'prepared', controller: inventory.controller })
  expect(preparationRecords[0]?.updateTarget?.operationId).toBe(preparationRecords[0]?.operationId)
})

it.each([false, true])('clears only a provably unsent preparation and keeps uncertain recovery durable: %s', async unsent => {
  const { driver, root, inventory, refusePreparation } = await fixture()
  const refusal = new Error('Native preparation reply lost')
  refusePreparation(unsent ? new NativeUpdateNotStarted(refusal) : refusal)
  const backendEvents: string[] = []
  const host = await createControlledRestartHost({
    root, operationId: null, update: driver, inventory: async () => inventory,
    backend: {
      prepare: async () => { backendEvents.push('prepare') },
      cancel: async () => { backendEvents.push('cancel') },
      detach: async () => {}, commit: async () => {}, stopForUpdate: async () => {},
    },
    replace: async () => { throw new Error('Ordinary restart is forbidden') },
  })
  host.register(10, 'window', () => { throw new Error('Capture must not start') })
  await expect(host.requestUpdate(10)).rejects.toThrow(unsent ? 'reply lost' : 'outcome is unknown')
  expect(backendEvents).toEqual([])
  const record = await (await RestartOperation.open(root))?.status()
  expect(record).toMatchObject({ intent: 'update', phase: unsent ? 'cancelled' : 'prepared' })
  if (!unsent) await expect(preflightProductionUpdateLaunch(root)).rejects.toThrow('Sidecar was not started')
})

it('refuses native preparation for a different durable controller', async () => {
  const { driver, identity, inventory, preparationRecords, recordPreparation } = await fixture()
  const target = await driver.preflight(identity)
  inventory.controller.generation++
  await recordPreparation(target)
  await expect(driver.prepare(target)).rejects.toThrow('matching durable recovery authority')
  expect(preparationRecords).toEqual([])
  await driver.cancel(target)
})

it('does not discard pending update authority merely because a newer controller exists', async () => {
  const { driver, root, identity, inventory, recordPreparation } = await fixture()
  await recordPreparation(await driver.preflight(identity))
  await expect(createControlledRestartHost({
    root, operationId: null, replace: async () => {},
    inventory: async () => ({ ...inventory, controller: { ...inventory.controller, generation: 2 } }),
  })).rejects.toThrow('authenticated recovery')
  expect(await (await RestartOperation.open(root))?.status()).toMatchObject({ phase: 'prepared', intent: 'update' })
})
