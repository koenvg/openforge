import { expect, userEvent } from 'storybook/test'
import { creationMeta, creationState, creationQueries as queries, creationReady, taskReady, type CreationStory } from '../../shared/creationStories'

const meta = { ...creationMeta('task', 'Components/Task Creation Controls'), title: 'Components/Task Creation Controls' }
export default meta
export const Default: CreationStory = creationState('task', 'inherited')
export const CustomTitle: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await taskReady(context)
    await userEvent.click(queries(context).getByRole('radio', { name: 'Custom title' }))
    await userEvent.type(queries(context).getByRole('textbox', { name: 'Task title' }), 'Keyboard navigation audit')
    await expect(queries(context).getByRole('textbox', { name: 'Task title' })).toHaveValue('Keyboard navigation audit')
    creationReady(context)
  },
}
export const ProviderAndMode: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await taskReady(context)
    await userEvent.click(queries(context).getByRole('button', { name: 'Provider' }))
    await userEvent.click(await queries(context).findByRole('option', { name: 'Claude Code' }))
    await userEvent.click(queries(context).getByRole('button', { name: 'Mode' }))
    await userEvent.click(await queries(context).findByRole('option', { name: 'Plan' }))
    await expect(queries(context).getByRole('button', { name: 'Mode' })).toHaveTextContent('Plan')
    creationReady(context)
  },
}
export const ExistingBranch: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await taskReady(context)
    await userEvent.click(queries(context).getByRole('radio', { name: 'Existing branch' }))
    await expect(queries(context).getByRole('radio', { name: 'Existing branch' })).toBeChecked()
    creationReady(context)
  },
}
export const WorktreeDisabled: CreationStory = creationState('task', 'no-commits')
async function pasteImage(context: Parameters<NonNullable<CreationStory['play']>>[0], oversized = false) {
  await taskReady(context)
  // Paste at the public input boundary, without reading the system clipboard.
  const bytes = oversized ? new Uint8Array(5 * 1024 * 1024 + 1) : Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='), character => character.charCodeAt(0))
  const clipboardData = new DataTransfer()
  clipboardData.items.add(new File([bytes], 'reference.png', { type: 'image/png' }))
  queries(context).getByRole('textbox', { name: 'What should the agent do?' }).dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
}
export const AttachedImage: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await pasteImage(context)
    await expect(queries(context).findByText('1 image ready')).resolves.toBeInTheDocument()
    creationReady(context)
  },
}
export const ImagePreview: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await pasteImage(context)
    await userEvent.click(await queries(context).findByRole('button', { name: 'Preview [image#1]' }))
    await expect(queries(context).findByRole('dialog', { name: /Pasted image/ })).resolves.toBeInTheDocument()
    creationReady(context)
  },
}
export const ImageTooLarge: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await pasteImage(context, true)
    await expect(queries(context).findByText('Pasted image is too large. Keep images under 5.0 MB.')).resolves.toBeInTheDocument()
    creationReady(context)
  },
}
