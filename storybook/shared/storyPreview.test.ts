import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { composeStories } from '@storybook/svelte-vite'
import * as stories from '../stories/components/StoryEnvironment.stories'
import { storyEnvironmentPreview } from './storyEnvironmentPreview'

const disposals: Array<() => Promise<void>> = []
const { Editable } = composeStories(stories, {
  ...storyEnvironmentPreview,
  async beforeEach(context) {
    const dispose = await storyEnvironmentPreview.beforeEach(context)
    disposals.push(dispose)
    return dispose
  },
})
afterEach(async () => {
  cleanup()
  for (const dispose of disposals.splice(0).reverse()) await dispose()
})

describe('Storybook environment preview', () => {
  it('starts each render with original fixture state and restores the desktop bridge on cleanup', async () => {
    const previousBridge = window.openforge
    const HostDate = Date
    const canvas = document.createElement('div')
    document.body.append(canvas)
    try {
      await Editable.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await screen.findByText('original')).toBeTruthy()
      await fireEvent.click(screen.getByRole('button', { name: 'Edit fixture' }))
      expect(await screen.findByText('edited')).toBeTruthy()
      await Editable.run({ canvasElement: canvas, testingLibraryRender: render })
      expect(await screen.findByText('original')).toBeTruthy()
      expect(screen.queryByText('edited')).toBeNull()
      cleanup()
      for (const dispose of disposals.splice(0).reverse()) await dispose()
      expect(window.openforge).toBe(previousBridge)
      expect(Date).toBe(HostDate)
    } finally {
      canvas.remove()
    }
  })
})
