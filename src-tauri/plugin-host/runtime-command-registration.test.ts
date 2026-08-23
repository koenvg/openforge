import { describe, expect, it } from 'vitest'
import { createPluginHostRuntime } from './index'
import { writeBackendModule } from './backend-module.test-fixtures'

describe('plugin-host backend command registration', () => {
  it('routes backend commands and explicit global event listeners through public integration primitives', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'sync',
            title: 'Backend Sync',
            input: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
            output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
            async handler(input) {
              await openforge.events.emit('sync.finished', { pluginId: context.pluginId, projectId: input.projectId })
              return { ok: true }
            }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'batch',
            title: 'Backend Batch',
            input: { type: 'array', items: { type: 'integer' } },
            output: { type: 'array', items: { type: 'string' } },
            async handler(input) {
              return input.map(String)
            }
          }))
          const events = []
          context.subscriptions.add(openforge.events.onGlobal('backend.sync.finished', event => events.push(event)))
          context.subscriptions.add(openforge.backend.registerMethod('events', { handler() { return events } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.activateBackend({ pluginId: 'backend', backendPath })
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'sync', payload: { projectId: 'P-1' } })).resolves.toEqual({ ok: true })
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'sync', payload: {} })).rejects.toThrow(/backend\.sync input.*projectId/i)
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'batch', payload: [1, 2] })).resolves.toEqual(['1', '2'])
    await expect(runtime.invokeCommand({ pluginId: 'backend', command: 'batch', payload: [1, '2'] })).rejects.toThrow(/backend\.batch input\[1\].*integer/i)
    await expect(runtime.listCommands()).resolves.toMatchObject([
      { id: 'sync', qualifiedId: 'backend.sync', pluginId: 'backend', title: 'Backend Sync' },
      { id: 'batch', qualifiedId: 'backend.batch', pluginId: 'backend', title: 'Backend Batch' },
    ])
    expect(await runtime.invokeBackend({ pluginId: 'backend', command: 'events' })).toEqual([{ pluginId: 'backend', projectId: 'P-1' }])
  })

  it('projects explicitly agent-facing backend commands into serializable descriptors', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'sync',
            title: 'Sync for people',
            discoverable: false,
            agent: {
              description: 'Synchronize the enabled project with its remote source.',
              examples: [{ force: true }]
            },
            input: { type: 'object', properties: { force: { type: 'boolean' } } },
            output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
            handler() { return { ok: true } }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'repair',
            title: 'Repair',
            agent: {
              description: 'Repair cached synchronization state.',
              discoverable: false
            },
            handler() { return null }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'ordinary',
            title: 'Ordinary command',
            handler() { return null }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    const response = await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'plugin.commands.list',
      params: { pluginId: 'backend', backendPath, projectId: 'P-1' },
    })
    expect(response.error).toBeUndefined()
    const descriptors = JSON.parse(JSON.stringify(response.result)) as Array<Record<string, unknown>>

    expect(descriptors).toEqual([
      {
        qualifiedId: 'backend.sync',
        pluginId: 'backend',
        runtime: 'backend',
        description: 'Synchronize the enabled project with its remote source.',
        examples: [{ force: true }],
        discoverable: true,
        input: { type: 'object', properties: { force: { type: 'boolean' } } },
        output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
      },
      {
        qualifiedId: 'backend.repair',
        pluginId: 'backend',
        runtime: 'backend',
        description: 'Repair cached synchronization state.',
        examples: [],
        discoverable: false,
      },
    ])
    expect(descriptors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ qualifiedId: 'backend.ordinary' }),
    ]))
    expect(descriptors.every(descriptor => !('handler' in descriptor))).toBe(true)
  })

  it('invokes only agent-facing backend commands with separate host-owned context', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'sync',
            title: 'Sync',
            agent: { description: 'Synchronize a project.' },
            input: {
              type: 'object',
              required: ['force'],
              additionalProperties: false,
              properties: { force: { type: 'boolean' } }
            },
            output: {
              type: 'object',
              required: ['input', 'context'],
              properties: {
                input: { type: 'object' },
                context: {
                  type: 'object',
                  required: ['taskId', 'projectId', 'source'],
                  properties: {
                    taskId: { type: 'string' },
                    projectId: { type: 'string' },
                    source: { const: 'agent-cli' }
                  }
                }
              }
            },
            handler(input, invocationContext) {
              return { input, context: invocationContext }
            }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'ordinary',
            title: 'Ordinary',
            handler() { return { shouldNotRun: true } }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'fail',
            title: 'Fail',
            agent: { description: 'Fail explicitly.' },
            handler() { throw new Error('sync exploded') }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'bad-output',
            title: 'Bad output',
            agent: { description: 'Return invalid output.' },
            output: { type: 'boolean' },
            handler() { return 'not a boolean' }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()
    const response = await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 101,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.sync',
        input: { force: true },
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 101,
      result: {
        input: { force: true },
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 102,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.sync',
        input: {},
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })).resolves.toMatchObject({
      error: { message: expect.stringMatching(/backend\.sync input.*force/i) },
    })

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 103,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.sync',
        input: { force: true },
        context: { taskId: 'T-42', projectId: 'P-2', source: 'agent-cli' },
      },
    })).resolves.toMatchObject({
      error: { message: 'commands registration agent invocation context Project P-2 does not match activated Project P-1' },
    })

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 104,
      method: 'plugin.commands.invoke',
      params: {
        pluginId: 'backend',
        backendPath,
        projectId: 'P-1',
        commandId: 'backend.ordinary',
        context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
      },
    })).resolves.toMatchObject({
      error: { message: 'Unknown agent-facing Plugin Command: backend.ordinary' },
    })

    for (const [id, commandId, message] of [
      [105, 'backend.fail', 'sync exploded'],
      [106, 'backend.bad-output', 'backend.bad-output output expected boolean'],
    ] as const) {
      await expect(runtime.handleJsonRpcRequest({
        jsonrpc: '2.0',
        id,
        method: 'plugin.commands.invoke',
        params: {
          pluginId: 'backend',
          backendPath,
          projectId: 'P-1',
          commandId,
          context: { taskId: 'T-42', projectId: 'P-1', source: 'agent-cli' },
        },
      })).resolves.toMatchObject({ error: { message: expect.stringContaining(message) } })
    }
  })

  it('rejects non-serializable schemas on agent-facing command registrations', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          const input = { type: 'object' }
          input.self = input
          context.subscriptions.add(openforge.commands.register({
            id: 'invalid',
            title: 'Invalid',
            agent: { description: 'Invalid schema example.' },
            input,
            handler() { return null }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await expect(runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 100,
      method: 'plugin.commands.list',
      params: { pluginId: 'backend', backendPath, projectId: 'P-1' },
    })).resolves.toMatchObject({
      error: { message: 'commands registration agent-facing input schema must be a JSON value' },
    })
  })

  it('reactivates backend command discovery when the resolved Project changes', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          const projectId = openforge.context.getSnapshot().projectId
          context.subscriptions.add(openforge.commands.register({
            id: projectId === 'P-2' ? 'second' : 'first',
            title: 'Project command',
            agent: { description: 'Command for ' + projectId },
            handler() { return null }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await expect(runtime.listAgentCommands({ pluginId: 'backend', backendPath, projectId: 'P-1' }))
      .resolves.toMatchObject([{ qualifiedId: 'backend.first', description: 'Command for P-1' }])
    await expect(runtime.listAgentCommands({ pluginId: 'backend', backendPath, projectId: 'P-2' }))
      .resolves.toMatchObject([{ qualifiedId: 'backend.second', description: 'Command for P-2' }])
  })
})
