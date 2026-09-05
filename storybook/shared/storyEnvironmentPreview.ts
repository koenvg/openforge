import type { Preview } from '@storybook/svelte-vite'
import { createStoryDesktopAdapter, type StoryDesktopDefinition } from './environment/storyDesktopAdapter'
import { createStoryPluginAdapter, type StoryPluginDefinition } from './environment/storyPluginAdapter'
import { createStoryEnvironment, type StoryEnvironmentAdapter } from './environment/storyEnvironment'
import StoryEnvironmentFrame from './StoryEnvironmentFrame.svelte'
import { createStoryStorageAdapter } from './environment/storyStorageAdapter'
import { createStoryThemeAdapter } from './environment/storyThemeAdapter'

export interface StoryScenarioDefinition {
  now?: string | number
  desktop?: StoryDesktopDefinition
  plugin?: StoryPluginDefinition
  adapters?: () => readonly StoryEnvironmentAdapter[]
  /** Exact diagnostic fragments expected from deliberately failed local responses. */
  expectedConsoleErrors?: readonly string[]
}

function createScenario(id: string, definition: StoryScenarioDefinition, themeId: string) {
  const desktop = createStoryDesktopAdapter(definition.desktop)
  const plugin = createStoryPluginAdapter(definition.plugin)
  const environment = createStoryEnvironment({
    id,
    now: definition.now ?? '2026-01-02T09:30:00.000Z',
    adapters: [
      createStoryStorageAdapter(window.localStorage),
      createStoryStorageAdapter(window.sessionStorage),
      desktop, createStoryThemeAdapter(themeId), plugin, ...(definition.adapters?.() ?? []),
    ],
  })
  return { environment, desktop, plugin }
}

export type StoryScenario = ReturnType<typeof createScenario>

export function getStoryScenario(context: { loaded: Record<string, unknown> }): StoryScenario {
  const scenario = context.loaded.openforge as StoryScenario | undefined
  if (!scenario) throw new Error('Story environment has not been installed')
  return scenario
}

// Desktop globals are document-wide. Docs stories use separate iframes rather than inline canvases.
const active = new WeakMap<Document, StoryScenario>()

export const storyEnvironmentPreview = {
  parameters: { docs: { story: { inline: false } } },
  beforeEach: async (context) => {
    const document = context.canvasElement.ownerDocument
    await active.get(document)?.environment.dispose()
    const scenario = createScenario(context.id, context.parameters.openforge ?? {}, context.globals.openforgeTheme ?? 'openforge-light')
    await scenario.environment.install()
    active.set(document, scenario)
    context.loaded.openforge = scenario
    return async () => {
      await scenario.environment.dispose()
      if (active.get(document) === scenario) active.delete(document)
    }
  },
  decorators: [(_Story, context) => ({
    Component: StoryEnvironmentFrame,
    props: { scenario: getStoryScenario(context) },
  })],
} satisfies Preview
