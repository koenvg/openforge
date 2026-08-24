import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@babel/parser'
import type { CallExpression, Node, ObjectProperty } from '@babel/types'
import { describe, expect, it } from 'vitest'
import { traverseBabelAst } from '../../scripts/babel-ast.mjs'
import * as ipc from './ipc'
import {
  desktopCommandContracts,
  desktopCommandOwnershipContracts,
} from './desktopIpcContract'

interface ParsedInvokeContract {
  functionName: string
  ipcCommand: string
  payloadKeys: string[]
}

function sourceSlice(node: Node, sourceText: string): string {
  return node.start === null || node.end === null ? '' : sourceText.slice(node.start, node.end)
}

function propertyName(name: ObjectProperty['key'], sourceText: string): string {
  if (name.type === 'Identifier') return name.name
  if (name.type === 'StringLiteral' || name.type === 'NumericLiteral') return String(name.value)
  return sourceSlice(name, sourceText)
}

function findInvokeCalls(node: Node): CallExpression[] {
  const calls: CallExpression[] = []

  traverseBabelAst(node, value => {
    if (value.type === 'CallExpression' && value.callee.type === 'Identifier' && value.callee.name === 'invoke') {
      calls.push(value)
    }
  })

  return calls
}


function parseIpcInvokeContracts(): ParsedInvokeContract[] {
  const sourcePath = resolve(process.cwd(), 'src/lib/ipc.ts')
  const sourceText = readFileSync(sourcePath, 'utf8')
  const sourceFile = parse(sourceText, { sourceType: 'module', plugins: ['typescript'] })
  const contracts: ParsedInvokeContract[] = []

  for (const statement of sourceFile.program.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue
    const declaration = statement.declaration
    if (declaration?.type !== 'FunctionDeclaration' || !declaration.id) continue

    const invokeCalls = findInvokeCalls(declaration)
    if (invokeCalls.length === 0) continue

    const commandArgument = invokeCalls[0].arguments[0]
    if (!commandArgument || commandArgument.type !== 'StringLiteral') continue

    const payloadKeys = invokeCalls.flatMap((invokeCall) => {
      const payloadArgument = invokeCall.arguments[1]
      return payloadArgument?.type === 'ObjectExpression'
        ? payloadArgument.properties.map((property) => {
          if (property.type !== 'ObjectProperty') return sourceSlice(property, sourceText)
          if (property.shorthand && property.key.type === 'Identifier') return property.key.name
          return propertyName(property.key, sourceText)
        })
        : []
    }).filter((key, index, keys) => keys.indexOf(key) === index)

    contracts.push({
      functionName: declaration.id.name,
      ipcCommand: commandArgument.value,
      payloadKeys,
    })
  }

  return contracts
}

describe('Desktop IPC contract', () => {
  it('lists every public runtime ipc.ts function export', () => {
    const exportedFunctions = Object.entries(ipc)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort()

    expect(desktopCommandContracts.map(contract => contract.functionName).sort()).toEqual(exportedFunctions)
  })

  it('locks ipc.ts IPC command names and top-level payload keys', () => {
    const parsedContracts = parseIpcInvokeContracts()
      .map(contract => [contract.functionName, contract] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    const declaredContracts = desktopCommandContracts
      .map(({ functionName, ipcCommand, payloadKeys }) => [
        functionName,
        { functionName, ipcCommand, payloadKeys: [...payloadKeys] },
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right))

    expect(declaredContracts).toEqual(parsedContracts)
  })

  it('locks internal desktop command ownership outside the public ipc.ts wrappers', () => {
    const publicCommands = new Set<string>(desktopCommandContracts.map(contract => contract.ipcCommand))
    const internalContracts = desktopCommandOwnershipContracts
      .filter(contract => !publicCommands.has(contract.ipcCommand))
      .map(({ ipcCommand, owner, domain }) => ({ ipcCommand, owner, domain }))

    expect(internalContracts).toEqual([
      { ipcCommand: 'list_browser_session_purge_intents', owner: 'rust-sidecar', domain: 'plugins' },
      { ipcCommand: 'acknowledge_browser_session_purge_intent', owner: 'rust-sidecar', domain: 'plugins' },
      { ipcCommand: 'plugin_frontend_command_acknowledge', owner: 'rust-sidecar', domain: 'plugins' },
    ])
    expect(new Set(desktopCommandOwnershipContracts.map(contract => contract.ipcCommand)).size)
      .toBe(desktopCommandOwnershipContracts.length)
  })


  it('records Electron main ownership for desktop shell commands and Rust sidecar ownership for backend commands', () => {
    expect(desktopCommandContracts.find(contract => contract.functionName === 'openUrl')).toMatchObject({
      ipcCommand: 'open_url',
      owner: 'electron-main',
    })
    expect(desktopCommandContracts.find(contract => contract.functionName === 'quitApp')).toMatchObject({
      ipcCommand: 'quit_app',
      owner: 'electron-main',
    })
    expect(desktopCommandContracts.find(contract => contract.functionName === 'writeClipboardText')).toMatchObject({
      ipcCommand: 'write_clipboard_text',
      payloadKeys: ['text'],
      owner: 'electron-main',
    })
    expect(desktopCommandContracts.find(contract => contract.functionName === 'createTask')).toMatchObject({
      ipcCommand: 'create_task',
      owner: 'rust-sidecar',
    })
  })
})
