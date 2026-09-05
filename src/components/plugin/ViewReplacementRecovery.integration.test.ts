import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineFrontendPlugin, type FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { Disposable } from '@openforge-app/plugin-sdk'
import { createTask } from '../../App.test-fixtures/tasks'
import { getLatestComponentProps } from '../../App.test-fixtures/component-props'
import { getEnabledPlugins, getPlugin, writeClipboardText } from '../../lib/ipc'
import { activeProjectId } from '../../lib/stores'
import { activatePlugin, deactivateAllPlugins, disablePluginForProject, enablePluginForProject } from '../../lib/plugin/pluginRegistry'
import { _resetPluginLoaderForTests, _setModuleLoader } from '../../lib/plugin/pluginLoader'
import { clearComponentRegistry } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, projectEnabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import { publishTaskInvalidation } from '../../lib/plugin/pluginTaskInvalidations'
import { clearProjectDashboardProviderIds, globalProjectDashboardProviderLoaded, projectDashboardProviderIds } from '../../lib/plugin/projectDashboardProviders'
import { clearTaskDetailProviderIds, globalTaskDetailProviderLoaded, projectTaskDetailProviderIds } from '../../lib/plugin/taskDetailProviders'
import ProjectDashboardProviderHost from '../focus-board/ProjectDashboardProviderHost.svelte'
import FocusBoard from '../focus-board/FocusBoard.svelte'
import TaskDetailProviderHost from '../task-detail/TaskDetailProviderHost.svelte'
import TaskDetailView from '../task-detail/TaskDetailView.svelte'
import GlobalPluginSettingsPanel from './GlobalPluginSettingsPanel.svelte'
import PluginSlotTestView from './PluginSlotTestView.svelte'
import ReplacementLifecycleTestView from './ReplacementLifecycleTestView.svelte'

vi.mock('../focus-board/FocusBoard.svelte', () => ({ default: vi.fn() }))
vi.mock('../task-detail/TaskDetailView.svelte', () => ({ default: vi.fn() }))
vi.mock('../../lib/terminalSessionService', () => ({
  regularTerminalSessions: {
    getShellLifecycleState: vi.fn(), getTaskTerminalTabsSession: vi.fn(), releaseAllForTask: vi.fn(),
  },
}))
vi.mock('../../lib/ipc', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/ipc')>(),
  getConfig: vi.fn(async () => null),
  getProjectConfig: vi.fn(async () => null),
  getTaskWorkspace: vi.fn(async () => null),
  getPlugin: vi.fn(),
  getEnabledPlugins: vi.fn(),
  writeClipboardText: vi.fn(async () => undefined),
  pluginBackendDeactivate: vi.fn(async () => undefined),
  setPluginEnabled: vi.fn(async () => undefined),
  uninstallPlugin: vi.fn(async () => undefined),
}))

const pluginId = 'recovery-plugin'
const project = { id: 'P-1', name: 'Project', path: '/project', created_at: 1, updated_at: 1 }
const task = createTask({ id: 'T-1', projectId: project.id })
const targets = ['project.dashboard', 'task.detail'] as const
const contributionIds = { 'project.dashboard': 'dashboard', 'task.detail': 'workspace' } as const

async function installProviders(failingTarget?: typeof targets[number]) {
  let runtimeApi!: FrontendOpenForgeAPI
  const registrations = new Map<typeof targets[number], Disposable>()
  function register(target: typeof targets[number]) {
    const registration = runtimeApi.viewReplacements.register({
      id: contributionIds[target], target, title: target, icon: 'panels-top-left',
      component: failingTarget === target
        ? () => Promise.reject(new Error(`Cannot load ${target}`))
        : ReplacementLifecycleTestView,
    })
    registrations.set(target, registration)
    return registration
  }
  const plugin = defineFrontendPlugin({
    activate(api, context) {
      runtimeApi = api
      for (const target of targets) context.subscriptions.add(register(target))
      context.subscriptions.add(api.settings.registerSection({
        id: 'settings', title: 'Plugin preferences', scope: 'global', component: PluginSlotTestView,
      }))
    },
  })
  installedPlugins.set(new Map([[pluginId, {
    manifest: { id: pluginId, name: 'Recovery plugin', version: '1.0.0', apiVersion: 1, description: '', permissions: [], frontend: 'index.js', backend: null },
    state: 'installed', error: null,
    packageMetadata: { id: pluginId, displayName: 'Recovery plugin', apiVersion: 1, description: 'Replacement recovery fixture', frontend: 'index.js', requires: ['viewReplacements'] },
  }]]))
  projectEnabledPluginIds.set(new Set([pluginId]))
  enabledPluginIds.set(new Set([pluginId]))
  _setModuleLoader(async () => ({ default: plugin }))
  const entry = get(installedPlugins).get(pluginId)!
  const row = {
    id: pluginId, name: entry.manifest.name, version: '1.0.0', apiVersion: 1, description: '', permissions: '[]',
    contributes: '{}', frontendEntry: 'index.js', backendEntry: null, installPath: '/plugin',
    sourceKind: 'local' as const, sourceSpec: '/plugin', installedAt: 1, isBuiltin: false,
    packageMetadata: JSON.stringify(entry.packageMetadata),
  }
  vi.mocked(getPlugin).mockResolvedValue(row)
  vi.mocked(getEnabledPlugins).mockResolvedValue([row])
  const activated = await activatePlugin(pluginId)
  expect(activated, get(installedPlugins).get(pluginId)?.error ?? '').toBe(true)
  return { registrations, register, recover: () => { failingTarget = undefined } }
}

function renderHosts() {
  const onOpenTask = vi.fn()
  const dashboard = render(ProjectDashboardProviderHost, { props: {
    project, tasks: [task], activeSessions: new Map(), ticketPrs: new Map(), isLoading: false,
    onOpenTask, onRunAction: vi.fn(),
  } })
  const detail = render(TaskDetailProviderHost, { props: { project, task, onOpenTask, onRunAction: vi.fn() } })
  render(GlobalPluginSettingsPanel, { props: { activeProjectId: project.id } })
  return { dashboard, detail, onOpenTask }
}

function publish() {
  publishTaskInvalidation({ projectId: project.id, taskId: task.id, reason: 'updated' })
}

describe('replacement recovery across targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearComponentRegistry()
    _resetPluginLoaderForTests()
    clearProjectDashboardProviderIds()
    clearTaskDetailProviderIds()
    globalProjectDashboardProviderLoaded.set(true)
    globalTaskDetailProviderLoaded.set(true)
    projectDashboardProviderIds.set(new Map([[project.id, `${pluginId}.dashboard`]]))
    projectTaskDetailProviderIds.set(new Map([[project.id, `${pluginId}.workspace`]]))
    activeProjectId.set(project.id)
  })

  afterEach(async () => {
    cleanup()
    await deactivateAllPlugins()
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    projectEnabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    activeProjectId.set(null)
  })

  it.each(targets)('keeps the other target and settings active after %s fails to load', async (target) => {
    await installProviders(target)
    const { onOpenTask } = renderHosts()
    const other = targets.find(value => value !== target)!
    expect(await screen.findByTestId(other)).toBeTruthy()
    const core = target === 'task.detail' ? vi.mocked(TaskDetailView) : vi.mocked(FocusBoard)
    await waitFor(() => expect(core).toHaveBeenCalled())
    const coreProps = getLatestComponentProps<{ onOpenTask: typeof onOpenTask }>(core, 'onOpenTask')
    coreProps.onOpenTask('T-2', project.id)
    expect(onOpenTask).toHaveBeenCalledWith('T-2', project.id)
    expect(get(installedPlugins).get(pluginId)).toMatchObject({ state: 'active', error: null })
    expect(await screen.findByTestId('plugin-slot-view')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics: Recovery plugin' }))
    const diagnostics = JSON.parse(vi.mocked(writeClipboardText).mock.calls.at(-1)![0])
    expect(diagnostics.replacementFailures).toEqual([expect.objectContaining({
      pluginId, contributionId: contributionIds[target], target, phase: 'load',
      message: `Cannot load ${target}`,
    })])
    expect(screen.getByRole('button', { name: 'Reload plugin: Recovery plugin' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Uninstall plugin: Recovery plugin' }).hasAttribute('disabled')).toBe(false)
    expect(get(projectDashboardProviderIds).get(project.id)).toBe(`${pluginId}.dashboard`)
    expect(get(projectTaskDetailProviderIds).get(project.id)).toBe(`${pluginId}.workspace`)
  })

  it.each(targets)('removes only the failed %s component and its subscriptions after a render exception', async (target) => {
    await installProviders()
    renderHosts()
    for (const value of targets) await screen.findByTestId(value)
    const delivered: string[] = []
    const onDelivery = (event: Event) => delivered.push((event as CustomEvent<string>).detail)
    window.addEventListener('replacement-delivery', onDelivery)
    try {
      publish()
      expect(delivered).toHaveLength(2)
      delivered.length = 0
      await fireEvent.click(screen.getByRole('button', { name: `Crash ${target}` }))
      await waitFor(() => expect(screen.queryByTestId(target)).toBeNull())
      publish()
      expect(delivered).toEqual([target === 'task.detail' ? 'project.dashboard:P-1:' : 'task.detail:P-1:T-1'])
      expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()

      await fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics: Recovery plugin' }))
      const diagnostics = JSON.parse(vi.mocked(writeClipboardText).mock.calls.at(-1)![0])
      expect(diagnostics.replacementFailures).toEqual([expect.objectContaining({
        pluginId, contributionId: contributionIds[target], target, phase: 'render', message: `Broken ${target}`,
      })])
      await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Recovery plugin' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('button', { name: 'Uninstall plugin: Recovery plugin' })).toBeTruthy()
    } finally {
      window.removeEventListener('replacement-delivery', onDelivery)
    }
  })

  it.each(targets)('falls back when %s is disposed and resumes when the contribution returns', async (target) => {
    const { registrations, register } = await installProviders()
    renderHosts()
    for (const value of targets) await screen.findByTestId(value)
    const other = targets.find(value => value !== target)!
    const otherElement = screen.getByTestId(other)
    const disposed: string[] = []
    const onDisposed = (event: Event) => disposed.push((event as CustomEvent<string>).detail)
    window.addEventListener('replacement-disposed', onDisposed)
    try {
      registrations.get(target)!.dispose()
      await waitFor(() => expect(screen.queryByTestId(target)).toBeNull())
      expect(disposed).toEqual([target === 'task.detail' ? 'task.detail:P-1:T-1' : 'project.dashboard:P-1:'])
      expect(screen.getByTestId(other)).toBe(otherElement)
      expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()

      register(target)
      expect(await screen.findByTestId(target)).toBeTruthy()
      expect(screen.getByTestId(other)).toBe(otherElement)
      expect(get(projectDashboardProviderIds).get(project.id)).toBe(`${pluginId}.dashboard`)
      expect(get(projectTaskDetailProviderIds).get(project.id)).toBe(`${pluginId}.workspace`)
    } finally {
      window.removeEventListener('replacement-disposed', onDisposed)
    }
  })

  it.each(targets)('recovers %s through the host reload control after loader and render failures', async (target) => {
    const { recover } = await installProviders(target)
    renderHosts()
    await screen.findByTestId(targets.find(value => value !== target)!)
    const disposed: string[] = []
    const onDisposed = (event: Event) => disposed.push((event as CustomEvent<string>).detail)
    window.addEventListener('replacement-disposed', onDisposed)
    try {
      recover()
      await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Recovery plugin' }))
      for (const value of targets) await screen.findByTestId(value)
      expect(disposed).toHaveLength(1)
      await fireEvent.click(screen.getByRole('button', { name: `Crash ${target}` }))
      await waitFor(() => expect(screen.queryByTestId(target)).toBeNull())
      await fireEvent.click(screen.getByRole('button', { name: 'Reload plugin: Recovery plugin' }))
      for (const value of targets) await screen.findByTestId(value)
      expect(disposed).toHaveLength(3)
      await fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics: Recovery plugin' }))
      expect(JSON.parse(vi.mocked(writeClipboardText).mock.calls.at(-1)![0]).replacementFailures).toEqual([])
    } finally {
      window.removeEventListener('replacement-disposed', onDisposed)
    }
  })

  it('removes subscriptions on disablement and uninstall, and restores configured providers on re-enable', async () => {
    await installProviders()
    renderHosts()
    for (const value of targets) await screen.findByTestId(value)
    const delivered: string[] = []
    const onDelivery = (event: Event) => delivered.push((event as CustomEvent<string>).detail)
    window.addEventListener('replacement-delivery', onDelivery)
    try {
      await disablePluginForProject(project.id, pluginId)
      await waitFor(() => {
        for (const value of targets) expect(screen.queryByTestId(value)).toBeNull()
      })
      publish()
      expect(delivered).toEqual([])
      expect(await enablePluginForProject(project.id, pluginId)).toBe(true)
      for (const value of targets) await screen.findByTestId(value)
      publish()
      expect(delivered).toHaveLength(2)
      delivered.length = 0

      await fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin: Recovery plugin' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Confirm uninstall plugin: Recovery plugin' }))
      await waitFor(() => expect(get(installedPlugins).has(pluginId)).toBe(false))
      for (const value of targets) expect(screen.queryByTestId(value)).toBeNull()
      publish()
      expect(delivered).toEqual([])
      expect(get(projectDashboardProviderIds).get(project.id)).toBe(`${pluginId}.dashboard`)
      expect(get(projectTaskDetailProviderIds).get(project.id)).toBe(`${pluginId}.workspace`)
      expect(screen.getByRole('button', { name: 'Choose plugin folder' })).toBeTruthy()
    } finally {
      window.removeEventListener('replacement-delivery', onDelivery)
    }
  })

  it('releases old task and project subscriptions without resetting the other target', async () => {
    await installProviders()
    const { dashboard, detail } = renderHosts()
    for (const value of targets) await screen.findByTestId(value)
    const dashboardElement = screen.getByTestId('project.dashboard')
    const delivered: string[] = []
    const onDelivery = (event: Event) => delivered.push((event as CustomEvent<string>).detail)
    window.addEventListener('replacement-delivery', onDelivery)
    try {
      await detail.rerender({ task: createTask({ id: 'T-2', projectId: project.id }) })
      await waitFor(() => expect(screen.getByTestId('task.detail').textContent).toContain('T-2'))
      expect(screen.getByTestId('project.dashboard')).toBe(dashboardElement)
      publish()
      expect(delivered.sort()).toEqual(['project.dashboard:P-1:', 'task.detail:P-1:T-2'])
      delivered.length = 0

      const nextProject = { ...project, id: 'P-2' }
      projectDashboardProviderIds.set(new Map([[nextProject.id, `${pluginId}.dashboard`]]))
      projectTaskDetailProviderIds.set(new Map([[nextProject.id, `${pluginId}.workspace`]]))
      await dashboard.rerender({ project: nextProject })
      await detail.rerender({ project: nextProject, task: createTask({ id: 'T-3', projectId: nextProject.id }) })
      await waitFor(() => {
        for (const value of targets) expect(screen.getByTestId(value).textContent).toContain('P-2')
      })
      publish()
      expect(delivered).toEqual([])
      publishTaskInvalidation({ projectId: nextProject.id, taskId: 'T-3', reason: 'updated' })
      expect(delivered.sort()).toEqual(['project.dashboard:P-2:', 'task.detail:P-2:T-3'])
      delivered.length = 0

      projectDashboardProviderIds.set(new Map([[nextProject.id, 'core']]))
      projectTaskDetailProviderIds.set(new Map([[nextProject.id, 'core']]))
      await waitFor(() => {
        for (const value of targets) expect(screen.queryByTestId(value)).toBeNull()
      })
      publishTaskInvalidation({ projectId: nextProject.id, taskId: 'T-3', reason: 'updated' })
      expect(delivered).toEqual([])
      expect(screen.getByTestId('plugin-slot-view')).toBeTruthy()
      dashboard.unmount()
      detail.unmount()
    } finally {
      window.removeEventListener('replacement-delivery', onDelivery)
    }
  })
})
