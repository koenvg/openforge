// ANSI escape codes
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'

/**
 * Format a Claude NDJSON event into ANSI-colored terminal text.
 * Returns null for events that should be silently skipped.
 *
 * Claude CLI NDJSON format:
 *   system.init: { type: "system", subtype: "init", session_id: "...", ... }
 *   assistant:   { type: "assistant", message: { content: [{ type: "text"|"tool_use", ... }] } }
 *   tool_result: { type: "tool_result", content: "..."|[...], tool_use_id: "..." }
 *   result:      { type: "result", subtype: "success"|"error_...", result: "..." }
 */
export function formatClaudeEvent(eventType: string, data: string): string | null {
  try {
    const json = JSON.parse(data)
    switch (eventType) {
      case 'system.init':
        return `${DIM}Session started (${json.session_id ?? 'unknown'})${RESET}\r\n`

      case 'assistant':
        return formatAssistant(json)

      case 'tool_result':
        return formatToolResult(json)

      case 'result.success':
        return formatResultSuccess(json)

      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * Format an assistant message event.
 * Content is nested at json.message.content (array of text/tool_use blocks).
 */
function formatAssistant(json: Record<string, unknown>): string | null {
  const message = json.message as Record<string, unknown> | undefined
  if (!message) return null

  const content = message.content
  if (!Array.isArray(content)) return null

  let out = ''
  for (const block of content) {
    if (block && typeof block === 'object' && 'type' in block) {
      if (block.type === 'text' && typeof block.text === 'string') {
        out += formatTextBlock(block.text)
      } else if (block.type === 'tool_use') {
        out += formatToolUseBlock(block as Record<string, unknown>)
      }
      // Skip 'thinking' blocks silently
    }
  }
  return out || null
}

/** Convert markdown-ish text to simple ANSI. Handles newlines for terminal. */
function formatTextBlock(text: string): string {
  // Replace \n with \r\n for terminal line feeds
  return text.replace(/\n/g, '\r\n') + '\r\n'
}

/**
 * Format a tool_use content block (inside an assistant message).
 */
function formatToolUseBlock(block: Record<string, unknown>): string {
  const name = typeof block.name === 'string' ? block.name : 'unknown_tool'
  let inputPreview = ''
  if (block.input && typeof block.input === 'object') {
    const input = block.input as Record<string, unknown>
    const keys = Object.keys(input)
    if (keys.length > 0) {
      const firstKey = keys[0]
      const firstVal = String(input[firstKey] ?? '')
      inputPreview = ` ${DIM}${firstKey}=${truncate(firstVal, 60)}${RESET}`
    }
  }
  return `\r\n${CYAN}${BOLD}> ${name}${RESET}${inputPreview}\r\n`
}

/**
 * Format a top-level tool_result event.
 * Format: { type: "tool_result", content: "..."|[...], tool_use_id: "..." }
 */
function formatToolResult(json: Record<string, unknown>): string | null {
  const content = json.content
  let summary = ''

  if (typeof content === 'string') {
    summary = truncate(content, 200)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && 'type' in block && block.type === 'text' && typeof block.text === 'string') {
        summary = truncate(block.text, 200)
        break
      }
    }
  }

  if (!summary) return `${DIM}  (result)${RESET}\r\n`

  const formatted = summary.replace(/\n/g, '\r\n')
  return `${DIM}${YELLOW}  ${formatted}${RESET}\r\n`
}

/**
 * Format a result.success event (final summary).
 */
function formatResultSuccess(json: Record<string, unknown>): string | null {
  const result = typeof json.result === 'string' ? json.result : null
  if (!result) return `\r\n${GREEN}${BOLD}--- Done ---${RESET}\r\n`
  const formatted = truncate(result, 300).replace(/\n/g, '\r\n')
  return `\r\n${GREEN}${BOLD}--- Done ---${RESET}\r\n${DIM}${formatted}${RESET}\r\n`
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}
