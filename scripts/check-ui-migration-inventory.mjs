import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { UI_MIGRATION_ROOTS, isInventorySource, checksPresentation } from './ui-migration-scope.mjs'
import { dirname, posix, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'svelte/compiler'
import { parse as parseScript } from '@babel/parser'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const OBSOLETE_SHARED_CONTROLS = Object.freeze([
  'ActionDropdown', 'AnchoredMenu', 'Card', 'CollapsibleInfoSection', 'CopyButton',
  'HoverTooltip', 'Modal', 'PrStatusChip', 'ResizablePanel', 'SearchableSelect',
])

function isObsoleteControl(path) {
  return OBSOLETE_SHARED_CONTROLS.some((name) => path.endsWith(`/shared/ui/${name}.svelte`))
}

// Source discovery is recursive so new files in migrated areas cannot escape the check.

export const UI_MIGRATION_ALLOWLIST = Object.freeze(JSON.parse(
  readFileSync(new URL('./ui-migration-allowlist.json', import.meta.url), 'utf8'),
))

const DAISY_UI_CONTROL_CLASS = /^(?:btn|input|select|textarea|checkbox|toggle|badge|card|tabs?|join|modal|dropdown|tooltip|menu|collapse)(?:-|$)/
const GEOMETRY_PROPERTY = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|border(?:-[a-z]+)*-radius)$/

function isFixedValue(value) {
  return !/^var\(--of-[\w-]+\)$/.test(value.trim())
    && /(?:\d*\.?\d+(?:%|px|r?em|[rl]?ch|[rl]?ex|cap|ic|lh|rlh|cm|mm|q|in|pt|pc|[sld]?v(?:h|w|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![\w-])|^0$)/i.test(value.trim())
}

function classRule(token) {
  // Strip responsive/state variants without splitting arbitrary values like [length:...].
  const base = token.split(/:(?![^\[]*\])/).at(-1).replace(/^!|!$/g, '')
  if (DAISY_UI_CONTROL_CLASS.test(base) && !/^select-(?:none|text|all|auto)$/.test(base)) return 'daisyui'
  if (/^(?:rounded(?:-.+)?|(?:(?:min|max)-)?(?:h|w|size)-(?:\d+(?:\.\d+)?|px|(?:[2-7])?xl|[23]?xs|sm|md|lg|prose|screen-(?:sm|md|lg|xl|2xl)|\[[^\]]+\]))$/.test(base)
      && !/\[var\(--of-[\w-]+\)\]$/.test(base)) return 'geometry'
  return null
}

function visit(node, callback) {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, callback)
    return
  }
  if (node === null || typeof node !== 'object') return

  callback(node)
  for (const value of Object.values(node)) visit(value, callback)
}

// Template constants belong to their sibling fragment, never an adjacent branch.
function visitTemplate(node, bindings, callback) {
  if (Array.isArray(node)) {
    const local = new Map(bindings)
    for (const child of node) {
      if (child?.type === 'ConstTag' && child.expression.left.type === 'Identifier') {
        local.set(child.expression.left.name, child.expression.right)
      }
    }
    for (const child of node) visitTemplate(child, local, callback)
    return
  }
  if (node === null || typeof node !== 'object') return
  const local = new Map(bindings)
  if (node.type === 'EachBlock') {
    visit(node.context, child => { if (child.type === 'Identifier') local.delete(child.name) })
    if (node.index) local.delete(node.index)
  }
  if (node.type === 'SnippetBlock') {
    visit(node.parameters, child => { if (child.type === 'Identifier') local.delete(child.name) })
  }
  callback(node, local)
  for (const [key, value] of Object.entries(node)) {
    // An each fallback is outside the iteration binding's scope.
    visitTemplate(value, node.type === 'EachBlock' && key === 'else' ? bindings : local, callback)
  }
}

function addTokens(value, tokens) {
  if (typeof value !== 'string') return
  for (const token of value.split(/\s+/).filter(Boolean)) tokens.add(token)
}

function stringsIn(node, bindings, seen = new Set()) {
  const values = []
  visit(node, (child) => {
    if (child.type === 'Text') values.push(child.data)
    if (child.type === 'Literal' && typeof child.value === 'string') values.push(child.value)
    if (child.type === 'TemplateElement') values.push(child.value.raw)
    if (child.type === 'Property' && !child.computed && child.key?.type === 'Identifier') values.push(child.key.name)
    if (child.type === 'Identifier' && bindings.has(child.name) && !seen.has(child.name)) {
      values.push(...stringsIn(bindings.get(child.name), bindings, new Set([...seen, child.name])))
    }
  })
  return values
}

function classTokens(attribute, bindings) {
  const tokens = new Set()
  if (attribute.type === 'Class') addTokens(attribute.name, tokens)
  if (attribute.type === 'Attribute' && /^(?:class|className|\w+Class)$/.test(attribute.name)) {
    for (const value of stringsIn(attribute.value, bindings)) addTokens(value, tokens)
  }
  return tokens
}

function elementName(node) {
  return typeof node.name === 'string' ? node.name : null
}

// Paint-equivalent roles from theme-adapter.css, not visual redesign choices.
const LEGACY_COLOR_ROLES = Object.freeze({
  'base-100': 'surface', 'base-200': 'surface-subtle', 'base-300': 'border',
  'base-content': 'text', primary: 'accent', 'primary-content': 'on-accent',
  accent: 'accent', 'accent-content': 'on-accent', secondary: 'control',
  'secondary-content': 'control-text', neutral: 'text', 'neutral-content': 'text-inverse',
  info: 'info', 'info-content': 'on-info', success: 'success', 'success-content': 'on-success',
  warning: 'warning', 'warning-content': 'on-warning', error: 'danger', 'error-content': 'on-danger',
})
const LEGACY_COLOR_CLASS = new RegExp(`^((?:bg|text|border(?:-[xytrblse])?|divide|ring(?:-offset)?|outline|decoration|placeholder|caret|accent|fill|stroke|from|via|to|shadow)-)(${Object.keys(LEGACY_COLOR_ROLES).sort((a, b) => b.length - a.length).join('|')})(/.*)?$`)
const LEGACY_VARIABLES = Object.freeze({
  ...Object.fromEntries(Object.entries(LEGACY_COLOR_ROLES).map(([legacy, role]) => [`--color-${legacy}`, `--of-${role}`])),
  '--radius-selector': '--of-radius-round', '--radius-field': '--of-radius-control', '--radius-box': '--of-radius-container',
  '--size-selector': 'calc(var(--of-control-height-compact) / 8)', '--size-field': 'calc(var(--of-control-height) / 10)',
  '--border': '--of-border-width', '--depth': '0', '--noise': '0',
})

function legacyVariables(value) {
  return [...value.matchAll(/--[\w-]+/g)].filter(match => Object.hasOwn(LEGACY_VARIABLES, match[0]))
}

function legacyColor(token) {
  const base = token.split(/:(?![^\[]*\])/).at(-1).replace(/^!|!$/g, '')
  const match = base.match(LEGACY_COLOR_CLASS)
  if (!match) return null
  const replacement = `${match[1]}of-${LEGACY_COLOR_ROLES[match[2]]}${match[3] ?? ''}`
  return token.replace(base, replacement)
}

function classifyLegacyToken(token) {
  const replacement = legacyColor(token)
  if (replacement) return { kind: 'color', replacement }
  if (legacyVariables(token).length) {
    return { kind: 'arbitrary-variable', replacement: token.replace(/--[\w-]+/g, name => LEGACY_VARIABLES[name] ?? name) }
  }
  const base = token.split(/:(?![^\[]*\])/).at(-1).replace(/^!|!$/g, '')
  if (/^kbd(?:-|$)/.test(base)) {
    return { kind: 'component', replacement: 'Preserve native kbd semantics with token-driven keyboard hints; shared packages use scoped styles' }
  }
  if (/^(?:loading|alert|progress)(?:-|$)/.test(base) || classRule(token) === 'daisyui') {
    return { kind: 'component', replacement: 'Use the corresponding SDK control; preserve caller semantics and bounds' }
  }
  return null
}

function unresolvedClass(node, bindings, seen = new Set()) {
  if (Array.isArray(node)) return node.some(child => unresolvedClass(child, bindings, seen))
  if (!node || typeof node !== 'object') return false
  switch (node.type) {
    case 'Text': case 'Literal': return false
    case 'Attribute': return unresolvedClass(node.value, bindings, seen)
    case 'MustacheTag': return unresolvedClass(node.expression, bindings, seen)
    case 'Identifier':
      return seen.has(node.name) || !bindings.get(node.name)
        || unresolvedClass(bindings.get(node.name), bindings, new Set([...seen, node.name]))
    case 'ConditionalExpression': return unresolvedClass([node.consequent, node.alternate], bindings, seen)
    case 'LogicalExpression': return unresolvedClass(node.operator === '&&' ? node.right : [node.left, node.right], bindings, seen)
    case 'ArrayExpression': return unresolvedClass(node.elements, bindings, seen)
    case 'ObjectExpression': return node.properties.some(property => property.computed || property.type !== 'Property')
    case 'TemplateLiteral': return node.expressions.length > 0
    default: return true
  }
}

export function inventoryLegacyUiConsumers(sources) {
  const records = []
  for (const source of sources) {
    const isCss = source.path.endsWith('.css')
    const isMarkup = /\.(?:svelte|html)$/.test(source.path)
    const subsystem = source.path.startsWith('src/') ? 'host' : source.path.split('/').slice(0, 2).join('/')
    let ast
    try {
      if (source.path.endsWith('package.json')) {
        const manifest = JSON.parse(source.contents)
        if (manifest.dependencies?.daisyui || manifest.devDependencies?.daisyui) {
          records.push({ path: source.path, subsystem, kind: 'build-input', token: 'daisyui', replacement: 'Retain until final removal', line: source.contents.slice(0, source.contents.indexOf('"daisyui"')).split('\n').length })
        }
        continue
      }
      ast = isCss || isMarkup
        ? parse(isCss ? `<style>${source.contents}</style>` : source.contents, { filename: source.path })
        : parseScript(source.contents, { sourceType: 'unambiguous', plugins: [['typescript', { dts: /\.d\.[cm]?ts$/.test(source.path) }], 'jsx'] })
    } catch (error) {
      records.push({ path: source.path, subsystem, kind: 'unresolved', token: `Parse error: ${error.message}`, replacement: 'Manual review required', line: error.loc?.line ?? 1 })
      continue
    }
    function record(kind, token, replacement, start) {
      records.push({ path: source.path, subsystem, kind, token, replacement, line: source.contents.slice(0, start).split('\n').length })
    }
    function classConsumer(token, start, candidate = false) {
      const classification = classifyLegacyToken(token)
      if (!classification) return
      const { kind, replacement } = classification
      record(candidate ? kind === 'color' ? 'script-candidate' : `script-${kind}-candidate` : kind, token, replacement, start)
    }
    if (!isMarkup && !isCss) {
      visit(ast, node => {
        if (node.type === 'VariableDeclarator' && /class/i.test(node.id?.name ?? '')
          && node.init && !['StringLiteral', 'Literal'].includes(node.init.type)) {
          record('unresolved', source.contents.slice(node.start, node.end), 'Review script class producer', node.start)
        }
        if (node.type !== 'StringLiteral' && node.type !== 'TemplateElement') return
        const value = node.type === 'TemplateElement' ? node.value.raw : node.value
        for (const token of value.split(/\s+/)) {
          classConsumer(token, node.start, true)
        }
        for (const [token] of legacyVariables(value)) record('script-variable-candidate', token, LEGACY_VARIABLES[token], node.start)
      })
    }
    visit(ast.css, node => {
      const start = node.start - (isCss ? 7 : 0)
      if (node.type === 'ClassSelector') classConsumer(node.name.replace(/\\(.)/g, '$1'), start)
      if (node.type === 'Declaration') {
        if (Object.hasOwn(LEGACY_VARIABLES, node.property)) record('compatibility-definition', node.property, LEGACY_VARIABLES[node.property], start)
        for (const [token] of legacyVariables(node.value)) {
          record(token.startsWith('--color-') ? 'color-variable' : 'geometry-variable', token, LEGACY_VARIABLES[token], start)
        }
      }
      if (node.type === 'Atrule' && node.name === 'apply') for (const token of node.prelude.split(/\s+/)) classConsumer(token, start)
      if (node.type === 'Atrule' && ['plugin', 'import'].includes(node.name)) {
        const token = node.prelude.replace(/^['"]|['"]$/g, '')
        if (/daisyui|theme-adapter\.css/.test(token)) record('build-input', token, 'Retain until final removal', start)
      }
    })
    const bindings = new Map()
    visit([ast.instance, ast.module], node => {
      if (node.type !== 'VariableDeclaration') return
      for (const declaration of node.declarations) {
        if (declaration.id?.type !== 'Identifier') continue
        // Mutable bindings and name collisions cannot be resolved from an initializer.
        const name = declaration.id.name
        bindings.set(name, node.kind === 'const' && !bindings.has(name) ? declaration.init : null)
      }
    })
    visitTemplate(ast.html, bindings, (node, local) => {
      if (!Array.isArray(node.attributes)) return
      for (const attribute of node.attributes) {
        if (attribute.type === 'StyleDirective' || (attribute.type === 'Attribute' && attribute.name === 'style')) {
          for (const value of stringsIn(attribute.value, local)) {
            for (const [token] of legacyVariables(value)) record(token.startsWith('--color-') ? 'color-variable' : 'geometry-variable', token, LEGACY_VARIABLES[token], attribute.start)
          }
        }
        if (attribute.type === 'Spread' || (attribute.type === 'Attribute' && /^(?:class|className|\w+Class)$/.test(attribute.name) && unresolvedClass(attribute, local))) {
          records.push({ path: source.path, subsystem: source.path.startsWith('src/') ? 'host' : source.path.split('/').slice(0, 2).join('/'),
            kind: 'unresolved', token: source.contents.slice(attribute.start, attribute.end), replacement: 'Manual review required',
            line: source.contents.slice(0, attribute.start).split('\n').length })
        }
        for (const token of classTokens(attribute, local)) {
          classConsumer(token, attribute.start)
        }
      }
    })
    if (isMarkup) {
      const consumed = new Set(records.filter(record => record.path === source.path).map(record => record.token))
      visit([ast.instance, ast.module], node => {
        const value = node.type === 'Literal' ? node.value : node.type === 'TemplateElement' ? node.value.raw : null
        if (typeof value !== 'string') return
        for (const token of value.split(/\s+/)) {
          if (!consumed.has(token)) classConsumer(token, node.start, true)
        }
      })
    }
  }
  return records
}

export function findUiMigrationInventoryViolations(sources, allowlist = {}) {
  const violations = []

  for (const source of sources) {
    if (isObsoleteControl(source.path)) {
      violations.push({ path: source.path, tag: 'file', token: 'obsolete implementation' })
    }
    const isSvelte = source.path.endsWith('.svelte')
    const ast = isSvelte
      ? parse(source.contents, { filename: source.path })
      : source.path.endsWith('.css')
        ? parse(`<style>${source.contents}</style>`, { filename: source.path })
        : parseScript(source.contents, { sourceType: 'module', plugins: [['typescript', { dts: /\.d\.[cm]?ts$/.test(source.path) }]], createImportExpressions: true, sourceFilename: source.path })
    if (!source.path.startsWith('packages/plugin-sdk/src/ui/')) {
      visit(isSvelte ? [ast.instance, ast.module] : ast, (node) => {
        const specifier = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)
          ? node.source?.value
          : node.type === 'TSImportType' ? node.argument?.value
            : node.type === 'TSExternalModuleReference' ? node.expression?.value
              : node.type === 'CallExpression' && node.callee?.name === 'require' ? node.arguments[0]?.value : null
        const importPath = typeof specifier === 'string' && specifier.startsWith('.')
          ? posix.normalize(posix.join(posix.dirname(source.path), specifier)) : specifier
        if (typeof specifier === 'string' && (/^bits-ui(?:\/|$)/.test(specifier) || isObsoleteControl(importPath))) {
          violations.push({ path: source.path, tag: 'import', token: specifier })
        }
      })
    }
    if (source.presentation === false) continue
    const bindings = new Map()
    visit([ast.instance, ast.module], (node) => {
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') bindings.set(node.id.name, node.init)
    })
    function geometry(tag, property, value, context, start) {
      if (GEOMETRY_PROPERTY.test(property) && isFixedValue(value)) {
        violations.push({ path: source.path, tag, token: `${property}: ${value}`, rule: 'geometry', context, line: source.contents.slice(0, start).split('\n').length })
      }
    }
    visit(ast.css, (node) => {
      if (node.type !== 'Rule') return
      const offset = source.path.endsWith('.css') ? 7 : 0
      const selector = source.contents.slice(node.prelude.start - offset, node.prelude.end - offset)
      for (const child of node.block.children) {
        if (child.type === 'Declaration') geometry('style', child.property, child.value, selector, child.start - offset)
      }
    })
    visitTemplate(ast.html, bindings, (node, bindings) => {
      const tag = elementName(node)
      if (tag === null || !Array.isArray(node.attributes)) return

      const tokens = new Set()
      for (const attribute of node.attributes) {
        for (const token of classTokens(attribute, bindings)) tokens.add(token)
        const context = source.contents.slice(attribute.start, attribute.end)
        if (attribute.type === 'StyleDirective') {
          for (const value of stringsIn(attribute.value, bindings)) geometry(tag, attribute.name, value, context, attribute.start)
        } else if (attribute.type === 'Attribute' && attribute.name === 'style') {
          for (const value of stringsIn(attribute.value, bindings)) {
            for (const declaration of value.split(';')) {
              const colon = declaration.indexOf(':')
              if (colon !== -1) geometry(tag, declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim(), context, attribute.start)
            }
          }
        }
      }

      for (const token of tokens) {
        const rule = classRule(token)
        if (!rule) continue
        violations.push({
          path: source.path, tag, token, rule,
          context: node.attributes.filter((a) => /^(?:class|className|\w+Class)$/.test(a.name) || a.type === 'Class').map((a) => source.contents.slice(a.start, a.end)).join(' '),
          line: source.contents.slice(0, node.start).split('\n').length,
        })
      }
    })
  }

  const remaining = [...violations]
  const sourcePaths = new Set(sources.map(source => source.path))
  for (const path of Object.keys(allowlist)) {
    const source = { path }
    if (!sourcePaths.has(path)) {
      remaining.push({ path, tag: 'allowlist', token: 'Exception source is missing', rule: 'allowlist' })
      continue
    }
    for (const entry of allowlist[path]) {
      const valid = ['reason', 'tag', 'context'].every(key => typeof entry[key] === 'string' && entry[key].trim())
        && Number.isInteger(entry.count) && entry.count > 0
        && Array.isArray(entry.tokens) && entry.tokens.length > 0 && entry.tokens.every(token => typeof token === 'string')
      if (!valid) {
        remaining.push({ path: source.path, tag: 'allowlist', token: 'Invalid exception', rule: 'allowlist' })
        continue
      }
      for (const token of entry.tokens) {
        const matches = remaining.filter(v => v.rule === 'geometry' && v.path === source.path
          && v.tag === entry.tag && v.token === token && v.context === entry.context)
        if (matches.length < entry.count) {
          remaining.push({ path: source.path, tag: entry.tag, token: `Invalid or stale exception: ${token}`, rule: 'allowlist' })
        }
        for (const match of matches.slice(0, entry.count)) remaining.splice(remaining.indexOf(match), 1)
      }
    }
  }
  return remaining
}

export function readMigratedUiSources(root = REPO_ROOT) {
  const paths = []
  function collect(directory) {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) collect(path)
      else if (entry.isFile() && isInventorySource(path)) paths.push(path)
    }
  }
  for (const directory of UI_MIGRATION_ROOTS) collect(directory)
  if (!paths.length) throw new Error('UI migration inventory scope is empty')
  return paths.sort().map((path) => ({ path, contents: readFileSync(resolve(root, path), 'utf8'), presentation: checksPresentation(path) }))
}

export function readLegacyUiSources(root = REPO_ROOT) {
  const sources = []
  const skipped = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.svelte-kit', 'target', 'storybook-static'])
  function collect(directory) {
    if (!existsSync(resolve(root, directory))) return
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory() && !skipped.has(entry.name)) collect(path)
      else if (entry.isFile() && (/\.(?:svelte|css|html|[cm]?[jt]sx?)$/.test(path) || entry.name === 'package.json')) {
        sources.push({ path, contents: readFileSync(resolve(root, path), 'utf8') })
      }
    }
  }
  for (const directory of ['src', 'packages', 'plugins', 'storybook', 'scripts', 'tests']) collect(directory)
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name === 'package.json' || /\.(?:[cm]?[jt]s|html)$/.test(entry.name))) {
      sources.push({ path: entry.name, contents: readFileSync(resolve(root, entry.name), 'utf8') })
    }
  }
  return sources.sort((a, b) => a.path.localeCompare(b.path))
}

function run() {
  const { values } = parseArgs({ options: { root: { type: 'string', default: REPO_ROOT }, 'legacy-inventory': { type: 'boolean' } } })
  if (values['legacy-inventory']) {
    const sources = readLegacyUiSources(values.root)
    console.log(JSON.stringify({ sources: sources.length, records: inventoryLegacyUiConsumers(sources) }, null, 2))
    return
  }
  const sources = readMigratedUiSources(values.root)
  const policy = JSON.parse(readFileSync(resolve(values.root, 'scripts/ui-migration-allowlist.json'), 'utf8'))
  const violations = findUiMigrationInventoryViolations(sources, policy)
  if (violations.length === 0) {
    console.log(`UI migration inventory passed for ${sources.length} files, ${sources.filter((s) => s.presentation).length} with presentation checks. No violations.`)
    return
  }

  console.error('UI migration inventory found covered classes:')
  for (const violation of violations) {
    console.error(`- ${violation.path}: <${violation.tag}> ${violation.token}`)
  }
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run()
}
