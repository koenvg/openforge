import { writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachTestTerminal, createHost } from './terminalRuntimeHost.testSupport'
import {
  resetTerminalRuntimeMocks,
  terminalMocks,
} from './terminalRuntimeFeatures.testSupport'
import { createTerminalRuntime } from './terminalRuntime'
import {
  getTerminalThemeSnapshot,
  getTerminalViewTheme,
  type TerminalColorProfile,
  type TerminalThemeSnapshot,
} from './theme'

function profile(seed: number): TerminalColorProfile {
  const color = (offset: number) => ({
    red: (seed + offset) % 256,
    green: (seed + offset + 16) % 256,
    blue: (seed + offset + 32) % 256,
  })
  return {
    version: 1,
    background: color(0),
    foreground: color(1),
    cursor: color(2),
    ansiColors: Array.from({ length: 16 }, (_, index) => color(index + 3)),
  }
}

function snapshot(appearance: 'light' | 'dark', seed: number): TerminalThemeSnapshot {
  const fallback = getTerminalThemeSnapshot(appearance)
  return {
    ...fallback,
    terminalTheme: {
      ...fallback.terminalTheme,
      // Deliberately disagree with the profile: the profile is the authority.
      background: '#000000',
      foreground: '#000000',
      red: '#000000',
    },
    colorProfile: profile(seed),
  }
}

describe('terminal runtime theme authority', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('updates every attached xterm from the authority profile without replacing its view or session', async () => {
    const light = snapshot('light', 17)
    const dark = snapshot('dark', 83)
    const themePresentation = writable(light)
    const host = createHost()
    host.environment.themeMode = undefined
    host.environment.themePresentation = themePresentation
    const programOverride = '\u001b]4;1;rgb:AAAA/BBBB/CCCC\u001b\\'
    host.setBuffer('T-1-shell-0', programOverride)
    host.setBuffer('T-1-shell-1', programOverride)
    const runtime = createTerminalRuntime(host)

    try {
      const firstSession = await runtime.acquire('T-1-shell-0')
      const secondSession = await runtime.acquire('T-1-shell-1')
      const firstAttachment = await attachTestTerminal(runtime, firstSession)
      const secondAttachment = await attachTestTerminal(runtime, secondSession)
      const terminals = [...terminalMocks.instances]
      const writesBeforeThemeChange = terminals.map(terminal => terminal.write.mock.calls.length)
      const readsBeforeThemeChange = host.transport.readReplay.mock.calls.length

      expect(terminals).toHaveLength(2)
      for (const terminal of terminals) {
        expect(terminal.constructorOptions.theme).toEqual(getTerminalViewTheme(light))
      }

      themePresentation.set(dark)

      await vi.waitFor(() => {
        expect(host.transport.readReplay).toHaveBeenCalledTimes(readsBeforeThemeChange + 2)
        for (const [index, terminal] of terminals.entries()) {
          const replayed = terminal.write.mock.calls
            .slice(writesBeforeThemeChange[index])
            .map(([data]) => typeof data === 'string' ? data : new TextDecoder().decode(data))
            .join('')
          expect(replayed).toContain(programOverride)
        }
      })
      expect(terminalMocks.instances).toEqual(terminals)
      expect(await runtime.acquire('T-1-shell-0')).toBe(firstSession)
      expect(await runtime.acquire('T-1-shell-1')).toBe(secondSession)
      expect(firstAttachment.generation).toBe(1)
      expect(secondAttachment.generation).toBe(1)
      for (const terminal of terminals) {
        expect(terminal.options.theme).toEqual(getTerminalViewTheme(dark))
      }
    } finally {
      runtime.dispose()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})
