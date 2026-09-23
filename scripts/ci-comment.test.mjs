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
      '/tmp/frontend-results/plugin-build-exit-code': '0',
      '/tmp/frontend-results/app-build-exit-code': '0',
      '/tmp/frontend-results/lint-exit-code': '0',
      [RESULT_PATHS.rustFormat]: '0\n',
      [RESULT_PATHS.rustClippy]: '101\n',
      [RESULT_PATHS.rustTests]: '0\n',
    })

    expect(readCiResults({ readFileSync, core: { info: vi.fn(), warning: vi.fn() } })).toEqual({
      frontend: { staticFailures: [], typecheckFailed: true, testsFailed: false },
      rust: { formatFailed: false, clippyFailed: true, testsFailed: false },
    })
  })

  it('distinguishes missing and unreadable Rust results from passing checks', () => {
    const readFileSync = vi.fn((path) => {
      if (path === RESULT_PATHS.rustClippy) throw Object.assign(new Error('access denied'), { code: 'EACCES' })
      if (path === RESULT_PATHS.rustFormat) return '0'
      if (path === RESULT_PATHS.rustTests) return '101'
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    })
    const core = { info: vi.fn(), warning: vi.fn() }
    const results = readCiResults({ readFileSync, core })
    expect(results.rust).toEqual({ formatFailed: false, clippyFailed: null, testsFailed: true })
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Rust Clippy exit code file'))
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('Rust formatting exit code file'))
  })

  it('treats absent Rust exit-code files as incomplete', () => {
    const core = { info: vi.fn(), warning: vi.fn() }
    const results = readCiResults({ readFileSync: createFileReader(), core })
    expect(results.rust).toEqual({ formatFailed: null, clippyFailed: null, testsFailed: null })
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Rust formatting exit code file'))
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

it('renders a bounded summary from every failed shard rather than only the last shard', () => {
  const readFileSync = createFileReader({
    '/tmp/frontend-logs/tests.log': 'last shard only',
    '/tmp/frontend-logs/tests-summary.log': 'Shard 1/3 FAIL first\nShard 2/3 FAIL second\nShard 3/3 FAIL third',
  })
  const body = renderFrontendComment({ testsFailed: true }, { readFileSync, core: { warning: vi.fn() } })
  for (const text of ['FAIL first', 'FAIL second', 'FAIL third']) expect(body).toContain(text)
})

it('treats absent frontend results as incomplete, not successful', () => {
  const results = readCiResults({ readFileSync: createFileReader(), core: { info: vi.fn(), warning: vi.fn() } })
  expect(results.frontend.typecheckFailed).toBe(true)
  expect(results.frontend.testsFailed).toBe(true)
})

it('reports build and lint failures with their logs', async () => {
  const github = createGitHub()
  github.rest.issues.listComments = vi.fn().mockResolvedValue({ data: [] })
  const readFileSync = createFileReader({
    [RESULT_PATHS.frontendTypecheck]: '0',
    [RESULT_PATHS.frontendTests]: '0',
    '/tmp/frontend-results/plugin-build-exit-code': '1',
    '/tmp/frontend-results/app-build-exit-code': '1',
    '/tmp/frontend-results/lint-exit-code': '1',
    '/tmp/frontend-logs/plugin-build.log': 'plugin build error',
    '/tmp/frontend-logs/app-build.log': 'app build error',
    '/tmp/frontend-logs/lint.log': 'lint violation',
  })
  await postCiComments({ github, context: { repo: { owner: 'test', repo: 'test' } }, prNumber: 1, readFileSync, core: { info: vi.fn(), warning: vi.fn() } })
  const body = github.rest.issues.createComment.mock.calls[0]?.[0].body ?? ''
  for (const error of ['plugin build error', 'app build error', 'lint violation']) expect(body).toContain(error)
})

it('keeps combined frontend failure comments within GitHub limits', () => {
  const files = {
    '/tmp/frontend-logs/typecheck.log': 'error TS2322: '.repeat(5000),
    '/tmp/frontend-logs/tests-summary.log': 'shard failure\n'.repeat(5000),
  }
  const staticFailures = [['plugin-build', 'Plugin Build'], ['app-build', 'App Build'], ['lint', 'Lint']]
  for (const [check] of staticFailures) files[`/tmp/frontend-logs/${check}.log`] = 'error\n'.repeat(5000)
  const body = renderFrontendComment({ staticFailures, typecheckFailed: true, testsFailed: true }, { readFileSync: createFileReader(files), core: { warning: vi.fn() } })
  expect(body.length).toBeLessThan(65000)
  for (const label of ['Plugin Build', 'App Build', 'Lint', 'Type Check', 'Tests']) expect(body).toContain(`### ${label}`)
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
  it.each(['missing', 'unreadable'])('keeps the Rust comment for %s results and includes available logs', async (artifact) => {
    const github = createGitHub()
    github.rest.issues.listComments = vi.fn().mockResolvedValue({
      data: [{ id: 83, body: '<!-- ci-rust-failures -->\nold failure' }],
    })
    const files = {
      [RESULT_PATHS.rustFormat]: '0',
      [RESULT_PATHS.rustTests]: '0',
      '/tmp/rust-logs/rust-clippy.log': 'error: redundant clone',
    }
    const readFileSync = createFileReader(files)
    if (artifact === 'unreadable') {
      readFileSync.mockImplementation((path) => {
        if (path === RESULT_PATHS.rustClippy) throw Object.assign(new Error('access denied'), { code: 'EACCES' })
        if (Object.hasOwn(files, path)) return files[path]
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
      })
    }
    await postCiComments({
      github,
      context: { repo: { owner: 'open-forge', repo: 'openforge' } },
      core: { info: vi.fn(), warning: vi.fn() },
      readFileSync,
      prNumber: 42,
    })
    expect(github.rest.issues.deleteComment).not.toHaveBeenCalledWith(expect.objectContaining({ comment_id: 83 }))
    expect(github.rest.issues.updateComment).toHaveBeenCalledWith(expect.objectContaining({
      comment_id: 83,
      body: expect.stringMatching(/<!-- ci-rust-failures -->[\s\S]*Clippy[\s\S]*Incomplete[\s\S]*error: redundant clone/),
    }))
  })

  it('creates a marked incomplete Rust comment when result artifacts and logs are absent', async () => {
    const github = createGitHub()
    github.rest.issues.listComments = vi.fn().mockResolvedValue({ data: [] })
    await postCiComments({
      github,
      context: { repo: { owner: 'open-forge', repo: 'openforge' } },
      core: { info: vi.fn(), warning: vi.fn() },
      readFileSync: createFileReader(),
      prNumber: 42,
    })
    expect(github.rest.issues.createComment).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringMatching(/<!-- ci-rust-failures -->[\s\S]*Rust CI Incomplete[\s\S]*Formatting[\s\S]*Logs unavailable/),
    }))
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
