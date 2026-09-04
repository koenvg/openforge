import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'svelte/compiler'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const MIGRATED_UI_SOURCE_FILES = Object.freeze([
  'packages/plugin-sdk/src/ui/PluginSidebarLink.svelte',
  'src/components/shell/AppSidebar.svelte',
  'src/components/shell/IconRail.svelte',
  'src/components/shell/ProjectSidebarList.svelte',
  'src/components/shell/StaticPluginSidebarNavigation.svelte',
  'src/components/task-detail/AgentStatusPill.svelte',
  'src/components/task-detail/TaskDetailToolbar.svelte',
  'src/components/task-detail/TaskPaneNavigation.svelte',
])

export const UI_MIGRATION_ALLOWLIST = Object.freeze({
  'src/components/shell/AppSidebar.svelte': Object.freeze([
    Object.freeze({ tag: 'aside', marker: 'of-app-sidebar', token: 'w-16' }),
    Object.freeze({ tag: 'aside', marker: 'of-app-sidebar', token: 'w-[17rem]' }),
    Object.freeze({ tag: 'div', marker: 'of-sidebar-header', token: 'h-12' }),
    Object.freeze({ tag: 'div', marker: 'dev-badge-gradient', token: 'h-12' }),
  ]),
  'src/components/shell/ProjectSidebarList.svelte': Object.freeze([
    Object.freeze({ tag: 'div', marker: 'project-list-header', token: 'h-12' }),
    Object.freeze({ tag: 'div', marker: 'project-sidebar-list', token: 'min-h-0' }),
  ]),
})

const DAISY_UI_CONTROL_CLASS = /^(?:btn|input|select|textarea|checkbox|toggle|badge|card|tabs?|join)(?:-|$)/
const FIXED_CONTROL_GEOMETRY_CLASS = /^(?:rounded(?:-.+)?|(?:(?:min|max)-)?[hw]-(?:\d+|\[[^\]]+\]))$/

function isCoveredClass(token) {
  return DAISY_UI_CONTROL_CLASS.test(token) || FIXED_CONTROL_GEOMETRY_CLASS.test(token)
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

function addTokens(value, tokens) {
  if (typeof value !== 'string') return
  for (const token of value.split(/\s+/).filter(Boolean)) tokens.add(token)
}

function classTokens(attribute) {
  const tokens = new Set()
  if (attribute.type === 'Class') {
    addTokens(attribute.name, tokens)
    return tokens
  }
  if (attribute.type !== 'Attribute' || attribute.name !== 'class') return tokens

  visit(attribute.value, (node) => {
    if (node.type === 'Property' && !node.computed && node.key?.type === 'Identifier') {
      addTokens(node.key.name, tokens)
    }
    if (node.type === 'Text') addTokens(node.data, tokens)
    if (node.type === 'Literal') addTokens(node.value, tokens)
    if (node.type === 'TemplateElement') addTokens(node.value?.raw, tokens)
  })
  return tokens
}

function elementName(node) {
  return typeof node.name === 'string' ? node.name : null
}

export function findUiMigrationInventoryViolations(sources, allowlist = {}) {
  const violations = []

  for (const source of sources) {
    const allowedOccurrences = allowlist[source.path] ?? []
    const ast = parse(source.contents, { filename: source.path })
    visit(ast.html, (node) => {
      const tag = elementName(node)
      if (tag === null || !Array.isArray(node.attributes)) return

      const tokens = new Set()
      for (const attribute of node.attributes) {
        for (const token of classTokens(attribute)) tokens.add(token)
      }

      for (const token of tokens) {
        if (!isCoveredClass(token)) continue
        const isAllowed = allowedOccurrences.some((entry) => (
          entry.tag === tag
          && entry.token === token
          && tokens.has(entry.marker)
        ))
        if (!isAllowed) violations.push({ path: source.path, tag, token })
      }
    })
  }

  return violations
}

export function readMigratedUiSources(root = REPO_ROOT) {
  return MIGRATED_UI_SOURCE_FILES.map((path) => ({
    path,
    contents: readFileSync(resolve(root, path), 'utf8'),
  }))
}

function run() {
  const violations = findUiMigrationInventoryViolations(readMigratedUiSources(), UI_MIGRATION_ALLOWLIST)
  if (violations.length === 0) {
    console.log(`UI migration inventory passed for ${MIGRATED_UI_SOURCE_FILES.length} files.`)
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
