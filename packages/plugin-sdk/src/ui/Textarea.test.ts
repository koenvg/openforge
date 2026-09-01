import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Textarea from './Textarea.svelte'
import TextareaTestWrapper from './TextareaTestWrapper.svelte'

describe('plugin-sdk Textarea', () => {
  it('binds its native value and reports value changes', async () => {
    render(TextareaTestWrapper)

    const textarea = screen.getByRole('textbox', { name: 'Review note' })
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    expect(textarea).toHaveProperty('value', 'Initial note')

    await fireEvent.input(textarea, { target: { value: 'Ship this change' } })

    expect(screen.getByRole('status', { name: 'Bound value' }).textContent).toBe('Ship this change')
    expect(screen.getByRole('status', { name: 'Last change' }).textContent).toBe('Ship this change')
  })

  it('links helper and validation text to the native textarea', () => {
    render(Textarea, {
      props: {
        label: 'Review note',
        helperText: 'Summarize the user-facing change.',
        error: 'A review note is required.',
        required: true,
      },
    })

    const textarea = screen.getByRole('textbox', { name: 'Review note' })
    const descriptions = textarea.getAttribute('aria-describedby')?.split(' ') ?? []

    expect(textarea.getAttribute('aria-invalid')).toBe('true')
    expect(textarea).toHaveProperty('required', true)
    expect(descriptions.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Summarize the user-facing change.',
      'A review note is required.',
    ])
  })
})
