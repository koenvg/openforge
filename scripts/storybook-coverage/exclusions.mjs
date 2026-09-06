import { readFileSync } from 'node:fs'
import { basename, join, posix } from 'node:path'
import { parse } from 'svelte/compiler'
import { isTestSource } from './discovery.mjs'

/**
 * Conservative check: a test-named wrapper must not be referenced by production,
 * even indirectly through other test-named files. Text references also cover
 * aliases and dynamic imports; ambiguous references keep the module uncovered.
 * @param {string} root @param {string} source @param {string[]} files
 */
function usedByProduction(root, source, files) {
  const sources = files.filter(file => /\.(?:svelte|[cm]?[jt]sx?)$/.test(file))
    .map(file => ({ file, contents: readFileSync(join(root, file), 'utf8') }))
  const pending = [source]
  const seen = new Set(pending)
  for (const target of pending) {
    for (const { file, contents } of sources) {
      if (seen.has(file) || !contents.includes(basename(target))) continue
      if (!isTestSource(file)) return true
      seen.add(file)
      pending.push(file)
    }
  }
  return false
}

/** @param {unknown} node @param {(name: string) => boolean} visibleComponent @returns {boolean} */
function hasVisibleInterface(node, visibleComponent) {
  if (node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(child => hasVisibleInterface(child, visibleComponent))
  const value = /** @type {Record<string, any>} */ (node)
  if (value.type === 'Component' && visibleComponent(value.name)) return true
  if (['RegularElement', 'SvelteComponent', 'SvelteElement', 'ExpressionTag', 'HtmlTag', 'SlotElement'].includes(value.type)) return true
  if (value.type === 'Text' && value.data.trim()) return true
  if (value.type === 'RenderTag') {
    // Forwarding the caller's children does not give a provider its own UI.
    const expression = value.expression?.type === 'ChainExpression' ? value.expression.expression : value.expression
    return expression?.callee?.type !== 'Identifier' || expression.callee.name !== 'children'
  }
  return Object.values(value).some(child => hasVisibleInterface(child, visibleComponent))
}

/** @param {string} root @param {string} source @param {string[]} files @param {Set<string>} [seen] @returns {boolean} */
function moduleIsVisible(root, source, files, seen = new Set()) {
  if (seen.has(source) || !files.includes(source)) return true
  const ast = parse(readFileSync(join(root, source), 'utf8'), { filename: source, modern: true })
  const imports = new Map()
  for (const node of ast.instance?.content.body ?? []) {
    if (node.type !== 'ImportDeclaration' || typeof node.source.value !== 'string' || !node.source.value.startsWith('.')) continue
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier' && node.source.value.endsWith('.svelte')) {
        imports.set(specifier.local.name, posix.join(posix.dirname(source), node.source.value))
      }
    }
  }
  return hasVisibleInterface(ast.fragment, name => {
    const dependency = imports.get(name)
    return !dependency || moduleIsVisible(root, dependency, files, new Set([...seen, source]))
  })
}

/** @param {string} root @param {string} source @param {unknown} kind @param {string[]} files */
export function exclusionProblem(root, source, kind, files) {
  if (kind === 'test-only-wrapper') {
    if (!isTestSource(source)) return 'test-only wrappers must use the repository test naming conventions'
    return usedByProduction(root, source, files) ? 'test-only wrapper is used by production' : null
  }
  if (kind !== 'nonvisual-provider' && kind !== 'registration-shim') return 'invalid exclusion kind'
  return moduleIsVisible(root, source, files) ? 'cannot exclude independently visible UI' : null
}
