import { describe, expect, it } from 'vitest'
import { getPresentationRecordings, terminalModelRecordingCorpus } from './terminalPresentationCorpus'

describe('recorded Terminal Model presentation corpus', () => {
  it('reuses the KVG-3903 recordings and covers renderer presentation requirements', () => {
    expect(terminalModelRecordingCorpus.originTask).toBe('KVG-3903')
    expect(terminalModelRecordingCorpus.recordings.map(recording => recording.id)).toEqual(expect.arrayContaining([
      'claude',
      'codex',
      'opencode',
      'pi',
      'grok',
      'shell',
      'full-screen',
      'inline-images',
    ]))

    const tags = new Set(getPresentationRecordings().flatMap(recording => recording.tags))
    expect(tags).toEqual(new Set([
      'presentation',
      'ansi',
      'palette',
      'bold',
      'italic',
      'underline',
      'block-drawing',
      'powerline',
      'nerd-font',
      'pua',
      'ligature',
      'unicode',
      'width',
      'graphemes',
      'ime',
      'cursor',
      'osc-8',
      'alternate-screen',
      'resize',
      'reflow',
    ]))
  })

  it('keeps chunks intact instead of normalizing the recorded byte stream', () => {
    const ansi = getPresentationRecordings().find(recording => recording.id === 'presentation-ansi-styles')

    expect(ansi?.chunks).toHaveLength(3)
    expect(ansi?.chunks.join('')).toContain('\u001b[38;2;12;200;90mtruecolor')
  })
})
