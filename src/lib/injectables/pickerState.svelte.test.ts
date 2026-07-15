import { describe, it, expect, vi } from 'vitest'
import { pickerState } from './pickerState.svelte'
import type { Injectable } from '../types'

const inj = (invocationText: string): Injectable => ({
  id: 'personal:skill:g',
  kind: 'skill',
  name: 'g',
  description: null,
  origin: 'personal',
  triggerMode: 'manual-only',
  sourceDir: null,
  sourcePath: null,
  content: null,
  invocationText,
})

describe('pickerState', () => {
  it('opens with context and routes the selected text to onInsert, then closes', () => {
    const onInsert = vi.fn()
    pickerState.openPicker({ projectId: 'P-1', onInsert })
    expect(pickerState.open).toBe(true)
    expect(pickerState.projectId).toBe('P-1')

    pickerState.handleSelect(inj('hello'))
    expect(onInsert).toHaveBeenCalledWith('hello')
    expect(pickerState.open).toBe(false)
  })

  it('close() stops routing to a stale onInsert', () => {
    const onInsert = vi.fn()
    pickerState.openPicker({ projectId: 'P-2', onInsert })
    pickerState.close()
    expect(pickerState.open).toBe(false)
    pickerState.handleSelect(inj('ignored'))
    expect(onInsert).not.toHaveBeenCalled()
  })
})
