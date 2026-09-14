import { expect, userEvent, waitFor } from 'storybook/test'
import { creationMeta, creationState, creationQueries as queries, creationReady, reopenCreation, taskReady, type CreationStory } from '../../shared/creationStories'
import { creationPrompt } from '../../shared/fixtures/creationScenario'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = { ...creationMeta('task', 'Pages/Task Creation'), title: 'Pages/Task Creation' }
export default meta
export const Empty: CreationStory = {}
export const InheritedDefaults: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await taskReady(context)
    await expect(queries(context).getByRole('radio', { name: 'AI-generated title' })).toBeChecked()
    await expect(queries(context).getByRole('switch', { name: 'Worktree' })).toBeChecked()
    creationReady(context)
  },
}
export const ProjectDirectory: CreationStory = creationState('task', 'project-directory')
export const NoCommits: CreationStory = {
  ...creationState('task', 'no-commits'),
  play: async (context) => {
    await taskReady(context)
    await expect(queries(context).getByRole('switch', { name: 'Worktree' })).toBeDisabled()
    creationReady(context)
  },
}
export const LongContent: CreationStory = creationState('task', 'long-content')
export const Narrow: CreationStory = { ...creationState('task', 'inherited'), globals: { viewport: { value: 'narrow', isRotated: false } } }
export const Loading: CreationStory = {
  ...creationState('task', 'loading'),
  play: async (context) => {
    await queries(context).findByText('Loading task defaults…')
    await expect(queries(context).getByRole('button', { name: /Start Task/ })).toBeDisabled()
    creationReady(context)
  },
}
export const DefaultsFailure: CreationStory = {
  ...creationState('task', 'defaults-failure'),
  play: async (context) => {
    await expect(queries(context).findByRole('alert')).resolves.toHaveTextContent('Could not load task defaults.')
    await expect(queries(context).getByRole('button', { name: /Start Task/ })).toBeDisabled()
    creationReady(context)
  },
}
export const Validation: CreationStory = {
  ...creationState('task', 'no-branches'),
  play: async (context) => {
    await taskReady(context)
    await userEvent.click(queries(context).getByRole('radio', { name: 'Existing branch' }))
    await userEvent.click(queries(context).getByRole('button', { name: 'Add to backlog' }))
    await expect(queries(context).findByRole('alert')).resolves.toHaveTextContent('Select an existing branch before creating the task.')
    await expect(getStoryScenario(context).desktop.calls.filter(call => call.command === 'create_task')).toHaveLength(0)
    creationReady(context)
  },
}
export const Failure: CreationStory = {
  ...creationState('task', 'failure'),
  play: async (context) => {
    await taskReady(context)
    await userEvent.click(queries(context).getByRole('button', { name: 'Add to backlog' }))
    await expect(queries(context).findByRole('alert')).resolves.toHaveTextContent('Catalog task creation unavailable')
    await expect(queries(context).getByRole('textbox', { name: 'What should the agent do?' })).toHaveValue(creationPrompt)
    creationReady(context)
  },
}
export const Saving: CreationStory = {
  ...creationState('task', 'saving'),
  play: async (context) => {
    await taskReady(context)
    await userEvent.click(queries(context).getByRole('button', { name: /Start Task/ }))
    await expect(queries(context).findByRole('button', { name: 'Starting…' })).resolves.toBeDisabled()
    creationReady(context)
  },
}
export const AddToBacklog: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await taskReady(context)
      await userEvent.click(queries(context).getByRole('button', { name: 'Add to backlog' }))
      await waitFor(() => expect(context.args.onTaskCreated).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'T-99' }), 'backlog'))
      await reopenCreation(context)
      await expect(queries(context).getByRole('textbox', { name: 'What should the agent do?' })).toHaveValue(creationPrompt)
      await expect(getStoryScenario(context).desktop.calls.filter(call => call.command === 'create_task')).toHaveLength(0)
    }
    await taskReady(context)
    creationReady(context)
  },
}
export const StartTask: CreationStory = {
  ...creationState('task', 'inherited'),
  play: async (context) => {
    await taskReady(context)
    await userEvent.click(queries(context).getByRole('button', { name: /Start Task/ }))
    await waitFor(() => expect(context.args.onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-99' }), 'start'))
    await reopenCreation(context)
    await taskReady(context)
    creationReady(context)
  },
}
export const DismissRetainsDraft: CreationStory = {
  play: async (context) => {
    const prompt = () => queries(context).getByRole('textbox', { name: 'What should the agent do?' })
    await userEvent.type(prompt(), 'Keep this draft')
    await userEvent.keyboard('{Escape}')
    await reopenCreation(context)
    await waitFor(() => expect(prompt()).toHaveValue('Keep this draft'))

    await userEvent.click(queries(context).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(prompt()).toHaveValue(''))
    await expect(queries(context).getByRole('dialog')).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await reopenCreation(context)
    await waitFor(() => expect(prompt()).toHaveValue(''))

    await expect(context.args.onTaskCreated).not.toHaveBeenCalled()
    await taskReady(context)
    creationReady(context)
  },
}
export const EditPrompt: CreationStory = {
  ...creationState('task', 'edit'),
  play: async (context) => {
    const input = queries(context).getByRole('textbox', { name: 'What should the agent do?' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Revised acceptance criteria')
    await userEvent.click(queries(context).getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(context.args.onTaskSaved).toHaveBeenCalledTimes(1))
    await expect(getStoryScenario(context).desktop.calls).toContainEqual({ command: 'update_task', payload: { id: 'T-42', initialPrompt: 'Revised acceptance criteria' } })
    await reopenCreation(context)
    await expect(queries(context).getByRole('textbox', { name: 'What should the agent do?' })).toHaveValue('Review keyboard navigation')
    creationReady(context)
  },
}
