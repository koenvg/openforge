import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { tick } from 'svelte'
import type { Component } from 'svelte'
import { installAppTestLifecycle } from './App.test-harness'
import { createTask } from './App.test-fixtures/tasks'


installAppTestLifecycle()
beforeEach(async () => {
  const { default: Region } = await import('./App.test-fixtures/ShellRegion.svelte')
  const regions = [
    [(await import('./components/shell/AppSidebar.svelte')).default, 'Application sidebar'],
    [(await import('./components/shell/IconRail.svelte')).default, 'Project navigation'],
    [(await import('./components/focus-board/FocusBoard.svelte')).default, 'Focus Board'],
    [(await import('./components/task-detail/TaskDetailView.svelte')).default, 'Task Detail'],
    [(await import('./components/settings/SettingsView.svelte')).default, 'Settings'],
    [(await import('./components/project/ProjectSetupDialog.svelte')).default, 'Project setup dialog'],
    [(await import('./components/feedback/toasts/ToastHost.svelte')).default, 'Global feedback'],
  ] as const
  for (const [component, label] of regions) {
    vi.mocked(component as unknown as Component).mockImplementation((anchor, props) =>
      (Region as unknown as Component)(anchor, Object.create(props ?? null, { label: { value: label, enumerable: true } })),
    )
  }
  localStorage.removeItem('appSidebarCollapsed')
  const { zenMode } = await import('./lib/zenMode')
  zenMode.set(false)
})
afterEach(async () => {
  localStorage.removeItem('appSidebarCollapsed')
  const { zenMode } = await import('./lib/zenMode')
  zenMode.set(false)
})

async function mountApp() {
  const { default: App } = await import('./App.svelte')
  const view = render(App)
  await vi.waitFor(() => expect(view.container.querySelector('[data-app-ready]')?.getAttribute('data-app-ready')).toBe('true'))
  return view
}

describe('application shell characterization', { timeout: 15_000 }, () => {
  it('places the resolved page in main while navigation and global feedback remain outside it', async () => {
    await mountApp()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('region', { name: 'Focus Board' })).toBeTruthy()
    expect(within(main).queryByRole('region', { name: 'Application sidebar' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Project navigation' })).toBeTruthy()
    expect(within(main).queryByRole('region', { name: 'Global feedback' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Global feedback' })).toBeTruthy()
  })

  it('preserves collapsed navigation and page-local project setup dialogs', async () => {
    localStorage.setItem('appSidebarCollapsed', 'true')
    await mountApp()
    await fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy()
    expect(localStorage.getItem('appSidebarCollapsed')).toBe('false')
    await fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(within(screen.getByRole('main')).getByRole('region', { name: 'Project setup dialog' })).toBeTruthy()
  })

  it('selects Task Detail and hides navigation in zen mode without hiding content or feedback', async () => {
    await mountApp()
    const stores = await import('./lib/stores')
    const { setMockTasks } = await import('./App.test-fixtures/stores')
    const task = createTask()
    setMockTasks([task])
    stores.selectedTaskId.set(task.id)
    await tick()
    expect(screen.getByRole('region', { name: 'Task Detail' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Focus Board' })).toBeNull()
    const { zenMode } = await import('./lib/zenMode')
    zenMode.set(true)
    await tick()
    expect(screen.queryByRole('region', { name: 'Application sidebar' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Project navigation' })).toBeNull()
    expect(within(screen.getByRole('main')).getByRole('region', { name: 'Task Detail' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Global feedback' })).toBeTruthy()
  })

  it('hides project navigation for global settings and replaces the board content', async () => {
    await mountApp()
    const { currentView } = await import('./lib/stores')
    currentView.set('global_settings')
    await tick()
    expect(within(screen.getByRole('main')).getByRole('region', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Focus Board' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Project navigation' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Application sidebar' })).toBeTruthy()
  })
})
