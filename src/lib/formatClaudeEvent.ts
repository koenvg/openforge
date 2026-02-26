// ANSI escape codes
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[33m'

/**
 * Format a Claude NDJSON event into ANSI-colored terminal text.
 * Returns null for events that should be silently skipped.
 */
export function formatClaudeEvent(eventType: string, data: string): string | null {
  try {
    const json = JSON.parse(data)
    switch (eventType) {
      case 'system.init':
        return `${DIM}Session started (${json.session_id ?? 'unknown'})${RESET}\r\n`

      case 'assistant':
        return formatAssistant(json)

      case 'tool_use':
        return formatToolUse(json)

      case 'tool_result':
        return formatToolResult(json)

      default:
        return null
    }
  } catch {
    return null
  }
}

function formatAssistant(json: Record<string, unknown>): string | null {
  const content = json.content
  if (!Array.isArray(content)) return null

  let out = ''
  for (const block of content) {
    if (block && typeof block === 'object' && 'type' in block) {
      if (block.type === 'text' && typeof block.text === 'string') {
        out += formatTextBlock(block.text)
      }
    }
  }
  return out || null
}

/** Convert markdown-ish text to simple ANSI. Handles newlines for terminal. */
function formatTextBlock(text: string): string {
  // Replace \n with \r\n for terminal line feeds
  return text.replace(/\n/g, '\r\n') + '\r\n'
}

function formatToolUse(json: Record<string, unknown>): string | null {
  const name = typeof json.name === 'string' ? json.name : 'unknown_tool'
  let inputPreview = ''
  if (json.input && typeof json.input === 'object') {
    const input = json.input as Record<string, unknown>
    // Show a short preview of tool input
    const keys = Object.keys(input)
    if (keys.length > 0) {
      const firstKey = keys[0]
      const firstVal = String(input[firstKey] ?? '')
      inputPreview = ` ${DIM}${firstKey}=${truncate(firstVal, 60)}${RESET}`
    }
  }
  return `\r\n${CYAN}${BOLD}> ${name}${RESET}${inputPreview}\r\n`
}

function formatToolResult(json: Record<string, unknown>): string | null {
  const content = json.content
  let summary = ''

  if (typeof content === 'string') {
    summary = truncate(content, 200)
  } else if (Array.isArray(content)) {
    // content blocks: extract text from first text block
    for (const block of content) {
      if (block && typeof block === 'object' && 'type' in block && block.type === 'text' && typeof block.text === 'string') {
        summary = truncate(block.text, 200)
        break
      }
    }
  }

  if (!summary) return `${DIM}  (result)${RESET}\r\n`

  // Show truncated result, converting newlines for terminal
  const formatted = summary.replace(/\n/g, '\r\n')
  return `${DIM}${YELLOW}  ${formatted}${RESET}\r\n`
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}
