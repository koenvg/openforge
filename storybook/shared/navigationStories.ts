import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import NavigationWorkflow from './frames/NavigationWorkflow.svelte'
import { navigationScenario, type NavigationWorkflowKind } from './fixtures/navigationScenario'
import { getStoryScenario } from './storyEnvironmentPreview'

const renderNavigation: NonNullable<Meta<typeof NavigationWorkflow>['render']> = (args, context) => ({
  Component: NavigationWorkflow,
  props: { ...args, reset: () => getStoryScenario(context).environment.reset() },
})

export function navigationMeta(workflow: NavigationWorkflowKind, title: string) {
  return {
    title,
    component: NavigationWorkflow,
    parameters: { openforge: navigationScenario(workflow) },
    beforeEach: (context) => {
      delete context.canvasElement.ownerDocument.body.dataset.navigationReady
      return () => { delete context.canvasElement.ownerDocument.body.dataset.navigationReady }
    },
    play: async (context) => {
      const body = dialogQueries(context)
      await body.findByRole('dialog')
      if (workflow === 'commands') {
        if (context.args.state === 'loading') await body.findByText('Loading tasks...')
        else if (context.args.state === 'empty' || context.args.state === 'failure') await body.findByText('No tasks or commands match your search')
        else await body.findByRole('listbox')
      }
      if (context.args.paletteTheme) {
        await waitFor(() => expect(getComputedStyle(body.getByRole('dialog').querySelector('.of-search-palette-panel')!).backdropFilter).toBe('blur(12px)'))
      }
      markNavigationReady(context)
    },
    args: {
      workflow, state: 'populated', onClose: fn(), onSelectProject: fn(), onExecute: fn(),
      reset: async () => { throw new Error('Navigation stories require their story environment') },
    },
    argTypes: { workflow: { control: false }, state: { control: false }, reset: { table: { disable: true } } },
    render: renderNavigation,
  } satisfies Meta<typeof NavigationWorkflow>
}

export function navigationState(workflow: NavigationWorkflowKind, state: string) {
  return { args: { state }, parameters: { openforge: navigationScenario(workflow, state) } }
}

export type NavigationStory = StoryObj<typeof NavigationWorkflow>
export type NavigationPlayContext = Parameters<NonNullable<StoryObj<typeof NavigationWorkflow>['play']>>[0]
export const dialogQueries = (context: NavigationPlayContext) => within(context.canvasElement.ownerDocument.body)

export async function reopenWorkflow(context: NavigationPlayContext) {
  const button = await dialogQueries(context).findByRole('button', { name: 'Reopen workflow' })
  // Modal's production exit transition releases its pointer lock asynchronously.
  await waitFor(() => expect(getComputedStyle(button).pointerEvents).not.toBe('none'))
  await userEvent.click(button)
}

/** Reopen twice so interactions also prove reset rather than only first-mount state. */
export async function dismissAndReopen(context: NavigationPlayContext, placeholder: string) {
  const body = dialogQueries(context)
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = await body.findByPlaceholderText(placeholder)
    await userEvent.clear(input)
    await userEvent.type(input, 'no-such-result')
    await userEvent.keyboard('{Escape}')
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    await reopenWorkflow(context)
    await expect(await body.findByPlaceholderText(placeholder)).toHaveValue('')
  }
}

export function markNavigationReady(context: NavigationPlayContext) {
  context.canvasElement.ownerDocument.body.dataset.navigationReady = context.id
}
