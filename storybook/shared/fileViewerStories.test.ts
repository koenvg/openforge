import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/svelte'
import { composeStories } from '@storybook/svelte-vite'
import * as stories from '../stories/pages/FileViewer.stories'
import { storyEnvironmentPreview, getStoryScenario, type StoryScenario } from './storyEnvironmentPreview'
import { fileViewerProject } from './fixtures/fileViewerScenario'

const disposals: Array<() => Promise<void>> = []
let scenario: StoryScenario
const composed = composeStories(stories, {
  ...storyEnvironmentPreview,
  async beforeEach(context) {
    const dispose = await storyEnvironmentPreview.beforeEach(context)
    scenario = getStoryScenario(context)
    disposals.push(dispose)
    return dispose
  },
})
let diagnostics: string[] = []
beforeEach(() => {
  diagnostics = []
  vi.spyOn(console, 'error').mockImplementation((...args) => { diagnostics.push(args.join(' ')) })
  vi.spyOn(console, 'warn').mockImplementation((...args) => { diagnostics.push(args.join(' ')) })
})
afterEach(async () => {
  cleanup()
  for (const dispose of disposals.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
  expect(diagnostics).toEqual([])
})

describe('File Viewer catalog', () => {
  it('resets selections, fixture edits, and persisted layout across same-document renders and story switching', async () => {
    const canvas = document.createElement('div')
    document.body.append(canvas)
    try {
      await composed.Populated.run({ canvasElement: canvas, testingLibraryRender: render })
      const view = within(canvas)
      await fireEvent.click(await view.findByRole('treeitem', { name: /^README\.md/ }))
      expect(await view.findByRole('heading', { name: 'File Viewer guide' })).toBeTruthy()
      await scenario.plugin.api.fs.writeFile({ projectId: fileViewerProject.id, path: 'README.md', content: 'Edited fixture' })
      await fireEvent.keyDown(view.getByRole('separator', { name: 'Resize files panel' }), { key: 'ArrowRight' })
      expect(localStorage.getItem('resizable-panel:files-tree')).not.toBeNull()
      await composed.Populated.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByText('Select a file to view its content')).toBeTruthy()
      expect(localStorage.getItem('resizable-panel:files-tree')).toBeNull()
      expect(view.getByRole('separator', { name: 'Resize files panel' }).getAttribute('aria-valuenow')).toBe('240')
      await fireEvent.click(await view.findByRole('treeitem', { name: /^README\.md/ }))
      expect(await view.findByRole('heading', { name: 'File Viewer guide' })).toBeTruthy()
      expect(view.queryByText('Edited fixture')).toBeNull()
      await composed.TaskPane.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await view.findByText('Live worktree')).toBeTruthy()
      expect(await view.findByText('Select a file to view its content')).toBeTruthy()
      for (const name of ['Navigate', 'TaskNavigate', 'RetryRoot', 'FinishLoading', 'Search', 'SearchLoading', 'SearchFailure', 'DirectoryFailure'] as const) {
        await composed[name].run({ canvasElement: canvas, testingLibraryRender: render })
        await composed[name].run({ canvasElement: canvas, testingLibraryRender: render })
      }
    } finally { canvas.remove() }
  }, 30_000)
})
