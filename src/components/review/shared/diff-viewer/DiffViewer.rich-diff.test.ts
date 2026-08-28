import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff, ReviewComment } from '../../../../lib/types'
import './DiffViewer.test-harness'
import DiffViewer from './DiffViewer.svelte'
import SharedDiffViewer from '@openforge-app/pr-review-ui/DiffViewer.svelte'
import { modifiedFileWithPatch } from './DiffViewer.test-fixtures'

describe('DiffViewer Rich Diff View', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults Markdown files to Source and renders the post-change document in Rich view', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
    }
    const batchFetchFileContents = vi.fn().mockResolvedValue(new Map([
      ['README.md', {
        oldContent: '# Previous heading\n',
        newContent: '# Updated heading\n\n**Rendered body**\n',
      }],
    ]))

    const { rerender } = render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents,
      },
    })

    const sourceButton = screen.getByRole('button', { name: 'Show source diff for README.md' })
    const richButton = screen.getByRole('button', { name: 'Show rich diff for README.md' })
    expect(sourceButton.getAttribute('aria-pressed')).toBe('true')
    expect(richButton.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('heading', { name: 'Updated heading' })).toBeNull()

    await fireEvent.click(richButton)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Updated heading' })).toBeTruthy()
      expect(screen.getByText('Rendered body').tagName).toBe('STRONG')
    })
    expect(sourceButton.getAttribute('aria-pressed')).toBe('false')
    expect(richButton.getAttribute('aria-pressed')).toBe('true')

    const replacementFile: PrFileDiff = {
      ...markdownFile,
      sha: 'replacement-sha',
      patch: '@@ -1 +1 @@\n-# Updated heading\n+# Replacement heading',
    }
    const replacementFetch = vi.fn().mockResolvedValue(new Map([
      ['README.md', {
        oldContent: '# Updated heading\n',
        newContent: '# Replacement heading\n',
      }],
    ]))

    await rerender({
      files: [replacementFile],
      batchFetchFileContents: replacementFetch,
    })

    expect(screen.getByRole('button', { name: 'Show source diff for README.md' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Show rich diff for README.md' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('adds a pending self-review comment from a changed Rich Markdown block', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
      additions: 1,
      deletions: 1,
      patch: '@@ -1,3 +1,3 @@\n # Guide\n-Old details\n+Updated details\n Unchanged footer',
    }
    const onPendingCommentsChange = vi.fn()

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        pendingComments: [],
        onPendingCommentsChange,
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '# Guide\nOld details\nUnchanged footer',
          newContent: '# Guide\nUpdated details\nUnchanged footer',
        }]])),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    const addComment = await screen.findByRole('button', { name: 'Add comment to README.md line 2' })
    expect(screen.queryByRole('button', { name: 'Add comment to README.md line 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add comment to README.md line 3' })).toBeNull()

    await fireEvent.click(addComment)
    const editor = screen.getByRole('textbox', { name: 'Inline review comment for README.md line 2' })
    await fireEvent.input(editor, { target: { value: 'Please clarify this change.' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add to review' }))

    expect(onPendingCommentsChange).toHaveBeenCalledWith([{
      path: 'README.md',
      line: 2,
      side: 'RIGHT',
      body: 'Please clarify this change.',
    }])
  })

  it('comments on individual changed list items and table rows', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
      additions: 4,
      deletions: 4,
      patch: [
        '@@ -1,8 +1,8 @@',
        ' # Guide',
        '-- old alpha',
        '-- old beta',
        '+- alpha',
        '+- beta',
        ' ',
        ' | Name | Status |',
        ' | --- | --- |',
        '-| Alpha | Pending |',
        '-| Beta | Pending |',
        '+| Alpha | Ready |',
        '+| Beta | Blocked |',
      ].join('\n'),
    }
    const newContent = [
      '# Guide',
      '- alpha',
      '- beta',
      '',
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Ready |',
      '| Beta | Blocked |',
    ].join('\n')

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent,
        }]])),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    for (const line of [2, 3, 7, 8]) {
      expect(await screen.findByRole('button', { name: `Add comment to README.md line ${line}` })).toBeTruthy()
    }
  })

  it('renders and comments on a changed nested list item', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
      additions: 1,
      deletions: 0,
      patch: '@@ -1 +1,2 @@\n - parent\n+  - child',
    }

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '- parent',
          newContent: '- parent\n  - child',
        }]])),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    expect(await screen.findByText('child')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add comment to README.md line 2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add comment to README.md line 1' })).toBeNull()
  })

  it('preserves task-list checkboxes in commentable list items', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
      additions: 2,
      deletions: 0,
      patch: '@@ -0,0 +1,2 @@\n+- [x] done\n+- [ ] todo',
    }

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '- [x] done\n- [ ] todo',
        }]])),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    const checkboxes = await screen.findAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.map(checkbox => checkbox.checked)).toEqual([true, false])
    expect(checkboxes.every(checkbox => checkbox.disabled)).toBe(true)
  })

  it('shows an existing thread beneath its rendered Markdown block', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
      patch: '@@ -1,2 +1,2 @@\n # Guide\n-Old details\n+Updated details',
    }
    const existingComment: ReviewComment = {
      id: 42,
      pr_number: 7,
      repo_owner: 'acme',
      repo_name: 'docs',
      path: 'README.md',
      line: 2,
      side: 'RIGHT',
      body: 'Please explain this wording.',
      author: 'reviewer',
      created_at: '2025-01-01T00:00:00Z',
      in_reply_to_id: null,
    }

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        existingComments: [existingComment],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '# Guide\nOld details',
          newContent: '# Guide\nUpdated details',
        }]])),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    expect(await screen.findByText('Please explain this wording.')).toBeTruthy()
  })

  it('keeps Rich Markdown comment actions and thread replies available', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
      patch: '@@ -1,2 +1,2 @@\n # Guide\n-Old details\n+Updated details',
    }
    const existingComment: ReviewComment = {
      id: 42,
      pr_number: 7,
      repo_owner: 'acme',
      repo_name: 'docs',
      path: 'README.md',
      line: 2,
      side: 'RIGHT',
      body: 'Please explain this wording.',
      author: 'reviewer',
      created_at: '2025-01-01T00:00:00Z',
      in_reply_to_id: null,
    }
    const onAskAgent = vi.fn()
    const onCommentNow = vi.fn()
    const onReplyToExistingComment = vi.fn()

    render(SharedDiffViewer, {
      props: {
        files: [markdownFile],
        existingComments: [existingComment],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '# Guide\nOld details',
          newContent: '# Guide\nUpdated details',
        }]])),
        pendingComments: [],
        agentComments: [],
        onPendingCommentsChange: vi.fn(),
        onAgentCommentsChange: vi.fn(),
        onAskAgent,
        onCommentNow,
        onReplyToExistingComment,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    const addComment = await screen.findByRole('button', { name: 'Add comment to README.md line 2' })
    addComment.focus()
    expect(document.activeElement).toBe(addComment)
    await fireEvent.click(addComment)
    await fireEvent.input(screen.getByRole('textbox', { name: 'Inline review comment for README.md line 2' }), {
      target: { value: 'Why this change?' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Ask the AI' }))
    expect(onAskAgent).toHaveBeenCalledWith('README.md', 2, 'RIGHT', 'Why this change?')

    await fireEvent.click(addComment)
    await fireEvent.input(screen.getByRole('textbox', { name: 'Inline review comment for README.md line 2' }), {
      target: { value: 'Ship this now.' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(onCommentNow).toHaveBeenCalledWith('README.md', 2, 'RIGHT', 'Ship this now.')

    await fireEvent.click(screen.getByRole('button', { name: 'Reply to this comment' }))
    await fireEvent.input(screen.getByRole('textbox', { name: 'Reply to this comment' }), {
      target: { value: 'Reply body' },
    })
    await fireEvent.click(screen.getByTitle('Post this reply to GitHub now'))
    expect(onReplyToExistingComment).toHaveBeenCalledWith(42, 'Reply body')
  })

  it('renders reference links without exposing invisible definition blocks', async () => {
    const markdownFile: PrFileDiff = {
      ...modifiedFileWithPatch,
      filename: 'README.md',
      additions: 2,
      deletions: 2,
      patch: '@@ -1,3 +1,3 @@\n-[Old][guide]\n+[Setup][guide]\n \n-[guide]: docs/old.md\n+[guide]: docs/setup.md',
    }

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '[Old][guide]\n\n[guide]: docs/old.md',
          newContent: '[Setup][guide]\n\n[guide]: docs/setup.md',
        }]])),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Show rich diff for README.md' }))

    expect(await screen.findByRole('link', { name: 'Setup' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add comment to README.md line 1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add comment to README.md line 3' })).toBeNull()
  })

  it('resolves nested worktree images and links through Rich Diff repository callbacks', async () => {
    const markdownFile: PrFileDiff = { ...modifiedFileWithPatch, filename: 'docs/guides/README.md' }
    const resolveRepositoryImage = vi.fn().mockResolvedValue('data:image/png;base64,diagram')
    const onOpenRepositoryPath = vi.fn()
    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md)',
        }]])),
        resolveRepositoryImage,
        onOpenRepositoryPath,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))

    await waitFor(() => {
      expect(resolveRepositoryImage).toHaveBeenCalledWith('docs/assets/diagram.png')
      expect(screen.getByAltText('Diagram').getAttribute('src')).toBe('data:image/png;base64,diagram')
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenRepositoryPath).toHaveBeenCalledWith('docs/SETUP.md', '')
  })

  it('reports images opened from a Rich Diff View', async () => {
    const markdownFile: PrFileDiff = { ...modifiedFileWithPatch, filename: 'docs/README.md' }
    const onOpenImage = vi.fn()

    render(DiffViewer, {
      props: {
        files: [markdownFile],
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '![Diagram](assets/diagram.png)',
        }]])),
        resolveRepositoryImage: vi.fn().mockResolvedValue('data:image/png;base64,diagram'),
        onOpenImage,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))
    const imageButton = await screen.findByRole('button', { name: 'Open Diagram image' })
    await fireEvent.click(imageButton)

    expect(onOpenImage).toHaveBeenCalledWith({
      activeIndex: 0,
      images: [{
        alt: 'Diagram',
        filename: 'docs/README.md',
        label: 'Rich preview',
        src: 'data:image/png;base64,diagram',
      }],
    })
  })

  it('resolves nested GitHub Rich Diff images and links at the pull request head', async () => {
    const markdownFile: PrFileDiff = { ...modifiedFileWithPatch, filename: 'docs/guides/README.md' }
    const onOpenUrl = vi.fn()
    render(DiffViewer, {
      props: {
        files: [markdownFile],
        repoOwner: 'acme',
        repoName: 'repo',
        headSha: 'abc123',
        batchFetchFileContents: vi.fn().mockResolvedValue(new Map([[markdownFile.filename, {
          oldContent: '',
          newContent: '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md)',
        }]])),
        onOpenUrl,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }))

    await waitFor(() => {
      expect(screen.getByAltText('Diagram').getAttribute('src'))
        .toBe('https://raw.githubusercontent.com/acme/repo/abc123/docs/assets/diagram.png')
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://github.com/acme/repo/blob/abc123/docs/SETUP.md')
  })
})
