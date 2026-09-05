import { cleanup, render } from '@testing-library/svelte'
import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
import { vi } from 'vitest'
import { createFileEntry, createTextFileContent } from '../../../storybook/shared/fixtures/appFixtures'

vi.mock('@lucide/svelte', () => ({
  Archive: vi.fn(() => ({})),
  CircleAlert: vi.fn(() => ({})),
  FileQuestion: vi.fn(() => ({})),
  FolderCog: vi.fn(() => ({})),
  FileText: vi.fn(() => ({})),
  Folder: vi.fn(() => ({})),
  FolderOpen: vi.fn(() => ({})),
  Search: vi.fn(() => ({})),
  TriangleAlert: vi.fn(() => ({})),
  X: vi.fn(() => ({})),
}))

import FilesView from './FilesView.svelte'
import { fileBrowserStates, pendingFileReveal } from './lib/stores'

export const fsReadDir = vi.fn()
export const fsReadFile = vi.fn()
export const fsSearchFiles = vi.fn()
const openUrl = vi.fn()

function makeApi(): FrontendOpenForgeAPI {
  return {
    fs: { readDir: fsReadDir, readFile: fsReadFile, searchFiles: fsSearchFiles },
    system: { openUrl },
  } as unknown as FrontendOpenForgeAPI
}

const runtimeContext: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.file-viewer',
  projectId: 'test-project-id',
}

export function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return createFileEntry({
    name: 'file.ts',
    path: 'file.ts',
    size: 512,
    modifiedAt: null,
    ...overrides,
  })
}

export const sampleEntries: FileEntry[] = [
  makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
  makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 1024 }),
]

export const noisyRootEntries: FileEntry[] = [
  makeFileEntry({ name: '.openforge-dev', path: '.openforge-dev', isDir: true, size: null }),
  makeFileEntry({ name: 'node_modules', path: 'node_modules', isDir: true, size: null }),
  makeFileEntry({ name: 'dist-electron', path: 'dist-electron', isDir: true, size: null }),
  makeFileEntry({ name: 'src', path: 'src', isDir: true, size: null }),
  makeFileEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 1024 }),
]

export const sampleFileContent: FileContent = createTextFileContent({
  content: 'Hello world',
  mimeType: null,
})

export function renderFilesView(
  props: { projectName?: string; projectId?: string | null; api?: FrontendOpenForgeAPI } = {},
) {
  return render(FilesView, {
    props: {
      api: props.api ?? makeApi(),
      context: runtimeContext,
      projectName: props.projectName ?? 'My Project',
      projectId: props.projectId === undefined ? 'test-project-id' : props.projectId,
    },
  })
}

export function resetFilesViewTestHarness(): void {
  cleanup()
  fileBrowserStates.set(new Map())
  pendingFileReveal.set(null)
  vi.clearAllMocks()
  vi.mocked(fsReadDir).mockResolvedValue([])
  vi.mocked(fsReadFile).mockResolvedValue(sampleFileContent)
  vi.mocked(fsSearchFiles).mockResolvedValue([])
}

