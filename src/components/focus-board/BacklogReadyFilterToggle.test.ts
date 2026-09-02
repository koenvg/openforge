import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import BacklogReadyFilterToggle from './BacklogReadyFilterToggle.svelte'

describe('BacklogReadyFilterToggle', () => {
  it('renders a keyboard-operable toggle with the ready Task count and pressed state', async () => {
    const onToggle = vi.fn()
    const view = render(BacklogReadyFilterToggle, {
      props: { active: false, readyCount: 4, onToggle },
    })

    const toggle = screen.getByRole('button', { name: /Ready to start 4/i })
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.tabIndex).toBe(0)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.querySelector('.lucide-check')).toBeNull()

    await fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledOnce()

    await view.rerender({ active: true, readyCount: 4, onToggle })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.querySelector('.lucide-check')).toBeTruthy()
  })

  it('reports a zero ready Task count without disabling recovery', () => {
    render(BacklogReadyFilterToggle, {
      props: { active: true, readyCount: 0, onToggle: vi.fn() },
    })

    const toggle = screen.getByRole('button', { name: /Ready to start 0/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.hasAttribute('disabled')).toBe(false)
  })
})
