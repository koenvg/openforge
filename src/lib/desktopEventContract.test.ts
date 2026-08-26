import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type AppDesktopEventName,
  type AppDesktopEventPayloads,
  type SessionResumedPayload,
  type TerminalDesktopEventPayload,
} from './desktopIpcContract'
import { createAppDesktopEventListenerRegistrations } from './appDesktopEventListeners'
import type { AppDesktopEventDeps } from './appDesktopEventListeners/types'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Desktop event contract', () => {
  it('derives the app event inventory from the listener registrations', () => {
    const registrations = createAppDesktopEventListenerRegistrations({} as AppDesktopEventDeps)
    const names = registrations.map(registration => registration.eventName)

    expect(new Set(names).size).toBe(names.length)
    expectTypeOf<(typeof registrations)[number]['eventName']>().toEqualTypeOf<AppDesktopEventName>()
  })

  it('references concrete payload types for app events', () => {
    expectTypeOf<AppDesktopEventPayloads['session-resumed']>().toEqualTypeOf<SessionResumedPayload>()
    expectTypeOf<SessionResumedPayload>().toMatchTypeOf<{
      task_id: string
      workspace_path: string
      pty_instance_id?: number | null
    }>()
  })

  it('keeps PTY channel names and Rust payload fields inside the desktop adapter', () => {
    expectTypeOf<TerminalDesktopEventPayload<`pty-output-${string}`>>().toEqualTypeOf<{
      shell_session_key: string
      data: string
      instance_id: number
    }>()
    expectTypeOf<TerminalDesktopEventPayload<`pty-exit-${string}`>>()
      .toEqualTypeOf<{ instance_id: number }>()

    const adapterSource = source('src/lib/desktopTerminalTransport.ts')
    expect(adapterSource).toContain('`pty-output-${shellSessionKey}`')
    expect(adapterSource).toContain('`pty-exit-${shellSessionKey}`')
    expect(adapterSource).toContain('ptyInstanceId: payload.instance_id')

    const runtimeSource = source('packages/terminal-runtime/src/terminalAcquisition.ts')
    expect(runtimeSource).not.toContain('pty-output-')
    expect(runtimeSource).not.toContain('instance_id')

    const producerSource = source('src-tauri/src/pty_manager/events.rs')
    expect(producerSource).toContain('format!("pty-output-{}", self.session_key)')
    expect(producerSource).toContain('format!("pty-exit-{}", session_key)')
    expect(producerSource).toContain('"shell_session_key": &self.session_key')
    expect(producerSource).toContain('"instance_id": self.instance_id')
  })

})
