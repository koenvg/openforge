import { describe, expect, it } from 'vitest'
import {
  formatTaskPromptWithImageReferences,
  getTaskPromptImageReferences,
  getTaskPromptText,
  parseTaskPrompt,
} from './taskPrompt'

describe('Task prompt projections', () => {
  it('returns the canonical authoring prompt', () => {
    expect(getTaskPromptText({ prompt: 'Edited prompt' })).toBe('Edited prompt')
  })

  it('hides persisted inline image reference definitions from editable prompt text', () => {
    const task = {
      prompt: 'Inspect [image#1] and then explain it\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
    }

    expect(getTaskPromptText(task)).toBe('Inspect [image#1] and then explain it')
  })

  it('extracts persisted inline image references from the canonical prompt', () => {
    const task = {
      prompt: 'Inspect [image#1]\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
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
