import type { TerminalTaskPaneController } from './taskTerminalPaneLifecycle'

export interface TerminalTaskPaneControllerRegistry {
  register(taskId: string, controller: TerminalTaskPaneController): void
  unregister(taskId: string, controller: TerminalTaskPaneController): void
  get(taskId: string): TerminalTaskPaneController | undefined
  clear(): void
}

export function createTerminalTaskPaneControllerRegistry(): TerminalTaskPaneControllerRegistry {
  const controllers = new Map<string, TerminalTaskPaneController>()

  return {
    register(taskId, controller) {
      controllers.set(taskId, controller)
    },
    unregister(taskId, controller) {
      if (controllers.get(taskId) === controller) {
        controllers.delete(taskId)
      }
    },
    get(taskId) {
      return controllers.get(taskId)
    },
    clear() {
      controllers.clear()
    },
  }
}
