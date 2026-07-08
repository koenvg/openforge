#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const DEFAULT_PLUGIN_SOURCE_ROOT = 'plugins'
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte'])
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.svelte-kit', 'coverage'])
const FALLBACK_OPENFORGE_PACKAGE_EXPORTS = new Map([
  [
    '@openforge-app/plugin-sdk',
    new Set([
      '',
      '/frontend',
      '/backend',
      '/testing',
      '/vite',
      '/package-metadata-schema.json',
      '/domain',
      '/prStatusPresentation',
      '/projectFileTree',
      '/markdown',
      '/numberParsing',
      '/sanitize',
      '/ui/MarkdownContent.svelte',
      '/ui/ResizablePanel.svelte',
      '/ui/Modal.svelte',
      '/ui/PluginPageHeader.svelte',
      '/ui/PluginViewState.svelte',
    ]),
  ],
  [
    '@openforge-app/terminal-runtime',
    new Set([
      '',
      '/terminalRuntime',
      '/terminalOptions',
      '/theme',
      '/shortcuts',
      '/shortcutController',
      '/TerminalTabsShell',
      '/xterm.css',
    ]),
  ],
  [
    '@openforge-app/pr-review-ui',
    new Set([
      '/AuthoredPrCard.svelte',
      '/ReviewPrCard.svelte',
      '/PrStatusChip.svelte',
      '/FileTree.svelte',
      '/ReviewSubmitPanel.svelte',
      '/PrOverviewTab.svelte',
      '/DiffViewer.svelte',
      '/NonApplicationFilesToggle.svelte',
      '/applicationFiles',
      '/diffAdapter',
      '/diffComments',
      '/diffHighlightConfig',
      '/diffHighlighter',
      '/diffSearch',
      '/diffWorker',
      '/fileSort',
      '/useDiffSearch.svelte',
      '/useDiffWorker.svelte',
      '/useFileContentsFetcher.svelte',
      '/useVirtualizer.svelte',
      '/fileStatus',
      '/githubMarkdown',
      '/prSort',
      '/prStatusPresentation',
      '/reviewFileIdentity',
      '/timeAgo',
    ]),
  ],
])

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

function getAllowedOpenForgePackageSubpaths(packageName) {
  return FALLBACK_OPENFORGE_PACKAGE_EXPORTS.get(packageName)
}

function getOpenForgeImportMessage(importPath) {
  const packageName = getOpenForgePackageName(importPath)
  if (!packageName) return null

  const allowedSubpaths = getAllowedOpenForgePackageSubpaths(packageName)
  if (!allowedSubpaths) return PRIVATE_OPENFORGE_PACKAGE_MESSAGE

  const subpath = importPath.slice(packageName.length)
  if (allowedSubpaths.has(subpath)) return null

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

  for (const block of getScriptBlocks(source, filePath)) {
    const sourceFile = ts.createSourceFile(filePath, block.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

    function addModuleSpecifier(moduleSpecifier, node) {
      if (!moduleSpecifier || !ts.isStringLiteralLike(moduleSpecifier)) return
      specifiers.push({
        importPath: moduleSpecifier.text,
        line: getLineNumber(source, block.start + node.getStart(sourceFile)),
      })
    }

    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        addModuleSpecifier(node.moduleSpecifier, node)
      }

      if (ts.isImportEqualsDeclaration(node)) {
        const moduleReference = node.moduleReference
        if (ts.isExternalModuleReference(moduleReference)) {
          addModuleSpecifier(moduleReference.expression, node)
        }
      }

      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          addModuleSpecifier(node.arguments[0], node)
        }

        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          addModuleSpecifier(node.arguments[0], node)
        }
      }
      ts.forEachChild(node, visit)
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

function getViolationMessage({ importPath, filePath, repoRoot }) {
  if (isBareAppPrivateSourceImport(importPath)) return APP_PRIVATE_SOURCE_MESSAGE
  if (isBareRustSidecarSourceImport(importPath)) return RUST_SIDECAR_SOURCE_MESSAGE
  if (isBarePackageSourceImport(importPath)) return PACKAGE_SOURCE_MESSAGE

  const openForgeImportMessage = getOpenForgeImportMessage(importPath)
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
  const violations = []

  for (const [filePath, source] of files.entries()) {
    const normalizedFilePath = path.resolve(filePath)
    const relativeFilePath = path.relative(normalizedRepoRoot, normalizedFilePath)

    for (const specifier of collectImportSpecifiers(source, normalizedFilePath)) {
      const message = getViolationMessage({
        importPath: specifier.importPath,
        filePath: normalizedFilePath,
        repoRoot: normalizedRepoRoot,
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
