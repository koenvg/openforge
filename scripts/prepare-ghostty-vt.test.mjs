import { describe, expect, it } from 'vitest'
import { tarExtractionArgs } from './prepare-ghostty-vt.mjs'

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
})
