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
  daemonPath,
  helperPath,
  readExecutableArchitectures = readDarwinExecutableArchitectures,
} = {}) {
  const expectedArch = cargoBuildTarget
    ? expectedDarwinArchForTarget(cargoBuildTarget)
    : ({ arm64: 'arm64', x64: 'x86_64' })[process.arch]
  if (!expectedArch) throw new Error(`Unsupported macOS package target: ${cargoBuildTarget || process.arch}`)

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
  if (daemonPath) {
    const architectures = await readExecutableArchitectures(daemonPath)
    if (!architectures.includes(expectedArch)) {
      throw new Error(`Session Daemon architecture must include ${expectedArch} for ${cargoBuildTarget}; found ${architectures.join(', ') || 'unknown'}`)
    }
  }

  if (helperPath) {
    const architectures = await readExecutableArchitectures(helperPath)
    if (!architectures.includes(expectedArch)) {
      throw new Error(`Updater helper architecture must include ${expectedArch} for ${cargoBuildTarget}; found ${architectures.join(', ') || 'unknown'}`)
    }
  }

  return { expectedArch, appArchitectures, sidecarArchitectures }
}
