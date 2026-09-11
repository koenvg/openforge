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

  it('stretches the knob while pressed without committing until release', async () => {
    render(Switch, {
      props: {
        label: 'Enable notifications',
      },
    })

    const control = screen.getByRole('switch', { name: 'Enable notifications' })
    const track = document.querySelector('.of-switch-track')
    const knob = document.querySelector('.of-switch-knob') as HTMLElement

    expect(track).toBeTruthy()
    expect(knob.style.width).toBe('22px')

    await fireEvent.pointerDown(track!, { pointerId: 1, clientX: 4, isPrimary: true, timeStamp: 0 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    expect(control).toHaveProperty('checked', false)
    expect(Number.parseFloat(knob.style.width)).toBeGreaterThan(22)

    await fireEvent.pointerUp(track!, { pointerId: 1, clientX: 4, timeStamp: 16 })
    expect(control).toHaveProperty('checked', false)
  })

  it('commits a drag to the nearest side and suppresses the follow-up click', async () => {
    const onCheckedChange = vi.fn()
    render(Switch, {
      props: {
        label: 'Enable notifications',
        onCheckedChange,
      },
    })

    const control = screen.getByRole('switch', { name: 'Enable notifications' })
    const track = document.querySelector('.of-switch-track')

    await fireEvent.pointerDown(track!, { pointerId: 1, clientX: 4, isPrimary: true, timeStamp: 0 })
    await fireEvent.pointerMove(track!, { pointerId: 1, clientX: 40, timeStamp: 16 })
    await fireEvent.pointerUp(track!, { pointerId: 1, clientX: 40, timeStamp: 16 })

    expect(control).toHaveProperty('checked', true)
    expect(onCheckedChange).toHaveBeenCalledOnce()
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    await fireEvent.click(track!)
    expect(control).toHaveProperty('checked', true)
    expect(onCheckedChange).toHaveBeenCalledOnce()
  })

  it('lets a quick flick commit in its travel direction', async () => {
    render(Switch, {
      props: {
        label: 'Enable notifications',
      },
    })

    const control = screen.getByRole('switch', { name: 'Enable notifications' })
    const track = document.querySelector('.of-switch-track')

    await fireEvent.pointerDown(track!, { pointerId: 1, clientX: 4, isPrimary: true, timeStamp: 0 })
    await fireEvent.pointerMove(track!, { pointerId: 1, clientX: 8, timeStamp: 4 })
    await fireEvent.pointerUp(track!, { pointerId: 1, clientX: 8, timeStamp: 8 })

    expect(control).toHaveProperty('checked', true)
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
