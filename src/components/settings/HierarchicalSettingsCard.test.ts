import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_PR_REVIEW_GUIDANCE, DEFAULT_PR_WALKTHROUGH_GUIDANCE } from '../../lib/prGuidanceDefaults'
import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'

const baseValues: Record<string, string> = {
  task_display_title_metadata_updates_enabled: 'false',
  ai_provider: 'claude-code',
  use_worktrees: 'true',
  task_id_prefix: 'WEB',
  github_poll_interval: '60',
  pr_review_guidance: DEFAULT_PR_REVIEW_GUIDANCE,
  pr_walkthrough_guidance: DEFAULT_PR_WALKTHROUGH_GUIDANCE,
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
    expect(screen.queryByTestId('task_display_title_metadata_updates_enabled')).not.toBeNull()
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
          task_display_title_metadata_updates_enabled: null,
          ai_provider: 'claude-code',
        },
        onChange: vi.fn(),
        onResetSetting,
      },
    })

    expect(screen.getByTestId('status-task_display_title_metadata_updates_enabled').textContent).toContain('Inherited')
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
    expect(screen.queryByTestId('task_display_title_metadata_updates_enabled')).not.toBeNull()
    expect(screen.queryByTestId('task_id_prefix')).not.toBeNull()
  })
})

describe('HierarchicalSettingsCard long-text settings', () => {
  it('gives long-text settings the full card width instead of the narrow control column', () => {
    render(HierarchicalSettingsCard, {
      props: { mode: 'global', values: baseValues, onChange: vi.fn() },
    })

    expect(screen.getByTestId('row-pr_review_guidance').dataset.layout).toBe('stacked')
    expect(screen.getByTestId('row-task_id_prefix').dataset.layout).toBe('split')
  })

  it('expands and collapses a long-text setting from a single button', async () => {
    render(HierarchicalSettingsCard, {
      props: { mode: 'global', values: baseValues, onChange: vi.fn() },
    })

    const collapsed = screen.getByTestId('expand-pr_review_guidance')
    expect(collapsed.getAttribute('aria-expanded')).toBe('false')
    expect(collapsed.textContent).toContain('Expand')

    await fireEvent.click(collapsed)
    const expanded = screen.getByTestId('expand-pr_review_guidance')
    expect(expanded.getAttribute('aria-expanded')).toBe('true')
    expect(expanded.textContent).toContain('Collapse')

    await fireEvent.click(expanded)
    expect(screen.getByTestId('expand-pr_review_guidance').getAttribute('aria-expanded')).toBe('false')
  })

  it('offers reset to default in global mode only once the value drifts from the shipped default', async () => {
    const onChange = vi.fn()
    const { rerender } = render(HierarchicalSettingsCard, {
      props: { mode: 'global', values: baseValues, onChange },
    })

    expect(screen.queryByTestId('reset-default-pr_review_guidance')).toBeNull()

    await rerender({
      mode: 'global',
      values: { ...baseValues, pr_review_guidance: 'Hand-edited prompt' },
      onChange,
    })

    await fireEvent.click(screen.getByTestId('reset-default-pr_review_guidance'))
    expect(onChange).toHaveBeenCalledWith('pr_review_guidance', DEFAULT_PR_REVIEW_GUIDANCE)
  })

  it('warns above each PR guidance field about what a skill reference can reach', () => {
    render(HierarchicalSettingsCard, { props: { mode: 'global', values: baseValues, onChange: vi.fn() } })

    for (const key of ['pr_review_guidance', 'pr_walkthrough_guidance']) {
      // The limits a user would otherwise only discover by hitting them: the
      // feature is Claude Code only, and marketplace skills don't resolve.
      const notice = screen.getByTestId(`notice-${key}`).textContent ?? ''
      expect(notice).toContain('Claude Code provider')
      expect(notice).toContain('~/.claude/skills')
      expect(notice).toContain('.claude/skills')
      expect(notice).toContain('plugin or marketplace')
    }
  })

  it('leaves settings without a notice unadorned', () => {
    render(HierarchicalSettingsCard, { props: { mode: 'global', values: baseValues, onChange: vi.fn() } })

    expect(screen.queryByTestId('notice-task_id_prefix')).toBeNull()
  })

  it('keeps the project card on reset-to-global rather than reset-to-default', () => {
    render(HierarchicalSettingsCard, {
      props: {
        mode: 'project',
        values: { ...baseValues, pr_review_guidance: 'Project prompt' },
        overrides: { pr_review_guidance: 'Project prompt' },
        onChange: vi.fn(),
        onResetSetting: vi.fn(),
      },
    })

    expect(screen.queryByTestId('reset-default-pr_review_guidance')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Reset AI Review Instructions to global default' }),
    ).toBeTruthy()
  })
})
