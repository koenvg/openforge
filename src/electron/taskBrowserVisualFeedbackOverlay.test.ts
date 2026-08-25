import { beforeEach, describe, expect, it } from 'vitest'

import {
  TASK_BROWSER_VISUAL_FEEDBACK_THEME,
  buildTaskBrowserVisualFeedbackAnnotationsScript,
  runTaskBrowserVisualFeedbackOverlay,
} from './taskBrowserVisualFeedbackOverlay'

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

function openFeedbackComposer(nextAnnotationNumber: number): {
  selection: ReturnType<typeof runTaskBrowserVisualFeedbackOverlay>
  composer: HTMLFormElement
  textarea: HTMLTextAreaElement
} {
  const selection = runTaskBrowserVisualFeedbackOverlay(executeInPage, {
    savedAnnotations: [],
    nextAnnotationNumber,
  })
  const interaction = document.querySelector<HTMLElement>('#__openforge_visual_feedback_selector__ > div:last-child')
  if (!interaction) throw new Error('Expected visual feedback interaction layer')
  interaction.setPointerCapture = () => undefined
  dispatchPointer(interaction, 'pointerdown', { clientX: 100, clientY: 120 })
  dispatchPointer(interaction, 'pointerup', { clientX: 300, clientY: 280 })
  const composer = document.querySelector<HTMLFormElement>('form[aria-label="Visual feedback comment"]')
  const textarea = composer?.querySelector('textarea')
  if (!composer || !textarea) throw new Error('Expected visual feedback comment composer')
  return { selection, composer, textarea }
}

beforeEach(() => {
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

describe('Task Browser visual feedback overlay', () => {
  it('renders saved feedback markers through the shared semantic overlay theme', async () => {
    await executeInPage(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({
        savedAnnotations: [{
          number: 3,
          comment: 'Use the shared marker renderer',
          x: 16,
          y: 32,
          width: 96,
          height: 48,
        }],
      })}
    })()`)

    const annotation = document.querySelector<HTMLElement>('[role="note"]')
    const badge = annotation?.querySelector<HTMLElement>('span')
    const expectedAnnotation = document.createElement('div')
    expectedAnnotation.style.border = `2px solid ${TASK_BROWSER_VISUAL_FEEDBACK_THEME.annotationBorder}`
    expectedAnnotation.style.background = TASK_BROWSER_VISUAL_FEEDBACK_THEME.annotationBackground
    const expectedBadge = document.createElement('span')
    expectedBadge.style.background = TASK_BROWSER_VISUAL_FEEDBACK_THEME.accentBackground
    expectedBadge.style.color = TASK_BROWSER_VISUAL_FEEDBACK_THEME.foreground
    expect(annotation?.style.border).toBe(expectedAnnotation.style.border)
    expect(annotation?.style.background).toBe(expectedAnnotation.style.background)
    expect(badge?.style.background).toBe(expectedBadge.style.background)
    expect(badge?.style.color).toBe(expectedBadge.style.color)
  })

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
    const { selection, composer, textarea } = openFeedbackComposer(7)
    expect(composer.style.left).toBe('308px')
    expect(composer.style.top).toBe('288px')

    textarea.value = '  Clarify the selected navigation  '
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    composer.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))

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

  it('hides composer typing from live-page key handlers', async () => {
    const pageKeys: string[] = []
    const swallowKeys = (event: Event) => {
      pageKeys.push((event as KeyboardEvent).key)
      event.preventDefault()
    }
    document.addEventListener('keydown', swallowKeys, true)
    document.addEventListener('keydown', swallowKeys)
    try {
      const { selection, textarea } = openFeedbackComposer(3)
      const typed = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
      textarea.dispatchEvent(typed)

      expect(pageKeys).toEqual([])
      expect(typed.defaultPrevented).toBe(false)

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await expect(selection).resolves.toBeNull()
    } finally {
      document.removeEventListener('keydown', swallowKeys, true)
      document.removeEventListener('keydown', swallowKeys)
    }
  })

  it('keeps composer focus when the live page traps focus, and releases the trap on teardown', async () => {
    const trapped = document.createElement('button')
    document.body.append(trapped)
    trapped.focus()
    const stealFocus = () => trapped.focus()
    document.addEventListener('focus', stealFocus, true)
    document.addEventListener('focusin', stealFocus, true)
    try {
      const { selection, textarea } = openFeedbackComposer(4)
      expect(document.activeElement).toBe(textarea)

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await expect(selection).resolves.toBeNull()

      const pageField = document.createElement('input')
      document.body.append(pageField)
      pageField.focus()
      expect(document.activeElement).toBe(trapped)
    } finally {
      document.removeEventListener('focus', stealFocus, true)
      document.removeEventListener('focusin', stealFocus, true)
    }
  })

  it('dismisses only the composer when Escape is pressed while commenting', async () => {
    const { selection, composer, textarea } = openFeedbackComposer(5)

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(composer.isConnected).toBe(false)
    expect(document.getElementById('__openforge_visual_feedback_selector__')).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(selection).resolves.toBeNull()
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
