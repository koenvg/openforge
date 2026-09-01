import { describe, expect, it } from 'vitest'
import {
  createTerminalOutputObservation,
  recordTerminalOutput,
  synchronizeTerminalOutputObservation,
} from './terminalOutputObservation'

describe('terminal output observation', () => {
  it('counts accepted live-output bytes and contiguous sequence ranges', () => {
    const observation = createTerminalOutputObservation(7)
    synchronizeTerminalOutputObservation(observation, 7, 0)

    recordTerminalOutput(observation, {
      data: Uint8Array.from([1, 2, 3]),
      ptyInstanceId: 7,
      startSequence: 1,
      sequence: 1,
    })
    recordTerminalOutput(observation, {
      data: 'four',
      ptyInstanceId: 7,
      startSequence: 2,
      sequence: 3,
    })
    recordTerminalOutput(observation, {
      data: 'stale',
      ptyInstanceId: 8,
      startSequence: 4,
      sequence: 4,
    })

    expect(observation).toEqual({
      ptyInstanceId: 7,
      receivedBytes: 7,
      firstSequence: 1,
      lastSequence: 3,
      sequenceContinuous: true,
    })
  })


  it('treats a batch overlapping an authoritative watermark as complete coverage', () => {
    const observation = createTerminalOutputObservation(7)
    synchronizeTerminalOutputObservation(observation, 7, 3)

    recordTerminalOutput(observation, {
      data: 'overlapping batch',
      ptyInstanceId: 7,
      startSequence: 3,
      sequence: 8,
    })

    expect(observation).toEqual({
      ptyInstanceId: 7,
      receivedBytes: 17,
      firstSequence: 3,
      lastSequence: 8,
      sequenceContinuous: true,
    })
  })
  it('retains incomplete-sequence evidence until the PTY instance changes', () => {
    const observation = createTerminalOutputObservation(7)
    synchronizeTerminalOutputObservation(observation, 7, 4)

    recordTerminalOutput(observation, {
      data: 'gap',
      ptyInstanceId: 7,
      startSequence: 6,
      sequence: 6,
    })
    synchronizeTerminalOutputObservation(observation, 7, 6)

    expect(observation.sequenceContinuous).toBe(false)
    expect(observation.receivedBytes).toBe(3)
    expect(observation.lastSequence).toBe(6)

    synchronizeTerminalOutputObservation(observation, 8, 0)
    expect(observation).toEqual({
      ptyInstanceId: 8,
      receivedBytes: 0,
      firstSequence: null,
      lastSequence: 0,
      sequenceContinuous: true,
    })
  })
})
