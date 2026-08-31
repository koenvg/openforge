import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseStrictFiniteNumber } from '@openforge-app/plugin-sdk/numberParsing'
import { sanitizeHtml } from '@openforge-app/plugin-sdk/sanitize'
import {
  hasMergeConflicts,
  canMergePullRequest,
  isQueuedForMerge,
  isReadyToMerge,
  getMergeReadiness,
  parseCheckRuns,
  preservePullRequestState,
  splitCheckRuns,
  type FileContent,
  type FileEntry,
  type PullRequestInfo,
} from '@openforge-app/plugin-sdk/domain'

describe('public plugin utilities', () => {
  it('parses only strict finite decimal values', () => {
    expect(parseStrictFiniteNumber('42')).toBe(42)
    expect(parseStrictFiniteNumber('-.5')).toBe(-0.5)
    expect(parseStrictFiniteNumber('1e3')).toBeNull()
    expect(parseStrictFiniteNumber('Infinity')).toBeNull()
    expect(parseStrictFiniteNumber('12px')).toBeNull()
  })

  it('sanitizes unsafe HTML while preserving safe structure', () => {
    const result = sanitizeHtml('<p style="color:red">Hello</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>')

    expect(result).toContain('<p>Hello</p>')
    expect(result).not.toContain('style')
    expect(result).not.toContain('script')
    expect(result).not.toContain('javascript:')
  })

  it('exposes file domain types for plugin file views', () => {
    const entry: FileEntry = { name: 'README.md', path: 'README.md', isDir: false, size: 12, modifiedAt: null }
    const content: FileContent = { type: 'text', content: '# Hi', size: 4, mimeType: 'text/markdown' }

    expect(entry.path).toBe('README.md')
    expect(content.type).toBe('text')
  })

  it('exposes video and oversized-video file content contracts', () => {
    const video: FileContent = {
      type: 'video',
      content: 'AAECAw==',
      mimeType: 'video/mp4',
      size: 4,
    }
    const oversizedVideo: FileContent = {
      type: 'large-file',
      content: '',
      mimeType: 'video/webm',
      size: 25 * 1024 * 1024 + 1,
    }

    expect(video).toEqual({
      type: 'video',
      content: 'AAECAw==',
      mimeType: 'video/mp4',
      size: 4,
    })
    expect(oversizedVideo.content).toBe('')
    expect(oversizedVideo.mimeType).toBe('video/webm')
  })

  it('exposes PR domain helpers for GitHub plugins', () => {
    expect(hasMergeConflicts({ state: 'open', mergeable: false, mergeable_state: 'dirty' })).toBe(true)
    expect(isReadyToMerge({ state: 'open', mergeable: true, mergeable_state: 'clean' })).toBe(true)
    expect(canMergePullRequest(makePullRequest({ mergeable: true, mergeable_state: 'clean', ci_status: 'success' }))).toBe(true)
    expect(canMergePullRequest(makePullRequest({ mergeable: true, mergeable_state: 'clean', ci_status: 'pending' }))).toBe(false)
    expect(canMergePullRequest(makePullRequest({ mergeable: true, mergeable_state: 'clean', draft: true, ci_status: 'success' }))).toBe(false)
    expect(canMergePullRequest(makePullRequest({ mergeable: true, mergeable_state: 'clean', is_queued: true, ci_status: 'success' }))).toBe(false)
    expect(isQueuedForMerge({ state: 'open', is_queued: true })).toBe(true)
  })

  it('exposes the strict merge readiness domain model for GitHub plugins', () => {
    const ready = getMergeReadiness(makePullRequest({
      mergeable: true,
      mergeable_state: 'clean',
      ci_status: 'success',
      review_status: 'approved',
      head_sha: 'sha-ready',
      updated_at: 42,
    }))
    expect(ready).toMatchObject({
      status: 'ready_to_merge',
      action: 'merge',
      blockers: [],
      warnings: [],
      freshness: { sourceSha: 'sha-ready', checkedAt: 42 },
    })

    expect(getMergeReadiness(makePullRequest({ is_queued: true }))).toMatchObject({
      status: 'queued_pull_request',
      action: 'wait_for_queue',
    })

    expect(getMergeReadiness(makePullRequest({ is_queued: true, ci_status: 'failure' }))).toMatchObject({
      status: 'blocked',
      action: 'resolve_blockers',
      blockers: [expect.objectContaining({ code: 'checks_failed' })],
    })

    for (const ci_status of ['pending', 'queued', 'in_progress']) {
      const readiness = getMergeReadiness(makePullRequest({ mergeable: true, mergeable_state: 'unstable', ci_status }))
      expect(readiness).toMatchObject({
        status: 'blocked',
        action: 'resolve_blockers',
        blockers: [expect.objectContaining({ code: 'checks_pending' })],
      })
      expect(readiness.blockers).not.toContainEqual(expect.objectContaining({ code: 'checks_failed' }))
    }
    const noChecksYet = getMergeReadiness(makePullRequest({ mergeable: true, mergeable_state: 'unstable', ci_status: 'none', review_status: 'approved' }))
    expect(noChecksYet).toMatchObject({
      status: 'blocked',
      action: 'resolve_blockers',
      blockers: [expect.objectContaining({ code: 'checks_pending' })],
    })
    expect(noChecksYet.blockers).not.toContainEqual(expect.objectContaining({ code: 'checks_failed' }))

    const stalePersistedNoChecksYet = getMergeReadiness(makePullRequest({
      mergeable: true,
      mergeable_state: 'unstable',
      ci_status: 'none',
      review_status: 'approved',
      merge_readiness_status: 'blocked',
      merge_readiness_action: 'resolve_blockers',
      merge_readiness_blockers: [{ code: 'checks_failed', message: 'GitHub reports failing or unstable required checks.' }],
      readiness_source_head_sha: 'abc123',
      readiness_updated_at: 2,
      updated_at: 1,
    }))
    expect(stalePersistedNoChecksYet.blockers).toContainEqual(expect.objectContaining({ code: 'checks_pending' }))
    expect(stalePersistedNoChecksYet.blockers).not.toContainEqual(expect.objectContaining({ code: 'checks_failed' }))

    expect(getMergeReadiness(makePullRequest({
      mergeable: true,
      mergeable_state: null,
      ci_status: 'none',
      review_status: 'none',
    }))).toMatchObject({
      status: 'ready_to_merge',
      action: 'merge',
      warnings: [expect.objectContaining({ code: 'unprotected_fallback' })],
    })

    expect(getMergeReadiness(makePullRequest({ mergeable: true, mergeable_state: 'clean', ci_status: 'success' }), { requireMergeQueue: true })).toMatchObject({
      status: 'ready_to_enqueue',
      action: 'enqueue',
      blockers: [],
    })

    expect(getMergeReadiness(makePullRequest({ mergeable: null, mergeable_state: 'unknown', head_sha: 'sha-unknown' }))).toMatchObject({
      status: 'readiness_unknown',
      action: 'wait_for_github',
      freshness: { sourceSha: 'sha-unknown' },
    })
  })

  it('ignores persisted unresolved-conversations readiness after local comments are addressed', () => {
    const result = getMergeReadiness(makePullRequest({
      head_sha: 'abc123',
      updated_at: 1,
      mergeable_state: 'clean',
      unaddressed_comment_count: 0,
      merge_readiness_status: 'blocked',
      merge_readiness_action: 'resolve_blockers',
      merge_readiness_blockers: '[{"code":"unresolved_conversations","message":"Pull request has unresolved conversations."}]',
      merge_readiness_warnings: '[]',
      readiness_source_head_sha: 'abc123',
      readiness_updated_at: 2,
    }))

    expect(result).toMatchObject({
      status: 'ready_to_merge',
      action: 'merge',
      blockers: [],
      warnings: [],
    })
  })

  it('preserves other persisted blockers when locally addressed comments clear stale conversation blockers', () => {
    const result = getMergeReadiness(makePullRequest({
      head_sha: 'abc123',
      updated_at: 1,
      mergeable_state: 'clean',
      unaddressed_comment_count: 0,
      merge_readiness_status: 'blocked',
      merge_readiness_action: 'resolve_blockers',
      merge_readiness_blockers: '[{"code":"unresolved_conversations","message":"Pull request has unresolved conversations."},{"code":"checks_failed","message":"Required checks are failing."}]',
      merge_readiness_warnings: '[]',
      readiness_source_head_sha: 'abc123',
      readiness_updated_at: 2,
    }))

    expect(result).toMatchObject({
      status: 'blocked',
      action: 'resolve_blockers',
      blockers: [expect.objectContaining({ code: 'checks_failed' })],
      warnings: [],
    })
    expect(result.blockers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unresolved_conversations' }),
    ]))
  })

  it('preserves optimistic and definitive pull request state across transient syncs', () => {
    const oldPr = makePullRequest({ state: 'merged', mergeable: true, mergeable_state: 'clean', merged_at: 123 })
    const nextPr = makePullRequest({ state: 'open', mergeable: null, mergeable_state: 'unknown', merged_at: null })

    expect(preservePullRequestState(oldPr, nextPr)).toMatchObject({
      state: 'merged',
      mergeable: true,
      mergeable_state: 'clean',
      merged_at: 123,
    })
  })

  it('keeps skill-domain contracts out of the public SDK domain helpers', () => {
    const domainSource = readFileSync(resolve(import.meta.dirname, 'domain.ts'), 'utf8')

    expect(domainSource).not.toContain('SkillInfo')
    expect(domainSource).not.toContain('getSkillIdentity')
    expect(domainSource).not.toContain('groupSkillsBySource')
  })

  it('parses and splits CI check runs for PR views', () => {
    const checks = parseCheckRuns(JSON.stringify([
      { id: 1, name: 'unit', status: 'completed', conclusion: 'success', html_url: 'https://example.com/1' },
      { id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' },
    ]))

    expect(splitCheckRuns(checks)).toEqual({
      visible: [{ id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' }],
      passingCount: 1,
    })
  })
})

function makePullRequest(overrides: Partial<PullRequestInfo>): PullRequestInfo {
  return {
    id: 1,
    pr_number: 1,
    ticket_id: 'T-1',
    repo_owner: 'openforge',
    repo_name: 'app',
    title: 'Test PR',
    url: 'https://example.com/pr/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: 1,
    updated_at: 1,
    draft: false,
    is_queued: false,
    unaddressed_comment_count: 0,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
    ...overrides,
  }
}
