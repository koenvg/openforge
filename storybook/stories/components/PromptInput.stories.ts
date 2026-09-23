import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import PromptInput from '../../../src/components/prompt/PromptInput.svelte'
import { creationScenario, longCreationPrompt } from '../../shared/fixtures/creationScenario'

const meta = {
  title: 'Components/Prompt Input', component: PromptInput,
  args: { projectId: 'project-1', value: '', ariaLabel: 'Task prompt', containerClass: 'm-6 max-w-2xl', rows: 8, onSubmit: fn(), onValueChange: fn() },
  parameters: { openforge: creationScenario('task') },
  beforeEach: (context) => {
    delete context.canvasElement.ownerDocument.body.dataset.creationReady
    return () => { delete context.canvasElement.ownerDocument.body.dataset.creationReady }
  },
  play: async ({ canvasElement, id }) => {
    await within(canvasElement).findByRole('textbox', { name: 'Task prompt' })
    canvasElement.ownerDocument.body.dataset.creationReady = id
  },
} satisfies Meta<typeof PromptInput>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const LongContent: Story = { args: { value: longCreationPrompt } }
export const Editing: Story = {
  args: { value: 'Review the keyboard shortcuts.' },
  play: async ({ canvasElement, args, id }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Task prompt' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Revised prompt with clear acceptance criteria')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(args.onSubmit).toHaveBeenCalledWith('Revised prompt with clear acceptance criteria')
    canvasElement.ownerDocument.body.dataset.creationReady = id
  },
}
export const Commands: Story = {
  play: async ({ canvasElement, id }) => {
    await userEvent.type(within(canvasElement).getByRole('textbox', { name: 'Task prompt' }), '/')
    await expect(within(canvasElement).findByRole('option', { name: /review/ })).resolves.toBeInTheDocument()
    canvasElement.ownerDocument.body.dataset.creationReady = id
  },
}
export const SelectCommand: Story = {
  play: async ({ canvasElement, id }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Task prompt' })
    await userEvent.type(input, '/')
    await within(canvasElement).findByRole('option', { name: /review/ })
    await userEvent.keyboard('{Enter}')
    await expect(input).toHaveValue('/review ')
    canvasElement.ownerDocument.body.dataset.creationReady = id
  },
}
export const FileMention: Story = {
  play: async ({ canvasElement, id }) => {
    await userEvent.type(within(canvasElement).getByRole('textbox', { name: 'Task prompt' }), 'Review @nav')
    await expect(within(canvasElement).findByRole('option', { name: /navigation.ts/ })).resolves.toBeInTheDocument()
    canvasElement.ownerDocument.body.dataset.creationReady = id
  },
}
export const Cancel: Story = {
  name: 'Dismiss suggestions',
  play: async ({ canvasElement, id }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Task prompt' })
    await userEvent.type(input, '/')
    await canvas.findByRole('option', { name: /review/ })
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('option')).not.toBeInTheDocument()
    await expect(input).toHaveValue('/')
    await expect(input).toHaveFocus()
    canvasElement.ownerDocument.body.dataset.creationReady = id
  },
}
