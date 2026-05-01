import { cleanup, render } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TerminalProjectView from './TerminalProjectView.svelte'

const { terminalTabsApi } = vi.hoisted(() => ({
  terminalTabsApi: {
    addTab: vi.fn(),
    closeActiveTab: vi.fn().mockResolvedValue(undefined),
    focusActiveTab: vi.fn(),
    switchToTab: vi.fn(),
  },
}))

vi.mock('./TerminalTabs.svelte', () => ({
  default: vi.fn(() => ({
    update() {},
    destroy() {},
    ...terminalTabsApi,
  })),
}))

function resetTerminalTabsApi() {
  terminalTabsApi.addTab.mockClear()
  terminalTabsApi.closeActiveTab.mockClear()
  terminalTabsApi.focusActiveTab.mockClear()
  terminalTabsApi.switchToTab.mockClear()
}

function makeKeyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

function renderProjectTerminalView() {
  render(TerminalProjectView, {
    props: {
      projectId: 'P-123',
      projectName: 'Demo',
      projectPath: '/tmp/demo',
    },
  })
}

describe('TerminalProjectView', () => {
  afterEach(() => {
    cleanup()
    resetTerminalTabsApi()
    vi.restoreAllMocks()
  })

  it('handles Cmd+T for project terminal tabs', async () => {
    renderProjectTerminalView()

    const event = makeKeyEvent({ key: 't', code: 'KeyT', metaKey: true })
    window.dispatchEvent(event)

    expect(terminalTabsApi.addTab).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('handles Cmd+Shift+digit for project terminal tab switching', async () => {
    renderProjectTerminalView()

    const event = makeKeyEvent({ key: '#', code: 'Digit3', metaKey: true, shiftKey: true })
    window.dispatchEvent(event)

    expect(terminalTabsApi.switchToTab).toHaveBeenCalledWith(2)
    expect(event.defaultPrevented).toBe(true)
  })
})
