import { describe, expect, it } from 'vitest'
import { classifyTaskBrowserDevToolsShortcut } from './taskBrowserDevToolsShortcuts'
import type { TaskBrowserDevToolsShortcutInput } from './taskBrowserDevToolsShortcuts'

const keyDown = (
  key: string,
  modifiers: Partial<TaskBrowserDevToolsShortcutInput> = {},
): TaskBrowserDevToolsShortcutInput => ({
  key,
  keyDown: true,
  repeat: false,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...modifiers,
})

describe('classifyTaskBrowserDevToolsShortcut', () => {
  it.each([
    ['macos', keyDown('f12'), 'toggle'],
    ['macos', keyDown('i', { meta: true, alt: true }), 'toggle'],
    ['macos', keyDown('c', { meta: true, shift: true }), 'elements'],
    ['macos', keyDown('j', { meta: true, alt: true }), 'console'],
    ['other', keyDown('f12'), 'toggle'],
    ['other', keyDown('i', { control: true, shift: true }), 'toggle'],
    ['other', keyDown('c', { control: true, shift: true }), 'elements'],
    ['other', keyDown('j', { control: true, shift: true }), 'console'],
  ] as const)('maps %s %s to %s', (platform, input, expected) => {
    expect(classifyTaskBrowserDevToolsShortcut(platform, input)).toBe(expected)
  })

  it('rejects the macOS toggle modifiers for the Elements shortcut', () => {
    expect(classifyTaskBrowserDevToolsShortcut(
      'macos',
      keyDown('c', { meta: true, alt: true }),
    )).toBeNull()
  })

  it.each([
    keyDown('f12', { repeat: true }),
    keyDown('i', { control: true, shift: true, alt: true }),
    keyDown('i', { meta: true, alt: true, shift: true }),
    keyDown('r', { control: true, shift: true }),
    { ...keyDown('f12'), keyDown: false },
  ])('ignores non-shortcut input %#', (input) => {
    expect(classifyTaskBrowserDevToolsShortcut('other', input)).toBeNull()
  })
})
