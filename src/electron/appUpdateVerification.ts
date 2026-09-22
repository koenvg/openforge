import type { RestartTerminalController } from './restartWorkspace.js'

const components = ['app', 'sidecar', 'daemon', 'cli', 'helper'] as const
export type UpdateImages = Record<typeof components[number], string>

/** Content identities, not display versions. These identify the verified staged bytes. */
export interface UpdateTarget {
  installationId: string
  operationId: string
  manifestSha256: string
  images: UpdateImages
}

/**
 * Trusted host boundary, never supplied by IPC payloads or environment variables.
 * No production implementation is available until release trust verification exists.
 * Preflight must verify publisher trust, stage/pin target and fallback assets, check
 * compatibility, and verify the helper before returning. A checksum alone is not trust.
 */
export interface AppUpdateDriver {
  preflight(identity: { installationId: string; operationId: string }): Promise<UpdateTarget>
  /** Release prepared helper/runtime ownership before detach. */
  cancel(target: UpdateTarget): Promise<void>
  /** Authorize the verified helper, not app.relaunch or a direct bundle copy. */
  replace(target: UpdateTarget): Promise<void>
  /** Persist native commit only after authenticated readiness and workspace restoration. */
  commit(target: UpdateTarget): Promise<void>
  /** Authenticate the ready replacement and measure its running executable identities. */
  readiness(target: UpdateTarget): Promise<{
    operationId: string
    controller: RestartTerminalController
    images: UpdateImages
    reconciled: boolean
  }>
}

export function requireUpdateDriver(driver: AppUpdateDriver | undefined): AppUpdateDriver {
  if (!driver) throw new Error('Update requires trusted-release verification; production updates are disabled')
  return driver
}

export function parseUpdateTarget(value: unknown): UpdateTarget {
  if (!value || typeof value !== 'object') throw new Error('Invalid update target')
  const target = value as Partial<UpdateTarget>
  if (typeof target.installationId !== 'string' || !target.installationId
    || typeof target.operationId !== 'string' || !target.operationId
    || typeof target.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(target.manifestSha256)
    || !target.images || components.some(name => typeof target.images?.[name] !== 'string' || !/^[a-f0-9]{64}$/.test(target.images[name]))) {
    throw new Error('Invalid update target')
  }
  return {
    installationId: target.installationId, operationId: target.operationId,
    manifestSha256: target.manifestSha256,
    images: Object.fromEntries(components.map(name => [name, target.images![name]])) as UpdateImages,
  }
}

export async function verifyUpdateReadiness(driver: AppUpdateDriver | undefined, target: UpdateTarget | undefined, controller: RestartTerminalController): Promise<void> {
  if (!target) throw new Error('Update target is missing; compatible recovery is required')
  // A boundary implementation must not be able to mutate our expected identities.
  const evidence = await requireUpdateDriver(driver).readiness(parseUpdateTarget(target))
  if (!evidence || evidence.operationId !== target.operationId || evidence.reconciled !== true
    || evidence.controller?.installation !== controller.installation
    || evidence.controller.lifetime !== controller.lifetime || evidence.controller.generation !== controller.generation) {
    throw new Error('Update readiness or reconciliation is incomplete')
  }
  for (const name of components) {
    if (evidence.images?.[name] !== target.images[name]) throw new Error(`Update ${name} image is not the verified target`)
  }
}
