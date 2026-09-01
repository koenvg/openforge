import { createRawSnippet } from 'svelte'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Button from './Button.svelte'

const children = createRawSnippet(() => ({
  render: () => '<span>Run review</span>',
}))

function getButton(name: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name })
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected HTMLButtonElement')
  }
  return button
}

describe('plugin-sdk Button', () => {
  it('renders child content and forwards click events', async () => {
    const onclick = vi.fn()

    render(Button, { props: { children, onclick } })
    await fireEvent.click(getButton('Run review'))

    expect(onclick).toHaveBeenCalledTimes(1)
  })

  it('honors native disabled behavior', async () => {
    const onclick = vi.fn()

    render(Button, { props: { children, onclick, disabled: true } })
    const button = getButton('Run review')
    await fireEvent.click(button)

    expect(button.disabled).toBe(true)
    expect(onclick).not.toHaveBeenCalled()
  })

  it('forwards native and ARIA attributes', () => {
    render(Button, {
      props: {
        children,
        type: 'submit',
        name: 'review-action',
        value: 'run',
        title: 'Run the review',
        'aria-describedby': 'review-help',
      },
    })

    const button = getButton('Run review')
    expect(button.type).toBe('submit')
    expect(button.name).toBe('review-action')
    expect(button.value).toBe('run')
    expect(button.title).toBe('Run the review')
    expect(button.getAttribute('aria-describedby')).toBe('review-help')
  })

  it('supports the semantic onClick callback without replacing native attributes', async () => {
    const onClick = vi.fn()
    render(Button, {
      props: {
        children,
        onClick,
        type: 'button',
      },
    })

    await fireEvent.click(getButton('Run review'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
