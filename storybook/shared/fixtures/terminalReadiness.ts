import { expect, userEvent, waitFor } from 'storybook/test'
import { getStoryScenario } from '../storyEnvironmentPreview'

type TerminalStoryContext = { loaded: Record<string, unknown>; canvasElement: HTMLElement }

export function terminalProgress(context: TerminalStoryContext, phase: string, detail: Record<string, unknown> = {}) {
  const element = context.canvasElement
  const history: unknown[] = JSON.parse(element.getAttribute('data-terminal-progress') ?? '[]')
  history.push({ phase, atMs: Math.round(performance.now()), ...detail })
  element.setAttribute('data-terminal-progress', JSON.stringify(history.slice(-20)))
}

/** Readiness means the production view has consumed and painted its replay, not just mounted xterm. */
export async function terminalReady(context: TerminalStoryContext, expectedText = 'OpenForge Terminal') {
  const terminal = getStoryScenario(context).terminal!
  context.canvasElement.removeAttribute('data-terminal-ready')
  terminalProgress(context, 'fonts')
  await context.canvasElement.ownerDocument.fonts.ready
  await waitFor(async () => {
    const visible = terminal.runtime.diagnostics.list().filter(key => terminal.runtime.diagnostics.observe(key).view.visible)
    terminalProgress(context, 'visible-views', { visible })
    expect(visible.length).toBeGreaterThan(0)
    for (const key of visible) {
      const state = terminal.runtime.diagnostics.observe(key)
      terminalProgress(context, 'replay', { key, state })
      expect(state.lifecycle.ptyActive || state.lifecycle.shellExited).toBe(true)
      expect(state.view.authorityReadPending, key).toBe(false)
      terminalProgress(context, 'drain', { key })
      const evidence = await terminal.runtime.diagnostics.drainPresentation(key)
      const text = terminal.runtime.diagnostics.capturePresentation(key).lines.map(line => line.text).join('\n')
      terminalProgress(context, 'text', { key, evidence, expectedText, textTail: text.slice(-512) })
      expect(text).toContain(expectedText)
    }
  }, { timeout: 10000 }).catch(error => {
    terminalProgress(context, 'failed', { error: String(error).slice(0, 2000) })
    throw error
  })
  // Local replay requests a steady ANSI cursor. Keep focus deterministic too.
  const input = [...context.canvasElement.querySelectorAll<HTMLTextAreaElement>('.xterm-helper-textarea')]
    .find(element => element.checkVisibility({ visibilityProperty: true }))
  input?.focus()
  // xterm auto-hides its scrollbars with a timer, not a CSS animation. Hover
  // through the public interaction boundary so overflow stays visibly scrollable.
  const scrollable = input?.closest('.xterm')?.querySelector<HTMLElement>('.xterm-scrollable-element')
  terminalProgress(context, 'hover')
  if (scrollable) await userEvent.hover(scrollable)
  terminalProgress(context, 'paint')
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  terminalProgress(context, 'ready')
  context.canvasElement.setAttribute('data-terminal-ready', 'true')
}
