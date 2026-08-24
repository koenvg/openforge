import { isNode, VISITOR_KEYS } from '@babel/types'

/** @typedef {import('@babel/types').Node} BabelAstNode */

/**
 * @param {unknown} value
 * @returns {value is BabelAstNode}
 */
export function isBabelAstNode(value) {
  return isNode(value)
}

/**
 * Visits a Babel AST depth-first, with each parent before its children.
 *
 * @param {unknown} root
 * @param {(node: BabelAstNode) => void} visitor
 */
export function traverseBabelAst(root, visitor) {
  if (!isBabelAstNode(root)) return

  visitor(root)

  for (const childKey of VISITOR_KEYS[root.type] ?? []) {
    const child = root[childKey]
    if (Array.isArray(child)) {
      for (const item of child) traverseBabelAst(item, visitor)
    } else {
      traverseBabelAst(child, visitor)
    }
  }
}
