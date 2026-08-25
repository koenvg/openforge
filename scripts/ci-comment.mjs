import { readFileSync as readFile } from 'node:fs'

const RESULT_PATHS = {
  frontendTypecheck: '/tmp/frontend-results/typecheck-exit-code',
  frontendTests: '/tmp/frontend-results/tests-exit-code',
  rustFormat: '/tmp/rust-results/format-exit-code',
  rustClippy: '/tmp/rust-results/clippy-exit-code',
  rustTests: '/tmp/rust-results/tests-exit-code',
}

function describeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function isMissingFile(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT'
}

function readExitCodeFile(readFileSync, core, path, label) {
  try {
    return readFileSync(path, 'utf8').trim() !== '0'
  } catch (error) {
    if (isMissingFile(error)) {
      core.info(`${label} exit code file was not found at ${path}; assuming that check did not fail.`)
    } else {
      core.warning(
        `Unable to read ${label} exit code file at ${path}; assuming that check did not fail. ${describeError(error)}`,
      )
    }
    return false
  }
}

export function readCiResults({ readFileSync, core }) {
  return {
    frontend: {
      typecheckFailed: readExitCodeFile(
        readFileSync,
        core,
        RESULT_PATHS.frontendTypecheck,
        'frontend typecheck',
      ),
      testsFailed: readExitCodeFile(
        readFileSync,
        core,
        RESULT_PATHS.frontendTests,
        'frontend tests',
      ),
    },
    rust: {
      formatFailed: readExitCodeFile(
        readFileSync,
        core,
        RESULT_PATHS.rustFormat,
        'Rust formatting',
      ),
      clippyFailed: readExitCodeFile(
        readFileSync,
        core,
        RESULT_PATHS.rustClippy,
        'Rust Clippy',
      ),
      testsFailed: readExitCodeFile(readFileSync, core, RESULT_PATHS.rustTests, 'Rust test'),
    },
  }
}

export function renderFrontendComment(
  { typecheckFailed, testsFailed },
  { readFileSync, core },
) {
  let body = '## ❌ Frontend CI Failures\n\n'

  if (typecheckFailed) {
    try {
      const log = readFileSync('/tmp/frontend-logs/typecheck.log', 'utf8')
      const errors = log
        .split('\n')
        .filter((line) => line.includes('error TS'))
        .join('\n')
      body += `### Type Check\n\n\`\`\`\n${(errors || log).slice(0, 30000)}\n\`\`\`\n\n`
    } catch (error) {
      core.warning(`Unable to read frontend typecheck log: ${describeError(error)}`)
      body += '### Type Check\n\n_Failed (logs unavailable)_\n\n'
    }
  }

  if (testsFailed) {
    try {
      const log = readFileSync('/tmp/frontend-logs/tests.log', 'utf8')
      const lines = log.split('\n')
      const tail = lines.slice(Math.max(0, lines.length - 200)).join('\n')
      body += `### Tests\n\n\`\`\`\n${tail.slice(0, 30000)}\n\`\`\`\n\n`
    } catch (error) {
      core.warning(`Unable to read frontend test log: ${describeError(error)}`)
      body += '### Tests\n\n_Failed (logs unavailable)_\n\n'
    }
  }

  return body
}

function renderRustLogSection(heading, logPath, warningLabel, { readFileSync, core }) {
  let section = `${heading}\n\n`
  try {
    const log = readFileSync(logPath, 'utf8')
    section += `\`\`\`\n${log.slice(-30000)}\n\`\`\`\n\n`
  } catch (error) {
    core.warning(`Unable to read ${warningLabel} log: ${describeError(error)}`)
    section += '_Failed (logs unavailable)_\n\n'
  }
  return section
}

export function renderRustComment(
  { formatFailed, clippyFailed, testsFailed },
  dependencies,
) {
  let body = '## ❌ Rust CI Failures\n\n'

  if (formatFailed) {
    body += renderRustLogSection(
      '### Formatting',
      '/tmp/rust-logs/rust-format.log',
      'Rust formatting',
      dependencies,
    )
  }

  if (clippyFailed) {
    body += renderRustLogSection(
      '### Clippy',
      '/tmp/rust-logs/rust-clippy.log',
      'Rust Clippy',
      dependencies,
    )
  }

  if (testsFailed) {
    body += '### Tests\n\n'
    try {
      const log = dependencies.readFileSync('/tmp/rust-logs/rust-tests.log', 'utf8')
      const lines = log.split('\n')
      const errorLines = lines.filter(
        (line) =>
          line.includes('error[') ||
          line.includes('error:') ||
          line.includes('FAILED') ||
          line.includes('panicked'),
      )
      const tail = lines.slice(Math.max(0, lines.length - 100)).join('\n')
      const errors = errorLines.length > 0 ? `${errorLines.join('\n')}\n\n---\n\n${tail}` : tail
      body += `\`\`\`\n${errors.slice(0, 30000)}\n\`\`\`\n`
    } catch (error) {
      dependencies.core.warning(`Unable to read rust test log: ${describeError(error)}`)
      body += '_Failed (logs unavailable)_\n'
    }
  }

  return body
}

export async function syncGitHubComment({
  github,
  repo,
  prNumber,
  comments,
  marker,
  failed,
  body,
  maxLength,
}) {
  const existing = comments.find((comment) => comment.body.startsWith(marker))
  if (!failed) {
    if (existing) {
      await github.rest.issues.deleteComment({
        ...repo,
        comment_id: existing.id,
      })
    }
    return
  }

  let markedBody = `${marker}\n${body}`
  if (maxLength) markedBody = markedBody.slice(0, maxLength)
  if (existing) {
    await github.rest.issues.updateComment({
      ...repo,
      comment_id: existing.id,
      body: markedBody,
    })
    return
  }

  await github.rest.issues.createComment({
    ...repo,
    issue_number: prNumber,
    body: markedBody,
  })
}

export async function postCiComments({
  github,
  context,
  core,
  prNumber,
  readFileSync = readFile,
}) {
  const repo = context.repo
  const { data: comments } = await github.rest.issues.listComments({
    ...repo,
    issue_number: prNumber,
  })
  const results = readCiResults({ readFileSync, core })
  const dependencies = { readFileSync, core }

  await syncGitHubComment({
    github,
    repo,
    prNumber,
    comments,
    marker: '<!-- ci-frontend-failures -->',
    failed: results.frontend.typecheckFailed || results.frontend.testsFailed,
    body: renderFrontendComment(results.frontend, dependencies),
  })

  await syncGitHubComment({
    github,
    repo,
    prNumber,
    comments,
    marker: '<!-- ci-rust-failures -->',
    failed: results.rust.formatFailed || results.rust.clippyFailed || results.rust.testsFailed,
    body: renderRustComment(results.rust, dependencies),
    maxLength: 65000,
  })
}
