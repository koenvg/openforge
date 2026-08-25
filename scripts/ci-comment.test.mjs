import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  readCiResults,
  renderFrontendComment,
  renderRustComment,
  postCiComments,
  syncGitHubComment,
} from './ci-comment.mjs'

const RESULT_PATHS = {
  frontendTypecheck: '/tmp/frontend-results/typecheck-exit-code',
  frontendTests: '/tmp/frontend-results/tests-exit-code',
  rustFormat: '/tmp/rust-results/format-exit-code',
  rustClippy: '/tmp/rust-results/clippy-exit-code',
  rustTests: '/tmp/rust-results/tests-exit-code',
}

function createFileReader(files = {}) {
  return vi.fn((path) => {
    if (Object.hasOwn(files, path)) return files[path]
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  })
}

describe('CI artifact result reading', () => {
  it('maps nonzero exit-code files to failed checks', () => {
    const readFileSync = createFileReader({
      [RESULT_PATHS.frontendTypecheck]: '1\n',
      [RESULT_PATHS.frontendTests]: '0\n',
      [RESULT_PATHS.rustFormat]: '0\n',
      [RESULT_PATHS.rustClippy]: '101\n',
      [RESULT_PATHS.rustTests]: '0\n',
    })

    expect(readCiResults({ readFileSync, core: { info: vi.fn(), warning: vi.fn() } })).toEqual({
      frontend: { typecheckFailed: true, testsFailed: false },
      rust: { formatFailed: false, clippyFailed: true, testsFailed: false },
    })
  })
})

describe('frontend CI comment rendering', () => {
  it('shows TypeScript errors and the tail of failed test logs', () => {
    const readFileSync = createFileReader({
      '/tmp/frontend-logs/typecheck.log':
        'compiler startup\nsrc/example.ts:4:2 error TS2322: wrong type\nwatching for changes',
      '/tmp/frontend-logs/tests.log': 'setup complete\nFAIL src/example.test.ts > rejects invalid input',
    })

    const body = renderFrontendComment(
      { typecheckFailed: true, testsFailed: true },
      { readFileSync, core: { warning: vi.fn() } },
    )

    expect(body).toContain('## ❌ Frontend CI Failures')
    expect(body).toContain('### Type Check')
    expect(body).toContain('src/example.ts:4:2 error TS2322: wrong type')
    expect(body).not.toContain('compiler startup')
    expect(body).toContain('### Tests')
    expect(body).toContain('FAIL src/example.test.ts > rejects invalid input')
  })
})

describe('Rust CI comment rendering', () => {
  it('shows formatting, Clippy, and test failures', () => {
    const readFileSync = createFileReader({
      '/tmp/rust-logs/rust-format.log': 'Diff in src/main.rs:12',
      '/tmp/rust-logs/rust-clippy.log': 'error: redundant clone',
      '/tmp/rust-logs/rust-tests.log':
        "test parses_config ... FAILED\nthread 'parses_config' panicked",
    })

    const body = renderRustComment(
      { formatFailed: true, clippyFailed: true, testsFailed: true },
      { readFileSync, core: { warning: vi.fn() } },
    )

    expect(body).toContain('## ❌ Rust CI Failures')
    expect(body).toContain('### Formatting')
    expect(body).toContain('Diff in src/main.rs:12')
    expect(body).toContain('### Clippy')
    expect(body).toContain('error: redundant clone')
    expect(body).toContain('### Tests')
    expect(body).toContain('test parses_config ... FAILED')
    expect(body).toContain("thread 'parses_config' panicked")
  })
})

function createGitHub() {
  return {
    rest: {
      issues: {
        createComment: vi.fn().mockResolvedValue({ data: {} }),
        updateComment: vi.fn().mockResolvedValue({ data: {} }),
        deleteComment: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  }
}

describe('GitHub CI comment synchronization', () => {
  it('creates a marked comment when a check fails without an existing comment', async () => {
    const github = createGitHub()

    await syncGitHubComment({
      github,
      repo: { owner: 'open-forge', repo: 'openforge' },
      prNumber: 42,
      comments: [{ id: 11, body: 'A human review comment' }],
      marker: '<!-- ci-frontend-failures -->',
      failed: true,
      body: '## ❌ Frontend CI Failures',
    })

    expect(github.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'open-forge',
      repo: 'openforge',
      issue_number: 42,
      body: '<!-- ci-frontend-failures -->\n## ❌ Frontend CI Failures',
    })
    expect(github.rest.issues.updateComment).not.toHaveBeenCalled()
    expect(github.rest.issues.deleteComment).not.toHaveBeenCalled()
  })

  it('updates the matching comment when the same check still fails', async () => {
    const github = createGitHub()

    await syncGitHubComment({
      github,
      repo: { owner: 'open-forge', repo: 'openforge' },
      prNumber: 42,
      comments: [
        { id: 12, body: 'Automated coverage report' },
        { id: 71, body: '<!-- ci-frontend-failures -->\nstale failure' },
      ],
      marker: '<!-- ci-frontend-failures -->',
      failed: true,
      body: 'current failure',
    })

    expect(github.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'open-forge',
      repo: 'openforge',
      comment_id: 71,
      body: '<!-- ci-frontend-failures -->\ncurrent failure',
    })
    expect(github.rest.issues.createComment).not.toHaveBeenCalled()
    expect(github.rest.issues.deleteComment).not.toHaveBeenCalled()
  })

  it('deletes the matching comment after its checks pass', async () => {
    const github = createGitHub()

    await syncGitHubComment({
      github,
      repo: { owner: 'open-forge', repo: 'openforge' },
      prNumber: 42,
      comments: [
        { id: 13, body: 'Deployment preview is ready' },
        { id: 83, body: '<!-- ci-frontend-failures -->\nold failure' },
      ],
      marker: '<!-- ci-frontend-failures -->',
      failed: false,
      body: 'unused',
    })

    expect(github.rest.issues.deleteComment).toHaveBeenCalledWith({
      owner: 'open-forge',
      repo: 'openforge',
      comment_id: 83,
    })
    expect(github.rest.issues.createComment).not.toHaveBeenCalled()
    expect(github.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('limits a marked comment to the configured GitHub body length', async () => {
    const github = createGitHub()

    await syncGitHubComment({
      github,
      repo: { owner: 'open-forge', repo: 'openforge' },
      prNumber: 42,
      comments: [],
      marker: '<!-- marker -->',
      failed: true,
      body: '0123456789',
      maxLength: 20,
    })

    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: '<!-- marker -->\n0123' }),
    )
  })
})

describe('CI comment posting', () => {
  it('reads results and synchronizes frontend and Rust comments', async () => {
    const github = createGitHub()
    github.rest.issues.listComments = vi.fn().mockResolvedValue({
      data: [{ id: 83, body: '<!-- ci-rust-failures -->\nold failure' }],
    })
    const readFileSync = createFileReader({
      [RESULT_PATHS.frontendTypecheck]: '1',
      [RESULT_PATHS.frontendTests]: '0',
      [RESULT_PATHS.rustFormat]: '0',
      [RESULT_PATHS.rustClippy]: '0',
      [RESULT_PATHS.rustTests]: '0',
      '/tmp/frontend-logs/typecheck.log': 'src/example.ts:4:2 error TS2322: wrong type',
    })

    await postCiComments({
      github,
      context: { repo: { owner: 'open-forge', repo: 'openforge' } },
      core: { info: vi.fn(), warning: vi.fn() },
      readFileSync,
      prNumber: 42,
    })

    expect(github.rest.issues.listComments).toHaveBeenCalledWith({
      owner: 'open-forge',
      repo: 'openforge',
      issue_number: 42,
    })
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('src/example.ts:4:2 error TS2322: wrong type'),
      }),
    )
    expect(github.rest.issues.deleteComment).toHaveBeenCalledWith({
      owner: 'open-forge',
      repo: 'openforge',
      comment_id: 83,
    })
  })
})

describe('CI comment workflow delegation', () => {
  it('checks out the repository and delegates comment posting to the module', () => {
    const workflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/ci-comment.yml'),
      'utf8',
    )

    expect(workflow).toContain('uses: actions/checkout@v6')
    expect(workflow).toContain('postCiComments')
    expect(workflow).toContain('scripts/ci-comment.mjs')
    expect(workflow).not.toContain('function renderFrontendComment')
    expect(workflow).not.toContain('async function syncComment')
  })
})
