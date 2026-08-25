import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from './lib/types'
import { installAppTestLifecycle } from './App.test-harness'
import {
  installedPluginRows,
  mockExecutePluginCommand,
} from './App.test-fixtures/plugin-runtime'

describe('App shortcut behavior', () => {
  installAppTestLifecycle()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('CMD+SHIFT+F opens search tasks', async () => {
    const App = (await import('./App.svelte')).default
    const commandPaletteModule = await import('./components/shell/CommandPalette.svelte')

    render(App)

    await fireEvent.keyDown(window, { key: 'F', metaKey: true, shiftKey: true, bubbles: true })

    expect(commandPaletteModule.default).toHaveBeenCalled()
  })

  it('CMD+SHIFT+R triggers GitHub refresh through the plugin command shortcut', async () => {
    const App = (await import('./App.svelte')).default
    const ipc = await import('./lib/ipc')
    const pluginStore = await import('./lib/plugin/pluginStore')

    vi.mocked(ipc.forceGithubSync).mockResolvedValue({
      new_comments: 0,
      ci_changes: 0,
      review_changes: 0,
      pr_changes: 0,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
      outcome: 'completed',
    })

    render(App)

    await vi.waitFor(() => {
      expect(installedPluginRows.some((row) => row.id === 'com.openforge.github-sync')).toBe(true)
    })
    pluginStore.enabledPluginIds.set(new Set(['com.openforge.github-sync']))
    pluginStore.runtimeContributionSources.set(new Map([[
      'com.openforge.github-sync',
      { pluginId: 'com.openforge.github-sync', commands: [{ id: 'refresh', title: 'Refresh Pull Requests', shortcut: 'Cmd+Shift+R' }] },
    ]]))

    await fireEvent.keyDown(window, { key: 'R', metaKey: true, shiftKey: true, bubbles: true })

    await vi.waitFor(() => {
      expect(mockExecutePluginCommand).toHaveBeenCalledWith('com.openforge.github-sync', 'refresh')
    })
  })

  it('Shift+/ opens the keyboard shortcuts dialog', async () => {
    const App = (await import('./App.svelte')).default

    render(App)

    await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

    const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
    expect(screen.getByText('Global')).toBeTruthy()
    expect(screen.getByText('Vim navigation')).toBeTruthy()
    expect(screen.getByText('Board')).toBeTruthy()
    expect(screen.getByText('Board filters')).toBeTruthy()
    expect(dialog.textContent).toContain('⌘1⌘2⌘3')
    expect(dialog.textContent).not.toContain('Left / right column')
    expect(dialog.textContent).not.toContain('Toggle backlog')
    expect(dialog.textContent).not.toContain('Toggle done drawer')
    expect(dialog.textContent).not.toContain('// global')
    expect(dialog.textContent).not.toContain('// vim navigation')
    expect(dialog.textContent).not.toContain('// board')
  })

  it('presents alternative chords for one action as separate options rather than one long chord', async () => {
    const App = (await import('./App.svelte')).default

    render(App)

    await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

    const dialog = screen.getByRole('dialog')
    const normalized = dialog.textContent?.replace(/\s+/g, '') ?? ''

    expect(normalized).toContain('Attentionoverview⌘Eor⌘;')
  })

  it('shows task view shortcut section without a // prefix when a task is selected', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const selectedTask: Task = {
      id: 'task-123',
      initial_prompt: 'Selected task',
      prompt: null,
      title: null,
      title_source: null,
      title_generated_at: null,
      status: 'doing',
      agent: null,
      permission_mode: null,
      worktree_source: null,
      worktree_branch: null,
      source_ticket_url: null,
      depends_on: [],
      project_id: 'proj-1',
      created_at: 1000,
      updated_at: 1000,
    }
    stores.tasks.set([selectedTask])
    stores.selectedTaskId.set(selectedTask.id)

    render(App)

    await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

    const dialog = screen.getByRole('dialog')
    expect(screen.getByText('Task view')).toBeTruthy()
    expect(screen.getByText('Agent / Review / Terminal (if available)')).toBeTruthy()
    expect(dialog.textContent).not.toContain('Code / Review / Terminal')
    expect(dialog.textContent).not.toContain('Focus agent')
    expect(dialog.textContent).not.toContain('New terminal tab')
    // Scoped to the task view section: ⌘E is a global shortcut (attention overview), so
    // a dialog-wide assertion would no longer distinguish a returning "Focus agent" row
    // from an unrelated global binding.
    const taskViewSection = screen.getByText('Task view').parentElement
    expect(taskViewSection?.textContent).not.toContain('⌘E')
    expect(taskViewSection?.textContent).not.toContain('⌘T')
    expect(dialog.textContent).not.toContain('// task view')
  })

  it('shows the registered file quick-open shortcut in keyboard shortcuts help', async () => {
    const App = (await import('./App.svelte')).default

    render(App)

    await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

    const filesRow = screen.getByText('Files').closest('div')

    expect(filesRow?.textContent).toContain('⌘P')
  })

  it('Shift+/ does NOT open dialog when input is focused', async () => {
    const App = (await import('./App.svelte')).default
    render(App)

    // Create and focus an input element
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    // Dispatch ? key and check if preventDefault was called
    const event = new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true })
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    // preventDefault should NOT be called (handler should not run)
    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('s does NOT navigate when input is focused', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    stores.currentView.set('board')
    render(App)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    expect(get(stores.currentView)).toBe('board')
  })

  it('Shift+/ opens dialog when input is NOT focused', async () => {
    const App = (await import('./App.svelte')).default
    render(App)

    // Ensure no stray input holds focus from a previous test
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    await fireEvent.keyDown(window, { key: '?', shiftKey: true, bubbles: true })

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
  })
})
