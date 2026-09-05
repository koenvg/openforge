import { cleanup, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import AddTaskDialog from './AddTaskDialog.svelte'
import { getProjectConfig } from '../lib/ipc'
import { DARK_THEME, LIGHT_THEME, type ThemeDefinition } from '../lib/themeContract'
import { createThemeDocumentAdapter } from '../lib/themeDocumentAdapter'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn(),
  updateTaskInitialPrompt: vi.fn(),
  getConfig: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([]),
  repoHasCommits: vi.fn().mockResolvedValue(true),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/stores', () => ({
  activeProjectId: writable('test-project-id'),
}))

const BUILT_IN_THEMES = [LIGHT_THEME, DARK_THEME] as const

describe.each(BUILT_IN_THEMES)('AddTaskDialog loading state in $appearance mode', (theme: ThemeDefinition) => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    createThemeDocumentAdapter(document.documentElement).apply(theme)
  })

  it('uses the active theme token while task defaults load', async () => {
    let resolveProjectConfig: (value: string | null) => void = () => {}
    vi.mocked(getProjectConfig).mockImplementation((_projectId: string, key: string) =>
      key === 'use_worktrees'
        ? new Promise((resolve) => {
            resolveProjectConfig = resolve
          })
        : Promise.resolve(null),
    )

    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    const loading = await screen.findByText('Loading task defaults…')
    expect(document.documentElement.dataset.theme).toBe(theme.id)
    expect(loading.classList.contains('text-[var(--of-text-secondary)]')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--of-text-secondary')).toBe(theme.tokens.textSecondary)

    resolveProjectConfig(null)
  })
})
