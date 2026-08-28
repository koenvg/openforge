import { describe, expect, it } from 'vitest'
import { parseRichMarkdownDiff } from './richMarkdownDiff'

describe('parseRichMarkdownDiff', () => {
  it('maps changed list items and table rows to their source lines', () => {
    const content = [
      '# Guide',
      '',
      'Intro',
      '',
      '- alpha',
      '- beta',
      '',
      '| Name | Status |',
      '| --- | --- |',
      '| Alpha | Ready |',
      '| Beta | Blocked |',
    ].join('\n')
    const patch = [
      '@@ -4,8 +4,8 @@ Intro',
      ' ',
      ' - alpha',
      '-- old beta',
      '+- beta',
      ' ',
      ' | Name | Status |',
      ' | --- | --- |',
      ' | Alpha | Ready |',
      '-| Beta | Pending |',
      '+| Beta | Blocked |',
    ].join('\n')

    const document = parseRichMarkdownDiff(content, patch)
    const list = document.blocks.find(block => block.kind === 'list')
    const table = document.blocks.find(block => block.kind === 'table')

    expect(list).toMatchObject({
      kind: 'list',
      items: [
        { startLine: 5, anchorLine: null, content: 'alpha' },
        { startLine: 6, anchorLine: 6, content: 'beta' },
      ],
    })
    expect(table).toMatchObject({
      kind: 'table',
      header: { startLine: 8, anchorLine: null },
      rows: [
        { startLine: 10, anchorLine: null },
        { startLine: 11, anchorLine: 11 },
      ],
    })
  })

  it('maps a nested list item without marking its unchanged parent', () => {
    const document = parseRichMarkdownDiff(
      '- parent\n  - child',
      '@@ -1 +1,2 @@\n - parent\n+  - child',
    )

    expect(document.blocks[0]).toMatchObject({
      kind: 'list',
      items: [{
        startLine: 1,
        anchorLine: null,
        content: 'parent',
        childLists: [{
          items: [{ startLine: 2, anchorLine: 2, content: 'child' }],
        }],
      }],
    })
  })

  it('maps a changed table separator to the rendered header row', () => {
    const document = parseRichMarkdownDiff(
      '| Name |\n| :--- |\n| Alice |',
      '@@ -1,3 +1,3 @@\n | Name |\n-| --- |\n+| :--- |\n | Alice |',
    )

    expect(document.blocks[0]).toMatchObject({
      kind: 'table',
      header: { startLine: 1, endLine: 2, anchorLine: 2 },
    })
  })
})
