import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import SettingsShepherdCard from './SettingsShepherdCard.svelte'

function renderCard(shepherdEnabled: boolean, onShepherdToggle = vi.fn()) {
  return render(SettingsShepherdCard, {
    props: { shepherdEnabled, onShepherdToggle },
  })
}

describe('SettingsShepherdCard', () => {
  it('renders "Task Shepherd" title', () => {
    renderCard(false)
    expect(screen.getByText('Task Shepherd')).toBeTruthy()
  })

  it('renders "Experimental" badge text', () => {
    renderCard(false)
    expect(screen.getByText('Experimental')).toBeTruthy()
  })

  it('renders toggle with data-testid="shepherd-toggle"', () => {
    renderCard(false)
    expect(screen.getByTestId('shepherd-toggle')).toBeTruthy()
  })

  it('toggle is checked when shepherdEnabled=true', () => {
    renderCard(true)
    const toggle = screen.getByTestId('shepherd-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('toggle is unchecked when shepherdEnabled=false', () => {
    renderCard(false)
    const toggle = screen.getByTestId('shepherd-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('calls onShepherdToggle when toggle changes', async () => {
    const onShepherdToggle = vi.fn()
    renderCard(false, onShepherdToggle)
    const toggle = screen.getByTestId('shepherd-toggle')
    await fireEvent.change(toggle)
    expect(onShepherdToggle).toHaveBeenCalledOnce()
  })
})
