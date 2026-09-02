import { writePty } from './ipc'

/**
 * `\n` and `\t` are prompt content; `\r` would submit the prompt early.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

const pasteAndSubmit = (prompt: string): string => `\x1b[200~${prompt}\x1b[201~\r`

/**
 * Pasting rather than typing is what stops the CLI from reading `@`, `/` or Tab inside a
 * comment body as keystrokes.
 */
export async function writePtyWithSubmit(taskId: string, text: string): Promise<void> {
  const prompt = text.replace(CONTROL_CHARACTERS, '')
  await writePty(taskId, prompt === '' ? '\r' : pasteAndSubmit(prompt))
}
