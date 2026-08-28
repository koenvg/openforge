import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'

vi.mock('@lucide/svelte', () => ({
  Archive: vi.fn(() => ({})),
  CircleAlert: vi.fn(() => ({})),
  FileQuestion: vi.fn(() => ({})),
  TriangleAlert: vi.fn(() => ({})),
}))

import FilePreviewPane from './FilePreviewPane.svelte'

const api = {} as FrontendOpenForgeAPI

function makeActions() {
  return {
    onContentScrollTopChange: vi.fn(),
    onRetrySelectedFile: vi.fn(),
    onOpenRepositoryPath: vi.fn(async () => {}),
    onReturnFocusToSelectedFile: vi.fn(),
  }
}

afterEach(cleanup)

describe('FilePreviewPane', () => {
  it('composes the selected file preview and its return-to-tree action', async () => {
    const actions = makeActions()

    render(FilePreviewPane, {
      props: {
        api,
        projectId: 'project-id',
        model: {
          selectedPath: 'src/main.ts',
          selectedEntry: {
            name: 'main.ts',
            path: 'src/main.ts',
            isDir: false,
            size: 12,
            modifiedAt: null,
          },
          selectedFileName: 'main.ts',
          fileContent: {
            type: 'text',
            content: 'const ready = true',
            mimeType: 'text/typescript',
            size: 18,
          },
          fileError: null,
          contentScrollTop: 0,
          previewFocusRequest: null,
        },
        actions,
      },
    })

    expect(screen.getByLabelText('File text content').textContent).toContain('const ready = true')
    await fireEvent.click(screen.getByRole('button', { name: 'Return focus to selected file in tree' }))

    expect(actions.onReturnFocusToSelectedFile).toHaveBeenCalledOnce()
  })
})
