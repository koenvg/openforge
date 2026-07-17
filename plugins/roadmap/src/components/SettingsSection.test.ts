import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import SettingsSection from './SettingsSection.svelte'
import { API_KEY_STORAGE_KEY } from '../lib/settings/apiKey'

function renderSection(get = vi.fn().mockResolvedValue(null), set = vi.fn(), del = vi.fn()) {
  const api = { storage: { global: { get, set, delete: del } } }
  render(SettingsSection, { props: { api, context: {} } as never })
  return { get, set, del }
}

describe('SettingsSection', () => {
  it('shows an existing key so the user can tell one is configured', async () => {
    renderSection(vi.fn().mockResolvedValue('sk-ant-stored'))
    await waitFor(() => expect(screen.getByDisplayValue('sk-ant-stored')).toBeTruthy())
  })

  it('starts empty when no key is stored', async () => {
    renderSection()
    await waitFor(() => expect((screen.getByLabelText(/API key/i) as HTMLInputElement).value).toBe(''))
  })

  it('saves the key when the field loses focus', async () => {
    const { set } = renderSection()
    const input = await screen.findByLabelText(/API key/i)

    await fireEvent.input(input, { target: { value: 'sk-ant-new' } })
    await fireEvent.blur(input)

    await waitFor(() => expect(set).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, 'sk-ant-new'))
  })

  it('removes the key when the field is cleared, which re-gates Refine', async () => {
    const { set, del } = renderSection(vi.fn().mockResolvedValue('sk-ant-stored'))
    const input = await screen.findByLabelText(/API key/i)

    await fireEvent.input(input, { target: { value: '' } })
    await fireEvent.blur(input)

    await waitFor(() => expect(del).toHaveBeenCalledWith(API_KEY_STORAGE_KEY))
    expect(set).not.toHaveBeenCalled()
  })

  it('does not write when the key is unchanged', async () => {
    const { set, del } = renderSection(vi.fn().mockResolvedValue('sk-ant-stored'))
    const input = await screen.findByLabelText(/API key/i)

    await fireEvent.blur(input)

    await waitFor(() => expect(screen.getByDisplayValue('sk-ant-stored')).toBeTruthy())
    expect(set).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('masks the key rather than showing it in the clear', async () => {
    renderSection(vi.fn().mockResolvedValue('sk-ant-stored'))
    const input = (await screen.findByLabelText(/API key/i)) as HTMLInputElement
    expect(input.type).toBe('password')
  })

  it('surfaces a save failure instead of silently dropping the key', async () => {
    const set = vi.fn().mockRejectedValue(new Error('store is read-only'))
    renderSection(vi.fn().mockResolvedValue(null), set)
    const input = await screen.findByLabelText(/API key/i)

    await fireEvent.input(input, { target: { value: 'sk-ant-new' } })
    await fireEvent.blur(input)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('store is read-only'))
  })
})
