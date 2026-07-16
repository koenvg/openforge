import { render } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'

// Capture the onInsert callback passed to InjectionPointSlot by the pill.
const { injectionSlotProps, activeSessionsStore } = vi.hoisted(() => {
  // Minimal writable-compatible store that doesn't rely on imported svelte/store.
  function createStore<T>(initial: T) {
    let value = initial
    const subs = new Set<(v: T) => void>()
    return {
      subscribe(run: (v: T) => void) {
        run(value)
        subs.add(run)
        return () => { subs.delete(run) }
      },
      set(next: T) {
        value = next
        subs.forEach((s) => s(value))
      },
    }
  }
  return {
    injectionSlotProps: [] as Array<Record<string, unknown>>,
    activeSessionsStore: createStore<Map<string, unknown>>(new Map()),
  }
})

vi.mock('../plugin/InjectionPointSlot.svelte', () => ({
  default: vi.fn((_node: Element, props: Record<string, unknown>) => {
    injectionSlotProps.push({ ...props })
    return {
      update(nextProps: Record<string, unknown>) {
        injectionSlotProps.push({ ...nextProps })
      },
      destroy() {},
    }
  }),
}))

const writeSpy = vi.fn()
vi.mock('../../lib/agentTerminalPanel', () => ({
  writeAgentTerminalTranscription: (...args: unknown[]) => writeSpy(...args),
  getAgentStatusText: (_status: string, runningText: string) => runningText,
  getAgentStageLabel: (stage: string) => stage,
  getAgentSessionStatusBadgeClass: () => '',
  syncAgentPanelStatusFromSession: () => {},
  hydrateAgentTerminalPtyInstance: () => {},
}))

vi.mock('../../lib/injectables/pickerState.svelte', () => ({
  pickerState: {
    get open() { return false },
    get projectId() { return null },
    openPicker: vi.fn(),
    close: vi.fn(),
    handleSelect: vi.fn(),
  },
}))

vi.mock('../../lib/stores', () => ({
  activeSessions: activeSessionsStore,
  tasks: {
    subscribe(run: (v: unknown[]) => void) {
      run([])
      return () => {}
    },
  },
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}))

vi.mock('../../lib/agentPanelSessionSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/agentPanelSessionSync')>()
  return {
    ...actual,
    listenToAgentStatusChanged: vi.fn().mockResolvedValue(() => {}),
  }
})

vi.mock('../shared/adapters/VoiceInput.svelte', () => ({
  default: vi.fn(() => ({ update() {}, destroy() {} })),
}))

import AgentStatusPill from './AgentStatusPill.svelte'

describe('AgentStatusPill injection point', () => {
  it('routes injected text to the agent terminal', async () => {
    injectionSlotProps.length = 0
    writeSpy.mockClear()

    // Set an active session so the pill renders its view.
    activeSessionsStore.set(new Map([['T-1', {
      id: 'ses-1',
      ticket_id: 'T-1',
      status: 'running',
      stage: 'implement',
      provider: 'claude-code',
      checkpoint_data: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      claude_session_id: 'claude-sess-1',
      pi_session_id: null,
      opencode_session_id: null,
      pty_instance_id: null,
    }]]))

    render(AgentStatusPill, { props: { taskId: 'T-1' } })

    // InjectionPointSlot is always mounted (outside the {#if view} block).
    const captured = injectionSlotProps.find((p) => typeof p.onInsert === 'function')
    expect(captured).toBeDefined()
    expect(captured?.location).toBe('agentSession')
    expect(captured?.taskId).toBe('T-1')

    // Call onInsert and assert writeAgentTerminalTranscription was invoked correctly.
    const onInsert = captured!.onInsert as (text: string) => void
    onInsert('echo hi')

    // writeAgentTerminalTranscription returns a Promise; allow it to settle.
    await Promise.resolve()
    expect(writeSpy).toHaveBeenCalledWith('T-1', 'echo hi', 'InjectionPoint')
  })
})
