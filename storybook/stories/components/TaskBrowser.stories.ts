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
  beforeEach: context => {
    const body = context.canvasElement.ownerDocument.body
    delete body.dataset.taskBrowserReady
    return () => { delete body.dataset.taskBrowserReady }
  },
  render: (args, context) => ({
    Component: TaskBrowserModule,
    props: { ...args, api: getStoryScenario(context).plugin.api },
  }),
} satisfies Meta<Args>
export default meta
type Story = StoryObj<Partial<Args>>

async function markReady(canvasElement: HTMLElement, id: string): Promise<void> {
  const view = canvasElement.ownerDocument.defaultView
  if (view?.requestAnimationFrame) {
    await new Promise<void>(resolve => {
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()))
    })
  }
  canvasElement.ownerDocument.body.dataset.taskBrowserReady = id
}

export const Available: Story = { args: { seed: false } }
export const FeedbackActions: Story = {
  play: async ({ canvasElement, id }) => {
    await expect(within(canvasElement).findByText('1 screenshot · 1 annotation')).resolves.toBeVisible()
    await markReady(canvasElement, id)
  },
}
export const SaveFailure: Story = { args: { saveFailure: true } }
export const Review: Story = {
  args: { module: 'review' },
  play: async ({ canvasElement, id }) => {
    await expect(within(canvasElement).findByRole('region', { name: 'Visual feedback review' })).resolves.toBeVisible()
    await markReady(canvasElement, id)
  },
}
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
