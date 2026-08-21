import { describe, expect, it } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import {
  buildFileTree,
  collectFileTreeDirectoryPaths,
  flattenFileTree,
  orderFilesDepthFirst,
} from './fileTreeModel'

function makeFile(filename: string): PrFileDiff {
  return {
    sha: `sha-${filename}`,
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

describe('file-tree path model', () => {
  it('compacts single-child directory paths without losing their full path', () => {
    const tree = buildFileTree([
      makeFile('src/deep/one/a.ts'),
      makeFile('src/deep/two/b.ts'),
    ])

    const rows = flattenFileTree(tree, collectFileTreeDirectoryPaths([
      makeFile('src/deep/one/a.ts'),
      makeFile('src/deep/two/b.ts'),
    ]))

    expect(rows.map(({ node, depth }) => [node.name, node.fullPath, depth])).toEqual([
      ['src/deep', 'src/deep', 0],
      ['one', 'src/deep/one', 1],
      ['a.ts', 'src/deep/one/a.ts', 2],
      ['two', 'src/deep/two', 1],
      ['b.ts', 'src/deep/two/b.ts', 2],
    ])
  })

  it('omits descendants of collapsed directories from visible rows', () => {
    const files = [makeFile('a/x.ts'), makeFile('b/y.ts')]
    const rows = flattenFileTree(buildFileTree(files), new Set(['a']))

    expect(rows.map(({ node }) => node.fullPath)).toEqual(['a', 'a/x.ts', 'b'])
  })
})

describe('depth-first file ordering', () => {
  it('uses the same directories-before-files traversal exposed by tree rows', () => {
    const files = [
      makeFile('README.md'),
      makeFile('src/utils.ts'),
      makeFile('src/lib/helper.ts'),
      makeFile('tests/example.ts'),
    ]

    expect(orderFilesDepthFirst(files).map((file) => file.filename)).toEqual([
      'src/lib/helper.ts',
      'src/utils.ts',
      'tests/example.ts',
      'README.md',
    ])
  })
})
