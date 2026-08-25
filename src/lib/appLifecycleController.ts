import type { DesktopUnlistenFn } from './desktopIpc'
import type { DesktopWindowTarget } from './desktopWindow'
import type { ShortcutRegistry } from './shortcuts.svelte'

interface AppLifecycleControllerOptions {
  createWindow(): DesktopWindowTarget
  createShortcuts(): ShortcutRegistry
  registerShortcuts(shortcuts: ShortcutRegistry): void
  registerDesktopEvents(appWindow: DesktopWindowTarget): Promise<DesktopUnlistenFn[]>
  loadRendererStartupData(): Promise<void>
  onWindowFocusChange(focused: boolean): void
  logError?: (message: string, error: unknown) => void
}

export function createAppLifecycleController(options: AppLifecycleControllerOptions) {
  let appWindow: DesktopWindowTarget | null = null
  let shortcuts: ShortcutRegistry | null = null
  let unlisteners: DesktopUnlistenFn[] = []
  let started = false
  let generation = 0

  const logError = options.logError ?? ((message: string, error: unknown) => {
    console.error(message, error)
  })

  function refreshWindowFocus(): void {
    options.onWindowFocusChange(
      typeof document === 'undefined'
        ? true
        : document.visibilityState === 'visible' && document.hasFocus(),
    )
  }

  function handleKeydown(event: KeyboardEvent): void {
    shortcuts?.handleKeydown(event)
  }

  async function start(): Promise<void> {
    if (started) return
    started = true
    const startGeneration = ++generation
    appWindow = options.createWindow()
    shortcuts = options.createShortcuts()

    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('focus', refreshWindowFocus)
    window.addEventListener('blur', refreshWindowFocus)
    document.addEventListener('visibilitychange', refreshWindowFocus)
    refreshWindowFocus()

    options.registerShortcuts(shortcuts)
    let registeredUnlisteners: DesktopUnlistenFn[]
    try {
      registeredUnlisteners = await options.registerDesktopEvents(appWindow)
    } catch (error) {
      logError('[App] Failed to register desktop event listeners:', error)
      registeredUnlisteners = []
    }
    if (!started || generation !== startGeneration) {
      registeredUnlisteners.forEach((unlisten) => { unlisten() })
      return
    }
    unlisteners.push(...registeredUnlisteners)

    // Electron establishes Rust Sidecar readiness before creating the renderer.
    // Renderer startup only needs desktop listeners in place before loading its data.
    await options.loadRendererStartupData()
  }

  function dispose(): void {
    if (!started) return
    started = false
    generation += 1
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('focus', refreshWindowFocus)
    window.removeEventListener('blur', refreshWindowFocus)
    document.removeEventListener('visibilitychange', refreshWindowFocus)
    unlisteners.forEach((unlisten) => { unlisten() })
    unlisteners = []
  }

  return {
    start,
    dispose,
  }
}
