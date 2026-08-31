import type { TerminalImageProtocol } from './terminalImages'
import type { TerminalRuntime } from './terminalRuntime'
import type { TerminalTaskPaneController } from './taskTerminalPaneLifecycle'

export type TerminalSurfaceRuntime = Pick<TerminalRuntime,
  | 'acquire'
  | 'attach'
  | 'detach'
  | 'release'
  | 'resetTerminal'
  | 'shouldSpawnPty'
  | 'markPtySpawnPending'
  | 'clearPtySpawnPending'
  | 'markShellPtyStarted'
  | 'markPerformancePhase'
  | 'subscribeShellLifecycle'
  | 'getShellLifecycleState'
  | 'getTaskTerminalTabsSession'
  | 'updateTaskTerminalTabsSession'
  | 'releaseAllForTask'
  | 'focusTerminal'
  | 'recoverActiveTerminal'
  | 'getTerminalImageProtocol'
>

export interface TerminalSurfaceWorkspace {
  workspace_path?: string | null
}

export interface TerminalSurfaceAdapter {
  runtime: TerminalSurfaceRuntime
  spawnShellPty(
    taskId: string,
    cwd: string,
    cols: number,
    rows: number,
    terminalIndex: number,
    terminalImageProtocol?: TerminalImageProtocol | null,
  ): Promise<number>
  killPty(terminalKey: string): Promise<void>
  getTaskWorkspace(taskId: string): Promise<TerminalSurfaceWorkspace | null>
  getWorkspacePath(workspace: TerminalSurfaceWorkspace | null): string | null
  registerTaskPaneController(taskId: string, controller: TerminalTaskPaneController): void
  unregisterTaskPaneController(taskId: string, controller: TerminalTaskPaneController): void
}
