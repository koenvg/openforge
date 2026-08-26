import {
  createTerminalTaskPaneControllerRegistry,
  type TerminalTaskPaneController,
} from '@openforge-app/terminal-runtime'

export type { TerminalTaskPaneController }

const terminalTaskPaneControllerRegistry = createTerminalTaskPaneControllerRegistry()

export const registerTerminalTaskPaneController = terminalTaskPaneControllerRegistry.register
export const unregisterTerminalTaskPaneController = terminalTaskPaneControllerRegistry.unregister
export const getTerminalTaskPaneController = terminalTaskPaneControllerRegistry.get
export const clearTerminalTaskPaneControllers = terminalTaskPaneControllerRegistry.clear
