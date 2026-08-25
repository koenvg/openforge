import corpusJson from '../fixtures/terminal-model-recordings.v1.json'

export interface TerminalPresentationExpectation {
  textIncludes?: string[]
  styledText?: Partial<Record<'bold' | 'italic' | 'underline', string>>
  foregroundText?: Array<{ text: string; value: number }>
  minimumWideCells?: number
  activeBuffer?: 'normal' | 'alternate'
  visual?: boolean
}

export interface TerminalModelRecording {
  id: string
  tags: string[]
  chunks: string[]
  presentation?: TerminalPresentationExpectation
}

export interface TerminalModelRecordingCorpus {
  version: 1
  originTask: 'KVG-3903'
  recordings: TerminalModelRecording[]
}

function parseCorpus(value: unknown): TerminalModelRecordingCorpus {
  if (!value || typeof value !== 'object') throw new Error('Terminal Model fixture corpus must be an object')
  const candidate = value as Partial<TerminalModelRecordingCorpus>
  if (candidate.version !== 1 || candidate.originTask !== 'KVG-3903' || !Array.isArray(candidate.recordings)) {
    throw new Error('Terminal Model fixture corpus has an unsupported contract')
  }

  const ids = new Set<string>()
  for (const recording of candidate.recordings) {
    if (!recording
      || typeof recording.id !== 'string'
      || !Array.isArray(recording.tags)
      || !Array.isArray(recording.chunks)
      || recording.chunks.length === 0
      || recording.chunks.some(chunk => typeof chunk !== 'string')) {
      throw new Error('Terminal Model fixture corpus contains an invalid recording')
    }
    if (ids.has(recording.id)) throw new Error(`Duplicate Terminal Model recording id: ${recording.id}`)
    ids.add(recording.id)
  }

  return candidate as TerminalModelRecordingCorpus
}

export const terminalModelRecordingCorpus = parseCorpus(corpusJson)

export function getPresentationRecordings(): TerminalModelRecording[] {
  return terminalModelRecordingCorpus.recordings.filter(recording => recording.presentation)
}
