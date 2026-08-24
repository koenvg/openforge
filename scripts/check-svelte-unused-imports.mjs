#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'svelte/compiler'

const DEFAULT_TARGETS = ['src', 'plugins', 'packages']
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.svelte-kit'])

function walkSvelteFiles(targetPath, files = []) {
  if (!existsSync(targetPath)) return files

  const stat = statSync(targetPath)
  if (stat.isFile()) {
    if (targetPath.endsWith('.svelte')) files.push(targetPath)
    return files
  }

  if (!stat.isDirectory()) return files

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    walkSvelteFiles(path.join(targetPath, entry.name), files)
  }

  return files
}

function replaceRangeWithSpaces(source, start, end) {
  return source.slice(0, start) + ' '.repeat(end - start) + source.slice(end)
}

function getLineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function hasIdentifier(source, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w$])\\$?${escaped}(?![\\w$])`).test(source)
}

export function findUnusedSvelteImports(source, fileName = 'component.svelte') {
  const ast = parse(source, { filename: fileName, modern: true })
  const scriptBlocks = [ast.module, ast.instance]
    .filter(Boolean)
    .sort((left, right) => left.start - right.start)
  let searchableSource = source
  const imports = []

  for (const block of scriptBlocks) {
    let statementStart = block.content.start
    for (const statement of block.content.body) {
      if (statement.type === 'ImportDeclaration') {
        searchableSource = replaceRangeWithSpaces(searchableSource, statementStart, statement.end)

        for (const specifier of statement.specifiers) {
          imports.push({ name: specifier.local.name, index: statement.start })
        }
      }
      statementStart = statement.end
    }
  }

  return imports
    .filter((imported) => !hasIdentifier(searchableSource, imported.name))
    .map((imported) => ({ ...imported, line: getLineNumber(source, imported.index) }))
}

function main() {
  const targets = process.argv.slice(2)
  const files = (targets.length > 0 ? targets : DEFAULT_TARGETS)
    .flatMap((target) => walkSvelteFiles(path.resolve(process.cwd(), target)))
    .sort()

  const failures = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const unusedImports = findUnusedSvelteImports(source, file)
    for (const unusedImport of unusedImports) {
      failures.push(`${path.relative(process.cwd(), file)}:${unusedImport.line}: unused import '${unusedImport.name}'`)
    }
  }

  if (failures.length > 0) {
    console.error('Unused Svelte imports found:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
