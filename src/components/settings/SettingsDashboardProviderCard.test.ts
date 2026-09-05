import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { chooseSelectOption, openSelect } from '../../test-utils/select'
import SettingsDashboardProviderCard from './SettingsDashboardProviderCard.svelte'

const providers = [
  {
    pluginId: 'planning-plugin',
    contributionId: 'dashboard',
    qualifiedId: 'planning-plugin.dashboard',
    target: 'project.dashboard' as const,
    title: 'Planning',
    icon: 'panels-top-left',
  },
]
const taskProviders = [
  {
    pluginId: 'planning-plugin',
    contributionId: 'task-workspace',
    qualifiedId: 'planning-plugin.task-workspace',
    target: 'task.detail' as const,
    title: 'Task workspace',
    icon: null,
  },
]

describe('SettingsDashboardProviderCard', () => {
  it('offers an app-wide default for the project dashboard replacement target', async () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'global',
        selectedProviderId: 'core',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('button', { name: 'Default project dashboard' }) as HTMLButtonElement
    await openSelect(select)
    expect(screen.getAllByRole('option').map(option => option.textContent?.trim())).toEqual([
      'OpenForge',
      'Planning — Provided by planning-plugin',
    ])
    expect(select.textContent).toContain('OpenForge')
  })

  it('updates the displayed provider when the selected provider changes', async () => {
    const onProviderChange = vi.fn()
    const view = render(SettingsDashboardProviderCard, {
      props: {
        scope: 'global',
        selectedProviderId: 'core',
        providers,
        onProviderChange,
      },
    })

    const select = screen.getByRole('button', { name: 'Default project dashboard' }) as HTMLButtonElement
    expect(select.textContent).toContain('OpenForge')

    await view.rerender({
      scope: 'global',
      selectedProviderId: 'planning-plugin.dashboard',
      providers,
      onProviderChange,
    })

    expect(select.textContent).toContain('Planning')
  })

  it('offers project inheritance, OpenForge, and compatible plugin providers', async () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'project',
        selectedProviderId: 'inherit',
        inheritedProviderId: 'planning-plugin.dashboard',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('button', { name: 'Project dashboard' }) as HTMLButtonElement
    await openSelect(select)
    expect(screen.getAllByRole('option').map(option => option.textContent?.trim())).toEqual([
      'Use global default (Planning)',
      'OpenForge',
      'Planning — Provided by planning-plugin',
    ])
    expect(select.textContent).toContain('Use global default')
  })

  it('keeps an unavailable stored provider visible without changing the selection', async () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'project',
        selectedProviderId: 'missing-plugin.dashboard',
        inheritedProviderId: 'core',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('button', { name: 'Project dashboard' }) as HTMLButtonElement
    expect(select.textContent).toContain('missing-plugin.dashboard (unavailable)')
    await openSelect(select)
    expect(screen.getByRole('option', { name: 'missing-plugin.dashboard (unavailable)' })).toBeTruthy()
  })

  it('shows an unavailable inherited choice in the project inheritance option', async () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'project',
        selectedProviderId: 'inherit',
        inheritedProviderId: 'missing-plugin.dashboard',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    await openSelect(screen.getByRole('button', { name: 'Project dashboard' }))
    expect(screen.getByRole('option', {
      name: 'Use global default (missing-plugin.dashboard unavailable)',
    })).toBeTruthy()
  })

  it('lets the user change the configured provider', async () => {
    const onProviderChange = vi.fn()
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'project',
        selectedProviderId: 'planning-plugin.dashboard',
        inheritedProviderId: 'core',
        providers,
        onProviderChange,
      },
    })

    await chooseSelectOption(screen.getByRole('button', { name: 'Project dashboard' }), /^Use global default/)
    expect(onProviderChange).toHaveBeenCalledWith('inherit')
  })

  it('restores the committed provider when persistence fails', async () => {
    let rejectChange: ((error: Error) => void) | undefined
    const onProviderChange = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectChange = reject
    }))
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'global',
        selectedProviderId: 'core',
        providers,
        onProviderChange,
      },
    })

    const select = screen.getByRole('button', { name: 'Default project dashboard' }) as HTMLButtonElement
    await chooseSelectOption(select, /Planning — Provided by planning-plugin/)
    expect(select.disabled).toBe(true)

    rejectChange?.(new Error('write failed'))
    await waitFor(() => {
      expect(select.textContent).toContain('OpenForge')
      expect(select.disabled).toBe(false)
    })
  })

  it('offers the task detail target through the same global preference control', async () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'global',
        target: 'task.detail',
        selectedProviderId: 'core',
        providers: taskProviders,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('button', { name: 'Default task workspace' }) as HTMLButtonElement
    await openSelect(select)
    expect(screen.getAllByRole('option').map(option => option.textContent?.trim())).toEqual([
      'OpenForge',
      'Task workspace — Provided by planning-plugin',
    ])
  })
})
