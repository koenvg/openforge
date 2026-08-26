import type { TerminalSurfaceAdapter } from '@openforge-app/terminal-runtime'
import { getTaskWorkspace, killPty, spawnShellPty } from '../../lib/ipc'
import * as desktopTerminalRuntime from '../../lib/terminalPool'
import {
  registerTerminalTaskPaneController,
  unregisterTerminalTaskPaneController,
} from './terminalTaskPaneController'

export const desktopTerminalSurfaceAdapter: TerminalSurfaceAdapter = {
  runtime: desktopTerminalRuntime,
  spawnShellPty,
  killPty,
  getTaskWorkspace,
  getWorkspacePath: workspace => workspace?.workspace_path ?? null,
  registerTaskPaneController: registerTerminalTaskPaneController,
  unregisterTaskPaneController: unregisterTerminalTaskPaneController,
}
