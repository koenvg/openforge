import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import TextFieldTestWrapper from './TextFieldTestWrapper.svelte'
import TextFieldToolbarTestWrapper from './TextFieldToolbarTestWrapper.svelte'
import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'

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

  it('keeps a hidden label accessible without forwarding presentation props to the input', () => {
    render(TextField, {
      props: { label: 'Filter tasks', labelHidden: true, size: 'sm', placeholder: 'Search…' },
    })

    const input = screen.getByRole('textbox', { name: 'Filter tasks' }) as HTMLInputElement
    expect(screen.getByLabelText('Filter tasks')).toBe(input)
    expect(input.labels).toHaveLength(1)
    expect(input.labels?.[0].hidden).toBe(false)
    expect(input.hasAttribute('labelHidden')).toBe(false)
    expect(input.hasAttribute('size')).toBe(false)
  })

  it('preserves caller-owned captions when compact and hidden-label props are combined', () => {
    render(TextField, {
      props: {
        label: 'Task prefix', hideLabel: true, labelHidden: true, size: 'sm',
        'aria-label': 'Ignored override', helperText: 'Prefix new task IDs.',
      },
    })

    const input = screen.getByRole('textbox', { name: 'Task prefix', description: 'Prefix new task IDs.' }) as HTMLInputElement
    expect(input.labels).toHaveLength(0)
    expect(screen.queryByText('Task prefix')).toBeNull()
    expect(input.hasAttribute('hideLabel')).toBe(false)
    expect(input.hasAttribute('labelHidden')).toBe(false)
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

  it('composes adornments without changing input, form, or description behavior', async () => {
    render(TextFieldToolbarTestWrapper)
    const input = screen.getByRole('textbox', { name: 'Filter tasks' }) as HTMLInputElement
    const clear = screen.getByRole('button', { name: 'Clear filter' })
    expect(screen.getByText('Search icon').getAttribute('aria-hidden')).toBe('true')
    expect(input.classList.contains('task-filter-input')).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const descriptions = input.getAttribute('aria-describedby')!.split(' ')
    expect(descriptions.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Filter the task list.', 'Search by title.', 'No matching task.',
    ])

    await fireEvent.input(input, { target: { value: 'openforge' } })
    for (const name of ['Bound value', 'Native input value', 'Last change']) {
      expect(screen.getByRole('status', { name }).textContent).toBe('openforge')
    }
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('status', { name: 'Last key' }).textContent).toBe('Escape')
    expect(new FormData(input.form!).get('query')).toBe('openforge')

    clear.focus()
    expect(document.activeElement).toBe(clear)
    await fireEvent.click(clear)
    expect(input.value).toBe('')
    expect(screen.getByRole('status', { name: 'Bound value' }).textContent).toBe('')
    expect(new FormData(input.form!).get('query')).toBe('')
  })

  it.each(['disabled', 'readonly'] as const)('preserves %s semantics with adornments', (state) => {
    render(TextFieldToolbarTestWrapper, { props: { [state]: true } })
    const input = screen.getByRole('textbox', { name: 'Filter tasks' }) as HTMLInputElement
    expect(input[state === 'readonly' ? 'readOnly' : 'disabled']).toBe(true)
    expect(screen.getByRole('button', { name: 'Clear filter' })).toHaveProperty('disabled', true)
    expect(new FormData(input.form!).get('query')).toBe(state === 'disabled' ? null : 'initial')
  })

  it('keeps hidden labels and descriptions distinct across fields and id changes', async () => {
    const first = render(TextField, { props: { label: 'First filter', labelHidden: true, helperText: 'First help' } })
    render(TextField, { props: { label: 'Second filter', labelHidden: true, helperText: 'Second help' } })
    const firstInput = screen.getByLabelText('First filter') as HTMLInputElement
    const secondInput = screen.getByLabelText('Second filter') as HTMLInputElement
    expect(firstInput.id).not.toBe(secondInput.id)
    expect(firstInput.getAttribute('aria-describedby')).not.toBe(secondInput.getAttribute('aria-describedby'))
    await first.rerender({ id: 'custom-filter-id', labelHidden: false })
    expect(screen.getByLabelText('First filter')).toBe(firstInput)
    expect(firstInput.id).toBe('custom-filter-id')
    expect(document.getElementById(firstInput.getAttribute('aria-describedby')!)?.textContent).toBe('First help')
  })
})
