import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import BoardPage from '../../shared/frames/BoardPage.svelte'
import { boardScenario } from '../../shared/fixtures/boardScenario'

const meta = {
  title: 'Pages/Focus Board',
  component: BoardPage,
  parameters: { openforge: boardScenario() },
  args: { onOpenTask: fn(), onNewTask: fn(), onRunAction: fn() },
} satisfies Meta<typeof BoardPage>
export default meta

export const Populated: StoryObj<typeof meta> = {}
export const Empty: StoryObj<typeof meta> = { parameters: { openforge: boardScenario('empty') } }
export const Loading: StoryObj<typeof meta> = { parameters: { openforge: boardScenario('loading') } }
export const Failure: StoryObj<typeof meta> = { parameters: { openforge: boardScenario('failure') } }
export const Attention: StoryObj<typeof meta> = { parameters: { openforge: boardScenario('attention') } }
export const Narrow: StoryObj<typeof meta> = { globals: { viewport: { value: 'narrow', isRotated: false } } }
export const Overflow: StoryObj<typeof meta> = { parameters: { openforge: boardScenario('overflow') } }
export const Filtered: StoryObj<typeof meta> = {
  parameters: { openforge: boardScenario('populated', 'backlog') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const taskList = within(canvas.getByRole('region', { name: 'Task list' }))
    await expect(taskList.findByText('Improve keyboard navigation')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Filter by Task Labels' }))
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('menuitemcheckbox', { name: /accessibility/i }))
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByText('Document the release checklist')).not.toBeInTheDocument()
  },
}
