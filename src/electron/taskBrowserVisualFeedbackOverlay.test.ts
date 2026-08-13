import { beforeEach, describe, expect, it } from 'vitest'

import { runTaskBrowserVisualFeedbackOverlay } from './taskBrowserVisualFeedbackOverlay'

const executeInPage = async (script: string): Promise<unknown> => (0, eval)(script)

function dispatchPointer(target: Element, type: string, properties: {
  clientX: number
  clientY: number
  pointerId?: number
  pointerType?: string
  button?: number
}): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: properties.clientX,
    clientY: properties.clientY,
    button: properties.button ?? 0,
  })
  Object.defineProperties(event, {
    pointerId: { value: properties.pointerId ?? 1 },
    pointerType: { value: properties.pointerType ?? 'mouse' },
  })
  target.dispatchEvent(event)
}

beforeEach(() => {
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

describe('Task Browser visual feedback overlay', () => {
  it('renders saved feedback markers and cancels the active selection with Escape', async () => {
    const selection = runTaskBrowserVisualFeedbackOverlay(executeInPage, {
      savedAnnotations: [{
        number: 4,
        comment: 'Keep this aligned',
        x: 24,
        y: 48,
        width: 120,
        height: 32,
      }],
      nextAnnotationNumber: 5,
    })

    const annotations = document.getElementById('__openforge_visual_feedback_annotations__')
    expect(annotations?.dataset.pageUrl).toBe(location.href)
    expect(annotations?.querySelector('[role="note"]')?.getAttribute('aria-label'))
      .toBe('Feedback 4: Keep this aligned')
    expect(annotations?.textContent).toBe('4')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    await expect(selection).resolves.toBeNull()
    expect(document.getElementById('__openforge_visual_feedback_selector__')).toBeNull()
  })

  it('selects a dragged live-page rectangle and anchors its composer beside the selection', async () => {
    const selection = runTaskBrowserVisualFeedbackOverlay(executeInPage, {
      savedAnnotations: [],
      nextAnnotationNumber: 7,
    })
    const interaction = document.querySelector<HTMLElement>('#__openforge_visual_feedback_selector__ > div:last-child')
    expect(interaction).not.toBeNull()
    if (!interaction) throw new Error('Expected visual feedback interaction layer')
    interaction.setPointerCapture = () => undefined

    dispatchPointer(interaction, 'pointerdown', { clientX: 100, clientY: 120 })
    dispatchPointer(interaction, 'pointerup', { clientX: 300, clientY: 280 })

    const composer = document.querySelector<HTMLFormElement>('form[aria-label="Visual feedback comment"]')
    expect(composer?.style.left).toBe('308px')
    expect(composer?.style.top).toBe('288px')
    const textarea = composer?.querySelector('textarea')
    if (!textarea) throw new Error('Expected visual feedback comment field')
    textarea.value = '  Clarify the selected navigation  '
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    composer?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))

    await expect(selection).resolves.toEqual({
      region: { x: 0.1, y: 0.15, width: 0.2, height: 0.2 },
      comment: 'Clarify the selected navigation',
      annotation: {
        number: 7,
        comment: 'Clarify the selected navigation',
        x: 100,
        y: 120,
        width: 200,
        height: 160,
      },
    })
  })

  it('uses the live page element under a point selection', async () => {
    const target = document.createElement('button')
    target.getBoundingClientRect = () => ({
      x: 50, y: 60, left: 50, top: 60, right: 300, bottom: 160,
      width: 250, height: 100, toJSON: () => ({}),
    })
    document.body.append(target)
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [target] })
    const selection = runTaskBrowserVisualFeedbackOverlay(executeInPage, {
      savedAnnotations: [],
      nextAnnotationNumber: 11,
    })
    const interaction = document.querySelector<HTMLElement>('#__openforge_visual_feedback_selector__ > div:last-child')
    if (!interaction) throw new Error('Expected visual feedback interaction layer')
    interaction.setPointerCapture = () => undefined
    dispatchPointer(interaction, 'pointermove', { clientX: 80, clientY: 90 })
    dispatchPointer(interaction, 'pointerdown', { clientX: 80, clientY: 90 })
    dispatchPointer(interaction, 'pointerup', { clientX: 80, clientY: 90 })

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback comment"]')
    if (!textarea) throw new Error('Expected visual feedback comment field')
    textarea.value = 'Use the whole button'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    await expect(selection).resolves.toEqual({
      region: { x: 0.05, y: 0.075, width: 0.25, height: 0.125 },
      comment: 'Use the whole button',
      annotation: {
        number: 11, comment: 'Use the whole button',
        x: 50, y: 60, width: 250, height: 100,
      },
    })
  })

  it('rejects malformed results returned across the live-page execution seam', async () => {
    const execute = async (): Promise<unknown> => ({
      region: { x: 0.1, y: 0.2, width: Number.NaN, height: 0.4 },
      comment: 'Invalid region',
      annotation: { number: 12, x: 100, y: 120, width: 200, height: 160 },
    })

    await expect(runTaskBrowserVisualFeedbackOverlay(execute, {
      savedAnnotations: [],
      nextAnnotationNumber: 12,
    })).rejects.toThrow('Live page returned invalid visual feedback')
  })
})
