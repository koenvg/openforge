import { createRawSnippet, tick } from 'svelte'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import IconButton from './IconButton.svelte'

const children = createRawSnippet(() => ({
  render: () => '<svg aria-hidden="true"></svg>',
}))

describe('plugin-sdk IconButton', () => {
  beforeEach(() => {
    // jsdom does not reliably update :focus-visible after synthetic pointer input.
    // Native keyboard/touch modality is covered by Tooltip.browser.test.ts.
    const matches = HTMLElement.prototype.matches
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (selector) {
      return selector === ':focus-visible' ? this === document.activeElement : matches.call(this, selector)
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('preserves the native default submit type and explicit button types', async () => {
    const view = render(IconButton, { props: { label: 'Submit review', children } })
    const button = screen.getByRole('button', { name: 'Submit review' }) as HTMLButtonElement
    expect(button.type).toBe('submit')
    await view.rerender({ type: 'button' })
    expect(button.type).toBe('button')
    expect(screen.getByRole('button', { name: 'Submit review' })).toBe(button)
  })

  it('shows its label on keyboard focus without adding a second button', async () => {
    render(IconButton, { props: { label: 'Refresh tasks', children } })
    const button = screen.getByRole('button', { name: 'Refresh tasks' })
    button.focus()

    expect((await screen.findByRole('tooltip')).textContent).toBe('Refresh tasks')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(document.activeElement).toBe(button)
  })

  it('can opt out of automatic tooltips without losing its name or explicit title', async () => {
    render(IconButton, { props: { label: 'Refresh tasks', tooltip: false, title: 'Custom native title', children } })
    const button = screen.getByRole('button', { name: 'Refresh tasks' })
    await fireEvent.focus(button)

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button.getAttribute('title')).toBe('Custom native title')
  })

  it('uses the current label rather than a duplicate native title and preserves descriptions', async () => {
    const view = render(IconButton, {
      props: { label: 'Refresh tasks', title: 'Refresh tasks', 'aria-describedby': 'existing-help', children },
    })
    const button = screen.getByRole('button', { name: 'Refresh tasks' })
    button.focus()
    const tooltip = await screen.findByRole('tooltip')

    expect(button.getAttribute('title')).toBeNull()
    expect(button.getAttribute('aria-describedby')?.split(' ')).toEqual(['existing-help', tooltip.id])
    await view.rerender({ label: 'Reload tasks' })
    expect(tooltip.textContent).toBe('Reload tasks')
    expect(screen.getByRole('button', { name: 'Reload tasks' })).toBe(button)
  })

  it.each(['disabled', 'loading'] as const)('closes a visible tooltip when the button becomes %s', async (state) => {
    const onClick = vi.fn()
    const view = render(IconButton, { props: { label: 'Refresh tasks', children, onClick } })
    const button = screen.getByRole('button', { name: 'Refresh tasks' })
    button.focus()
    await screen.findByRole('tooltip')

    await view.rerender({ [state]: true })
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('cancels a pending tooltip when its trigger is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = render(IconButton, { props: { label: 'Refresh tasks', children } })
    await tick()
    await fireEvent.pointerEnter(screen.getByRole('button', { name: 'Refresh tasks' }), { pointerType: 'mouse' })
    await vi.advanceTimersByTimeAsync(299)
    expect(screen.queryByRole('tooltip')).toBeNull()
    view.unmount()
    await vi.advanceTimersByTimeAsync(500)
    await tick()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('removes an open tooltip with its trigger', async () => {
    const view = render(IconButton, { props: { label: 'Refresh tasks', children } })
    screen.getByRole('button', { name: 'Refresh tasks' }).focus()
    await screen.findByRole('tooltip')
    view.unmount()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('preserves both action callbacks and event cancellation when activating an open tooltip', async () => {
    const onclick = vi.fn((event: MouseEvent) => event.preventDefault())
    const onClick = vi.fn()
    render(IconButton, { props: { label: 'Refresh tasks', children, onclick, onClick } })
    const button = screen.getByRole('button', { name: 'Refresh tasks' })
    button.focus()
    await screen.findByRole('tooltip')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    await tick()

    expect(onclick).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('renders a named native button and invokes onClick', async () => {
    const onClick = vi.fn()

    render(IconButton, {
      props: {
        label: 'Refresh tasks',
        children,
        onClick,
        type: 'button',
      },
    })

    const button = screen.getByRole('button', { name: 'Refresh tasks' })
    await fireEvent.click(button)

    expect(button).toBeInstanceOf(HTMLButtonElement)
    expect(button.getAttribute('type')).toBe('button')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('supports a loading label and native busy semantics', () => {
    render(IconButton, {
      props: {
        label: 'Refresh tasks',
        loading: true,
        loadingLabel: 'Refreshing tasks',
        children,
      },
    })

    const button = screen.getByRole('button', { name: 'Refreshing tasks' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })
})
