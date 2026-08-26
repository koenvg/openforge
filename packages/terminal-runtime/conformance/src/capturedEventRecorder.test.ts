import { describe, expect, it, vi } from 'vitest'
import { createCapturedEventRecorder } from './capturedEventRecorder'

function createEventSource<T>() {
  let listener: ((event: T) => void) | null = null
  const dispose = vi.fn(() => { listener = null })

  return {
    dispose,
    emit(event: T) {
      listener?.(event)
    },
    subscribe(nextListener: (event: T) => void) {
      listener = nextListener
      return { dispose }
    },
  }
}

describe('captured event recorder', () => {
  it('clears captured events when reset', () => {
    const source = createEventSource<string>()
    const recorder = createCapturedEventRecorder<string>(event => event)
    recorder.subscribe(listener => source.subscribe(listener))
    source.emit('before reset')
    expect(recorder.snapshot()).toEqual(['before reset'])

    recorder.reset()

    expect(recorder.snapshot()).toEqual([])
  })

  it('cleans up its subscription when reset', () => {
    const source = createEventSource<string>()
    const recorder = createCapturedEventRecorder<string>(event => event)
    recorder.subscribe(listener => source.subscribe(listener))

    recorder.reset()
    source.emit('after reset')
    recorder.reset()

    expect(source.dispose).toHaveBeenCalledTimes(1)
    expect(recorder.snapshot()).toEqual([])
  })
})
