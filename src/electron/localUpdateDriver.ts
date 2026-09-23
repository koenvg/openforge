import { lstat, mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { parseUpdateTarget, type AppUpdateDriver, type UpdateTarget } from './appUpdateVerification.js'
import * as nativeUpdate from './nativeUpdateHelper.js'
import { RestartOperation, restartInstallationId } from './restartOperation.js'
import type { RestartTerminalInventory } from './restartWorkspace.js'
import { UpdateAuthorizationStore, type UpdateAuthorization, type UpdateLaunchContext } from './updateAuthorization.js'
import { UpdateBundleStore } from './updateBundleStore.js'

export type NativeUpdateOperations = Pick<typeof nativeUpdate,
  'prepareNativeUpdateHandoff' | 'prepareNativeUpdateRelaunch' | 'verifyNativeUpdateLaunch' | 'authorizeNativeUpdateSidecar' | 'verifyNativeUpdateReadiness' | 'commitNativeUpdate'>

interface Options {
  root: string
  installedBundlePath: string
  inventory(): Promise<RestartTerminalInventory>
  chooseBundle(): Promise<string | null>
  quit(): void
  confirmLocalBuild?(request: Readonly<UpdateAuthorization>): Promise<'approve' | 'cancel'>
  native?: NativeUpdateOperations
  platform?: NodeJS.Platform
  architecture?: string
}

type Handoff = Awaited<ReturnType<NativeUpdateOperations['prepareNativeUpdateHandoff']>>
type Selection = {
  target: UpdateTarget
  controller: RestartTerminalInventory['controller']
  launch: UpdateLaunchContext
} & ({ state: 'authorized' | 'uncertain' } | { state: 'prepared'; handoff: Handoff })

/** One host-owned entry point. No downloads, publisher fallback or legacy interruption. */
export class LocalUpdateDriver implements AppUpdateDriver {
  private readonly bundles: UpdateBundleStore
  private readonly native: NativeUpdateOperations
  private readonly recoveryRoot: string
  private selection: Selection | null = null
  private startup: UpdateTarget | null = null
  private preparing = false

  constructor(private readonly options: Options) {
    const root = join(options.root, 'updates')
    this.bundles = new UpdateBundleStore(join(root, 'staged'))
    this.recoveryRoot = join(root, 'native')
    this.native = options.native ?? nativeUpdate
  }

  async preflight(identity: { installationId: string; operationId: string }): Promise<UpdateTarget> {
    const request = Object.freeze({ ...identity })
    this.assertSupported()
    if (this.preparing || this.selection) throw new Error('A local update is already preparing')
    this.preparing = true
    try {
      const inventory = structuredClone(await this.options.inventory())
      const launch = this.launchContext(inventory)
      if (inventory.parentExitGuardArmed !== true) throw new Error('Local updates require parent-loss preservation for the source Sidecar')
      if (restartInstallationId(this.options.root, inventory.controller.installation) !== request.installationId) throw new Error('Update installation changed')
      const candidate = await this.options.chooseBundle()
      if (!candidate) throw new Error('Local update cancelled')
      const root = join(this.options.root, 'updates')
      await mkdir(root, { recursive: true, mode: 0o700 })
      const info = await lstat(root)
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
        throw new Error('Update storage must be a private owned directory')
      }
      const staged = await this.bundles.stage(candidate)
      const authorization = this.authorization(request.installationId, launch)
      await authorization.authorizeLocal(staged, request.operationId)
      const target = parseUpdateTarget({ ...request, manifestSha256: staged.manifestSha256, images: staged.images })
      Object.freeze(target.images)
      Object.freeze(target)
      this.selection = { target, launch, controller: Object.freeze(inventory.controller), state: 'authorized' }
      return parseUpdateTarget(target)
    } finally { this.preparing = false }
  }

  async prepare(target: UpdateTarget): Promise<void> {
    if (this.preparing) throw new Error('A local update is already preparing')
    const selected = this.requireSelection(target)
    if (selected.state !== 'authorized') throw new Error('Native update preparation was already attempted')
    this.preparing = true
    try {
      const record = await (await RestartOperation.open(this.options.root))?.status()
      if (record?.intent !== 'update' || record.phase !== 'prepared'
        || JSON.stringify(record.updateTarget) !== JSON.stringify(selected.target)
        || record.controller.installation !== selected.controller.installation
        || record.controller.lifetime !== selected.controller.lifetime
        || record.controller.generation !== selected.controller.generation
        || record.daemonRoot !== selected.launch.daemonRoot) {
        throw new Error('Native update preparation requires matching durable recovery authority')
      }
      // A lost preparation acknowledgement is not proof that no runtime change occurred.
      this.selection = { ...selected, state: 'uncertain' }
      const handoff = await this.native.prepareNativeUpdateHandoff({
        authorization: this.authorization(selected.target.installationId, selected.launch),
        bundles: this.bundles, target: selected.target, controller: selected.controller, recoveryRoot: this.recoveryRoot,
      })
      this.selection = { ...selected, state: 'prepared', handoff }
    } catch (error) {
      if (error instanceof nativeUpdate.NativeUpdateNotStarted) this.selection = selected
      throw error
    } finally { this.preparing = false }
  }

  async cancel(target: UpdateTarget): Promise<void> {
    if (this.preparing) throw new Error('A local update is already preparing')
    if (!this.selection) return
    const selected = this.requireSelection(target)
    if (selected.state === 'uncertain') throw new Error('Native update preparation outcome is unknown')
    this.preparing = true
    try {
      if (selected.state === 'prepared') {
        this.selection = { ...selected, state: 'uncertain' }
        await selected.handoff.cancel()
      }
      this.selection = null
    } finally { this.preparing = false }
  }

  async replace(target: UpdateTarget): Promise<void> {
    if (this.preparing) throw new Error('A local update is already preparing')
    const selected = this.requireSelection(target)
    if (selected.state !== 'prepared') throw new Error('Native update preparation is not confirmed')
    this.selection = { ...selected, state: 'uncertain' }
    await selected.handoff.arm()
    this.options.quit()
  }

  /** Recovery does not create a Sidecar or acquire a runtime controller. */
  async recover(target: UpdateTarget): Promise<void> {
    this.assertSupported()
    if (this.preparing || this.selection) throw new Error('A local update is already preparing')
    this.preparing = true
    try {
      const expected = parseUpdateTarget(target)
      const handoff = await this.native.prepareNativeUpdateRelaunch(await this.installed(expected))
      // Native arming refuses a live admitted Sidecar and waits for actual host exit.
      await handoff.arm()
      this.options.quit()
    } finally { this.preparing = false }
  }

  /** Called before creating a Sidecar. Native verification binds this running app. */
  async authorizeLaunch(target: UpdateTarget): Promise<void> {
    const expected = parseUpdateTarget(target)
    await this.native.verifyNativeUpdateLaunch(await this.installed(expected))
    this.startup = expected
  }

  async admitSidecar(sidecarPid: number): Promise<string> {
    if (!this.startup) throw new Error('Missing authenticated update launch')
    return this.native.authorizeNativeUpdateSidecar({ ...await this.installed(this.startup), sidecarPid })
  }

  async readiness(target: UpdateTarget) {
    const expected = parseUpdateTarget(target)
    const options = await this.installed(expected)
    const inventory = structuredClone(await this.options.inventory())
    await this.verifyRoots(options.authorization, expected, inventory)
    await this.native.verifyNativeUpdateReadiness({ ...options, controller: inventory.controller })
    const current = await this.options.inventory()
    if (JSON.stringify(current.controller) !== JSON.stringify(inventory.controller)) throw new Error('Update controller changed during readiness')
    return { operationId: expected.operationId, images: expected.images, controller: inventory.controller, reconciled: true }
  }

  async commit(target: UpdateTarget): Promise<void> {
    const expected = parseUpdateTarget(target)
    const options = await this.installed(expected)
    const inventory = structuredClone(await this.options.inventory())
    await this.verifyRoots(options.authorization, expected, inventory)
    await this.native.commitNativeUpdate({ ...options, controller: inventory.controller })
  }

  private assertSupported(): void {
    if ((this.options.platform ?? process.platform) !== 'darwin' || (this.options.architecture ?? process.arch) !== 'arm64') {
      throw new Error('Local session-preserving updates require macOS arm64')
    }
  }

  private authorization(installationId: string, launch?: UpdateLaunchContext): UpdateAuthorizationStore {
    return new UpdateAuthorizationStore({
      root: join(this.options.root, 'updates', 'authorization'), installationId,
      installedBundlePath: this.options.installedBundlePath, bundles: this.bundles,
      launch, confirmLocalBuild: this.options.confirmLocalBuild,
    })
  }

  private async installed(target: UpdateTarget) {
    const authorization = this.authorization(target.installationId)
    const grant = await authorization.read(target.operationId)
    if (!grant || grant.source !== 'local-build' || grant.firstAdoption || grant.manifestSha256 !== target.manifestSha256
      || grant.launch?.electronUserData !== this.options.root) throw new Error('Missing supported local update authorization')
    return { authorization, target, recoveryRoot: this.recoveryRoot }
  }

  private launchContext(inventory: RestartTerminalInventory): UpdateLaunchContext {
    if (inventory.hasLegacySessions !== false || !inventory.controller?.installation || !inventory.controller.lifetime
      || !Number.isSafeInteger(inventory.controller.generation) || inventory.controller.generation < 1) {
      throw new Error('Local updates require a daemon-aware installation without legacy sessions')
    }
    if (!inventory.appDataRoot || !inventory.daemonRoot || !isAbsolute(inventory.appDataRoot) || !isAbsolute(inventory.daemonRoot)) {
      throw new Error('Update requires authenticated backend data roots')
    }
    return { electronUserData: this.options.root, appData: inventory.appDataRoot, daemonRoot: inventory.daemonRoot }
  }

  private async verifyRoots(authorization: UpdateAuthorizationStore, target: UpdateTarget, inventory: RestartTerminalInventory): Promise<void> {
    const grant = await authorization.read(target.operationId)
    if (JSON.stringify(this.launchContext(inventory)) !== JSON.stringify(grant?.launch)) throw new Error('Update data roots changed')
  }

  private requireSelection(target: UpdateTarget): Selection {
    if (!this.selection) throw new Error('No local update is selected')
    if (JSON.stringify(parseUpdateTarget(target)) !== JSON.stringify(this.selection.target)) throw new Error('Stale local update target')
    return this.selection
  }
}
