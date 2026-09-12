import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Progress from './Progress.svelte'

describe('Progress public feedback', () => {
  it('uses native normalization and becomes indeterminate when value is omitted', async () => {
    const { rerender } = render(Progress, { value: 25, max: 50, 'aria-label': 'Download', title: 'Model download' })
    const progress = screen.getByRole('progressbar', { name: 'Download' }) as HTMLProgressElement
    expect(progress).toBeInstanceOf(HTMLProgressElement)
    expect(progress.value).toBe(25)
    expect(progress.max).toBe(50)
    expect(progress.position).toBe(.5)
    expect(progress.title).toBe('Model download')
    await rerender({ value: 200 })
    expect(progress.value).toBe(50)
    await rerender({ value: -10 })
    expect(progress.value).toBe(0)
    await rerender({ max: 0, value: 2 })
    expect(progress.max).toBe(1)
    expect(progress.value).toBe(1)
    await rerender({ value: undefined })
    expect(screen.getByRole('progressbar', { name: 'Download' })).toBe(progress)
    expect(progress.hasAttribute('value')).toBe(false)
    expect(progress.position).toBe(-1)
    expect(progress.hasAttribute('aria-valuenow')).toBe(false)
    expect(progress.textContent).not.toContain('%')
  })
})
