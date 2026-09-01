import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Switch from './Switch.svelte'
import SwitchTestWrapper from './SwitchTestWrapper.svelte'

describe('plugin-sdk Switch', () => {
  it('binds its native checked state and reports changes', async () => {
    render(SwitchTestWrapper)

    const control = screen.getByRole('switch', { name: 'Enable notifications' })
    await fireEvent.click(control)

    expect(control).toBeInstanceOf(HTMLInputElement)
    expect(control).toHaveProperty('checked', true)
    expect(screen.getByRole('status', { name: 'Bound state' }).textContent).toBe('true')
    expect(screen.getByRole('status', { name: 'Last change' }).textContent).toBe('true')
  })

  it('keeps disabled switches inert', async () => {
    const onCheckedChange = vi.fn()
    render(Switch, {
      props: {
        label: 'Enable notifications',
        disabled: true,
        onCheckedChange,
      },
    })

    const control = screen.getByRole('switch', { name: 'Enable notifications' })
    ;(control as HTMLInputElement).click()

    expect((control as HTMLInputElement).disabled).toBe(true)
    expect((control as HTMLInputElement).checked).toBe(false)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('links validation text and keeps native focus behavior', () => {
    render(Switch, {
      props: {
        label: 'Enable notifications',
        error: 'Notifications are unavailable.',
      },
    })

    const control = screen.getByRole('switch', { name: 'Enable notifications' })
    control.focus()

    expect(document.activeElement).toBe(control)
    expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Notifications are unavailable.')
  })
})
