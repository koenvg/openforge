import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { extractPackageArchive, fetchWithRetry, prepareRustDependencies, tarExtractionArgs } from './prepare-ghostty-vt.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

describe('Ghostty dependency preparation', () => {
  it('allows cold-cache fetching even when the caller keeps builds offline', () => {
    vi.stubEnv('CARGO_NET_OFFLINE', 'true')
    try {
      const runCommand = vi.fn((_command, args, options) => {
        if (args.includes('--offline')) throw new Error('cold cache')
        if (options.env.CARGO_NET_OFFLINE !== 'false') throw new Error('network still disabled')
      })
      expect(() => prepareRustDependencies({ runCommand })).not.toThrow()
      expect(runCommand).toHaveBeenCalledTimes(6)
      expect(process.env.CARGO_NET_OFFLINE).toBe('true')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('never requests an online fetch when all lockfiles are cached', () => {
    const runCommand = vi.fn()
    prepareRustDependencies({ runCommand })
    expect(runCommand).toHaveBeenCalledTimes(3)
    for (const [, args] of runCommand.mock.calls) expect(args).toContain('--offline')
  })

  it('prefetches standalone lockfiles before CI switches Cargo offline', () => {
    const runCommand = vi.fn((_command, args) => {
      if (args.includes('--offline')) throw new Error('cold cache')
    })
    prepareRustDependencies({ runCommand })
    const layout = resolveRustSidecarLayout()
    for (const manifest of [
      layout.manifestPath,
      layout.sessionCrates.daemon.manifestPath,
      join(layout.backendCrateRootPath, 'ghostty-compat', 'Cargo.toml'),
    ]) {
      expect(runCommand).toHaveBeenCalledWith('cargo', ['fetch', '--locked', '--manifest-path', manifest], expect.any(Object))
    }
  })

  it('forces Windows tar to treat drive-letter archives as local paths', () => {
    expect(tarExtractionArgs(
      String.raw`C:\Users\runner\archive.tar.gz`,
      String.raw`C:\Users\runner\package`,
      { platform: 'win32' },
    )).toEqual([
      '--force-local',
      '-xf',
      'C:/Users/runner/archive.tar.gz',
      '-C',
      'C:/Users/runner/package',
      '--strip-components=1',
    ])
  })

  it('uses portable tar arguments on Unix platforms', () => {
    expect(tarExtractionArgs('/tmp/archive.tar.gz', '/tmp/package', { platform: 'linux' })).toEqual([
      '-xf',
      '/tmp/archive.tar.gz',
      '-C',
      '/tmp/package',
      '--strip-components=1',
    ])
  })

  it('retries Windows extraction after archive symlinks precede their targets', () => {
    const runCommand = vi.fn()
      .mockImplementationOnce(() => { throw new Error('symlink target is not extracted yet') })
      .mockImplementationOnce(() => '')

    extractPackageArchive('C:\\archive.tar.gz', 'C:\\package', {
      platform: 'win32',
      runCommand,
    })

    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('does not mask Unix extraction failures', () => {
    const runCommand = vi.fn(() => { throw new Error('corrupt archive') })

    expect(() => extractPackageArchive('/tmp/archive.tar.gz', '/tmp/package', {
      platform: 'linux',
      runCommand,
    })).toThrow('corrupt archive')
    expect(runCommand).toHaveBeenCalledOnce()
  })

  it('retries transient fetch failures before returning the response', async () => {
    const response = { body: {}, ok: true, status: 200 }
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: new Error('socket reset') }))
      .mockResolvedValueOnce(response)
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(fetchWithRetry('https://example.com/archive.tar.gz', {
      fetchImpl,
      maxAttempts: 3,
      sleep,
    })).resolves.toBe(response)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1_000)
  })

  it('reports the underlying network error after retries are exhausted', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValue(new TypeError('fetch failed', { cause: new Error('connection timed out') }))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(fetchWithRetry('https://example.com/archive.tar.gz', {
      fetchImpl,
      maxAttempts: 2,
      sleep,
    })).rejects.toThrow(
      'Failed to download https://example.com/archive.tar.gz after 2 attempts: fetch failed: connection timed out',
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('reports each nested error from aggregate network failures', async () => {
    const networkErrors = new AggregateError([
      new Error('connect ETIMEDOUT 192.0.2.1:443'),
      new Error('connect ENETUNREACH 2001:db8::1:443'),
    ])
    const fetchImpl = vi.fn().mockRejectedValue(
      new TypeError('fetch failed', { cause: networkErrors }),
    )

    await expect(fetchWithRetry('https://example.com/archive.tar.gz', {
      fetchImpl,
      maxAttempts: 1,
    })).rejects.toThrow(
      'fetch failed: connect ETIMEDOUT 192.0.2.1:443: connect ENETUNREACH 2001:db8::1:443',
    )
  })
})
