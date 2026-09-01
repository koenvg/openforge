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

describe('SettingsDashboardProviderCard', () => {
  it('lists OpenForge and compatible dashboard providers without selecting a plugin by default', () => {
    render(SettingsDashboardProviderCard, {
      props: {
        selectedProviderId: 'core',
        providers,
        onProviderChange: vi.fn(),
      },
    })

    const select = screen.getByRole('combobox', { name: 'Project dashboard' }) as HTMLSelectElement
    expect(Array.from(select.options).map(option => [option.value, option.textContent])).toEqual([
      ['core', 'OpenForge'],
      ['planning-plugin.dashboard', 'Planning'],
    ])
    expect(select.value).toBe('core')
  })

  it('lets the user select a plugin provider or return to OpenForge', async () => {
    const onProviderChange = vi.fn()
    render(SettingsDashboardProviderCard, {
      props: {
        selectedProviderId: 'planning-plugin.dashboard',
        providers,
        onProviderChange,
      },
    })

    const select = screen.getByRole('combobox', { name: 'Project dashboard' })
    await fireEvent.change(select, { target: { value: 'core' } })
    expect(onProviderChange).toHaveBeenCalledWith('core')
  })

  it('restores the committed provider when persistence fails', async () => {
    let rejectChange: ((error: Error) => void) | undefined
    const onProviderChange = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectChange = reject
    }))
    render(SettingsDashboardProviderCard, {
      props: {
        selectedProviderId: 'core',
        providers,
        onProviderChange,
      },
    })

    const select = screen.getByRole('combobox', { name: 'Project dashboard' }) as HTMLSelectElement
    await fireEvent.change(select, { target: { value: 'planning-plugin.dashboard' } })
    expect(select.disabled).toBe(true)

    rejectChange?.(new Error('write failed'))
    await waitFor(() => {
      expect(select.value).toBe('core')
      expect(select.disabled).toBe(false)
    })
  })
})
