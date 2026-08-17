import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, it, expect, vi } from 'vitest'
import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'

const baseValues: Record<string, string> = {
  code_cleanup_tasks_enabled: 'false',
  task_display_title_metadata_updates_enabled: 'false',
  ai_provider: 'claude-code',
  use_worktrees: 'true',
  task_id_prefix: 'WEB',
  github_poll_interval: '60',
}

const pluginRows = [{ id: 'demo', name: 'Demo Plugin', enabled: true }]

describe('HierarchicalSettingsCard excludeKeys', () => {
  it('renders every project-applicable setting when nothing is excluded', () => {
    render(HierarchicalSettingsCard, {
      props: {
        mode: 'project',
        values: baseValues,
        pluginRows,
        onChange: vi.fn(),
        onPluginToggle: vi.fn(),
      },
    })

    expect(screen.queryByTestId('ai_provider')).not.toBeNull()
    expect(screen.queryByTestId('use_worktrees')).not.toBeNull()
    expect(screen.queryByTestId('plugin-default-demo')).not.toBeNull()
    expect(screen.queryByTestId('code_cleanup_tasks_enabled')).not.toBeNull()
  })

  it('explains inheritance and how to override in project mode', () => {
    render(HierarchicalSettingsCard, {
      props: {
        mode: 'project',
        values: baseValues,
        onChange: vi.fn(),
        onResetToGlobal: vi.fn(),
      },
    })

    expect(screen.getByText(/inherited from your global defaults/i)).toBeTruthy()
    expect(screen.getByText(/override it for this project only/i)).toBeTruthy()
  })

  it('identifies inherited and overridden rows and resets one override', async () => {
    const onResetSetting = vi.fn()
    render(HierarchicalSettingsCard, {
      props: {
        mode: 'project',
        values: baseValues,
        overrides: {
          code_cleanup_tasks_enabled: null,
          ai_provider: 'claude-code',
        },
        onChange: vi.fn(),
        onResetSetting,
      },
    })

    expect(screen.getByTestId('status-code_cleanup_tasks_enabled').textContent).toContain('Inherited')
    expect(screen.getByTestId('status-ai_provider').textContent).toContain('Overridden')

    await fireEvent.click(screen.getByRole('button', { name: 'Reset AI Provider to global default' }))
    expect(onResetSetting).toHaveBeenCalledWith('ai_provider')
  })

  it('renders a supplied provider field snippet in place of the default ai_provider select', () => {
    render(HierarchicalSettingsCard, {
      props: {
        mode: 'project',
        values: baseValues,
        onChange: vi.fn(),
        onResetToGlobal: vi.fn(),
        providerField: createRawSnippet(() => ({
          render: () => '<div data-testid="custom-provider-field">custom provider</div>',
        })),
      },
    })

    expect(screen.getByTestId('custom-provider-field')).toBeTruthy()
    // The default registry select for ai_provider must not also render.
    expect(screen.queryByTestId('ai_provider')).toBeNull()
  })

  it('renders the default ai_provider select when no provider field snippet is supplied (global mode)', () => {
    render(HierarchicalSettingsCard, {
      props: {
        mode: 'global',
        values: baseValues,
        onChange: vi.fn(),
      },
    })

    expect(screen.queryByTestId('ai_provider')).not.toBeNull()
    expect(screen.queryByTestId('custom-provider-field')).toBeNull()
  })

  it('omits excluded settings (including the plugins subsection) from the project card', () => {
    render(HierarchicalSettingsCard, {
      props: {
        mode: 'project',
        values: baseValues,
        pluginRows,
        onChange: vi.fn(),
        onPluginToggle: vi.fn(),
        excludeKeys: ['ai_provider', 'use_worktrees', 'plugins'],
      },
    })

    // Settings with a dedicated home elsewhere must not be duplicated here.
    expect(screen.queryByTestId('ai_provider')).toBeNull()
    expect(screen.queryByTestId('use_worktrees')).toBeNull()
    expect(screen.queryByTestId('plugin-default-demo')).toBeNull()

    // Settings whose only home is the grouped card remain visible.
    expect(screen.queryByTestId('code_cleanup_tasks_enabled')).not.toBeNull()
    expect(screen.queryByTestId('task_id_prefix')).not.toBeNull()
  })
})
