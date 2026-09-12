import { createEvent, fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Switch from './Switch.svelte'
import SwitchTestWrapper from './SwitchTestWrapper.svelte'

function firePointer(
  target: Element,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  clientX: number,
  timeStamp: number,
): Promise<boolean> {
  const event = createEvent[type](target, { pointerId: 1, clientX, isPrimary: true })
  // timeStamp is read-only and ignored in event init. Set the clock on the dispatched event.
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  return fireEvent(target, event)
}

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

    await firePointer(track!, 'pointerDown', 4, 0)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    expect(control).toHaveProperty('checked', false)
    expect(Number.parseFloat(knob.style.width)).toBeGreaterThan(22)

    await firePointer(track!, 'pointerUp', 4, 16)
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

    await firePointer(track!, 'pointerDown', 4, 0)
    await firePointer(track!, 'pointerMove', 40, 16)
    await firePointer(track!, 'pointerUp', 40, 16)

    expect(control).toHaveProperty('checked', true)
    expect(onCheckedChange).toHaveBeenCalledOnce()
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    await fireEvent.click(track!)
    expect(control).toHaveProperty('checked', true)
    expect(onCheckedChange).toHaveBeenCalledOnce()
  })

  it.each([
    { name: 'quick flick on', checked: false, endX: 8, duration: 8, expected: true },
    { name: 'quick flick off', checked: true, endX: 0, duration: 8, expected: false },
    { name: 'slow short drag stays off', checked: false, endX: 8, duration: 80, expected: false },
    { name: 'slow short drag stays on', checked: true, endX: 0, duration: 80, expected: true },
  ])('$name', async ({ checked, endX, duration, expected }) => {
    const onCheckedChange = vi.fn()
    render(Switch, { props: { label: 'Enable notifications', checked, onCheckedChange } })

    const control = screen.getByRole('switch', { name: 'Enable notifications' })
    const track = document.querySelector('.of-switch-track')!
    const timestamps: number[] = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      track.addEventListener(type, (event) => timestamps.push(event.timeStamp))
    }

    // Four pixels does not cross the midpoint: only the fast gesture should commit.
    await firePointer(track, 'pointerDown', 4, 0)
    // A busy event loop must not turn the explicit 8ms flick into a slow drag.
    const stallUntil = performance.now() + 32
    while (performance.now() < stallUntil) { /* busy main thread */ }
    await firePointer(track, 'pointerMove', endX, duration / 2)
    expect(control).toHaveProperty('checked', checked)
    expect(onCheckedChange).not.toHaveBeenCalled()
    await firePointer(track, 'pointerUp', endX, duration)

    expect(timestamps).toEqual([0, duration / 2, duration])
    expect(control).toHaveProperty('checked', expected)
    if (expected !== checked) {
      expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(expected)
    } else {
      expect(onCheckedChange).not.toHaveBeenCalled()
    }
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
