import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import MarkdownFilePreview from './MarkdownFilePreview.svelte'

const fsReadFile = vi.fn()
const openUrl = vi.fn()

function makeApi(): FrontendOpenForgeAPI {
  return {
    fs: { readFile: fsReadFile },
    system: { openUrl },
  } as unknown as FrontendOpenForgeAPI
}

describe('MarkdownFilePreview', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders markdown and resolves relative image sources through the typed runtime fs API', async () => {
    fsReadFile.mockImplementation(async (request: { path: string }) => {
      if (request.path === 'docs/guides/diagram.png') {
        return { type: 'image', content: 'same-image', mimeType: 'image/png', size: 10 }
      }
      if (request.path === 'docs/assets/logo.png') {
        return { type: 'image', content: 'parent-image', mimeType: 'image/png', size: 12 }
      }
      throw new Error(`Unexpected file read: ${request.path}`)
    })

    render(MarkdownFilePreview, {
      props: {
        api: makeApi(),
        content: ['# Guide', '![Same directory](./diagram.png)', '![Parent directory](../assets/logo.png)'].join('\n'),
        filePath: 'docs/guides/README.md',
        projectId: 'project-1',
      },
    })

    expect(screen.getByRole('heading', { name: 'Guide' })).toBeTruthy()

    await waitFor(() => {
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-1', path: 'docs/guides/diagram.png' })
      expect(fsReadFile).toHaveBeenCalledWith({ projectId: 'project-1', path: 'docs/assets/logo.png' })
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Same directory' }).getAttribute('src')).toBe('data:image/png;base64,same-image')
      expect(screen.getByRole('img', { name: 'Parent directory' }).getAttribute('src')).toBe('data:image/png;base64,parent-image')
    })
  })
})
