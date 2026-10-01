import { parseUpdateTarget, type UpdateTarget } from './appUpdateVerification.js'
import type { UpdateAuthorizationStore } from './updateAuthorization.js'
import type { UpdateBundleStore } from './updateBundleStore.js'

/** Integrity/authority check only. The helper must also hold exclusive current-operation ownership. */
export async function preflightAuthorizedInstall(options: {
  authorization: UpdateAuthorizationStore
  bundles: UpdateBundleStore
  target: UpdateTarget
}) {
  // Copy before awaiting: callers cannot change the expected target during disk I/O.
  const target = parseUpdateTarget(options.target)
  const authorization = await options.authorization.read(target.operationId)
  if (!authorization || authorization.installationId !== target.installationId
    || authorization.manifestSha256 !== target.manifestSha256) {
    throw new Error('Update target has no matching authorization')
  }
  const staged = await options.bundles.reopen(authorization.bundlePath, authorization.manifestSha256)
  for (const name of Object.keys(target.images) as (keyof typeof target.images)[]) {
    if (staged.images[name] !== target.images[name]) throw new Error(`Authorized update ${name} identity changed`)
  }
  return { authorization, staged }
}
