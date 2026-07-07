import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import FileTypeIcon from '@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte'

describe('FileTypeIcon', () => {
  it('renders the typescript icon for a .ts file', () => {
    const { container } = render(FileTypeIcon, { props: { filename: 'a/b/foo.ts' } })
    expect(container.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('typescript')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to the default file icon for unknown extensions', () => {
    const { container } = render(FileTypeIcon, { props: { filename: 'mystery.xyz' } })
    expect(container.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('file')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders folder icons based on open state', () => {
    const closed = render(FileTypeIcon, { props: { folder: true, open: false } })
    expect(closed.container.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('folder')

    const open = render(FileTypeIcon, { props: { folder: true, open: true } })
    expect(open.container.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('folder-open')
  })
})
