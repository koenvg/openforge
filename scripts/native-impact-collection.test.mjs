import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collectChangedPaths,
  evaluateNativeImpact,
  nativeImpactRequestForEvent,
} from './native-impact.mjs'

function git(repository, ...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
}

function createGitRepository() {
  const repository = mkdtempSync(join(tmpdir(), 'openforge-native-impact-git-'))
  git(repository, 'init')
  git(repository, 'config', 'user.email', 'ci@example.com')
  git(repository, 'config', 'user.name', 'CI')
  git(repository, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repository, 'base.txt'), 'base')
  git(repository, 'add', '--all')
  git(repository, 'commit', '-m', 'base')
  return repository
}

describe('native impact changed-path collection', () => {
  it('uses the trusted base and tested head from pull requests', () => {
    expect(nativeImpactRequestForEvent('pull_request', {
      pull_request: {
        base: { sha: 'base-sha' },
        head: { sha: 'head-sha' },
      },
    })).toEqual({ base: 'base-sha', head: 'head-sha' })
  })

  it('uses before and after revisions from pushes', () => {
    expect(nativeImpactRequestForEvent('push', {
      before: 'before-sha',
      after: 'after-sha',
    })).toEqual({ base: 'before-sha', head: 'after-sha' })
  })

  it.each(['schedule', 'workflow_dispatch'])('bypasses diffing for %s events', (eventName) => {
    expect(nativeImpactRequestForEvent(eventName, {})).toEqual({ fullRunEvent: eventName })
  })

  it('fails closed when a pull request revision is missing', () => {
    expect(nativeImpactRequestForEvent('pull_request', {
      pull_request: { base: {}, head: { sha: 'head-sha' } },
    })).toEqual({ uncertainty: 'missing-revision' })
  })

  it('fails closed for the all-zero base on a new branch push', () => {
    expect(nativeImpactRequestForEvent('push', {
      before: '0000000000000000000000000000000000000000',
      after: 'head-sha',
    })).toEqual({ uncertainty: 'unavailable-base-revision' })
  })

  it('collects changed paths with NUL delimiters', () => {
    const repository = createGitRepository()
    const base = git(repository, 'rev-parse', 'HEAD')
    writeFileSync(join(repository, 'line\nbreak.txt'), 'changed')
    git(repository, 'add', '--all')
    git(repository, 'commit', '-m', 'changed')
    const head = git(repository, 'rev-parse', 'HEAD')

    expect(collectChangedPaths({ repository, base, head })).toEqual(['line\nbreak.txt'])
  })

  it('selects every family when the event does not provide revisions', () => {
    const evidence = evaluateNativeImpact({
      eventName: 'pull_request',
      event: { pull_request: { base: {}, head: {} } },
      repository: process.cwd(),
    })

    expect(evidence.changedPaths).toEqual([])
    expect(evidence.decision.uncertain).toBe(true)
    expect(evidence.decision.packagedRuntime).toBe(true)
    expect(evidence.decision.mobileIos).toBe(true)
    expect(evidence.decision.ghosttyMac).toBe(true)
    expect(evidence.decision.whisperMac).toBe(true)
  })

  it('selects every family when Git cannot compare the revisions', () => {
    const repository = createGitRepository()
    const evidence = evaluateNativeImpact({
      eventName: 'push',
      event: { before: 'missing-base', after: git(repository, 'rev-parse', 'HEAD') },
      repository,
    })

    expect(evidence.collectionError).toMatch(/git diff failed/i)
    expect(evidence.changedPaths).toEqual([])
    expect(evidence.decision.uncertain).toBe(true)
    expect(evidence.decision.packagedRuntime).toBe(true)
    expect(evidence.decision.mobileIos).toBe(true)
    expect(evidence.decision.ghosttyMac).toBe(true)
    expect(evidence.decision.whisperMac).toBe(true)
  })

  it('publishes JSON evidence, job outputs, and a summary from the collect CLI', () => {
    const repository = createGitRepository()
    const base = git(repository, 'rev-parse', 'HEAD')
    writeFileSync(join(repository, 'package.json'), '{}')
    git(repository, 'add', '--all')
    git(repository, 'commit', '-m', 'changed')
    const head = git(repository, 'rev-parse', 'HEAD')
    const eventPath = join(repository, 'event.json')
    const evidencePath = join(repository, 'native-impact.json')
    const githubOutput = join(repository, 'github-output.txt')
    const githubStepSummary = join(repository, 'github-summary.md')
    writeFileSync(eventPath, JSON.stringify({ before: base, after: head }))

    execFileSync(process.execPath, [
      new URL('./native-impact.mjs', import.meta.url).pathname,
      'collect',
      '--event-name',
      'push',
      '--event-path',
      eventPath,
      '--repository',
      repository,
      '--output',
      evidencePath,
    ], {
      env: { ...process.env, GITHUB_OUTPUT: githubOutput, GITHUB_STEP_SUMMARY: githubStepSummary },
    })

    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    expect(evidence.changedPaths).toEqual(['package.json'])
    expect(readFileSync(githubOutput, 'utf8')).toContain('packagedRuntime=true')
    expect(readFileSync(githubOutput, 'utf8')).toContain('whisperMac=true')
    const summary = readFileSync(githubStepSummary, 'utf8')
    expect(summary).toContain('Native impact')
    expect(summary).toContain('| mobileIos | skip |')
    expect(summary).toContain('| ghosttyMac | skip |')
  })
})
