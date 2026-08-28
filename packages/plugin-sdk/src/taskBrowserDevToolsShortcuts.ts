export type TaskBrowserDevToolsShortcutPlatform = 'macos' | 'other'

export type TaskBrowserDevToolsShortcut = 'toggle' | 'elements' | 'console'

export interface TaskBrowserDevToolsShortcutInput {
  key: string
  keyDown: boolean
  repeat: boolean
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export function classifyTaskBrowserDevToolsShortcut(
  platform: TaskBrowserDevToolsShortcutPlatform,
  input: TaskBrowserDevToolsShortcutInput,
): TaskBrowserDevToolsShortcut | null {
  if (!input.keyDown || input.repeat) return null
  if (input.key === 'f12') return 'toggle'

  if (input.key === 'c') {
    const elementsModified = platform === 'macos'
      ? input.meta && input.shift && !input.control && !input.alt
      : input.control && input.shift && !input.meta && !input.alt
    return elementsModified ? 'elements' : null
  }

  const modified = platform === 'macos'
    ? input.meta && input.alt && !input.control && !input.shift
    : input.control && input.shift && !input.meta && !input.alt
  if (!modified) return null
  if (input.key === 'i') return 'toggle'
  return input.key === 'j' ? 'console' : null
}
