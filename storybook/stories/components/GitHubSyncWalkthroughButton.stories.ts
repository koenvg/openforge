import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import PrWalkthroughButton from '../../../plugins/github-sync/src/review/pr/PrWalkthroughButton.svelte'
import ComponentFrame from '../../shared/frames/ComponentFrame.svelte'

const meta = {
  title: 'Components/GitHub Sync/Walkthrough Button',
  component: PrWalkthroughButton,
  decorators: [() => ({ Component: ComponentFrame, props: { width: '24rem' } })],
  args: { state: 'idle', onGenerate: fn(), onStop: fn() },
} satisfies Meta<typeof PrWalkthroughButton>

export default meta
type Story = StoryObj<typeof meta>

export const Available: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Generate walkthrough and AI review' }))
    await expect(args.onGenerate).toHaveBeenCalledTimes(1)
  },
}

export const Generating: Story = {
  args: { state: 'generating' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Generating walkthrough')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop walkthrough generation' }))
    await expect(args.onStop).toHaveBeenCalledTimes(1)
  },
}

export const Ready: Story = {
  args: { state: 'ready' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('Walkthrough ready')).toBeVisible()
  },
}

export const NewCommits: Story = { args: { state: 'stale' } }
export const Failed: Story = { args: { state: 'failed' } }
export const Aborted: Story = { args: { state: 'aborted' } }
