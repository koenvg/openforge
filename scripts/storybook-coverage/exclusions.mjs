import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { parse } from 'svelte/compiler'
import { isTestSource } from './discovery.mjs'

/**
 * Track actual path references rather than every occurrence of a filename. An
 * unresolved module specifier naming the target remains unsafe to exclude.
 * @param {string} file @param {string} contents @param {string} target @param {Set<string>} files
 */
function referencesTarget(file, contents, target, files) {
  if (contents.includes(target)) return true
  const name = posix.basename(target)
  const stem = name.slice(0, -posix.extname(name).length)
  const imports = /\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"\n]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]/g
  for (const match of contents.matchAll(imports)) {
    const specifier = match[1] ?? match[2]
    const candidate = specifier.replace(/\.([mc]?)js(x?)$/, (_extension, prefix, jsx) => `.${prefix}ts${jsx}`)
    const leaf = posix.basename(candidate)
    if (leaf !== name && leaf !== stem) continue
    if (!candidate.startsWith('.')) return true // Alias or bare import: unresolved.
    const resolved = posix.normalize(posix.join(posix.dirname(file), candidate))
    if (resolved === target || resolved === target.slice(0, -posix.extname(target).length)) return true
    if (!files.has(resolved) && !files.has(`${resolved}${posix.extname(target)}`)) return true
  }
  for (const match of contents.matchAll(/\b(?:import|require)\s*\(([^)]*)\)/g)) {
    if (contents.includes(name) && (/\+|\$\{/.test(match[1]) || /^\s*[\w$]+\s*$/.test(match[1]))) return true
  }
  // A distinctive name in plain text may be a computed/aliased reference.
  // Shared names such as main.ts need a path or module specifier to establish identity.
  if (contents.includes(name) && ![...files].some(other => other !== target && posix.basename(other) === name)) return true
  return false
}

/**
 * Conservative check: a test-named wrapper must not be referenced by production,
 * even indirectly through other test-named files. Ambiguous module references
 * keep the module uncovered.
 * @param {string} root @param {string} source @param {string[]} files
 */
function usedByProduction(root, source, files) {
  const sources = files.filter(file => /\.(?:svelte|[cm]?[jt]sx?)$/.test(file))
    .map(file => ({ file, contents: readFileSync(join(root, file), 'utf8') }))
  const knownFiles = new Set(files)
  const pending = [source]
  const seen = new Set(pending)
  for (const target of pending) {
    for (const { file, contents } of sources) {
      if (seen.has(file) || !referencesTarget(file, contents, target, knownFiles)) continue
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
