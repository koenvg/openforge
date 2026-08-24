import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@babel/parser'
import type { CallExpression, Node, ObjectProperty } from '@babel/types'
import { describe, expect, it } from 'vitest'
import { traverseBabelAst } from '../../scripts/babel-ast.mjs'
import * as ipc from './ipc'
import {
  appDesktopEventContracts,
  desktopCommandContracts,
  desktopCommandOwnershipContracts,
  dynamicDesktopEventContracts,
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

  it('locks the app desktop event channel names registered by appDesktopEventListeners', () => {
    expect(appDesktopEventContracts.map(contract => contract.eventName)).toEqual([
      'github-sync-complete',
      'task-pull-request-updated',
      'openforge-app-events-gap',
      'review-status-changed',
      'action-complete',
      'implementation-failed',
      'session-resumed',
      'startup-resume-complete',
      'new-pr-comment',
      'comment-addressed',
      'ci-status-changed',
      'agent-event',
      'session-aborted',
      'agent-status-changed',
      'agent-pty-exited',
      'review-pr-count-changed',
      'authored-prs-updated',
      'github-rate-limited',
      'plugin-frontend-command-request',
      'openforge.open-url',
      'openforge.write-clipboard-text',
      'plugin-installation-changed',
      'app-plugin-enablement-changed',
      'project-plugin-enablement-changed',
      'plugin-reload-requested',
      'task-changed',
    ])
  })

  it('locks high-risk dynamic PTY and plugin event patterns outside appDesktopEventListeners', () => {
    expect(dynamicDesktopEventContracts.map(contract => contract.eventPattern)).toEqual([
      'pty-output-{taskId}',
      'pty-exit-{taskId}',
      'pty-output-{taskId}-shell-{terminalIndex}',
      'pty-exit-{taskId}-shell-{terminalIndex}',
      'plugin:sidecar-exited',
      'plugin:sidecar-failed',
      'whisper-download-progress',
      '{plugin-defined-desktop-event}',
    ])
    expect(dynamicDesktopEventContracts.find(contract => contract.eventPattern === 'pty-output-{taskId}')).toMatchObject({
      payload: '{ task_id: string; data: string; instance_id: number }',
      domain: 'agent-session-pty',
    })
    expect(dynamicDesktopEventContracts.find(contract => contract.eventPattern === 'pty-exit-{taskId}')).toMatchObject({
      payload: '{ instance_id: number }',
      domain: 'agent-session-pty',
    })
    expect(dynamicDesktopEventContracts.find(contract => contract.eventPattern === 'plugin:sidecar-exited')).toMatchObject({
      domain: 'plugins',
      payload: '{ code: number | null; signal: number | null; pid: number | null; retry_attempts: number }',
    })
    expect(dynamicDesktopEventContracts.find(contract => contract.eventPattern === 'plugin:sidecar-failed')).toMatchObject({
      domain: 'plugins',
      payload: '{ error: string | null; retry_attempts: number }',
    })
    expect(dynamicDesktopEventContracts.find(contract => contract.eventPattern === 'whisper-download-progress')).toMatchObject({
      domain: 'whisper-audio',
      payload: '{ model_size: string; bytes_downloaded: number; total_bytes: number; percentage: number }',
    })
  })

  it('locks known non-obvious event payload shapes', () => {
    expect(appDesktopEventContracts.find(contract => contract.eventName === 'session-resumed')).toMatchObject({
      payload: '{ task_id: string; workspace_path: string; pty_instance_id?: number | null }',
    })
    expect(appDesktopEventContracts.find(contract => contract.eventName === 'agent-pty-exited')).toMatchObject({
      payload: '{ task_id: string; success: boolean; instance_id: number }',
    })
    expect(appDesktopEventContracts.find(contract => contract.eventName === 'task-changed')).toMatchObject({
      payload: '{ action: "created" | "updated" | "deleted"; task_id: string }',
    })
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
