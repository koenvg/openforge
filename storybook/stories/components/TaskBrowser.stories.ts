import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import TaskBrowserModule from '../../shared/frames/TaskBrowserModule.svelte'
import { taskBrowserScenario } from '../../shared/fixtures/taskBrowserScenario'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

type Args = {
  module?: 'actions' | 'review'
  seed?: boolean
  saveFailure?: boolean
}

const meta = {
  title: 'Components/Task Browser',
  component: TaskBrowserModule,
  args: { module: 'actions', seed: true, saveFailure: false },
  parameters: { openforge: taskBrowserScenario('feedback') },
  render: (args, context) => ({
    Component: TaskBrowserModule,
    props: { ...args, api: getStoryScenario(context).plugin.api },
  }),
} satisfies Meta<Args>
export default meta
type Story = StoryObj<Partial<Args>>

export const Available: Story = { args: { seed: false } }
export const FeedbackActions: Story = {}
export const SaveFailure: Story = { args: { saveFailure: true } }
export const Review: Story = { args: { module: 'review' } }
export const EditReview: Story = {
  args: { module: 'review' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const comment = await canvas.findByRole('textbox', { name: 'Comment for annotation 1' })
    await userEvent.clear(comment)
    await userEvent.type(comment, 'Use the compact toolbar spacing')
    await userEvent.click(canvas.getByRole('button', { name: 'Save annotation 1' }))
    await expect(comment).toHaveValue('Use the compact toolbar spacing')
  },
}
