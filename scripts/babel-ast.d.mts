import type { Node } from '@babel/types'

export function isBabelAstNode(value: unknown): value is Node
export function traverseBabelAst(root: unknown, visitor: (node: Node) => void): void
