import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'

import NonApplicationFilesToggle from './NonApplicationFilesToggle.svelte'

describe('NonApplicationFilesToggle', () => {
  it('labels the control', () => {
    render(NonApplicationFilesToggle, { props: { checked: false, hiddenCount: 3, onToggle: vi.fn() } })
    expect(screen.getByText('Also include non-application files')).toBeTruthy()
  })

  it('uses the compact checkbox size', () => {
    render(NonApplicationFilesToggle, { props: { checked: false, hiddenCount: 3, onToggle: vi.fn() } })

    expect(screen.getByRole('checkbox').parentElement?.getAttribute('data-size')).toBe('xs')
  })

  it('shows the hidden count only while non-application files are hidden', () => {
    const { rerender } = render(NonApplicationFilesToggle, {
      props: { checked: false, hiddenCount: 3, onToggle: vi.fn() },
    })
    expect(screen.getByText('(3 hidden)')).toBeTruthy()

    rerender({ checked: true, hiddenCount: 3, onToggle: vi.fn() })
    expect(screen.queryByText('(3 hidden)')).toBeNull()
  })

  it('omits the hidden count when nothing is hidden', () => {
    render(NonApplicationFilesToggle, { props: { checked: false, hiddenCount: 0, onToggle: vi.fn() } })
    expect(screen.queryByText(/hidden\)/)).toBeNull()
  })

  it('reports the new checkbox state when toggled on', async () => {
    const onToggle = vi.fn()
    render(NonApplicationFilesToggle, { props: { checked: false, hiddenCount: 3, onToggle } })
    await fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('reports the new checkbox state when toggled off', async () => {
    const onToggle = vi.fn()
    render(NonApplicationFilesToggle, { props: { checked: true, hiddenCount: 3, onToggle } })
    await fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })
})
