import { describe, expectTypeOf, it } from 'vitest'
import {
  createTerminalRuntime,
  type TerminalRuntimeEnvironment,
  type TerminalRuntimeOptions,
  type TerminalTransport,
} from './index'

describe('Terminal Runtime constructor contract', () => {
  it('accepts one options object with a transport and environment', () => {
    expectTypeOf<TerminalRuntimeOptions>().toMatchTypeOf<{
      transport: TerminalTransport
      environment: TerminalRuntimeEnvironment
    }>()
  })

  it('does not retain the old host callback bag or a second options argument', () => {
    if (false) {
      const transport = {} as TerminalTransport
      const environment = {} as TerminalRuntimeEnvironment
      createTerminalRuntime({ transport, environment })

      const oldHost: TerminalRuntimeOptions = {
        // @ts-expect-error The old callback bag is not TerminalRuntimeOptions.
        listenEvent: async () => () => undefined,
        getPtyBuffer: async () => ({ buffer: null, isLive: false, instanceId: null }),
      }
      createTerminalRuntime(oldHost)

      // @ts-expect-error Terminal Runtime has one constructor shape.
      createTerminalRuntime({ transport, environment }, {})
    }
  })
})
