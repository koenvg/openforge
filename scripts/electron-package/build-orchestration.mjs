import { electronPackageIdentityForRepoRoot } from '../data-identity.mjs'
import { resolveRustSidecarLayout } from '../rust-sidecar-layout.mjs'
import { packageElectronApp } from './package-assembly.mjs'
import { runBuildCommand } from './commands.mjs'
import { repoRootFromScript } from './repo-root.mjs'

export async function buildAndPackageElectronApp(options = {}) {
  const {
    repoRoot = repoRootFromScript(),
    cargoBuildTarget = process.env.CARGO_BUILD_TARGET ?? '',
    runCommand = runBuildCommand,
    packageApp = packageElectronApp,
  } = options
  const packageIdentity = options.packageIdentity
    ?? (!options.rustSidecarLayout || packageApp === packageElectronApp ? electronPackageIdentityForRepoRoot(repoRoot) : null)
  const rustSidecarLayout = options.rustSidecarLayout
    ?? resolveRustSidecarLayout({ repoRoot, appName: packageIdentity.appName })

  await runCommand('pnpm', ['build:plugins'], { cwd: repoRoot })
  await runCommand('pnpm', ['build'], { cwd: repoRoot })
  await runCommand('pnpm', ['electron:build'], { cwd: repoRoot })
  const cargoArgs = cargoBuildTarget
    ? ['build', '--release', '--target', cargoBuildTarget]
    : ['build', '--release']
  await runCommand('cargo', cargoArgs, { cwd: rustSidecarLayout.backendCrateRootPath })
  return packageApp({
    repoRoot,
    rustSidecarLayout,
    ...(packageIdentity ? { packageIdentity } : {}),
    sidecarBinaryPath: rustSidecarLayout.releaseSidecarBinaryPath({ cargoBuildTarget }),
    cargoBuildTarget,
  })
}
