import { describe, expect, it, vi } from 'vitest'
import { extractPackageArchive, tarExtractionArgs } from './prepare-ghostty-vt.mjs'

describe('Ghostty dependency preparation', () => {
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
})
