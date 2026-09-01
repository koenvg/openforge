import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import PrWalkthroughButton from './PrWalkthroughButton.svelte'

describe('PrWalkthroughButton', () => {
  it('offers a Stop control while generating and calls onStop when clicked', async () => {
    const onStop = vi.fn()
    render(PrWalkthroughButton, { props: { state: 'generating', onGenerate: vi.fn(), onStop } })

    await fireEvent.click(screen.getByRole('button', { name: /stop walkthrough generation/i }))

    expect(onStop).toHaveBeenCalledOnce()
  })

  it('renders no Stop control when generating without an onStop handler', () => {
    render(PrWalkthroughButton, { props: { state: 'generating', onGenerate: vi.fn() } })
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull()
  })
})
