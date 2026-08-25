import { loadInstallationStatus } from '../../lib/settingsConfig'

type InstallationStatus = Awaited<ReturnType<typeof loadInstallationStatus>>

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function createSettingsInstallationController() {
  let status = $state<InstallationStatus | null>(null)
  let loading = $state(false)
  let loadError = $state<string | null>(null)

  async function refresh(): Promise<void> {
    loading = true
    loadError = null
    try {
      status = await loadInstallationStatus()
    } catch (value) {
      loadError = getErrorMessage(value)
    } finally {
      loading = false
    }
  }

  return {
    get opencodeInstalled() { return status?.opencodeInstalled ?? false },
    get opencodeVersion() { return status?.opencodeVersion ?? null },
    get claudeInstalled() { return status?.claudeInstalled ?? false },
    get claudeVersion() { return status?.claudeVersion ?? null },
    get claudeAuthenticated() { return status?.claudeAuthenticated ?? false },
    get piInstalled() { return status?.piInstalled ?? false },
    get piVersion() { return status?.piVersion ?? null },
    get codexInstalled() { return status?.codexInstalled ?? false },
    get codexVersion() { return status?.codexVersion ?? null },
    get grokInstalled() { return status?.grokInstalled ?? false },
    get grokVersion() { return status?.grokVersion ?? null },
    get grokAuthenticated() { return status?.grokAuthenticated ?? false },
    get loading() { return loading },
    get loadError() { return loadError },
    refresh,
  }
}

export type SettingsInstallationController = ReturnType<typeof createSettingsInstallationController>
