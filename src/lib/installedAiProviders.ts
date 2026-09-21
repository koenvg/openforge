import { installedAiProvidersFromFlags, type InstalledAiProvider } from '@openforge-app/plugin-sdk'
import { loadInstallationStatus, type InstallationStatus } from './settingsConfig'

export function installedAiProvidersFromStatus(status: InstallationStatus): InstalledAiProvider[] {
  return installedAiProvidersFromFlags({
    'claude-code': status.claudeInstalled,
    opencode: status.opencodeInstalled,
    pi: status.piInstalled,
    codex: status.codexInstalled,
    grok: status.grokInstalled,
  })
}

export async function listInstalledAiProviders(): Promise<InstalledAiProvider[]> {
  return installedAiProvidersFromStatus(await loadInstallationStatus())
}
