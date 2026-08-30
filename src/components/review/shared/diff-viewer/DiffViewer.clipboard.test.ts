import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from '../../../../lib/ipc'
import './DiffViewer.test-harness'
import DiffViewer from './DiffViewer.svelte'
import { modifiedFileWithPatch } from './DiffViewer.test-fixtures'

vi.mock('../../../../lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/ipc')>()
  return {
    ...actual,
    writeClipboardText: vi.fn(async () => undefined),
  }
})

describe('DiffViewer file path clipboard integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies the exact repository-relative path through typed IPC', async () => {
    render(DiffViewer, { props: { files: [modifiedFileWithPatch] } })

    await fireEvent.click(screen.getByRole('button', { name: 'Copy file path: src/test.ts' }))

    expect(writeClipboardText).toHaveBeenCalledWith('src/test.ts')
  })

  it('owns clipboard failures at the app adapter boundary', async () => {
    const clipboardError = new Error('clipboard unavailable')
    vi.mocked(writeClipboardText).mockRejectedValueOnce(clipboardError)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(DiffViewer, { props: { files: [modifiedFileWithPatch] } })

    await fireEvent.click(screen.getByRole('button', { name: 'Copy file path: src/test.ts' }))

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to copy file path:', clipboardError)
    })
    consoleError.mockRestore()
  })
})
