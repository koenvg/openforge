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

const TEMPLATE_NAME_REFERENCE_TYPES = new Set([
  'AnimateDirective',
  'Component',
  'TransitionDirective',
  'UseDirective',
])

function getLineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

const LOCAL_BINDING = Symbol('local binding')

function createScope(parent = null) {
  return { bindings: new Map(), parent }
}

function declarePattern(pattern, scope, binding = LOCAL_BINDING) {
  if (!pattern) return

  switch (pattern.type) {
    case 'Identifier':
      scope.bindings.set(pattern.name, binding)
      break
    case 'ArrayPattern':
      for (const element of pattern.elements) declarePattern(element, scope, binding)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        declarePattern(property.type === 'RestElement' ? property.argument : property.value, scope, binding)
      }
      break
    case 'AssignmentPattern':
      declarePattern(pattern.left, scope, binding)
      break
    case 'RestElement':
      declarePattern(pattern.argument, scope, binding)
      break
    case 'TSParameterProperty':
      declarePattern(pattern.parameter, scope, binding)
      break
  }
}

function declareStatement(statement, scope, importBindings) {
  if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') {
    if (statement.declaration) declareStatement(statement.declaration, scope, importBindings)
    return
  }

  switch (statement.type) {
    case 'ImportDeclaration':
      for (const specifier of statement.specifiers) {
        declarePattern(specifier.local, scope, importBindings.get(specifier))
      }
      break
    case 'VariableDeclaration':
      for (const declaration of statement.declarations) declarePattern(declaration.id, scope)
      break
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
    case 'TSEnumDeclaration':
    case 'TSInterfaceDeclaration':
    case 'TSModuleDeclaration':
    case 'TSTypeAliasDeclaration':
      declarePattern(statement.id, scope)
      break
  }
}

function declareStatements(statements, scope, importBindings) {
  for (const statement of statements) declareStatement(statement, scope, importBindings)
}

function isIdentifierReference(parent, key) {
  if (!parent) return true

  switch (parent.type) {
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ImportSpecifier':
      return false
    case 'VariableDeclarator':
      return key !== 'id'
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return key !== 'id' && key !== 'params'
    case 'ClassDeclaration':
    case 'ClassExpression':
      return key !== 'id'
    case 'CatchClause':
      return key !== 'param'
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return key !== 'property' || parent.computed
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
    case 'TSPropertySignature':
    case 'TSMethodSignature':
      return key !== 'key' || parent.computed || parent.shorthand
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return key !== 'label'
    case 'ExportSpecifier':
      return key === 'local'
    case 'TSQualifiedName':
      return key !== 'right'
    case 'EachBlock':
      return key !== 'context'
    case 'AwaitBlock':
      return key !== 'value' && key !== 'error'
    case 'SnippetBlock':
      return key !== 'expression' && key !== 'parameters'
    default:
      return true
  }
}

function resolveBinding(scope, name) {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) return current.bindings.get(name)
  }
  return undefined
}

function markReference(scope, name) {
  let binding = resolveBinding(scope, name)
  if (binding === undefined && name.startsWith('$') && name.length > 1) {
    binding = resolveBinding(scope, name.slice(1))
  }
  if (binding !== undefined && binding !== LOCAL_BINDING) binding.used = true
}

function collectImportReferences(ast, imports, importBindings) {
  function visitFragment(fragment, scope) {
    for (const node of fragment.nodes) {
      if (node.type === 'SnippetBlock') declarePattern(node.expression, scope)
    }
    for (const node of fragment.nodes) visit(node, scope, fragment, 'nodes')
  }

  function visitFunction(node, scope) {
    const functionScope = createScope(scope)
    declarePattern(node.id, functionScope)
    for (const parameter of node.params) declarePattern(parameter, functionScope)
    if (node.body.type === 'BlockStatement') {
      declareStatements(node.body.body, functionScope, importBindings)
    }

    for (const [childKey, child] of Object.entries(node)) {
      if (!['body', 'id', 'loc', 'metadata', 'params'].includes(childKey)) {
        visit(child, functionScope, node, childKey)
      }
    }
    for (const parameter of node.params) visit(parameter, functionScope, node, 'params')
    if (node.body.type === 'BlockStatement') {
      for (const statement of node.body.body) visit(statement, functionScope, node.body, 'body')
    } else {
      visit(node.body, functionScope, node, 'body')
    }
  }

  function visit(node, scope, parent = null, key = null) {
    if (!node || typeof node !== 'object') return

    switch (node.type) {
      case 'ImportDeclaration':
        return
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        visitFunction(node, scope)
        return
      case 'BlockStatement': {
        const blockScope = createScope(scope)
        declareStatements(node.body, blockScope, importBindings)
        for (const statement of node.body) visit(statement, blockScope, node, 'body')
        return
      }
      case 'CatchClause': {
        const catchScope = createScope(scope)
        declarePattern(node.param, catchScope)
        visit(node.param, catchScope, node, 'param')
        visit(node.body, catchScope, node, 'body')
        return
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const loopScope = createScope(scope)
        const declaration = node.init ?? node.left
        if (declaration?.type === 'VariableDeclaration') {
          declareStatement(declaration, loopScope, importBindings)
        }
        for (const [childKey, child] of Object.entries(node)) {
          if (childKey !== 'loc' && childKey !== 'metadata') {
            visit(child, loopScope, node, childKey)
          }
        }
        return
      }
      case 'Fragment':
        visitFragment(node, scope)
        return
      case 'EachBlock': {
        visit(node.expression, scope, node, 'expression')
        const bodyScope = createScope(scope)
        declarePattern(node.context, bodyScope)
        if (node.index) bodyScope.bindings.set(node.index, LOCAL_BINDING)
        visitFragment(node.body, bodyScope)
        if (node.fallback) visitFragment(node.fallback, scope)
        return
      }
      case 'AwaitBlock': {
        visit(node.expression, scope, node, 'expression')
        if (node.pending) visitFragment(node.pending, scope)
        if (node.then) {
          const thenScope = createScope(scope)
          declarePattern(node.value, thenScope)
          visitFragment(node.then, thenScope)
        }
        if (node.catch) {
          const catchScope = createScope(scope)
          declarePattern(node.error, catchScope)
          visitFragment(node.catch, catchScope)
        }
        return
      }
      case 'SnippetBlock': {
        const snippetScope = createScope(scope)
        for (const parameter of node.parameters) declarePattern(parameter, snippetScope)
        for (const parameter of node.parameters) visit(parameter, snippetScope, node, 'parameters')
        visitFragment(node.body, snippetScope)
        return
      }
    }

    if (node.type === 'Identifier' && isIdentifierReference(parent, key)) {
      markReference(scope, node.name)
    }

    if (TEMPLATE_NAME_REFERENCE_TYPES.has(node.type)) {
      markReference(scope, node.name.split('.')[0])
    }

    for (const [childKey, child] of Object.entries(node)) {
      if (childKey === 'loc' || childKey === 'metadata') continue
      if (Array.isArray(child)) {
        for (const item of child) visit(item, scope, node, childKey)
      } else {
        visit(child, scope, node, childKey)
      }
    }
  }

  const moduleScope = createScope()
  if (ast.module) {
    declareStatements(ast.module.content.body, moduleScope, importBindings)
    for (const statement of ast.module.content.body) {
      visit(statement, moduleScope, ast.module.content, 'body')
    }
  }

  const instanceScope = createScope(moduleScope)
  if (ast.instance) {
    declareStatements(ast.instance.content.body, instanceScope, importBindings)
    for (const statement of ast.instance.content.body) {
      visit(statement, instanceScope, ast.instance.content, 'body')
    }
  }

  visitFragment(ast.fragment, createScope(instanceScope))
  return imports
}

export function findUnusedSvelteImports(source, fileName = 'component.svelte') {
  const ast = parse(source, { filename: fileName, modern: true })
  const scriptBlocks = [ast.module, ast.instance]
    .filter(Boolean)
    .sort((left, right) => left.start - right.start)
  const imports = []
  const importBindings = new Map()

  for (const block of scriptBlocks) {
    for (const statement of block.content.body) {
      if (statement.type !== 'ImportDeclaration') continue

      for (const specifier of statement.specifiers) {
        const imported = { name: specifier.local.name, index: statement.start, used: false }
        imports.push(imported)
        importBindings.set(specifier, imported)
      }
    }
  }

  return collectImportReferences(ast, imports, importBindings)
    .filter((imported) => !imported.used)
    .map((imported) => ({
      name: imported.name,
      index: imported.index,
      line: getLineNumber(source, imported.index),
    }))
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
