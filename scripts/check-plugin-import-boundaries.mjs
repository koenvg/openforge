#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'

const DEFAULT_PLUGIN_SOURCE_ROOT = 'plugins'
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte'])
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.svelte-kit', 'coverage'])
export const PLUGIN_IMPORT_PACKAGE_MANIFEST_PATHS = Object.freeze([
  'packages/plugin-sdk/package.json',
  'packages/terminal-runtime/package.json',
  'packages/pr-review-ui/package.json',
])

function readDocumentedPackageExports(workspaceRoot, manifestPath) {
  const absoluteManifestPath = path.join(workspaceRoot, manifestPath)
  const manifest = JSON.parse(readFileSync(absoluteManifestPath, 'utf8'))

  if (typeof manifest.name !== 'string' || !manifest.exports || typeof manifest.exports !== 'object') {
    throw new Error(`${absoluteManifestPath} must declare a package name and exports object`)
  }

  const documentedExports = Object.entries(manifest.exports)
    .filter(([subpath]) => subpath === '.' || subpath.startsWith('./'))
    .map(([subpath, target]) => [subpath.slice(1), target])

  return [manifest.name, new Map(documentedExports)]
}

function readAllowedOpenForgePackageExports(workspaceRoot) {
  return new Map(
    PLUGIN_IMPORT_PACKAGE_MANIFEST_PATHS.map((manifestPath) =>
      readDocumentedPackageExports(workspaceRoot, manifestPath)),
  )
}

const APP_PRIVATE_SOURCE_MESSAGE =
  'Plugins must not import app-private source under src/**; use documented SDK or host-shared package exports instead.'
const RUST_SIDECAR_SOURCE_MESSAGE =
  'Plugins must not import host-private Rust sidecar source under src-tauri/**; use SDK host capabilities instead.'
const PACKAGE_SOURCE_MESSAGE =
  'Plugins must not import package source paths directly; use documented package exports instead.'
const PRIVATE_OPENFORGE_PACKAGE_MESSAGE =
  'Plugins may only import documented OpenForge package surfaces: @openforge-app/plugin-sdk, @openforge-app/terminal-runtime, and @openforge-app/pr-review-ui.'

function getLineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath))
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function getOpenForgePackageName(importPath) {
  if (!importPath.startsWith('@openforge-app/')) return null

  const parts = importPath.split('/')
  if (parts.length < 2) return null
  return `${parts[0]}/${parts[1]}`
}

function isDocumentedPackageSubpath(subpath, documentedExports) {
  if (documentedExports.has(subpath)) return documentedExports.get(subpath) !== null

  let bestMatch = null
  for (const [documentedSubpath, target] of documentedExports) {
    const wildcardIndex = documentedSubpath.indexOf('*')
    if (wildcardIndex === -1) continue

    const prefix = documentedSubpath.slice(0, wildcardIndex)
    const suffix = documentedSubpath.slice(wildcardIndex + 1)
    const matches = subpath.length >= prefix.length + suffix.length
      && subpath.startsWith(prefix)
      && subpath.endsWith(suffix)
    if (!matches) continue

    if (!bestMatch
      || prefix.length > bestMatch.prefixLength
      || (prefix.length === bestMatch.prefixLength && documentedSubpath.length > bestMatch.subpathLength)) {
      bestMatch = {
        prefixLength: prefix.length,
        subpathLength: documentedSubpath.length,
        target,
      }
    }
  }

  return bestMatch !== null && bestMatch.target !== null
}

function getOpenForgeImportMessage(importPath, allowedOpenForgePackageExports) {
  const packageName = getOpenForgePackageName(importPath)
  if (!packageName) return null

  const allowedSubpaths = allowedOpenForgePackageExports.get(packageName)
  if (!allowedSubpaths) return PRIVATE_OPENFORGE_PACKAGE_MESSAGE

  const subpath = importPath.slice(packageName.length)
  if (isDocumentedPackageSubpath(subpath, allowedSubpaths)) return null

  return `Plugins may only import documented exports from ${packageName}.`
}

function getScriptBlocks(source, filePath) {
  if (!filePath.endsWith('.svelte')) return [{ content: source, start: 0 }]

  const blocks = []
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let match

  while ((match = scriptPattern.exec(source)) !== null) {
    const content = match[1]
    if (content === undefined) continue
    blocks.push({ content, start: match.index + match[0].indexOf(content) })
  }

  return blocks
}

function collectImportSpecifiers(source, filePath) {
  const specifiers = []
  const extension = path.extname(filePath)
  const parserPlugins = []
  if (extension === '.ts' || extension === '.tsx' || extension === '.svelte') parserPlugins.push('typescript')
  if (extension === '.tsx' || extension === '.jsx') parserPlugins.push('jsx')

  for (const block of getScriptBlocks(source, filePath)) {
    const sourceFile = parse(block.content, { sourceType: 'unambiguous', plugins: parserPlugins })

    function addModuleSpecifier(moduleSpecifier, node) {
      if (moduleSpecifier?.type !== 'StringLiteral') return
      specifiers.push({
        importPath: moduleSpecifier.value,
        line: getLineNumber(source, block.start + (node.start ?? 0)),
      })
    }

    function visit(node) {
      if (!node || typeof node !== 'object') return

      if (node.type === 'ImportDeclaration'
        || node.type === 'ExportNamedDeclaration'
        || node.type === 'ExportAllDeclaration') {
        addModuleSpecifier(node.source, node)
      }

      if (node.type === 'TSImportEqualsDeclaration'
        && node.moduleReference.type === 'TSExternalModuleReference') {
        addModuleSpecifier(node.moduleReference.expression, node)
      }

      if (node.type === 'ImportExpression') addModuleSpecifier(node.source, node)

      if (node.type === 'CallExpression' && node.arguments.length > 0) {
        if (node.callee.type === 'Import') addModuleSpecifier(node.arguments[0], node)
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          addModuleSpecifier(node.arguments[0], node)
        }
      }

      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(visit)
        else visit(child)
      }
    }

    visit(sourceFile)
  }

  return specifiers
}

function resolveRelativeImport(filePath, importPath) {
  if (importPath.startsWith('.')) return path.resolve(path.dirname(filePath), importPath)
  if (path.isAbsolute(importPath)) return path.normalize(importPath)
  return null
}

function isPackageSourcePath(repoRoot, targetPath) {
  const packagesRoot = path.join(repoRoot, 'packages')
  if (!isWithin(packagesRoot, targetPath)) return false

  const relativeParts = path.relative(packagesRoot, targetPath).split(path.sep)
  return relativeParts.length >= 2 && relativeParts[1] === 'src'
}

function isBareAppPrivateSourceImport(importPath) {
  return importPath === 'src' || importPath.startsWith('src/')
}

function isBareRustSidecarSourceImport(importPath) {
  return importPath === 'src-tauri' || importPath.startsWith('src-tauri/')
}

function isBarePackageSourceImport(importPath) {
  if (importPath === 'packages') return false
  const parts = importPath.split('/')
  return parts[0] === 'packages' && parts.length >= 3 && parts[2] === 'src'
}

function getViolationMessage({ importPath, filePath, repoRoot, allowedOpenForgePackageExports }) {
  if (isBareAppPrivateSourceImport(importPath)) return APP_PRIVATE_SOURCE_MESSAGE
  if (isBareRustSidecarSourceImport(importPath)) return RUST_SIDECAR_SOURCE_MESSAGE
  if (isBarePackageSourceImport(importPath)) return PACKAGE_SOURCE_MESSAGE

  const openForgeImportMessage = getOpenForgeImportMessage(importPath, allowedOpenForgePackageExports)
  if (openForgeImportMessage) return openForgeImportMessage

  const targetPath = resolveRelativeImport(filePath, importPath)
  if (!targetPath) return null

  if (isWithin(path.join(repoRoot, 'src'), targetPath)) return APP_PRIVATE_SOURCE_MESSAGE
  if (isWithin(path.join(repoRoot, 'src-tauri'), targetPath)) return RUST_SIDECAR_SOURCE_MESSAGE
  if (isPackageSourcePath(repoRoot, targetPath)) return PACKAGE_SOURCE_MESSAGE

  return null
}

function walkFiles(targetPath, files = []) {
  if (!existsSync(targetPath)) return files

  const stat = statSync(targetPath)
  if (stat.isFile()) {
    if (isSourceFile(targetPath)) files.push(targetPath)
    return files
  }

  if (!stat.isDirectory()) return files

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    walkFiles(path.join(targetPath, entry.name), files)
  }

  return files
}

export function collectPluginSourceFiles(repoRoot) {
  const pluginsRoot = path.join(repoRoot, DEFAULT_PLUGIN_SOURCE_ROOT)
  if (!existsSync(pluginsRoot)) return []

  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => walkFiles(path.join(pluginsRoot, entry.name, 'src')))
    .sort()
}

export function findPluginImportBoundaryViolations({ files, repoRoot }) {
  const normalizedRepoRoot = path.resolve(repoRoot)
  const allowedOpenForgePackageExports = readAllowedOpenForgePackageExports(normalizedRepoRoot)
  const violations = []

  for (const [filePath, source] of files.entries()) {
    const normalizedFilePath = path.resolve(filePath)
    const relativeFilePath = path.relative(normalizedRepoRoot, normalizedFilePath)

    for (const specifier of collectImportSpecifiers(source, normalizedFilePath)) {
      const message = getViolationMessage({
        importPath: specifier.importPath,
        filePath: normalizedFilePath,
        repoRoot: normalizedRepoRoot,
        allowedOpenForgePackageExports,
      })
      if (!message) continue

      violations.push({
        file: relativeFilePath,
        line: specifier.line,
        importPath: specifier.importPath,
        message,
      })
    }
  }

  return violations
}

function main() {
  const repoRoot = process.cwd()
  const filePaths = collectPluginSourceFiles(repoRoot)
  const files = new Map(filePaths.map((filePath) => [filePath, readFileSync(filePath, 'utf8')]))
  const violations = findPluginImportBoundaryViolations({ files, repoRoot })

  if (violations.length > 0) {
    console.error('Plugin import boundary violations found:')
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}: ${violation.importPath} - ${violation.message}`)
    }
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
