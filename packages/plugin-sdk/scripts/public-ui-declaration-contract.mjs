import { parse } from '@babel/parser'

function instanceScripts(componentSource) {
  return [...componentSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bcontext\s*=|\bmodule\b/.test(match[0]))
    .map((match) => match[1] ?? '')
}

function childNodes(node) {
  return Object.entries(node)
    .filter(([key]) => !['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments'].includes(key))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value) => value && typeof value === 'object' && typeof value.type === 'string')
}

export function findPrivateBitsUiTypeLeaks(componentSource) {
  const leaks = new Set()

  for (const script of instanceScripts(componentSource)) {
    const program = parse(script, { sourceType: 'module', plugins: ['typescript'] }).program
    const bitsUiNames = new Set()
    const typeDeclarations = new Map()
    const roots = []

    for (const rawStatement of program.body) {
      const exported = rawStatement.type === 'ExportNamedDeclaration'
      const statement = exported && rawStatement.declaration ? rawStatement.declaration : rawStatement

      if (statement.type === 'ImportDeclaration' && statement.source.value === 'bits-ui') {
        for (const specifier of statement.specifiers) bitsUiNames.add(specifier.local.name)
      }

      if (statement.type === 'TSInterfaceDeclaration' || statement.type === 'TSTypeAliasDeclaration') {
        typeDeclarations.set(statement.id.name, statement)
        if (exported) roots.push(statement)
      }

      if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) {
          const annotation = declaration.id.typeAnnotation?.typeAnnotation
          const initializer = declaration.init
          if (
            annotation &&
            initializer?.type === 'CallExpression' &&
            initializer.callee.type === 'Identifier' &&
            initializer.callee.name === '$props'
          ) {
            roots.push(annotation)
          }
        }
      }
    }

    const visitedDeclarations = new Set()
    function visit(node) {
      if (
        node.type === 'TSImportType' &&
        ((node.argument?.type === 'StringLiteral' && node.argument.value === 'bits-ui') ||
          (node.parameter?.type === 'TSLiteralType' && node.parameter.literal?.value === 'bits-ui'))
      ) {
        leaks.add('import("bits-ui")')
      }
      if (node.type === 'Identifier') {
        if (bitsUiNames.has(node.name)) leaks.add(node.name)
        const declaration = typeDeclarations.get(node.name)
        if (declaration && !visitedDeclarations.has(declaration)) {
          visitedDeclarations.add(declaration)
          visit(declaration)
        }
      }
      for (const child of childNodes(node)) visit(child)
    }

    for (const root of roots) visit(root)
  }

  return [...leaks].sort()
}

export function assertPublicUiDeclarationsHideBitsUi(components) {
  const violations = components.flatMap(({ componentName, source }) =>
    findPrivateBitsUiTypeLeaks(source).map((typeName) => `${componentName}: ${typeName}`),
  )

  if (violations.length > 0) {
    throw new Error(`Public OpenForge UI declarations expose private Bits UI types (${violations.join(', ')})`)
  }
}
