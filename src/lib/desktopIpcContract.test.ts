import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
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

function propertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText(sourceFile)
}

function findInvokeCalls(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []

  function visit(child: ts.Node): void {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'invoke') {
      calls.push(child)
    }
    ts.forEachChild(child, visit)
  }

  ts.forEachChild(node, visit)
  return calls
}


function parseIpcInvokeContracts(): ParsedInvokeContract[] {
  const sourcePath = resolve(process.cwd(), 'src/lib/ipc.ts')
  const sourceText = readFileSync(sourcePath, 'utf8')
  const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const contracts: ParsedInvokeContract[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue
    const isExported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (!isExported) continue

    const invokeCalls = findInvokeCalls(statement)
    if (invokeCalls.length === 0) continue

    const commandArgument = invokeCalls[0].arguments[0]
    if (!commandArgument || !ts.isStringLiteral(commandArgument)) continue

    const payloadKeys = invokeCalls.flatMap((invokeCall) => {
      const payloadArgument = invokeCall.arguments[1]
      return payloadArgument && ts.isObjectLiteralExpression(payloadArgument)
        ? payloadArgument.properties.map((property) => {
          if (ts.isShorthandPropertyAssignment(property)) return property.name.text
          if (ts.isPropertyAssignment(property)) return propertyName(property.name, sourceFile)
          return property.getText(sourceFile)
        })
        : []
    }).filter((key, index, keys) => keys.indexOf(key) === index)

    contracts.push({
      functionName: statement.name.text,
      ipcCommand: commandArgument.text,
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
