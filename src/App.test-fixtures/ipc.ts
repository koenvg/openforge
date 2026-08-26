import { vi } from 'vitest'
import type { NormalizedPluginRow } from '../lib/ipc'

type RegisterBuiltinPluginInput = Parameters<
  typeof import('../lib/ipc').registerBuiltinPlugin
>[0]

export const installedPluginRows: NormalizedPluginRow[] = []

export function persistInstalledPluginRow(plugin: RegisterBuiltinPluginInput): void {
  const nextRow: NormalizedPluginRow = {
    sourceKind: 'legacy',
    sourceSpec: '',
    packageMetadata: '{}',
    ...plugin,
  }

  const existingIndex = installedPluginRows.findIndex((row) => row.id === plugin.id)
  if (existingIndex >= 0) {
    installedPluginRows.splice(existingIndex, 1, nextRow)
  } else {
    installedPluginRows.push(nextRow)
  }
}

export const callOrder: string[] = []
export const eventListeners = new Map<string, Function>()

vi.mock('../lib/desktopIpc', () => ({
  invokeDesktopCommand: vi.fn(),
  isElectronDesktopBridgeAvailable: vi.fn(() => true),
  listenDesktopEvent: vi.fn(async (eventName: string, callback: Function) => {
    callOrder.push('listen')
    eventListeners.set(eventName, callback)
    return () => {}
  }),
}))

vi.mock('../lib/ipc', () => ({
  registerBuiltinPlugin: vi.fn(async (plugin) => {
    persistInstalledPluginRow(plugin)
  }),
  listPlugins: vi.fn(async () => installedPluginRows.map((row) => ({ ...row }))),
  getEnabledPlugins: vi.fn(async () => installedPluginRows.map((row) => ({ ...row }))),
  getSessions: vi.fn(),
  getProjects: vi.fn(async () => {
    callOrder.push('getProjects')
    return [{ id: 'proj-1', name: 'Test Project', path: '/test' }]
  }),
  getTasksForProject: vi.fn(async () => {
    callOrder.push('getTasksForProject')
    return []
  }),
  getAllTasks: vi.fn(async () => {
    callOrder.push('getAllTasks')
    return []
  }),
  getTaskAttention: vi.fn(async () => []),
  getTaskLanes: vi.fn(async () => ({ focus: [], in_flight: [], out_of_focus: [], backlog: [] })),
  getOpenCodeStatus: vi.fn(async () => {
    callOrder.push('getOpenCodeStatus')
    return { installed: false, running: false, session_count: 0 }
  }),
  getLatestSessions: vi.fn(async () => {
    callOrder.push('getLatestSessions')
    return []
  }),
  getPullRequests: vi.fn(async () => {
    callOrder.push('getPullRequests')
    return []
  }),
  getAppMode: vi.fn(async () => {
    callOrder.push('getAppMode')
    return 'prod'
  }),
  getConfig: vi.fn(async () => null),
  getProjectAttention: vi.fn(async () => {
    callOrder.push('getProjectAttention')
    return []
  }),
  getLatestSession: vi.fn(async () => {
    callOrder.push('getLatestSession')
    return null
  }),
  finalizeAgentSession: vi.fn(async () => {
    callOrder.push('finalizeAgentSession')
  }),
  openUrl: vi.fn(),
  writePty: vi.fn(),
  writeTerminalQueryResponse: vi.fn(),
  resizePty: vi.fn(),
  killPty: vi.fn(),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getPtyBuffer: vi.fn().mockResolvedValue({ buffer: null, isLive: false }),
  createTask: vi.fn(),
  getTaskDetail: vi.fn(),
  updateTaskInitialPrompt: vi.fn(),
  updateTaskStatus: vi.fn(async () => undefined),
  deleteTask: vi.fn(),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectConfig: vi.fn(async () => null),
  setProjectConfig: vi.fn(),
  startImplementation: vi.fn(),
  mergePullRequest: vi.fn(),
  getWorktreeForTask: vi.fn(),
  getSessionStatus: vi.fn(),
  abortSession: vi.fn(),
  forceGithubSync: vi.fn(),
  setPollContext: vi.fn(),
  getProjectRepo: vi.fn(async () => null),
  getPrComments: vi.fn(),
  markCommentAddressed: vi.fn(),
  checkOpenCodeInstalled: vi.fn(),
  getReviewPullRequests: vi.fn(),
  getReviewComments: vi.fn(),
  submitReview: vi.fn(),
  getReviewPullRequestDetails: vi.fn(),
  getPrFileDiffs: vi.fn(),
  getReviewPullRequestDiff: vi.fn(),
  getReviewPullRequestDiffForFile: vi.fn(),
  getReviewPullRequestComments: vi.fn(),
  addReviewComment: vi.fn(),
  removeReviewComment: vi.fn(),
  updateReviewComment: vi.fn(),
  getReviewCommentReplies: vi.fn(),
  addReviewCommentReply: vi.fn(),
  removeReviewCommentReply: vi.fn(),
  updateReviewCommentReply: vi.fn(),
  submitReviewComments: vi.fn(),
  dismissReviewPullRequest: vi.fn(),
  getReviewPrs: vi.fn(async () => {
    callOrder.push('getReviewPrs')
    return []
  }),
  getAuthoredPrs: vi.fn(async () => {
    callOrder.push('getAuthoredPrs')
    return []
  }),
}))

export function resetIpcFixtures() {
  callOrder.length = 0
  installedPluginRows.length = 0
  eventListeners.clear()
}
