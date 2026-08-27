import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./ipc', () => ({
  writePty: vi.fn().mockResolvedValue(undefined),
}))

import { writePty } from './ipc'
import { writePtyWithSubmit } from './ptySubmit'

async function submit(taskId: string, text: string): Promise<void> {
  const promise = writePtyWithSubmit(taskId, text)
  await vi.advanceTimersByTimeAsync(100)
  await promise
}

function writtenText(): string {
  return vi.mocked(writePty).mock.calls[0][1]
}

describe('writePtyWithSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes text and \\r as separate writePty calls', async () => {
    await submit('task-1', 'hello world')

    expect(writePty).toHaveBeenCalledTimes(2)
    expect(writePty).toHaveBeenNthCalledWith(1, 'task-1', 'hello world')
    expect(writePty).toHaveBeenNthCalledWith(2, 'task-1', '\r')
  })

  it('sends \\r after a delay so the terminal processes text first', async () => {
    const promise = writePtyWithSubmit('task-2', 'multi\nline\nprompt')

    await vi.advanceTimersByTimeAsync(0)
    expect(writePty).toHaveBeenCalledTimes(1)
    expect(writePty).toHaveBeenCalledWith('task-2', 'multi\nline\nprompt')

    await vi.advanceTimersByTimeAsync(100)
    await promise
    expect(writePty).toHaveBeenCalledTimes(2)
    expect(writePty).toHaveBeenNthCalledWith(2, 'task-2', '\r')
  })

  it('strips the carriage returns of a CRLF comment body so the prompt is not submitted early', async () => {
    await submit('task-3', '1. [reviewer] first comment\r\n\r\n2. [reviewer] second comment')

    expect(writtenText()).toBe('1. [reviewer] first comment\n\n2. [reviewer] second comment')
  })

  it('keeps newlines and tabs', async () => {
    await submit('task-4', 'line one\n\tindented')

    expect(writtenText()).toBe('line one\n\tindented')
  })

  it('strips control characters the CLI would read as keystrokes', async () => {
    await submit('task-5', 'before\x03after')

    expect(writtenText()).toBe('beforeafter')
  })

  it('strips the escape of an ansi sequence so it cannot move the cursor', async () => {
    await submit('task-6', 'before\x1b[Aafter')

    expect(writtenText()).toBe('before[Aafter')
  })

  it('leaves multi-byte characters intact', async () => {
    await submit('task-7', 'ship it 🚀 naïve 日本語')

    expect(writtenText()).toBe('ship it 🚀 naïve 日本語')
  })
})
