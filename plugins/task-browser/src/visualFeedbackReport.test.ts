import type { BrowserSurfaceCapture, BrowserSurfaceRegion } from '@openforge-app/plugin-sdk/frontend'
import { describe, expect, it } from 'vitest'
import { formatVisualFeedbackReport } from './visualFeedbackReport'

function capture(overrides: Partial<BrowserSurfaceCapture> = {}): BrowserSurfaceCapture {
  return {
    artifactId: 'capture-1',
    absolutePath: '/Users/test/Library/Application Support/OpenForge/task-browser/capture-1.png',
    mediaType: 'image/png',
    width: 1280,
    height: 720,
    url: 'https://shop.example/checkout',
    title: 'Checkout',
    capturedAt: '2026-08-11T14:30:00.000Z',
    dataUrl: 'data:image/png;base64,cG5n',
    ...overrides,
  }
}

const rect: BrowserSurfaceRegion = { x: 0.125, y: 0.25, width: 0.5, height: 0.125 }

describe('visual feedback report', () => {
  it('formats captures and annotations in deterministic session order', () => {
    const report = formatVisualFeedbackReport([
      { number: 2, evidence: capture({ artifactId: 'capture-2', absolutePath: '/tmp/capture-2.png', url: 'https://shop.example/confirmation' }) },
      { number: 1, evidence: capture() },
    ], [
      { number: 3, captureNumber: 2, rect, comment: 'Confirmation marker' },
      { number: 2, captureNumber: 1, rect, comment: 'Second checkout marker' },
      { number: 1, captureNumber: 1, rect, comment: 'Tighten spacing.\nKeep the button visible.' },
    ])

    expect(report).toBe(`# Task Browser visual feedback

## Capture 1

- URL: https://shop.example/checkout
- Title: Checkout
- Captured: 2026-08-11T14:30:00.000Z
- Viewport: 1280 × 720
- PNG: \`/Users/test/Library/Application Support/OpenForge/task-browser/capture-1.png\`

### Annotation 1

- Region: x=0.125, y=0.25, width=0.5, height=0.125

Comment:

> Tighten spacing.
> Keep the button visible.

### Annotation 2

- Region: x=0.125, y=0.25, width=0.5, height=0.125

Comment:

> Second checkout marker

## Capture 2

- URL: https://shop.example/confirmation
- Title: Checkout
- Captured: 2026-08-11T14:30:00.000Z
- Viewport: 1280 × 720
- PNG: \`/tmp/capture-2.png\`

### Annotation 3

- Region: x=0.125, y=0.25, width=0.5, height=0.125

Comment:

> Confirmation marker
`)
  })
})
