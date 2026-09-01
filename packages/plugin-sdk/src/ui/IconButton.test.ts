import { createRawSnippet } from 'svelte'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import IconButton from './IconButton.svelte'

const children = createRawSnippet(() => ({
  render: () => '<svg aria-hidden="true"></svg>',
}))

describe('plugin-sdk IconButton', () => {
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
})
