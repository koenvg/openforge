import { marked, type Token, type Tokens } from 'marked'

interface RichMarkdownSourceBlock {
  startLine: number
  endLine: number
  anchorLine: number | null
}

export interface RichMarkdownContentBlock extends RichMarkdownSourceBlock {
  kind: 'content'
  markdown: string
  tokenType: string
}

export interface RichMarkdownListItem extends RichMarkdownSourceBlock {
  content: string
  checked: boolean | null
  childLists: RichMarkdownListBlock[]
}

export interface RichMarkdownListBlock extends RichMarkdownSourceBlock {
  kind: 'list'
  markdown: string
  ordered: boolean
  start: number | ''
  items: RichMarkdownListItem[]
}

export interface RichMarkdownTableRow extends RichMarkdownSourceBlock {
  cells: string[]
}

export interface RichMarkdownTableBlock extends RichMarkdownSourceBlock {
  kind: 'table'
  markdown: string
  align: Array<'center' | 'left' | 'right' | null>
  header: RichMarkdownTableRow
  rows: RichMarkdownTableRow[]
}

export type RichMarkdownBlock =
  | RichMarkdownContentBlock
  | RichMarkdownListBlock
  | RichMarkdownTableBlock

export interface RichMarkdownDocument {
  blocks: RichMarkdownBlock[]
  references: string
}

function countNewlines(value: string): number {
  return value.split('\n').length - 1
}

function sourceEndLine(startLine: number, raw: string): number {
  const newlineCount = countNewlines(raw)
  return raw.endsWith('\n') ? startLine + Math.max(0, newlineCount - 1) : startLine + newlineCount
}

function firstChangedLine(changedLines: Set<number>, startLine: number, endLine: number): number | null {
  for (let line = startLine; line <= endLine; line++) {
    if (changedLines.has(line)) return line
  }
  return null
}

export function getChangedRightLines(patch: string): Set<number> {
  const changedLines = new Set<number>()
  let newLine = 0

  for (const line of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (newLine === 0 || line.startsWith('\\')) continue
    if (line.startsWith('+')) {
      changedLines.add(newLine)
      newLine++
    } else if (!line.startsWith('-')) {
      newLine++
    }
  }

  return changedLines
}

function isListToken(token: Token): token is Tokens.List {
  return token.type === 'list'
}

function isTableToken(token: Token): token is Tokens.Table {
  return token.type === 'table'
}

function parseList(
  token: Tokens.List,
  startLine: number,
  changedLines: Set<number>,
): RichMarkdownListBlock {
  let itemSearchOffset = 0
  const items = token.items.map((item) => {
    const itemOffset = token.raw.indexOf(item.raw, itemSearchOffset)
    const safeOffset = itemOffset >= 0 ? itemOffset : itemSearchOffset
    itemSearchOffset = safeOffset + item.raw.length
    const itemStartLine = startLine + countNewlines(token.raw.slice(0, safeOffset))
    const contentParts: string[] = []
    const childLists: RichMarkdownListBlock[] = []
    let itemTokenLine = itemStartLine
    let itemContentEndLine = itemStartLine - 1

    for (const itemToken of item.tokens) {
      if (isListToken(itemToken)) {
        const childList = parseList(itemToken, itemTokenLine, changedLines)
        childLists.push(childList)
        itemTokenLine = childList.endLine + 1
      } else if (itemToken.type !== 'checkbox') {
        contentParts.push(itemToken.raw)
        itemContentEndLine = sourceEndLine(itemTokenLine, itemToken.raw)
        itemTokenLine += countNewlines(itemToken.raw)
      }
    }

    return {
      startLine: itemStartLine,
      endLine: Math.max(itemStartLine, itemContentEndLine),
      anchorLine: firstChangedLine(changedLines, itemStartLine, itemContentEndLine),
      content: contentParts.join('').trim(),
      checked: item.checked ?? null,
      childLists,
    }
  })
  const endLine = sourceEndLine(startLine, token.raw)

  return {
    kind: 'list',
    markdown: token.raw,
    ordered: token.ordered,
    start: token.start,
    startLine,
    endLine,
    anchorLine: firstChangedLine(changedLines, startLine, endLine),
    items,
  }
}

function tableRow(
  cells: Tokens.TableCell[],
  startLine: number,
  endLine: number,
  changedLines: Set<number>,
): RichMarkdownTableRow {
  return {
    startLine,
    endLine,
    anchorLine: firstChangedLine(changedLines, startLine, endLine),
    cells: cells.map(cell => cell.text),
  }
}

function parseTable(
  token: Tokens.Table,
  startLine: number,
  changedLines: Set<number>,
): RichMarkdownTableBlock {
  const endLine = sourceEndLine(startLine, token.raw)

  return {
    kind: 'table',
    markdown: token.raw,
    align: token.align,
    startLine,
    endLine,
    anchorLine: firstChangedLine(changedLines, startLine, endLine),
    header: tableRow(token.header, startLine, startLine + 1, changedLines),
    rows: token.rows.map((row, index) => {
      const rowLine = startLine + index + 2
      return tableRow(row, rowLine, rowLine, changedLines)
    }),
  }
}

function parseContent(
  token: Token,
  startLine: number,
  changedLines: Set<number>,
): RichMarkdownContentBlock {
  const endLine = sourceEndLine(startLine, token.raw)
  return {
    kind: 'content',
    markdown: token.raw,
    startLine,
    tokenType: token.type,
    endLine,
    anchorLine: firstChangedLine(changedLines, startLine, endLine),
  }
}

export function parseRichMarkdownDiff(content: string, patch: string): RichMarkdownDocument {
  const changedLines = getChangedRightLines(patch)
  const blocks: RichMarkdownBlock[] = []
  let references = ''
  let sourceLine = 1

  for (const token of marked.lexer(content)) {
    if (token.type === 'space') {
      sourceLine += countNewlines(token.raw)
      continue
    }

    if (token.type === 'def') {
      references += token.raw.endsWith('\n') ? token.raw : `${token.raw}\n`
    } else if (isListToken(token)) {
      blocks.push(parseList(token, sourceLine, changedLines))
    } else if (isTableToken(token)) {
      blocks.push(parseTable(token, sourceLine, changedLines))
    } else {
      blocks.push(parseContent(token, sourceLine, changedLines))
    }

    sourceLine += countNewlines(token.raw)
  }

  return { blocks, references }
}
