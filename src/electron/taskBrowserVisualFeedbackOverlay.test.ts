import { beforeEach, describe, expect, it } from 'vitest'

import {
  TASK_BROWSER_VISUAL_FEEDBACK_THEME,
  TASK_BROWSER_VISUAL_FEEDBACK_THEMES,
  buildTaskBrowserVisualFeedbackAnnotationsScript,
  runTaskBrowserVisualFeedbackOverlay,
} from './taskBrowserVisualFeedbackOverlay'
import { TaskBrowserVisualFeedbackController } from './taskBrowserVisualFeedback'

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

function openFeedbackComposer(
  nextAnnotationNumber: number,
  savedAnnotations: Parameters<typeof buildTaskBrowserVisualFeedbackAnnotationsScript>[0]['savedAnnotations'] = [],
): {
  selection: ReturnType<typeof runTaskBrowserVisualFeedbackOverlay>
  composer: HTMLFormElement
  textarea: HTMLTextAreaElement
} {
  const selection = runTaskBrowserVisualFeedbackOverlay(executeInPage, {
    savedAnnotations,
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

  it('applies light and dark palettes without resetting same-page disclosure state', async () => {
    const annotation = {
      number: 1,
      comment: 'Keep the configured appearance',
      x: 16,
      y: 32,
      width: 96,
      height: 48,
    }
    const render = async (appearance: 'light' | 'dark') => {
      await executeInPage(`(() => {
        ${buildTaskBrowserVisualFeedbackAnnotationsScript({
          savedAnnotations: [annotation],
          appearance,
        })}
      })()`)
    }

    await render('light')
    const lightCard = document.querySelector<HTMLElement>('[aria-label="Visual feedback comments"]')
    const lightBadge = document.querySelector<HTMLElement>('[role="note"] span')
    const expectedLight = document.createElement('div')
    expectedLight.style.background = TASK_BROWSER_VISUAL_FEEDBACK_THEMES.light.panelBackground
    expectedLight.style.color = TASK_BROWSER_VISUAL_FEEDBACK_THEMES.light.foreground
    expect(lightCard?.style.background).toBe(expectedLight.style.background)
    expect(lightCard?.style.color).toBe(expectedLight.style.color)
    const expectedLightAccent = document.createElement('div')
    expectedLightAccent.style.color = TASK_BROWSER_VISUAL_FEEDBACK_THEMES.light.accentForeground
    expect(lightBadge?.style.color).toBe(expectedLightAccent.style.color)

    lightCard?.querySelector<HTMLButtonElement>('button')?.click()
    expect(lightCard?.dataset.expanded).toBe('false')

    await render('dark')
    const darkCard = document.querySelector<HTMLElement>('[aria-label="Visual feedback comments"]')
    const expectedDark = document.createElement('div')
    expectedDark.style.background = TASK_BROWSER_VISUAL_FEEDBACK_THEMES.dark.panelBackground
    expectedDark.style.color = TASK_BROWSER_VISUAL_FEEDBACK_THEMES.dark.foreground
    expect(darkCard?.style.background).toBe(expectedDark.style.background)
    expect(darkCard?.style.color).toBe(expectedDark.style.color)
    expect(darkCard?.dataset.expanded).toBe('false')
  })

  it('shows current-page comments in annotation order with an accessible count', async () => {
    await executeInPage(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({
        savedAnnotations: [
          { number: 8, comment: 'Tighten the footer spacing', x: 80, y: 160, width: 120, height: 40 },
          { number: 2, comment: 'Rename this action', x: 20, y: 40, width: 100, height: 32 },
        ],
      })}
    })()`)

    const card = document.querySelector<HTMLElement>('[aria-label="Visual feedback comments"]')
    expect(card?.parentElement?.id).toBe('__openforge_visual_feedback_annotations__')
    const comments = Array.from(card?.querySelectorAll('li') ?? [])

    expect(card?.style.position).toBe('fixed')
    expect(card?.style.right).toBe('12px')
    expect(card?.style.bottom).toBe('12px')
    expect(card?.textContent).toContain('2 annotations')
    expect(comments.map(comment => comment.textContent)).toEqual([
      '2Rename this action×',
      '8Tighten the footer spacing×',
    ])

    await executeInPage(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({
        savedAnnotations: [
          { number: 3, comment: 'Keep this singular', x: 30, y: 60, width: 90, height: 30 },
        ],
      })}
    })()`)
    expect(document.querySelector('[aria-label="Visual feedback comments"]')?.textContent)
      .toContain('1 annotation')

    await executeInPage(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({ savedAnnotations: [] })}
    })()`)
    expect(document.querySelector('[aria-label="Visual feedback comments"]')).toBeNull()
  })

  it('keeps keyboard disclosure state while synchronizing the same URL', async () => {
    const firstScript = buildTaskBrowserVisualFeedbackAnnotationsScript({
      savedAnnotations: [
        { number: 1, comment: 'Clarify the heading', x: 20, y: 40, width: 100, height: 32 },
      ],
    })
    await executeInPage(`(() => { ${firstScript} })()`)

    const initialButton = document.querySelector<HTMLButtonElement>('[aria-label="Collapse visual feedback comments"]')
    const initialList = document.querySelector<HTMLOListElement>('#__openforge_visual_feedback_comment_list__')
    expect(initialButton?.getAttribute('aria-expanded')).toBe('true')
    expect(initialList?.hidden).toBe(false)

    initialButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(initialButton?.getAttribute('aria-expanded')).toBe('false')
    expect(initialList?.hidden).toBe(true)

    const updateScript = buildTaskBrowserVisualFeedbackAnnotationsScript({
      savedAnnotations: [
        { number: 1, comment: 'Use the revised heading', x: 20, y: 40, width: 100, height: 32 },
        { number: 2, comment: 'Align the action', x: 120, y: 80, width: 80, height: 28 },
      ],
    })
    await executeInPage(`(() => { ${updateScript} })()`)

    const updatedButton = document.querySelector<HTMLButtonElement>('[aria-label="Expand visual feedback comments"]')
    const updatedList = document.querySelector<HTMLOListElement>('#__openforge_visual_feedback_comment_list__')
    expect(updatedButton?.getAttribute('aria-expanded')).toBe('false')
    expect(updatedButton?.textContent).toContain('2 annotations')
    expect(updatedList?.hidden).toBe(true)

    updatedButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(updatedButton?.getAttribute('aria-expanded')).toBe('true')
    expect(updatedList?.hidden).toBe(false)
    expect(updatedList?.textContent).toContain('Use the revised heading')
  })

  it('renders keyboard-operable delete controls without honoring programmatic page activation', async () => {
    await executeInPage(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({
        savedAnnotations: [
          { number: 4, comment: 'Remove this finding', x: 20, y: 40, width: 100, height: 32 },
        ],
      })}
    })()`)

    const deleteControl = document.querySelector<HTMLButtonElement>('[aria-label="Delete annotation 4"]')
    expect(deleteControl?.tabIndex).toBe(0)
    deleteControl?.focus()
    expect(deleteControl?.style.outline).toContain(TASK_BROWSER_VISUAL_FEEDBACK_THEME.annotationBorder)

    deleteControl?.click()

    expect(document.querySelector('[aria-label="Delete annotation 4"]')).toBe(deleteControl)
    expect(document.querySelector('[role="note"]')?.textContent).toBe('4')
  })

  it('bounds and isolates the card from live-page styles and events', async () => {
    const pageStyle = document.createElement('style')
    pageStyle.textContent = 'section, button, ol, li, span { position: static; color: hotpink; padding: 99px; }'
    document.head.append(pageStyle)
    let pageClicks = 0
    const recordPageClick = () => { pageClicks += 1 }
    document.addEventListener('click', recordPageClick)
    try {
      await executeInPage(`(() => {
        ${buildTaskBrowserVisualFeedbackAnnotationsScript({
          savedAnnotations: [
            { number: 5, comment: 'A long comment that must wrap inside the bounded card', x: 20, y: 40, width: 100, height: 32 },
          ],
        })}
      })()`)

      const card = document.querySelector<HTMLElement>('#__openforge_visual_feedback_comments__')
      const list = document.querySelector<HTMLOListElement>('#__openforge_visual_feedback_comment_list__')
      const disclosure = card?.querySelector<HTMLButtonElement>('button')
      expect(card?.style.getPropertyValue('all')).toBe('initial')
      expect(card?.style.width).toContain('320px')
      expect(card?.style.width).toContain('100vw')
      expect(card?.style.maxHeight).toContain('100vh')
      expect(card?.style.pointerEvents).toBe('auto')
      expect(list?.style.maxHeight).toContain('100vh')
      expect(list?.style.overflowY).toBe('auto')

      disclosure?.focus()
      expect(disclosure?.style.outline).toContain(TASK_BROWSER_VISUAL_FEEDBACK_THEME.annotationBorder)
      disclosure?.click()
      expect(pageClicks).toBe(0)

      await executeInPage(`(() => {
        ${buildTaskBrowserVisualFeedbackAnnotationsScript({ savedAnnotations: [] })}
      })()`)
      const pageButton = document.createElement('button')
      document.body.append(pageButton)
      pageButton.click()
      expect(pageClicks).toBe(1)
    } finally {
      document.removeEventListener('click', recordPageClick)
    }
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
    expect(annotations?.querySelector('[role="note"]')?.textContent).toBe('4')

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

  it('hides comments during selection and restores the latest list afterward', async () => {
    const savedAnnotations = [
      { number: 1, comment: 'Keep the existing note', x: 24, y: 48, width: 120, height: 32 },
    ]
    const cancelledSelection = runTaskBrowserVisualFeedbackOverlay(executeInPage, {
      savedAnnotations,
      nextAnnotationNumber: 2,
    })
    const hiddenCard = document.querySelector<HTMLElement>('#__openforge_visual_feedback_comments__')
    expect(hiddenCard?.style.display).toBe('none')
    expect(hiddenCard?.getAttribute('aria-hidden')).toBe('true')
    expect(hiddenCard?.style.pointerEvents).toBe('none')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(cancelledSelection).resolves.toBeNull()
    expect(hiddenCard?.style.display).toBe('flex')
    expect(hiddenCard?.hasAttribute('aria-hidden')).toBe(false)
    expect(hiddenCard?.style.pointerEvents).toBe('auto')

    const { selection, composer, textarea } = openFeedbackComposer(2, savedAnnotations)
    expect(document.querySelector<HTMLElement>('#__openforge_visual_feedback_comments__')?.style.display)
      .toBe('none')
    textarea.value = 'Add the new note immediately'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    composer.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await expect(selection).resolves.toMatchObject({ comment: 'Add the new note immediately' })

    const restoredCard = document.querySelector<HTMLElement>('#__openforge_visual_feedback_comments__')
    expect(restoredCard?.style.display).toBe('flex')
    expect(restoredCard?.hasAttribute('aria-hidden')).toBe(false)
    expect(Array.from(restoredCard?.querySelectorAll('li') ?? []).map(item => item.textContent)).toEqual([
      '1Keep the existing note×',
      '2Add the new note immediately×',
    ])
  })

  it('removes the complete annotation root from rendering during viewport capture', async () => {
    await executeInPage(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({
        savedAnnotations: [
          { number: 1, comment: 'Exclude this card from capture', x: 24, y: 48, width: 120, height: 32 },
        ],
      })}
    })()`)
    const controller = new TaskBrowserVisualFeedbackController({
      isDestroyed: () => false,
      executeJavaScript: executeInPage,
    } as never, () => false, () => true)
    const root = document.getElementById('__openforge_visual_feedback_annotations__')
    const card = document.getElementById('__openforge_visual_feedback_comments__')

    await controller.setVisibility('hidden')
    expect(root?.style.display).toBe('none')
    expect(root?.getAttribute('aria-hidden')).toBe('true')
    expect(card?.style.display).toBe('flex')

    await controller.setVisibility('')
    expect(root?.style.display).toBe('')
    expect(root?.hasAttribute('aria-hidden')).toBe(false)
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
