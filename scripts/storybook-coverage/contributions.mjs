import { parse } from '@babel/parser'
import babelTraverse from '@babel/traverse'
import { parse as parseSvelte } from 'svelte/compiler'

const traverse = typeof babelTraverse === 'function' ? babelTraverse : babelTraverse.default
const VISUAL_REGISTRATIONS = new Set([
  'views.register', 'taskPane.registerTab', 'taskUI.registerTab', 'taskUI.registerSection',
  'settings.registerSection', 'reviewUI.registerRowAction', 'injectionPoints.register',
  'viewReplacements.register',
])

/** @typedef {import('@babel/traverse').NodePath<import('@babel/types').Node | null | undefined>} NodePath */
/** @typedef {import('@babel/traverse').Binding} Binding */

/** @param {import('@babel/types').Node} node @param {boolean} computed */
function propertyName(node, computed) {
  if (node.type === 'StringLiteral') return node.value
  if (!computed && node.type === 'Identifier') return node.name
  return null
}

/** @param {NodePath | NodePath[]} path @param {Set<Binding>} [seen] @returns {string[]} */
function memberPath(path, seen = new Set()) {
  if (Array.isArray(path) || !path.node) return []
  if (path.isIdentifier()) {
    // Babel resolves the declaration in this expression's lexical scope, not a
    // file-wide name table where an unrelated function could hide an alias.
    const binding = path.scope.getBinding(path.node.name)
    if (!binding) return [path.node.name]
    if (seen.has(binding)) return []
    const declaration = binding.path
    if (!declaration.isVariableDeclarator()) return [path.node.name]
    const next = new Set([...seen, binding])
    const init = declaration.get('init')
    if (!init.node) return []
    const base = memberPath(init, next)
    if (declaration.node.id.type === 'Identifier') return base
    if (declaration.node.id.type === 'ObjectPattern') {
      const property = declaration.node.id.properties.find(property =>
        property.type === 'ObjectProperty' && property.value.type === 'Identifier' && property.value.name === path.node.name)
      if (property?.type === 'ObjectProperty') {
        const name = propertyName(property.key, property.computed)
        if (name) return [...base, name]
      }
    }
    return []
  }
  if (path.isMemberExpression() || path.isOptionalMemberExpression()) {
    const property = propertyName(path.node.property, path.node.computed)
    return property ? [...memberPath(path.get('object'), seen), property] : []
  }
  if (path.isTSAsExpression() || path.isTSNonNullExpression()) return memberPath(path.get('expression'), seen)
  return []
}

/** @param {string} source @param {string} contents */
function scriptContents(source, contents) {
  if (!source.endsWith('.svelte')) return contents
  const ast = parseSvelte(contents, { filename: source, modern: true })
  // Keep original line positions for registration diagnostics.
  const ranges = [ast.module, ast.instance].filter(script => script != null)
    .map(script => {
      const content = /** @type {typeof script.content & {start: number, end: number}} */ (script.content)
      return [content.start, content.end]
    })
  return contents.split('').map((char, index) =>
    char === '\n' || ranges.some(([start, end]) => index >= start && index < end) ? char : ' ').join('')
}

/** @param {string} source @param {string} contents @param {string} pluginId */
export function discoverContributions(source, contents, pluginId) {
  const ast = parse(scriptContents(source, contents), { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  /** @type {{source: string, contribution: string}[]} */
  const contributions = []
  traverse(ast, {
    enter(path) {
      if (!path.isCallExpression() && !path.isOptionalCallExpression()) return
      const node = path.node
      const kind = memberPath(path.get('callee')).slice(-2).join('.')
      if (!VISUAL_REGISTRATIONS.has(kind)) return
      const registration = node.arguments[0]
      const properties = registration?.type === 'ObjectExpression' ? registration.properties : []
      const ids = properties.filter(property => property.type === 'ObjectProperty' && propertyName(property.key, property.computed) === 'id')
      const id = ids[0]
      if (properties.some(property => property.type === 'SpreadElement') || ids.length !== 1 || id?.type !== 'ObjectProperty' || id.value.type !== 'StringLiteral' || !id.value.value.trim()) {
        throw new Error(`${source}:${node.loc?.start.line}: ${kind} requires a static non-empty id for coverage discovery`)
      }
      contributions.push({ source, contribution: `${pluginId}:${kind}:${id.value.value}` })
    },
  })
  return contributions
}
