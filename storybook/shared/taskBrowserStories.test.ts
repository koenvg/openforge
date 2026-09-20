import { cleanup, fireEvent, render, within } from '@testing-library/svelte'
import { composeStories } from '@storybook/svelte-vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as componentStories from '../stories/components/TaskBrowser.stories'
import * as pageStories from '../stories/pages/TaskBrowser.stories'
import { getStoryScenario, storyEnvironmentPreview, type StoryScenario } from './storyEnvironmentPreview'

const disposals: Array<() => Promise<void>> = []
let latestScenario: StoryScenario

const pages = composeStories(pageStories, {
  ...storyEnvironmentPreview,
  async beforeEach(context) {
    const dispose = await storyEnvironmentPreview.beforeEach(context)
    latestScenario = getStoryScenario(context)
    disposals.push(dispose)
    return dispose
  },
})
const components = composeStories(componentStories, storyEnvironmentPreview)

let diagnostics: string[] = []
beforeEach(() => {
  diagnostics = []
  vi.spyOn(console, 'error').mockImplementation((...args) => { diagnostics.push(args.join(' ')) })
  vi.spyOn(console, 'warn').mockImplementation((...args) => { diagnostics.push(args.join(' ')) })
})

afterEach(async () => {
  cleanup()
  for (const dispose of disposals.splice(0).reverse()) await dispose()
  document.body.replaceChildren()
  await new Promise(resolve => setTimeout(resolve, 0))
  try {
    expect(diagnostics).toEqual([])
  } finally {
    vi.restoreAllMocks()
  }
})

describe('Task Browser catalog', () => {
  it('resets resources and repeats public page and component interactions without diagnostics', async () => {
    const canvas = document.createElement('div')
    document.body.append(canvas)
    const view = within(canvas)
    try {
      await pages.Empty.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByText('No page loaded')).toBeTruthy()
      expect(document.body.dataset.taskBrowserReady).toBe('pages-task-browser--empty')
      await pages.Failure.run({ canvasElement: canvas, testingLibraryRender: render })
      expect((await view.findAllByText('The local preview could not be loaded')).length).toBeGreaterThanOrEqual(1)
      expect(document.body.dataset.taskBrowserReady).toBe('pages-task-browser--failure')
      await pages.Disconnected.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByText('Browser runtime disconnected')).toBeTruthy()
      expect(document.body.dataset.taskBrowserReady).toBe('pages-task-browser--disconnected')

      await pages.Populated.run({ canvasElement: canvas, testingLibraryRender: render })
      const firstScenario = latestScenario
      const address = await view.findByDisplayValue('https://catalog.openforge.local/tasks/T-42')
      await fireEvent.input(address, { target: { value: 'https://catalog.openforge.local/review' } })
      await fireEvent.click(view.getByRole('button', { name: 'Go' }))
      await view.findByDisplayValue('https://catalog.openforge.local/review')
      await fireEvent.click(view.getByRole('button', { name: 'Open Developer Tools' }))
      expect(firstScenario.plugin.calls.storageSets.length).toBeGreaterThan(0)

      await pages.Populated.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByDisplayValue('https://catalog.openforge.local/tasks/T-42')).toBeTruthy()
      expect(view.getByRole('button', { name: 'Open Developer Tools' }).getAttribute('aria-pressed')).toBe('false')
      expect(view.getAllByLabelText('Attached browser page')).toHaveLength(1)
      expect(firstScenario.plugin.calls.browserSurfaceDetaches).toEqual([{ taskId: 'T-42', id: 'main' }])
      expect(latestScenario.plugin.calls.storageSets).toHaveLength(1)
      expect(document.body.dataset.taskBrowserReady).toBe('pages-task-browser--populated')

      await pages.VisualFeedback.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByText('1 screenshot · 1 annotation')).toBeTruthy()
      await pages.VisualFeedback.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(view.getAllByText('1 screenshot · 1 annotation')).toHaveLength(1)
      expect(document.body.dataset.taskBrowserReady).toBe('pages-task-browser--visual-feedback')

      for (const [name, story] of [
        ['Navigation', pages.Navigation],
        ['StopLoading', pages.StopLoading],
        ['RetryConnection', pages.RetryConnection],
        ['InvalidAddress', pages.InvalidAddress],
        ['SendFeedback', pages.SendFeedback],
      ] as const) {
        await story.run({ canvasElement: canvas, testingLibraryRender: render })
        await story.run({ canvasElement: canvas, testingLibraryRender: render })
        expect(diagnostics, name).toEqual([])
      }

      await components.FeedbackActions.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByText('1 screenshot · 1 annotation')).toBeTruthy()
      expect(document.body.dataset.taskBrowserReady).toBe('components-task-browser--feedback-actions')
      await components.Review.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByRole('region', { name: 'Visual feedback review' })).toBeTruthy()
      expect(document.body.dataset.taskBrowserReady).toBe('components-task-browser--review')
      await components.EditReview.run({ canvasElement: canvas, testingLibraryRender: render })
      await components.EditReview.run({ canvasElement: canvas, testingLibraryRender: render })
      expect((view.getByRole('textbox', { name: 'Comment for annotation 1' }) as HTMLTextAreaElement).value)
        .toBe('Use the compact toolbar spacing')
      expect(diagnostics).toEqual([])
    } finally {
      // Testing Library owns unmounting; afterEach removes the now-empty canvas.
    }
  }, 20_000)
})
