import { render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from './lib/types'
import { getLatestComponentProps } from './App.test-fixtures/component-props'
import { installAppTestLifecycle } from './App.test-harness'

const projectList: Project[] = [
  { id: 'proj-1', name: 'Project One', path: '/test/one', created_at: 0, updated_at: 0 },
  { id: 'proj-2', name: 'Project Two', path: '/test/two', created_at: 0, updated_at: 0 },
]

describe('App project navigation', () => {
  installAppTestLifecycle()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function renderAppWithProjects() {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const ipc = await import('./lib/ipc')
    const { get } = await import('svelte/store')

    vi.mocked(ipc.getProjects).mockResolvedValue(projectList)
    render(App)

    await vi.waitFor(() => {
      expect(get(stores.projects)).toHaveLength(2)
    })

    return { get, stores }
  }

  it('pressing 2 cycles to next project and restores its last-viewed location', async () => {
    const nav = await import('./lib/router.svelte')
    const { get, stores } = await renderAppWithProjects()

    vi.mocked(nav.restoreProjectView).mockClear()
    stores.activeProjectId.set('proj-1')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

    expect(get(stores.activeProjectId)).toBe('proj-2')
    expect(nav.restoreProjectView).toHaveBeenCalledWith('proj-2')
  })

  it('resets remembered Flow board tab when switching projects', async () => {
    const { get, stores } = await renderAppWithProjects()

    stores.focusBoardFilters.set(new Map([
      ['proj-1', 'backlog'],
      ['proj-2', 'out-of-focus'],
    ]))

    stores.activeProjectId.set('proj-1')
    await vi.waitFor(() => {
      expect(get(stores.focusBoardFilters).get('proj-1')).toBeUndefined()
    })

    stores.focusBoardFilters.set(new Map([
      ['proj-1', 'backlog'],
      ['proj-2', 'out-of-focus'],
    ]))

    stores.activeProjectId.set('proj-2')
    await vi.waitFor(() => {
      expect(get(stores.focusBoardFilters).get('proj-2')).toBeUndefined()
    })
    expect(get(stores.focusBoardFilters).get('proj-1')).toBe('backlog')
  })

  it('pressing 1 cycles to previous project', async () => {
    const { get, stores } = await renderAppWithProjects()

    stores.activeProjectId.set('proj-2')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

    expect(get(stores.activeProjectId)).toBe('proj-1')
  })

  it('pressing 2 wraps around to first project', async () => {
    const { get, stores } = await renderAppWithProjects()

    stores.activeProjectId.set('proj-2')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

    expect(get(stores.activeProjectId)).toBe('proj-1')
  })

  it('pressing Ctrl+N cycles to next project on the board and restores its last-viewed location', async () => {
    const nav = await import('./lib/router.svelte')
    const { get, stores } = await renderAppWithProjects()

    stores.currentView.set('board')
    stores.selectedTaskId.set(null)
    vi.mocked(nav.restoreProjectView).mockClear()
    stores.activeProjectId.set('proj-1')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))

    expect(get(stores.activeProjectId)).toBe('proj-2')
    expect(nav.restoreProjectView).toHaveBeenCalledWith('proj-2')
  })

  it('pressing Ctrl+P cycles to previous project on the board', async () => {
    const nav = await import('./lib/router.svelte')
    const { get, stores } = await renderAppWithProjects()

    stores.currentView.set('board')
    stores.selectedTaskId.set(null)
    vi.mocked(nav.restoreProjectView).mockClear()
    stores.activeProjectId.set('proj-2')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))

    expect(get(stores.activeProjectId)).toBe('proj-1')
    expect(nav.restoreProjectView).toHaveBeenCalledWith('proj-1')
  })

  it('1 and 2 do not fire when input is focused', async () => {
    const { get, stores } = await renderAppWithProjects()

    stores.activeProjectId.set('proj-1')
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

    expect(get(stores.activeProjectId)).toBe('proj-1')
  })

  it('dashboard icon resets to board when a task view is open', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const nav = await import('./lib/router.svelte')
    const iconRailModule = await import('./components/shell/IconRail.svelte')

    stores.selectedTaskId.set('task-123')
    stores.currentView.set('board')

    render(App)

    await vi.waitFor(() => {
      expect(iconRailModule.default).toHaveBeenCalled()
    })

    const props = getLatestComponentProps<{ onNavigate: (view: string) => void }>(
      vi.mocked(iconRailModule.default),
      'onNavigate',
      { latestCallOnly: true },
    )

    vi.mocked(nav.resetToBoard).mockClear()

    props.onNavigate('board')

    expect(nav.resetToBoard).toHaveBeenCalled()
  })
})
