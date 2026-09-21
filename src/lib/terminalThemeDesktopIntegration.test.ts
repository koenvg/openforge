import {
  createTerminalRuntime,
  type TerminalColorProfile,
  type TerminalTransport,
  type TerminalView,
} from '@openforge-app/terminal-runtime'
import { createFakeTerminalView } from '@openforge-app/terminal-runtime/testUtils'
import { get } from 'svelte/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThemeRuntime } from './theme'
import { DARK_THEME, LIGHT_THEME } from './themeContract'
import { resolveTerminalThemeSnapshot } from './terminalThemePresentation'

vi.mock('./ipc', () => ({ getConfig: vi.fn(), setConfig: vi.fn() }))

const PTY_INSTANCE_ID = 73
const SHELL_SESSION_KEY = 'T-theme-proof-shell-0'

function channel(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase().repeat(2)
}

function rgb(color: { red: number; green: number; blue: number }): string {
  return `rgb:${channel(color.red)}/${channel(color.green)}/${channel(color.blue)}`
}

function queryReplies(profile: TerminalColorProfile): Uint8Array {
  return new TextEncoder().encode([
    `\u001b]10;${rgb(profile.foreground)}\u001b\\`,
    `\u001b]11;${rgb(profile.background)}\u001b\\`,
    `\u001b]12;${rgb(profile.cursor)}\u001b\\`,
    `\u001b]4;1;${rgb(profile.ansiColors[1])}\u001b\\`,
  ].join(''))
}

function stubAttachmentEnvironment(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = [0]
  })
}

describe('desktop terminal theme integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('keeps a live shell attached while light, dark, and contributed profiles drive recovery replies', async () => {
    stubAttachmentEnvironment()
    let authorityProfile = resolveTerminalThemeSnapshot(LIGHT_THEME).colorProfile
    const publishedProfiles: TerminalColorProfile[] = []
    const theme = createThemeRuntime({
      root: document.documentElement,
      getStoredThemeId: async () => LIGHT_THEME.id,
      persistThemeId: async () => undefined,
      publishTerminalColorProfile: async (profile) => {
        authorityProfile = profile
        publishedProfiles.push(profile)
      },
    })
    const contributed = {
      ...DARK_THEME,
      id: 'proof.theme:midnight',
      label: 'Midnight proof',
      tokens: {
        ...DARK_THEME.tokens,
        terminalBackground: '#07111F',
        terminalForeground: '#E7F0FA',
        terminalRed: '#F05D6F',
      },
    }
    theme.registry.registerContributedTheme(contributed, {
      pluginId: 'proof.theme',
      generation: 1,
    })

    const views: TerminalView[] = []
    const transport: TerminalTransport = {
      subscribeSession: vi.fn(async () => ({
        setModelOutputEnabled: vi.fn(async () => undefined),
        dispose: vi.fn(),
      })),
      subscribeConnectionRestored: vi.fn(async () => ({ dispose: vi.fn() })),
      readReplay: vi.fn(async () => ({
        historicalData: null,
        isLive: true,
        ptyInstanceId: PTY_INSTANCE_ID,
        snapshot: {
          data: queryReplies(authorityProfile),
          continuationData: new Uint8Array(),
          ptyInstanceId: PTY_INSTANCE_ID,
          watermark: 0,
        },
      })),
      writeUserInput: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    const runtime = createTerminalRuntime({
      transport,
      environment: {
        openLink: async () => undefined,
        themePresentation: theme.terminalThemePresentation,
      },
      createTerminalView: () => {
        const view = createFakeTerminalView({ isMountedIn: vi.fn(() => true) })
        views.push(view)
        return view
      },
    })

    try {
      await theme.initialize()
      const session = await runtime.acquire(SHELL_SESSION_KEY)
      const attachment = await runtime.attach(session, document.createElement('div'))

      for (const themeId of [DARK_THEME.id, contributed.id, LIGHT_THEME.id]) {
        const replacementsBefore = vi.mocked(views[0].replaceSnapshot).mock.calls.length
        await theme.registry.selectTheme(themeId)
        await vi.waitFor(() => {
          expect(views[0].replaceSnapshot).toHaveBeenCalledTimes(replacementsBefore + 1)
        })
        const selected = get(theme.terminalThemePresentation)
        const recovered = vi.mocked(views[0].replaceSnapshot).mock.calls.at(-1)?.[0]
        expect(recovered?.data).toEqual(queryReplies(selected.colorProfile))
        expect(runtime.diagnostics.observe(SHELL_SESSION_KEY)?.lifecycle.currentPtyInstance)
          .toBe(PTY_INSTANCE_ID)
        expect(attachment.generation).toBe(1)
        expect(await runtime.acquire(SHELL_SESSION_KEY)).toBe(session)
      }

      expect(views).toHaveLength(1)
      expect(publishedProfiles).toHaveLength(4)
      expect(get(theme.registry.selectedTheme).id).toBe(LIGHT_THEME.id)
    } finally {
      runtime.dispose()
    }
  })
})
