import type { DesktopCloseRequestEvent, DesktopWindowTarget } from './desktopWindow'
import { hasActiveAgentSessions } from './quitGuard'
import type { ProjectAttention } from './types'

interface AppCloseControllerOptions {
  refreshAttention(): Promise<void> | void
  getAttention(): Map<string, ProjectAttention>
  getAppWindow(): DesktopWindowTarget | null
  logError?: (message: string, error: unknown) => void
}

export function useAppCloseController(options: AppCloseControllerOptions) {
  let confirmationOpen = $state(false)
  const logError = options.logError ?? ((message: string, error: unknown) => {
    console.error(message, error)
  })

  async function confirmClose(): Promise<void> {
    const appWindow = options.getAppWindow()
    if (!appWindow) return

    confirmationOpen = false

    try {
      await appWindow.destroy()
    } catch (error) {
      confirmationOpen = true
      logError('[App] Failed to close window:', error)
    }
  }

  function cancelClose(): void {
    confirmationOpen = false
  }

  async function handleCloseRequested(event: DesktopCloseRequestEvent): Promise<void> {
    event.preventDefault()

    try {
      await options.refreshAttention()
    } catch (error) {
      logError('[App] Failed to refresh project attention before quit:', error)
    }

    if (hasActiveAgentSessions(options.getAttention())) {
      confirmationOpen = true
      return
    }

    await confirmClose()
  }

  return {
    get confirmationOpen() {
      return confirmationOpen
    },
    handleCloseRequested,
    confirmClose,
    cancelClose,
  }
}

export type AppCloseController = ReturnType<typeof useAppCloseController>
