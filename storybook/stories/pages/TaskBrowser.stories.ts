import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within, waitFor } from 'storybook/test'
import TaskBrowserPage from '../../shared/frames/TaskBrowserPage.svelte'
import { taskBrowserScenario } from '../../shared/fixtures/taskBrowserScenario'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/Task Browser',
  component: TaskBrowserPage,
  parameters: { openforge: taskBrowserScenario() },
  beforeEach: context => {
    const body = context.canvasElement.ownerDocument.body
    delete body.dataset.taskBrowserReady
    return () => { delete body.dataset.taskBrowserReady }
  },
  render: (args, context) => {
    const { plugin } = getStoryScenario(context)
    return { Component: TaskBrowserPage, props: { ...args, api: plugin.api, context: plugin.context } }
  },
} satisfies Meta<typeof TaskBrowserPage>
export default meta
type Story = StoryObj<{ taskId?: string }>

async function markReady(canvasElement: HTMLElement, id: string): Promise<void> {
  const view = canvasElement.ownerDocument.defaultView
  if (view?.requestAnimationFrame) {
    await new Promise<void>(resolve => {
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()))
    })
  }
  canvasElement.ownerDocument.body.dataset.taskBrowserReady = id
}

async function markAttachedReady(
  { canvasElement, id }: { canvasElement: HTMLElement; id: string },
  heading: string,
): Promise<void> {
  const canvas = within(canvasElement)
  await expect(canvas.findByRole('heading', { name: heading })).resolves.toBeVisible()
  await expect(canvas.findByRole('button', { name: 'Add visual feedback' })).resolves.toBeVisible()
  await markReady(canvasElement, id)
}

export const Populated: Story = {
  play: context => markAttachedReady(context, 'Task implementation preview'),
}
export const Empty: Story = {
  parameters: { openforge: taskBrowserScenario('empty') },
  play: context => markAttachedReady(context, 'No page loaded'),
}
export const Loading: Story = { parameters: { openforge: taskBrowserScenario('loading') } }
export const Failure: Story = {
  parameters: { openforge: taskBrowserScenario('failure') },
  play: context => markAttachedReady(context, 'The local preview could not be loaded'),
}
export const Disconnected: Story = {
  parameters: { openforge: taskBrowserScenario('disconnected') },
  play: async ({ canvasElement, id }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('Browser unavailable')).resolves.toBeVisible()
    await expect(canvas.findByRole('button', { name: 'Retry' })).resolves.toBeVisible()
    await markReady(canvasElement, id)
  },
}
export const Overflow: Story = { parameters: { openforge: taskBrowserScenario('overflow') } }

export const Navigation: Story = {
  play: async context => {
    const canvas = within(context.canvasElement)
    const address = await canvas.findByDisplayValue('https://catalog.openforge.local/tasks/T-42')
    await userEvent.clear(address)
    await userEvent.type(address, 'catalog.openforge.local/review')
    await userEvent.click(canvas.getByRole('button', { name: 'Go' }))
    await expect(canvas.findByDisplayValue('https://catalog.openforge.local/review')).resolves.toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Go back' }))
    await expect(canvas.findByDisplayValue('https://catalog.openforge.local/tasks/T-42')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Go forward' }))
    await expect(canvas.findByDisplayValue('https://catalog.openforge.local/review')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Reload page' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Open Developer Tools' }))
    await expect(canvas.getByRole('button', { name: 'Close Developer Tools' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Close Developer Tools' }))

    await waitFor(() => expect(getStoryScenario(context).plugin.calls.browserSurfaceControls).toEqual([
      { taskId: 'T-42', id: 'main', action: 'goBack' },
      { taskId: 'T-42', id: 'main', action: 'goForward' },
      { taskId: 'T-42', id: 'main', action: 'reload' },
      { taskId: 'T-42', id: 'main', action: 'openDevTools' },
      { taskId: 'T-42', id: 'main', action: 'closeDevTools' },
    ]))
  },
}

export const StopLoading: Story = {
  parameters: { openforge: taskBrowserScenario('loading') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Stop loading' }))
    await expect(canvas.findByRole('button', { name: 'Reload page' })).resolves.toBeVisible()
    await expect(canvas.findByText('Task implementation preview')).resolves.toBeVisible()
  },
}

export const RetryConnection: Story = {
  parameters: { openforge: taskBrowserScenario('retry') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('Browser runtime is restarting')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    await expect(canvas.findByDisplayValue('https://catalog.openforge.local/tasks/T-42')).resolves.toBeVisible()
    await expect(canvas.findByLabelText('Attached browser page')).resolves.toBeVisible()
  },
}

export const InvalidAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const address = await canvas.findByDisplayValue('https://catalog.openforge.local/tasks/T-42')
    await userEvent.clear(address)
    await userEvent.type(address, 'file:///tmp/private')
    await userEvent.click(canvas.getByRole('button', { name: 'Go' }))
    await expect(canvas.findByText('Only valid HTTP(S) addresses are supported')).resolves.toBeVisible()
    await expect(canvas.findByLabelText('Attached browser page')).resolves.toBeVisible()
  },
}

export const VisualFeedback: Story = {
  parameters: { openforge: taskBrowserScenario('feedback') },
  play: async ({ canvasElement, id }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Add visual feedback' }))
    await expect(canvas.findByText('1 screenshot · 1 annotation')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Review visual feedback' }))
    await expect(canvas.findByRole('region', { name: 'Visual feedback review' })).resolves.toBeVisible()
    await markReady(canvasElement, id)
  },
}

export const SendFeedback: Story = {
  parameters: { openforge: taskBrowserScenario('feedback') },
  play: async context => {
    const canvas = within(context.canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Add visual feedback' }))
    await expect(canvas.findByText('1 screenshot · 1 annotation')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Send visual feedback to agent' }))
    await waitFor(() => expect(getStoryScenario(context).plugin.calls.taskFollowUps).toHaveLength(1))
    await expect(canvas.queryByText('1 screenshot · 1 annotation')).not.toBeInTheDocument()
  },
}
