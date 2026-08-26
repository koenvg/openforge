// Mock xterm.js — provide a minimal Terminal stub
vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    loadAddon = vi.fn()
    refresh = vi.fn()
    focus = vi.fn()
    reset = vi.fn()
    cols = 80
    rows = 24
    options: { theme: Record<string, string> } = { theme: {} }
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
    proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 })
  }
  return { FitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {}
  return { WebLinksAddon }
})

vi.mock('@openforge-app/terminal-runtime/xterm.css', () => ({}))

const mockRunAppCommandInTaskTerminal = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../../lib/runAppCommand', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/runAppCommand')>()
  return {
    ...actual,
    runAppCommandInTaskTerminal: mockRunAppCommandInTaskTerminal,
  }
})

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

vi.mock('../../lib/useDiffLoader.svelte', () => ({
  createDiffLoader: vi.fn(() => ({
    get isLoading() { return false },
    get error() { return null },
    get prComments() { return [] },
    get linkedPr() { return null },
    get commits() { return [] },
    get selectedCommitSha() { return null },
    loadDiff: vi.fn().mockResolvedValue(undefined),
    loadCommits: vi.fn().mockResolvedValue(undefined),
    selectCommit: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
  })),
}))

vi.mock('../../lib/useCommentSelection.svelte', () => ({
  createCommentSelection: vi.fn(() => ({
    get selectedCount() { return 0 },
    get unaddressedCount() { return 0 },
    get addressedCount() { return 0 },
    get selectedPrCommentIds() { return new Set() },
    get unaddressedComments() { return [] },
    get selectedPrComments() { return [] },
    toggleSelected: vi.fn(),
    selectAll: vi.fn(),
    deselectAll: vi.fn(),
    markAddressed: vi.fn(),
  })),
}))

import { writable } from 'svelte/store'
import type { PoolEntry } from '@openforge-app/terminal-runtime'
import { createFakeTerminalView } from '@openforge-app/terminal-runtime/testUtils'
import { vi } from 'vitest'

vi.mock('../../lib/stores', () => ({
  selectedTaskId: writable(null),
  activeSessions: writable(new Map()),
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  projects: writable([]),
  setTaskMerging: vi.fn(),
  tasks: writable([]),
  dependencyReferenceTasks: writable([]),
  activeProjectId: writable('project-1'),
  startingTasks: writable(new Set()),
  completingTasks: writable(new Set()),
  outOfFocusTaskIdsByProject: writable(new Map()),
  error: writable(null),
  taskRuntimeInfo: writable(new Map()),
  pendingManualComments: writable([]),
  taskActiveView: writable(new Map()),
  taskDraftNotes: writable(new Map()),
  commandHeld: writable(false),
}))

vi.mock('../../lib/ipc', () => ({
  updateTaskFields: vi.fn().mockResolvedValue(undefined),
  updateTaskTitle: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  openInEditor: vi.fn().mockResolvedValue(undefined),
  hasVsCodeProtocolHandler: vi.fn().mockResolvedValue(true),
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
  getConfig: vi.fn().mockResolvedValue(''),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
  getLatestSession: vi.fn().mockResolvedValue(null),
  spawnShellPty: vi.fn().mockResolvedValue(1),
  getPtyBuffer: vi.fn().mockResolvedValue({ buffer: null, isLive: false, instanceId: null }),
  writePty: vi.fn().mockResolvedValue(undefined),
  writeTerminalQueryResponse: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getTaskFileContents: vi.fn().mockResolvedValue(['', '']),
  getTaskBatchFileContents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

const { taskTabSessions, terminalPoolEntries, terminalAttachmentDetach } = vi.hoisted(() => ({
  taskTabSessions: new Map<string, { tabs: Array<{ index: number, key: string, label: string }>, activeTabIndex: number, nextIndex: number }>(),
  terminalPoolEntries: new Map<string, PoolEntry>(),
  terminalAttachmentDetach: vi.fn(),
}))

vi.mock('../../lib/terminalPool', () => {
  function createTerminalView() {
    const geometry = { cols: 80, rows: 24 }
    let mountedHost: HTMLElement | null = null

    return createFakeTerminalView({
      geometry,
      imageProtocol: 'iterm2',
      mount: vi.fn((host: HTMLElement) => {
        mountedHost = host
      }),
      unmount: vi.fn(() => {
        mountedHost = null
      }),
      isMountedIn: vi.fn((host: HTMLElement) => mountedHost === host),
      drainPresentation: vi.fn(async () => ({
        writeGeneration: 0,
        parsedGeneration: 0,
        renderFrame: 0,
        renderedRows: { start: 0, end: geometry.rows - 1 },
        renderer: 'dom',
        presentedAt: 0,
        devicePixelRatio: 1,
        geometry,
      })),
      capturePresentation: vi.fn(() => ({
        geometry,
        activeBuffer: 'normal' as const,
        cursor: { x: 0, y: 0 },
        selectionText: '',
        lines: [],
      })),
      fit: vi.fn(() => geometry),
      dispose: vi.fn(() => {
        mountedHost = null
      }),
    })
  }

  function createPoolEntry(shellSessionKey: string): PoolEntry {
    return {
      shellSessionKey,
      view: createTerminalView(),
      ptyActive: false,
      needsClear: false,
      transportSubscription: null,
      viewSubscriptions: [],
      resizeObserver: null,
      visibilityObserver: null,
      resizeTimeout: null,
      attached: false,
      attachmentGeneration: 0,
      spawnPending: false,
      currentPtyInstance: null,
      authority: null,
      terminalStateSource: 'bootstrapping',
      pendingPtyOutput: [],
      terminalModelSequence: null,
      pendingTerminalModelOutput: [],
      terminalReplayRecovery: null,
      hasOutput: false,
      outputSequence: 0,
    }
  }

  return {
    acquire: vi.fn(async (shellSessionKey: string) => {
      const existing = terminalPoolEntries.get(shellSessionKey)
      if (existing) return existing
      const entry = createPoolEntry(shellSessionKey)
      terminalPoolEntries.set(shellSessionKey, entry)
      return entry
    }),
    attach: vi.fn(async (entry: PoolEntry, host: HTMLElement) => {
      if (entry.attached) entry.view.unmount()
      entry.attachmentGeneration += 1
      const generation = entry.attachmentGeneration
      entry.view.mount(host)
      entry.attached = true
      return {
        generation,
        detach: () => {
          if (!entry.attached || entry.attachmentGeneration !== generation) return
          terminalAttachmentDetach()
          entry.view.unmount()
          entry.attached = false
        },
      }
    }),
    detach: vi.fn((entry: PoolEntry) => {
      entry.view.unmount()
      entry.attached = false
    }),
    recoverActiveTerminal: vi.fn(async () => undefined),
    restorePtyInstance: vi.fn(),
    release: vi.fn(),
    resetTerminal: vi.fn((entry: PoolEntry) => entry.view.reset()),
    releaseAllForTask: vi.fn().mockReturnValue(0),
    focusTerminal: vi.fn((entry: PoolEntry) => entry.view.focus()),
    shouldSpawnPty: vi.fn((entry: PoolEntry) => !entry.ptyActive && !entry.spawnPending && !entry.needsClear),
    getTerminalImageProtocol: vi.fn((entry: PoolEntry) => entry.view.imageProtocol),
    markPtySpawnPending: vi.fn((entry: PoolEntry) => {
      entry.spawnPending = true
    }),
    clearPtySpawnPending: vi.fn((entry: PoolEntry) => {
      entry.spawnPending = false
    }),
    markShellPtyStarted: vi.fn((entry: PoolEntry, instanceId: number) => {
      entry.currentPtyInstance = instanceId
      entry.ptyActive = true
      entry.needsClear = false
    }),
    subscribeShellLifecycle: vi.fn(() => () => {}),
    getShellLifecycleState: vi.fn(() => ({
      ptyActive: false,
      shellExited: false,
      currentPtyInstance: null,
      hasOutput: false,
    })),
    updateShellLifecycleState: vi.fn(),
    isShellExited: vi.fn(() => false),
    getTaskTerminalTabsSession: vi.fn((taskId: string) => {
      const existing = taskTabSessions.get(taskId)
      if (existing) return existing
      const session = {
        tabs: [{ index: 0, key: `${taskId}-shell-0`, label: 'Shell 1' }],
        activeTabIndex: 0,
        nextIndex: 1,
      }
      taskTabSessions.set(taskId, session)
      return session
    }),
    updateTaskTerminalTabsSession: vi.fn((taskId: string, session) => {
      taskTabSessions.set(taskId, session)
    }),
    clearTaskTerminalTabsSession: vi.fn((taskId: string) => {
      taskTabSessions.delete(taskId)
    }),
  }
})

vi.mock('../../lib/liveTerminalPool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/liveTerminalPool')>()
  return {
    ...actual,
    releaseAllForTask: vi.fn().mockReturnValue(0),
  }
})

const { mockResetToBoard } = vi.hoisted(() => ({
  mockResetToBoard: vi.fn(),
}))

vi.mock('../../lib/router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  pushNavState: vi.fn(),
  useAppRouter: () => ({
    resetToBoard: mockResetToBoard,
  }),
}))

import { completingTasks, taskActiveView, commandHeld, outOfFocusTaskIdsByProject, taskRuntimeInfo, tasks } from '../../lib/stores'
import type { Task, TaskWorkspaceInfo } from '../../lib/types'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import { clearTerminalTaskPaneControllers } from './terminalTaskPaneController'
import TaskDetailView from './TaskDetailView.svelte'

const TERMINAL_VIEW_ID = 'com.openforge.terminal:terminal'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  source_ticket_url: null,
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const secondaryTask: Task = {
  ...baseTask,
  id: 'T-99',
  initial_prompt: 'Implement audit logging',
}

const mockOnRunAction = vi.fn()

function createTaskWorkspaceInfo(overrides: Partial<TaskWorkspaceInfo> = {}): TaskWorkspaceInfo {
  return {
    id: 1,
    task_id: 'T-42',
    project_id: 'project-1',
    repo_path: '/repo',
    workspace_path: '/path/to/worktree',
    kind: 'worktree',
    branch_name: 'branch',
    provider_name: 'opencode',
    status: 'ready',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  }
}

function getTaskDetailViewTestDependencies() {
  return {
    PluginSlotTestView,
    TaskDetailView,
    TerminalTaskPane,
    clearComponentRegistry,
    commandHeld,
    completingTasks,
    enabledPluginIds,
    installedPlugins,
    outOfFocusTaskIdsByProject,
    registerRenderableContributionComponent,
    runtimeContributionSources,
    taskActiveView,
    taskRuntimeInfo,
    tasks,
  }
}

function resetTaskDetailViewTestState() {
  localStorage.clear()
  taskActiveView.set(new Map())
  taskRuntimeInfo.set(new Map())
  completingTasks.set(new Set())
  commandHeld.set(false)
  outOfFocusTaskIdsByProject.set(new Map())
  tasks.set([])
  taskTabSessions.clear()
  terminalPoolEntries.clear()
  terminalAttachmentDetach.mockClear()
  clearTerminalTaskPaneControllers()
  installedPlugins.set(new Map([[
    'com.openforge.terminal',
    {
      manifest: {
        id: 'com.openforge.terminal',
        name: 'Terminal',
        version: '1.0.0',
        apiVersion: 1,
        description: 'Embedded terminal plugin',
        permissions: [],
        frontend: 'index.js',
        backend: null,
      },
      state: 'installed',
      error: null,
    },
  ]]))
  enabledPluginIds.set(new Set(['com.openforge.terminal']))
  runtimeContributionSources.set(new Map([[
    'com.openforge.terminal',
    { pluginId: 'com.openforge.terminal', taskPaneTabs: [{ id: 'terminal', title: 'Terminal', icon: 'terminal', order: 10 }] },
  ]]))
  clearComponentRegistry()
  registerRenderableContributionComponent('taskPaneTabs', TERMINAL_VIEW_ID, TerminalTaskPane)
}

export {
  TERMINAL_VIEW_ID,
  baseTask,
  secondaryTask,
  mockOnRunAction,
  createTaskWorkspaceInfo,
  mockResetToBoard,
  mockRunAppCommandInTaskTerminal,
  taskTabSessions,
  terminalAttachmentDetach,
  getTaskDetailViewTestDependencies,
  resetTaskDetailViewTestState,
}
export type { Task }
