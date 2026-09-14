import { beforeEach, describe, expect, it } from 'vitest'
import { clearAllCreateTaskDrafts, clearCreateTaskDraft, readCreateTaskDraft, writeCreateTaskDraft, type RetainedCreateTaskDraft } from './createTaskDraftStore'

function draft(prompt: string, markers: string[] = []): RetainedCreateTaskDraft {
  return {
    prompt,
    images: markers.map((marker, index) => ({
      id: index + 1,
      marker,
      dataUrl: `data:image/png;base64,AA==`,
      mimeType: 'image/png',
      size: 2,
    })),
  }
}

describe('create task draft store', () => {
  beforeEach(() => {
    clearAllCreateTaskDrafts()
  })

  it('starts with no draft for an unknown project', () => {
    expect(readCreateTaskDraft('P-unknown')).toBeNull()
  })

  it('reads back a written draft', () => {
    writeCreateTaskDraft('P-1', draft('Fix the crash', ['[image#1]']))

    expect(readCreateTaskDraft('P-1')).toEqual(draft('Fix the crash', ['[image#1]']))
  })

  it('keeps drafts independent per project', () => {
    writeCreateTaskDraft('P-1', draft('First project'))
    writeCreateTaskDraft('P-2', draft('Second project'))

    expect(readCreateTaskDraft('P-1')?.prompt).toBe('First project')
    expect(readCreateTaskDraft('P-2')?.prompt).toBe('Second project')
  })

  it('replaces the previous draft for the same project', () => {
    writeCreateTaskDraft('P-1', draft('First attempt'))
    writeCreateTaskDraft('P-1', draft('Second attempt'))

    expect(readCreateTaskDraft('P-1')?.prompt).toBe('Second attempt')
  })

  it('clears one project without touching another', () => {
    writeCreateTaskDraft('P-1', draft('First project'))
    writeCreateTaskDraft('P-2', draft('Second project'))

    clearCreateTaskDraft('P-1')

    expect(readCreateTaskDraft('P-1')).toBeNull()
    expect(readCreateTaskDraft('P-2')?.prompt).toBe('Second project')
  })

  it('clearing an unknown project is harmless', () => {
    expect(() => clearCreateTaskDraft('P-unknown')).not.toThrow()
  })

  it('does not expose the stored image array for outside mutation', () => {
    const stored = draft('Fix the crash', ['[image#1]'])
    writeCreateTaskDraft('P-1', stored)
    stored.images.length = 0

    expect(readCreateTaskDraft('P-1')?.images).toHaveLength(1)

    const read = readCreateTaskDraft('P-1')!
    read.images.length = 0

    expect(readCreateTaskDraft('P-1')?.images).toHaveLength(1)
  })

  it('clears every project at once', () => {
    writeCreateTaskDraft('P-1', { prompt: 'One', images: [] })
    writeCreateTaskDraft('P-2', { prompt: 'Two', images: [] })

    clearAllCreateTaskDrafts()

    expect(readCreateTaskDraft('P-1')).toBeNull()
    expect(readCreateTaskDraft('P-2')).toBeNull()
  })
})
