import { describe, expectTypeOf, it } from 'vitest'
import {
  createTerminalRuntime,
  type TerminalPtySpawnLease,
  type TerminalRuntime,
  type TerminalRuntimeDiagnostics,
  type TerminalRuntimeEnvironment,
  type TerminalRuntimeOptions,
  type TerminalSession,
  type TerminalTransport,
  type TerminalViewAttachment,
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

  it('exposes opaque sessions and semantic coordination capabilities', () => {
    type AcquiredSession = Awaited<ReturnType<TerminalRuntime['acquire']>>

    expectTypeOf<AcquiredSession>().toEqualTypeOf<TerminalSession>()
    expectTypeOf<TerminalRuntime['attach']>().returns.resolves.toEqualTypeOf<TerminalViewAttachment>()
    expectTypeOf<TerminalRuntime['beginPtySpawn']>().returns.toEqualTypeOf<TerminalPtySpawnLease | null>()
    expectTypeOf<TerminalRuntime['diagnostics']>().toEqualTypeOf<TerminalRuntimeDiagnostics>()

    if (false) {
      const session = {} as TerminalSession
      // @ts-expect-error Terminal Session state is runtime-owned.
      session.view
      // @ts-expect-error Terminal Session lifecycle is runtime-owned.
      session.ptyActive = false
    }
  })
})
