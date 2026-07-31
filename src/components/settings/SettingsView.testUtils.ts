import { vi } from 'vitest'

interface MockWritable<T> {
  set(value: T): void
  update(updater: (value: T) => T): void
  subscribe(run: (value: T) => void): () => void
}

const mocks = vi.hoisted(() => {
  function createMockWritable<T>(initialValue: T): MockWritable<T> {
    let value = initialValue
    const subscribers = new Set<(value: T) => void>()

    function notify() {
      subscribers.forEach((subscriber) => subscriber(value))
    }

    return {
      set(nextValue: T) {
        value = nextValue
        notify()
      },
      update(updater: (value: T) => T) {
        value = updater(value)
        notify()
      },
      subscribe(run: (value: T) => void) {
        run(value)
        subscribers.add(run)
        return () => subscribers.delete(run)
      },
    }
  }

  return {
    getProjectConfig: vi.fn(),
    setProjectConfig: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    getCompanionGatewayStatus: vi.fn(),
    setCompanionGatewayEnabled: vi.fn(),
    checkClaudeInstalled: vi.fn(),
    checkPiInstalled: vi.fn(),
    getAllWhisperModelStatuses: vi.fn(),
    getDeveloperLogSnapshot: vi.fn(),
    getProjectTaskLabels: vi.fn(),
    activeProjectId: createMockWritable<string | null>('test-project-id'),
    activeProjectColorId: createMockWritable<string | null>(null),
    codeCleanupTasksEnabled: createMockWritable(false),
    error: createMockWritable<string | null>(null),
    projects: createMockWritable([
      {
        id: 'test-project-id',
        name: 'Test Project',
        path: '/tmp/test',
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ]),
  }
})

vi.mock('../../lib/ipc', () => ({
  getProjectConfig: mocks.getProjectConfig,
  setProjectConfig: mocks.setProjectConfig,
  updateProject: mocks.updateProject,
  deleteProject: mocks.deleteProject,
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  getCompanionGatewayStatus: mocks.getCompanionGatewayStatus,
  setCompanionGatewayEnabled: mocks.setCompanionGatewayEnabled,
  checkOpenCodeInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  checkClaudeInstalled: mocks.checkClaudeInstalled,
  checkPiInstalled: mocks.checkPiInstalled,
  checkCodexInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  getAllWhisperModelStatuses: mocks.getAllWhisperModelStatuses,
  getDeveloperLogSnapshot: mocks.getDeveloperLogSnapshot,
  getDeveloperLogs: vi.fn(() => Promise.resolve([])),
  openInEditor: vi.fn(() => Promise.resolve(undefined)),
  setWhisperModel: vi.fn(),
  getProjectTaskLabels: mocks.getProjectTaskLabels,
  createTaskLabel: vi.fn(() => Promise.resolve({ id: 1, project_id: 'test-project-id', name: 'bug' })),
  deleteTaskLabel: vi.fn(() => Promise.resolve(undefined)),
  installPluginFromLocal: vi.fn(),
  installPluginFromNpm: vi.fn(),
  installPluginFromGit: vi.fn(),
  uninstallPlugin: vi.fn(),
  getPlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  getEnabledPlugins: vi.fn(() => Promise.resolve([])),
  getGlobalPluginDefaults: vi.fn(() => Promise.resolve([])),
  setGlobalPluginDefault: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('../../lib/boardFilters', () => ({
  loadFocusFilterStates: vi.fn(() => Promise.resolve(['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'])),
  saveFocusFilterStates: vi.fn(() => Promise.resolve(undefined)),
  DEFAULT_FOCUS_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
  FOCUS_FILTER_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
}))

vi.mock('../../lib/stores', () => ({
  activeProjectId: mocks.activeProjectId,
  activeProjectColorId: mocks.activeProjectColorId,
  projects: mocks.projects,
  codeCleanupTasksEnabled: mocks.codeCleanupTasksEnabled,
  error: mocks.error,
}))

export const defaultProps = {
  onClose: vi.fn(),
  onProjectDeleted: vi.fn(),
  onProjectSettingsSaved: vi.fn(),
  mode: 'project' as const,
}

export function installedPluginEntry(id: string, name: string) {
  return {
    manifest: {
      id,
      name,
      version: '1.0.0',
      apiVersion: 1,
      description: `${name} description`,
      permissions: [],
      frontend: 'index.js',
      backend: null,
    },
    state: 'installed' as const,
    error: null,
    installPath: `/plugins/${id}`,
    isBuiltin: false,
    sourceKind: 'local',
    sourceSpec: `/plugins/${id}`,
  }
}

export async function resetSettingsViewTest() {
  vi.clearAllMocks()
  mocks.getProjectConfig.mockResolvedValue(null)
  mocks.getConfig.mockResolvedValue(null)
  mocks.setProjectConfig.mockResolvedValue(undefined)
  mocks.setConfig.mockResolvedValue(undefined)
  mocks.getCompanionGatewayStatus.mockResolvedValue({
    enabled: false,
    phase: 'disabled',
    hostId: null,
    certificateFingerprint: null,
    endpoints: [],
    error: null,
  })
  mocks.setCompanionGatewayEnabled.mockResolvedValue(undefined)
  mocks.updateProject.mockResolvedValue(undefined)
  mocks.deleteProject.mockResolvedValue(undefined)
  mocks.checkClaudeInstalled.mockResolvedValue({ installed: false, path: null, version: null, authenticated: false })
  mocks.checkPiInstalled.mockResolvedValue({ installed: false, path: null, version: null })
  mocks.getAllWhisperModelStatuses.mockResolvedValue([])
  mocks.getDeveloperLogSnapshot.mockResolvedValue({ entries: [], logFilePath: '/tmp/openforge.log', totalEntries: 0 })
  mocks.getProjectTaskLabels.mockResolvedValue([])

  mocks.activeProjectId.set('test-project-id')
  mocks.activeProjectColorId.set(null)
  mocks.codeCleanupTasksEnabled.set(false)
  mocks.error.set(null)
  mocks.projects.set([
    {
      id: 'test-project-id',
      name: 'Test Project',
      path: '/tmp/test',
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  ])

  const [{ clearComponentRegistry }, { enabledPluginIds, installedPlugins, runtimeContributionSources }] = await Promise.all([
    import('../../lib/plugin/componentRegistry'),
    import('../../lib/plugin/pluginStore'),
  ])
  installedPlugins.set(new Map())
  enabledPluginIds.set(new Set())
  runtimeContributionSources.set(new Map())
  clearComponentRegistry()
}
