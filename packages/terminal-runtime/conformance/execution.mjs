import { PLAYWRIGHT_IMAGE } from '../../../scripts/playwright-image.mjs'

export function terminalBaselineIdentity(platform, architecture) {
  return `${platform}-${architecture}`
}

export function assertTerminalPresentationEnvironment({ browserOnly, platform, architecture, image }) {
  if (!browserOnly) return
  if (platform !== 'linux' || architecture !== 'arm64' || image !== PLAYWRIGHT_IMAGE) {
    throw new Error('Browser-only terminal conformance must run in the pinned Linux ARM64 container')
  }
}

export const browserPhaseNames = Object.freeze([
  'live-write-batch',
  'terminal-colour-profile',
  'semantic-and-visual-matrix',
  'concurrent-terminal-lifecycle',
  'interaction-and-recovery',
])

export async function runTerminalPresentation({ browserOnly, runNative, browserChecks }) {
  if (!browserOnly) runNative()
  for (const name of browserPhaseNames) {
    const run = browserChecks[name]
    if (typeof run !== 'function') {
      throw new Error(`Missing terminal presentation browser phase: ${name}`)
    }
    await run()
  }
}
