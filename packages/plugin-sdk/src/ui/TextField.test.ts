import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import TextFieldTestWrapper from './TextFieldTestWrapper.svelte'
import TextField from './TextField.svelte'

describe('plugin-sdk TextField', () => {
  it('binds its native value and reports value changes', async () => {
    render(TextFieldTestWrapper)

    const input = screen.getByRole('textbox', { name: 'Repository name' })
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input).toHaveProperty('value', 'initial')

    await fireEvent.input(input, { target: { value: 'openforge' } })

    expect(screen.getByRole('status', { name: 'Bound value' }).textContent).toBe('openforge')
    expect(screen.getByRole('status', { name: 'Last change' }).textContent).toBe('openforge')
  })

  it('links helper and validation text to the native input', () => {
    render(TextField, {
      props: {
        label: 'Repository name',
        helperText: 'Use the remote repository name.',
        error: 'A repository name is required.',
        required: true,
      },
    })

    const input = screen.getByRole('textbox', { name: 'Repository name' })
    const descriptions = input.getAttribute('aria-describedby')?.split(' ') ?? []

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input).toHaveProperty('required', true)
    expect(descriptions).toHaveLength(2)
    expect(descriptions.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Use the remote repository name.',
      'A repository name is required.',
    ])
  })
})
