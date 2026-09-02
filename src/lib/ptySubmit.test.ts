import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./ipc', () => ({
  writePty: vi.fn().mockResolvedValue(undefined),
}))

import { writePty } from './ipc'
import { writePtyWithSubmit } from './ptySubmit'

function pasteAndSubmit(body: string): string {
  return `\x1b[200~${body}\x1b[201~\r`
}

function writtenText(): string {
  return vi.mocked(writePty).mock.calls[0][1]
}

describe('writePtyWithSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delivers the prompt as one bracketed paste followed by Enter', async () => {
    await writePtyWithSubmit('task-1', 'hello world')

    expect(writePty).toHaveBeenCalledTimes(1)
    expect(writePty).toHaveBeenCalledWith('task-1', pasteAndSubmit('hello world'))
  })

  it('sends a bare Enter when there is no prompt', async () => {
    await writePtyWithSubmit('task-2', '')

    expect(writePty).toHaveBeenCalledTimes(1)
    expect(writePty).toHaveBeenCalledWith('task-2', '\r')
  })

  it('strips the carriage returns of a CRLF comment body so the prompt is not submitted early', async () => {
    await writePtyWithSubmit('task-3', '1. [reviewer] first comment\r\n\r\n2. [reviewer] second comment')

    expect(writtenText()).toBe(pasteAndSubmit('1. [reviewer] first comment\n\n2. [reviewer] second comment'))
  })

  it('keeps newlines and tabs, and sends a multi-line prompt as one write', async () => {
    await writePtyWithSubmit('task-4', 'line one\n\tindented')

    expect(writePty).toHaveBeenCalledTimes(1)
    expect(writtenText()).toBe(pasteAndSubmit('line one\n\tindented'))
  })

  it('strips control characters the CLI would read as keystrokes', async () => {
    await writePtyWithSubmit('task-5', 'before\x03after')

    expect(writtenText()).toBe(pasteAndSubmit('beforeafter'))
  })

  it('strips the escape of an ansi sequence so it cannot move the cursor', async () => {
    await writePtyWithSubmit('task-6', 'before\x1b[Aafter')

    expect(writtenText()).toBe(pasteAndSubmit('before[Aafter'))
  })

  it('strips the escape of a paste terminator so a comment body cannot close the paste early', async () => {
    await writePtyWithSubmit('task-7', 'before\x1b[201~after')

    expect(writtenText()).toBe(pasteAndSubmit('before[201~after'))
  })

  it('strips the 8-bit control sequence introducer so it cannot close the paste either', async () => {
    await writePtyWithSubmit('task-8', 'before\u009b201~after')

    expect(writtenText()).toBe(pasteAndSubmit('before201~after'))
  })

  it('leaves multi-byte characters intact', async () => {
    await writePtyWithSubmit('task-9', 'ship it 🚀 naïve 日本語')

    expect(writtenText()).toBe(pasteAndSubmit('ship it 🚀 naïve 日本語'))
  })
})
