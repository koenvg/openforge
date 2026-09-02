import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
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
  it('offers an app-wide default for the project dashboard replacement target', () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'global',
        selectedProviderId: 'core',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('combobox', { name: 'Default project dashboard' }) as HTMLSelectElement
    expect(Array.from(select.options).map(option => [option.value, option.textContent])).toEqual([
      ['core', 'OpenForge'],
      ['planning-plugin.dashboard', 'Planning'],
    ])
    expect(select.value).toBe('core')
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

    const select = screen.getByRole('combobox', { name: 'Default project dashboard' }) as HTMLSelectElement
    expect(select.value).toBe('core')

    await view.rerender({
      scope: 'global',
      selectedProviderId: 'planning-plugin.dashboard',
      providers,
      onProviderChange,
    })

    expect(select.value).toBe('planning-plugin.dashboard')
  })

  it('offers project inheritance, OpenForge, and compatible plugin providers', () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'project',
        selectedProviderId: 'inherit',
        inheritedProviderId: 'planning-plugin.dashboard',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('combobox', { name: 'Project dashboard' }) as HTMLSelectElement
    expect(Array.from(select.options).map(option => [option.value, option.textContent])).toEqual([
      ['inherit', 'Use global default (Planning)'],
      ['core', 'OpenForge'],
      ['planning-plugin.dashboard', 'Planning'],
    ])
    expect(select.value).toBe('inherit')
  })

  it('keeps an unavailable stored provider visible without changing the selection', () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'project',
        selectedProviderId: 'missing-plugin.dashboard',
        inheritedProviderId: 'core',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('combobox', { name: 'Project dashboard' }) as HTMLSelectElement
    expect(select.value).toBe('missing-plugin.dashboard')
    expect(screen.getByRole('option', { name: 'missing-plugin.dashboard (unavailable)' })).toBeTruthy()
  })

  it('shows an unavailable inherited choice in the project inheritance option', () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'project',
        selectedProviderId: 'inherit',
        inheritedProviderId: 'missing-plugin.dashboard',
        providers,
        onProviderChange: vi.fn(),
      },
    })

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

    await fireEvent.change(screen.getByRole('combobox', { name: 'Project dashboard' }), {
      target: { value: 'inherit' },
    })
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

    const select = screen.getByRole('combobox', { name: 'Default project dashboard' }) as HTMLSelectElement
    await fireEvent.change(select, { target: { value: 'planning-plugin.dashboard' } })
    expect(select.disabled).toBe(true)

    rejectChange?.(new Error('write failed'))
    await waitFor(() => {
      expect(select.value).toBe('core')
      expect(select.disabled).toBe(false)
    })
  })

  it('offers the task detail target through the same global preference control', () => {
    render(SettingsDashboardProviderCard, {
      props: {
        scope: 'global',
        target: 'task.detail',
        selectedProviderId: 'core',
        providers: taskProviders,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('combobox', { name: 'Default task workspace' }) as HTMLSelectElement
    expect(Array.from(select.options).map(option => [option.value, option.textContent])).toEqual([
      ['core', 'OpenForge'],
      ['planning-plugin.task-workspace', 'Task workspace'],
    ])
  })
})
