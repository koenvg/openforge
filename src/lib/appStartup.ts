type LogError = (message: string, error: unknown) => void

export interface AppStartupDeps {
  initializePluginRuntime(): Promise<void>
  initializeTheme(): Promise<void>
  loadProjects(): Promise<void>
  getAppMode(): Promise<string | null>
  setAppMode(appMode: string | null): void
  loadProjectAttention(): void | Promise<void>
  loadTasks(): Promise<void>
  logError?: LogError
}

function defaultLogError(message: string, error: unknown): void {
  console.error(message, error)
}

export async function loadAppStartupData(deps: AppStartupDeps): Promise<void> {
  const logError = deps.logError ?? defaultLogError

  try {
    await deps.initializePluginRuntime()
  } catch (e) {
    logError('[App] Failed to initialize plugin runtime:', e)
  }

  try {
    await deps.initializeTheme()
  } catch (e) {
    logError('[App] Failed to initialize theme:', e)
  }

  await deps.loadProjects()

  try {
    deps.setAppMode(await deps.getAppMode())
  } catch (e) {
    logError('[App] Failed to get app mode:', e)
  }

  void deps.loadProjectAttention()
  await deps.loadTasks()
}
