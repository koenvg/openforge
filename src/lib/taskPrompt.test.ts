import { describe, expect, it } from 'vitest'
import {
  formatTaskPromptWithImageReferences,
  getTaskPromptImageReferences,
  getTaskPromptText,
  parseTaskPrompt,
} from './taskPrompt'
import type { Task } from './types'

describe('getTaskPromptText', () => {
  const baseTask = {
    id: 'T-123',
    status: 'backlog' as const,
    agent: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: null,
    created_at: 0,
    updated_at: 0,
  }

  it('returns mutable prompt when present', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Initial prompt', prompt: 'Edited prompt' }
    expect(getTaskPromptText(task)).toBe('Edited prompt')
  })

  it('falls back to immutable initial_prompt when prompt is empty', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Initial prompt', prompt: '' }
    expect(getTaskPromptText(task)).toBe('Initial prompt')
  })

  it('falls back to empty string when both values are missing', () => {
    const task: Task = { ...baseTask, initial_prompt: '', prompt: null }
    expect(getTaskPromptText(task)).toBe('')
  })

  it('hides persisted inline image reference definitions from editable prompt text', () => {
    const task: Task = {
      ...baseTask,
      initial_prompt: 'Inspect [image#1] and then explain it\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
      prompt: null,
    }

    expect(getTaskPromptText(task)).toBe('Inspect [image#1] and then explain it')
  })

  it('extracts persisted inline image references from task prompt text', () => {
    const task: Task = {
      ...baseTask,
      initial_prompt: 'Inspect [image#1]\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
      prompt: null,
    }

    expect(getTaskPromptImageReferences(task)).toEqual([
      {
        marker: '[image#1]',
        dataUrl: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        mimeType: 'image/png',
        size: 11,
      },
    ])
  })
})

describe('parseTaskPrompt', () => {
  it('keeps normal prompt lines while removing image reference lines', () => {
    expect(parseTaskPrompt([
      'Line one [image#1]',
      '',
      'Line two [image#2]',
      '',
      '[image#1]: data:image/png;base64,Zmlyc3Q=',
      '[image#2]: data:image/jpeg;base64,c2Vjb25k',
    ].join('\n'))).toEqual({
      text: 'Line one [image#1]\n\nLine two [image#2]',
      imageReferences: [
        {
          marker: '[image#1]',
          dataUrl: 'data:image/png;base64,Zmlyc3Q=',
          mimeType: 'image/png',
          size: 5,
        },
        {
          marker: '[image#2]',
          dataUrl: 'data:image/jpeg;base64,c2Vjb25k',
          mimeType: 'image/jpeg',
          size: 6,
        },
      ],
    })
  })
})

describe('formatTaskPromptWithImageReferences', () => {
  const references = [
    {
      marker: '[image#1]',
      dataUrl: 'data:image/png;base64,Zmlyc3Q=',
      mimeType: 'image/png',
      size: 5,
    },
    {
      marker: '[image#2]',
      dataUrl: 'data:image/png;base64,c2Vjb25k',
      mimeType: 'image/png',
      size: 6,
    },
  ]

  it('appends only image references whose markers remain in the prompt', () => {
    expect(formatTaskPromptWithImageReferences('Use [image#2] only', references)).toBe(
      'Use [image#2] only\n\n[image#2]: data:image/png;base64,c2Vjb25k',
    )
  })

  it('returns the prompt unchanged when no image markers remain', () => {
    expect(formatTaskPromptWithImageReferences('Use text only', references)).toBe('Use text only')
  })
})
