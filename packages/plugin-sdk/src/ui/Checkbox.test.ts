import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Checkbox from './Checkbox.svelte'
import CheckboxTestWrapper from './CheckboxTestWrapper.svelte'

function getCheckbox(name: string): HTMLInputElement {
  const checkbox = screen.getByRole('checkbox', { name })
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error('Expected HTMLInputElement')
  }
  return checkbox
}

describe('plugin-sdk Checkbox', () => {
  it('forwards native checkbox state, events, and accessibility attributes', async () => {
    const onchange = vi.fn()
    render(Checkbox, {
      props: {
        'aria-label': 'Include generated files',
        'aria-describedby': 'generated-files-help',
        checked: false,
        name: 'generated-files',
        onchange,
      },
    })

    const checkbox = getCheckbox('Include generated files')
    await fireEvent.click(checkbox)

    expect(checkbox.checked).toBe(true)
    expect(checkbox.name).toBe('generated-files')
    expect(checkbox.getAttribute('aria-describedby')).toBe('generated-files-help')
    expect(onchange).toHaveBeenCalledTimes(1)
  })

  it('exposes a mixed state for partially selected groups', () => {
    render(Checkbox, {
      props: {
        'aria-label': 'Select changed files',
        indeterminate: true,
      },
    })

    const checkbox = getCheckbox('Select changed files')
    expect(checkbox.indeterminate).toBe(true)
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed')
  })

  it('forwards native disabled state', () => {
    render(Checkbox, {
      props: {
        'aria-label': 'Include generated files',
        disabled: true,
      },
    })

    expect(getCheckbox('Include generated files').disabled).toBe(true)
  })

  it('binds checked state and reports semantic state changes', async () => {
    render(CheckboxTestWrapper)

    const checkbox = getCheckbox('Include generated files')
    await fireEvent.click(checkbox)

    expect(checkbox.checked).toBe(true)
    expect(screen.getByRole('status', { name: 'Bound state' }).textContent).toBe('true')
    expect(screen.getByRole('status', { name: 'Last change' }).textContent).toBe('true')
    expect(screen.getByRole('status', { name: 'Bound state at callback' }).textContent).toBe('true')
  })
})
