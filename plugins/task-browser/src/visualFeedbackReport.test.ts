import type { BrowserSurfaceCapture, BrowserSurfaceRegion } from '@openforge-app/plugin-sdk/frontend'
import type { Task } from '@openforge-app/plugin-sdk'
import { describe, expect, it } from 'vitest'
import { formatVisualFeedbackReport } from './visualFeedbackReport'

function task(): Task {
  return {
    id: 'T-42',
    initial_prompt: 'Improve the checkout page',
    status: 'doing',
    prompt: null,
    title: 'Checkout polish',
    title_source: 'manual',
    title_generated_at: null,
    summary: null,
    agent: 'worker',
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    source_ticket_url: null,
    depends_on: [],
    project_id: 'P-1',
    created_at: 0,
    updated_at: 0,
  }
}

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
  it('formats deterministic Task context, immutable capture metadata, and marker comments', () => {
    const report = formatVisualFeedbackReport(task(), [
      { number: 2, rect, comment: 'Second marker', capture: capture({ artifactId: 'capture-2', absolutePath: '/tmp/capture-2.png' }) },
      { number: 1, rect, comment: 'Tighten spacing.\nKeep the button visible.', capture: capture() },
    ])

    expect(report).toBe(`# Task Browser visual feedback

Task: \`T-42\` — Checkout polish

## Marker 1

- URL: https://shop.example/checkout
- Title: Checkout
- Captured: 2026-08-11T14:30:00.000Z
- Viewport: 1280 × 720
- PNG: \`/Users/test/Library/Application Support/OpenForge/task-browser/capture-1.png\`
- Region: x=0.125, y=0.25, width=0.5, height=0.125

Comment:

> Tighten spacing.
> Keep the button visible.

## Marker 2

- URL: https://shop.example/checkout
- Title: Checkout
- Captured: 2026-08-11T14:30:00.000Z
- Viewport: 1280 × 720
- PNG: \`/tmp/capture-2.png\`
- Region: x=0.125, y=0.25, width=0.5, height=0.125

Comment:

> Second marker
`)
  })
})
