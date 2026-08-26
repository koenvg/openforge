import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type AppDesktopEventName,
  type AppDesktopEventPayloads,
  type SessionResumedPayload,
} from './desktopIpcContract'
import { createAppDesktopEventListenerRegistrations } from './appDesktopEventListeners'
import type { AppDesktopEventDeps } from './appDesktopEventListeners/types'
import {
  ptyExitEventName,
  ptyOutputEventName,
  type PtyExitEventPayload,
  type PtyOutputEventPayload,
} from '@openforge-app/terminal-runtime'

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

  it('builds PTY channels used by the real renderer listeners and Rust producer', () => {
    expect(ptyOutputEventName('T-1')).toBe('pty-output-T-1')
    expect(ptyExitEventName('T-1-shell-2')).toBe('pty-exit-T-1-shell-2')
    expectTypeOf<PtyOutputEventPayload>().toEqualTypeOf<{
      shell_session_key: string
      data: string
      instance_id: number
    }>()
    expectTypeOf<PtyExitEventPayload>().toEqualTypeOf<{ instance_id: number }>()

    const acquisitionSource = source('packages/terminal-runtime/src/terminalAcquisition.ts')
    expect(acquisitionSource).toContain('ptyOutputEventName(terminalKey)')
    expect(acquisitionSource).toContain('ptyExitEventName(terminalKey)')

    const producerSource = source('src-tauri/src/pty_manager/events.rs')
    expect(producerSource).toContain('format!("pty-output-{}", self.session_key)')
    expect(producerSource).toContain('format!("pty-exit-{}", session_key)')
    expect(producerSource).toContain('"shell_session_key": &self.session_key')
    expect(producerSource).toContain('"instance_id": self.instance_id')
  })

})
