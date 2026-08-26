import { captureCommand } from './commands.mjs'

export function expectedDarwinArchForTarget(cargoBuildTarget = '') {
  if (!cargoBuildTarget) return null
  if (cargoBuildTarget.startsWith('aarch64-apple-darwin')) return 'arm64'
  if (cargoBuildTarget.startsWith('x86_64-apple-darwin')) return 'x86_64'
  return null
}

function normalizeArchitectures(output) {
  return output
    .replace(/^.*are:\s*/i, '')
    .replace(/^.*is architecture:\s*/i, '')
    .split(/\s+/)
    .map(arch => arch.trim())
    .filter(Boolean)
}

export async function readDarwinExecutableArchitectures(binaryPath) {
  if (process.platform !== 'darwin') return []
  try {
    return normalizeArchitectures(await captureCommand('lipo', ['-archs', binaryPath]))
  } catch {
    return normalizeArchitectures(await captureCommand('file', [binaryPath]))
  }
}

export async function assertPackageArchitectureCompatibility({
  cargoBuildTarget = '',
  appExecutablePath,
  sidecarPath,
  readExecutableArchitectures = readDarwinExecutableArchitectures,
} = {}) {
  const expectedArch = expectedDarwinArchForTarget(cargoBuildTarget)
  if (!expectedArch) return null

  const [appArchitectures, sidecarArchitectures] = await Promise.all([
    readExecutableArchitectures(appExecutablePath),
    readExecutableArchitectures(sidecarPath),
  ])

  if (!appArchitectures.includes(expectedArch)) {
    throw new Error(`Electron runtime architecture must include ${expectedArch} for ${cargoBuildTarget}; found ${appArchitectures.join(', ') || 'unknown'}`)
  }
  if (!sidecarArchitectures.includes(expectedArch)) {
    throw new Error(`Rust sidecar architecture must include ${expectedArch} for ${cargoBuildTarget}; found ${sidecarArchitectures.join(', ') || 'unknown'}`)
  }

  return { expectedArch, appArchitectures, sidecarArchitectures }
}
