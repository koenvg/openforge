import { writePty } from './ipc'

/**
 * `\r` is Enter to the agent CLI; `\n` and `\t` are prompt content.
 * `terminal_follow_up_input` in `src-tauri/src/agent_follow_up.rs` sanitizes the same way.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

/**
 * Enter is a separate write, 50ms later, so the CLI reads the text as a paste
 * and the keystroke as a submit rather than as part of the pasted body.
 */
export async function writePtyWithSubmit(taskId: string, text: string): Promise<void> {
  await writePty(taskId, text.replace(CONTROL_CHARACTERS, ''))
  await new Promise(resolve => setTimeout(resolve, 50))
  await writePty(taskId, '\r')
}
