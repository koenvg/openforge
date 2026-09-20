import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import PullRequestLinkForm from '../../../plugins/github-sync/src/task/PullRequestLinkForm.svelte'
import ComponentFrame from '../../shared/frames/ComponentFrame.svelte'

const meta = {
  title: 'Components/GitHub Sync/Pull Request Link Form',
  component: PullRequestLinkForm,
  decorators: [() => ({ Component: ComponentFrame, props: { width: '32rem' } })],
  args: { onLink: fn(async () => undefined), onLinked: fn(), onCancel: fn() },
} satisfies Meta<typeof PullRequestLinkForm>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Validation: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Link PR' }))
    await expect(canvas.findByText('Enter a GitHub pull request URL')).resolves.toBeVisible()
    await expect(args.onLink).not.toHaveBeenCalled()
  },
}

export const Failure: Story = {
  args: { onLink: fn(async () => { throw new Error('The pull request is not available to this GitHub account.') }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('GitHub pull request URL'), 'https://github.com/openforge/private/pull/12')
    await userEvent.click(canvas.getByRole('button', { name: 'Link PR' }))
    await expect(canvas.findByText(/not available to this GitHub account/)).resolves.toBeVisible()
  },
}

export const Linking: Story = {
  args: { onLink: fn(() => new Promise<void>(() => undefined)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('GitHub pull request URL'), 'https://github.com/openforge/openforge/pull/42')
    await userEvent.click(canvas.getByRole('button', { name: 'Link PR' }))
    await expect(canvas.getByRole('button', { name: 'Linking…' })).toBeDisabled()
    await expect(canvas.getByLabelText('GitHub pull request URL')).toBeDisabled()
  },
}
