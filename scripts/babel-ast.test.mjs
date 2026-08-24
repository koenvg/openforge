import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import { isBabelAstNode, traverseBabelAst } from './babel-ast.mjs'

describe('Babel AST traversal', () => {
  it('recognizes registered Babel AST nodes', () => {
    const sourceFile = parse('const answer = 42', { sourceType: 'module' })

    expect(isBabelAstNode(sourceFile)).toBe(true)
    expect(isBabelAstNode(sourceFile.program.body[0])).toBe(true)
    expect(isBabelAstNode({ type: 'NotABabelNode' })).toBe(false)
    expect(isBabelAstNode(null)).toBe(false)
  })

  it('visits each AST child in depth-first source order', () => {
    const sourceFile = parse('const answer = makeValue(42)', { sourceType: 'module' })
    const visitedTypes = []

    traverseBabelAst(sourceFile, node => visitedTypes.push(node.type))

    expect(visitedTypes).toEqual([
      'File',
      'Program',
      'VariableDeclaration',
      'VariableDeclarator',
      'Identifier',
      'CallExpression',
      'Identifier',
      'NumericLiteral',
    ])
  })

  it('ignores node-shaped metadata outside Babel child keys', () => {
    const sourceFile = parse('const answer = 42', { sourceType: 'module' })
    sourceFile.metadata = { type: 'Identifier', name: 'metadata' }
    const visitedNames = []

    traverseBabelAst(sourceFile, node => {
      if (node.type === 'Identifier') visitedNames.push(node.name)
    })

    expect(visitedNames).toEqual(['answer'])
  })
})
