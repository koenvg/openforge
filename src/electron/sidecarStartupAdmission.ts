import type { ChildProcessLike, SidecarLaunchConfig, StartSidecarDeps } from './sidecar.js'

export function sidecarStartupConfig(config: SidecarLaunchConfig, authorize: StartSidecarDeps['authorizeStartup']): SidecarLaunchConfig {
  return authorize ? { ...config, args: [...config.args, '--openforge-update-startup'] } : config
}

/** The native child verifies the opaque admission itself before domain startup. */
export async function admitSidecarStartup(child: ChildProcessLike, authorize: StartSidecarDeps['authorizeStartup']): Promise<void> {
  if (!authorize) return
  const input = child.stdin
  if (!input) throw new Error('Update Sidecar has no inherited admission pipe')
  const admission = await authorize(child)
  if (!admission || Buffer.byteLength(admission) > 16 * 1024) throw new Error('Invalid native Sidecar admission')
  await new Promise<void>((resolve, reject) => {
    input.once('error', reject)
    input.end(admission, (error?: Error | null) => error ? reject(error) : resolve())
  })
}
