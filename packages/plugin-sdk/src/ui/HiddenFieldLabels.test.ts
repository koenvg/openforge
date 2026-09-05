import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Select from './Select.svelte'
import Switch from './Switch.svelte'
import TextField from './TextField.svelte'
import Textarea from './Textarea.svelte'

describe('fields with caller-owned visible captions', () => {
  it('combines a caller-owned select description with helper and error text', () => {
    const description = document.createElement('p')
    description.id = 'owned-description'
    description.textContent = 'Choose an application theme.'
    document.body.append(description)
    try {
      render(Select, {
        label: 'Theme', hideLabel: true, options: [],
        'aria-describedby': description.id, helperText: 'Pick one.', error: 'Unavailable.',
      })
      expect(screen.getByRole('button', {
        name: 'Theme', description: 'Choose an application theme. Pick one. Unavailable.',
      })).toBeTruthy()
    } finally {
      description.remove()
    }
  })

  it('names a select without repeating its caption', () => {
    render(Select, { label: 'Theme', hideLabel: true, options: [{ value: 'light', label: 'Light' }] })
    expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy()
    expect(screen.queryByText('Theme')).toBeNull()
  })

  it('names a switch without repeating its caption', () => {
    render(Switch, { label: 'Notifications', hideLabel: true })
    expect(screen.getByRole('switch', { name: 'Notifications' })).toBeTruthy()
    expect(screen.queryByText('Notifications')).toBeNull()
  })

  it('names a text field without repeating its caption', () => {
    render(TextField, { label: 'Task prefix', hideLabel: true })
    expect(screen.getByRole('textbox', { name: 'Task prefix' })).toBeTruthy()
    expect(screen.queryByText('Task prefix')).toBeNull()
  })

  it('names a text area without repeating its caption', () => {
    render(Textarea, { label: 'Instructions', hideLabel: true })
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBeTruthy()
    expect(screen.queryByText('Instructions')).toBeNull()
  })
})
