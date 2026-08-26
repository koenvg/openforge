#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { traverseBabelAst } from './babel-ast.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const ipcModulesDirectory = resolve(repoRoot, 'src/lib/ipc')
const registrySourcePaths = {
  domainsFile: resolve(repoRoot, 'src/lib/desktopIpcDomains.ts'),
  electronHandlersFile: resolve(repoRoot, 'src/electron/electronShellCommandHandler.ts'),
  internalRegistrationsFile: resolve(repoRoot, 'src/electron/internalSidecarCommandRegistrations.ts'),
  protocolFile: resolve(repoRoot, 'src/electron/frontendHostRequestProtocol.ts'),
}
const outputPath = resolve(repoRoot, 'src/electron/generatedDesktopIpcRegistry.ts')

function parseTypeScript(source) {
  return parse(source, { sourceType: 'module', plugins: ['typescript'] })
}

function unwrapExpression(expression) {
  let current = expression
  while (
    current.type === 'TSAsExpression'
    || current.type === 'TSSatisfiesExpression'
    || current.type === 'ParenthesizedExpression'
  ) {
    current = current.expression
  }
  return current
}

function* topLevelVariableDeclarations(sourceFile) {
  for (const statement of sourceFile.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type === 'VariableDeclaration') yield* declaration.declarations
  }
}

function variableInitializer(sourceFile, name) {
  for (const declaration of topLevelVariableDeclarations(sourceFile)) {
    if (declaration.id.type === 'Identifier' && declaration.id.name === name && declaration.init) {
      return unwrapExpression(declaration.init)
    }
  }
  throw new Error(`Missing ${name} declaration`)
}

function collectStringConstants(sourceFile) {
  const constants = new Map()
  for (const declaration of topLevelVariableDeclarations(sourceFile)) {
    if (declaration.id.type !== 'Identifier' || !declaration.init) continue
    const initializer = unwrapExpression(declaration.init)
    if (initializer.type === 'StringLiteral') constants.set(declaration.id.name, initializer.value)
  }
  return constants
}

function resolveString(expression, constants = new Map()) {
  if (!expression) return null
  const unwrapped = unwrapExpression(expression)
  if (unwrapped.type === 'StringLiteral') return unwrapped.value
  if (unwrapped.type === 'Identifier') return constants.get(unwrapped.name) ?? null
  return null
}

function propertyName(property) {
  if (property.computed) return null
  if (property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'StringLiteral' || property.key.type === 'NumericLiteral') {
    return String(property.key.value)
  }
  return null
}

function propertyValue(object, name) {
  const property = object.properties.find(candidate => (
    candidate.type === 'ObjectProperty' && propertyName(candidate) === name
  ))
  return property?.type === 'ObjectProperty' ? property.value : null
}

export function publicCommandContracts(sourceFile, moduleName = null) {
  const contracts = []
  for (const statement of sourceFile.program.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue
    const declaration = statement.declaration
    if (declaration?.type !== 'FunctionDeclaration' || !declaration.id) continue

    const invokeCalls = []
    traverseBabelAst(declaration, node => {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'invoke') {
        invokeCalls.push(node)
      }
    })
    if (invokeCalls.length === 0) {
      throw new Error(`Public IPC wrapper ${declaration.id.name} does not invoke a desktop command`)
    }

    const commands = invokeCalls.map(call => resolveString(call.arguments[0]))
    if (commands.some(command => command === null) || new Set(commands).size !== 1) {
      throw new Error(`Public IPC wrapper ${declaration.id.name} must invoke one static desktop command`)
    }

    const payloadKeys = []
    for (const invokeCall of invokeCalls) {
      const payload = invokeCall.arguments[1]
      if (!payload) continue
      if (payload.type !== 'ObjectExpression') {
        throw new Error(`Public IPC wrapper ${declaration.id.name} must use a static object payload`)
      }
      for (const property of payload.properties) {
        if (property.type !== 'ObjectProperty') {
          throw new Error(`Public IPC wrapper ${declaration.id.name} has a non-static payload key`)
        }
        const key = propertyName(property)
        if (!key) throw new Error(`Public IPC wrapper ${declaration.id.name} has an unresolved payload key`)
        if (!payloadKeys.includes(key)) payloadKeys.push(key)
      }
    }

    contracts.push({
      functionName: declaration.id.name,
      moduleName,
      ipcCommand: commands[0],
      payloadKeys,
    })
  }
  return contracts
}

function functionDomains(sourceFile) {
  const initializer = variableInitializer(sourceFile, 'desktopIpcFunctionDomains')
  if (initializer.type !== 'ObjectExpression') {
    throw new Error('desktopIpcFunctionDomains must be an object literal')
  }
  return new Map(initializer.properties.map(property => {
    if (property.type !== 'ObjectProperty') throw new Error('desktopIpcFunctionDomains contains a non-static entry')
    const functionName = propertyName(property)
    const domain = resolveString(property.value)
    if (!functionName || !domain) throw new Error('desktopIpcFunctionDomains contains an unresolved entry')
    return [functionName, domain]
  }))
}

function electronMainCommands(sourceFile) {
  const initializer = variableInitializer(sourceFile, 'electronShellCommandHandlers')
  if (initializer.type !== 'ObjectExpression') {
    throw new Error('electronShellCommandHandlers must be an object literal')
  }
  return new Set(initializer.properties.map(property => {
    if (property.type !== 'ObjectProperty') throw new Error('electronShellCommandHandlers contains a non-static entry')
    const command = propertyName(property)
    if (!command) throw new Error('electronShellCommandHandlers contains an unresolved command')
    return command
  }))
}

function internalSidecarContracts(sourceFile, constants) {
  const initializer = variableInitializer(sourceFile, 'internalSidecarCommandRegistrations')
  if (initializer.type !== 'ArrayExpression') {
    throw new Error('internalSidecarCommandRegistrations must be an array literal')
  }
  return initializer.elements.map(element => {
    if (element?.type !== 'ObjectExpression') {
      throw new Error('internalSidecarCommandRegistrations contains a non-object entry')
    }
    const ipcCommand = resolveString(propertyValue(element, 'ipcCommand'), constants)
    const domain = resolveString(propertyValue(element, 'domain'), constants)
    if (!ipcCommand || !domain) {
      throw new Error('internalSidecarCommandRegistrations contains an unresolved entry')
    }
    return { ipcCommand, owner: 'rust-sidecar', domain }
  })
}

function assertUnique(items, selectValue, label) {
  const values = items.map(selectValue)
  const duplicate = values.find((candidate, index) => values.indexOf(candidate) !== index)
  if (duplicate) throw new Error(`Duplicate ${label}: ${duplicate}`)
}

function buildRegistry({ ipcModules, domainsFile, electronHandlersFile, internalRegistrationsFile, protocolFile }) {
  const publicContracts = ipcModules.flatMap(({ moduleName, sourceFile }) => (
    publicCommandContracts(sourceFile, moduleName)
  ))
  const domains = functionDomains(domainsFile)
  const electronCommands = electronMainCommands(electronHandlersFile)
  const publicCommands = new Set(publicContracts.map(contract => contract.ipcCommand))

  assertUnique(publicContracts, contract => contract.functionName, 'public IPC wrapper')
  assertUnique(publicContracts, contract => contract.ipcCommand, 'public IPC command')

  const missingDomains = publicContracts.map(contract => contract.functionName).filter(name => !domains.has(name))
  const staleDomains = [...domains.keys()].filter(name => !publicContracts.some(contract => contract.functionName === name))
  if (missingDomains.length || staleDomains.length) {
    throw new Error(`Desktop IPC domain metadata is out of date. Missing: ${missingDomains.join(', ') || 'none'}. Stale: ${staleDomains.join(', ') || 'none'}.`)
  }

  const unwrappedElectronCommands = [...electronCommands].filter(command => !publicCommands.has(command))
  if (unwrappedElectronCommands.length) {
    throw new Error(`Electron main commands lack public wrappers: ${unwrappedElectronCommands.join(', ')}`)
  }

  const publicRegistry = publicContracts.map(contract => ({
    ...contract,
    owner: electronCommands.has(contract.ipcCommand) ? 'electron-main' : 'rust-sidecar',
    domain: domains.get(contract.functionName),
  }))

  const constants = new Map([
    ...collectStringConstants(protocolFile),
    ...collectStringConstants(internalRegistrationsFile),
  ])
  const internalRegistry = internalSidecarContracts(internalRegistrationsFile, constants)
  assertUnique(internalRegistry, contract => contract.ipcCommand, 'internal sidecar command')

  const duplicateInternal = internalRegistry.find(contract => publicCommands.has(contract.ipcCommand))
  if (duplicateInternal) {
    throw new Error(`Internal sidecar command also has a public wrapper: ${duplicateInternal.ipcCommand}`)
  }

  return { publicRegistry, internalRegistry }
}

function render({ publicRegistry, internalRegistry }) {
  const publicEntries = publicRegistry.map(contract => (
    `  ${JSON.stringify(contract)},`
  )).join('\n')
  const internalEntries = internalRegistry.map(contract => (
    `  ${JSON.stringify(contract)},`
  )).join('\n')

  return `// Generated by scripts/generate-desktop-ipc-registry.mjs. Do not edit.\nexport const desktopCommandContracts = [\n${publicEntries}\n] as const\n\nconst internalDesktopCommandContracts = [\n${internalEntries}\n] as const\n\nexport const desktopCommandOwnershipContracts = [\n  ...desktopCommandContracts,\n  ...internalDesktopCommandContracts,\n] as const\n\nexport const SIDECAR_BACKED_COMMANDS: ReadonlySet<string> = new Set(\n  desktopCommandOwnershipContracts\n    .filter(contract => contract.owner === 'rust-sidecar')\n    .map(contract => contract.ipcCommand),\n)\n`
}

async function generate() {
  const [sourceFiles, ipcModuleEntries] = await Promise.all([
    Promise.all(Object.entries(registrySourcePaths).map(async ([name, path]) => [
      name,
      parseTypeScript(await readFile(path, 'utf8')),
    ])),
    readdir(ipcModulesDirectory, { withFileTypes: true }),
  ])
  const ipcModules = await Promise.all(
    ipcModuleEntries
      .filter(entry => entry.isFile() && extname(entry.name) === '.ts')
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async entry => ({
        moduleName: basename(entry.name, '.ts'),
        sourceFile: parseTypeScript(await readFile(resolve(ipcModulesDirectory, entry.name), 'utf8')),
      })),
  )

  return render(buildRegistry({ ...Object.fromEntries(sourceFiles), ipcModules }))
}

async function main() {
  const generated = await generate()
  if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8').catch(() => '')
    if (current !== generated) {
      throw new Error('Generated desktop IPC registry is stale. Run pnpm electron:contract:generate.')
    }
  } else {
    await writeFile(outputPath, generated)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
